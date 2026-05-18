// controller/customerOrderController.js
require("dotenv").config({ quiet: true });
const Order = require("../models/Order");
const Status = require("../models/Status");
const Product = require("../models/Product");
const Offer = require("../models/Offer");
const Delivery = require("../models/Delivery");
const Region = require("../models/Region");
const Coupon = require("../models/Coupon");
const dayjs = require("dayjs");
const Customer = require("../models/Customer");
const { findOptimalOfferCombination } = require("../utils/offerCalculations");
const { getFinalPrice } = require("../utils/priceUtils");
const { getShippingCostByRegionRules } = require("../utils/shippingUtils");
const { createCreditOrder } = require("../services/orderServices");
const { createCheckout } = require("../services/orderPaymentService");
const { roundQuantity } = require("../utils/quantityDecimals");

const addOrder = async (req, res) => {
  try {
    console.log('addOrder req.body: ', req.body)
    // שליפת הלקוח עם MainCustomer
    const customer = await Customer.findById(req.user._id).populate('mainCustomer');
    const permittedBarcodes = Array.isArray(customer?.mainCustomer?.permittedBarcodes)
      ? customer.mainCustomer.permittedBarcodes.map((barcode) => String(barcode || "").trim()).filter(Boolean)
      : [];
    const hasBarcodeRestrictions = permittedBarcodes.length > 0;
    const permittedBarcodeSet = hasBarcodeRestrictions ? new Set(permittedBarcodes) : null;

    // שלב 1: השמת המזהה של הסטטוס במקום המילה עצמה
    const status = await Status.findOne({ name: "Pending" });

    // שלב 2: מחיקת הזמנה קודמת אם קיימת
    const isOrderExist = await Order.findOne({ user: req.user._id, status: status._id });
    if (isOrderExist) {
      await Order.findByIdAndDelete(isOrderExist._id);
    }

    // שלב 3: אחזור פרטי העגלה (כמויות מעוגלות ל-2 ספרות עשרוניות)
    let cartItems = req.body.cart;
    if (Array.isArray(cartItems)) {
      cartItems = cartItems.map((item) => ({
        ...item,
        quantity: Number.isFinite(Number(item.quantity))
          ? roundQuantity(item.quantity)
          : item.quantity,
      }));
    }
    let serverCalculatedTotal = 0;
    let serverSubTotal = 0
    let totalDiscount = 0;
    let missingProducts = []; // מערך לשמירת המוצרים החסרים
    let priceConflicts = []; // מערך לשמירת מוצרים שהשתנה להם המחיר

    // שלב 4: בדיקת זמינות המוצרים
    const productIds = cartItems.map(item => item._id);
    const products = await Product.find({ _id: { $in: productIds } })
      .populate({ path: "categories", select: "_id name" });
    const productMap = new Map(products.map(product => [product._id.toString(), product]));

    // בדיקה על מוצרים חסרים או ששונה להם המחיר
    for (const item of cartItems) {
      const product = productMap.get(item._id.toString());

      // console.log('client cart item :>> ', item);
      // console.log('DB product :>> ', product);

      if (!product) {
        // המוצר לא נמצא במאגר הנתונים
        missingProducts.push({
          ...item,
          reason: 'המוצר לא נמצא'
        });
        continue; // ✅ דלג על שאר הבדיקות
      } else if (hasBarcodeRestrictions && !permittedBarcodeSet.has(String(product.barcode || "").trim())) {
        missingProducts.push({
          ...product.toObject(),
          reason: 'המוצר לא מורשה ללקוח'
        });
        continue; // ✅ דלג על שאר הבדיקות
      } else if (
        product.manageStock &&
        Number(item.quantity) > Number(product.stock) + 1e-6
      ) {
        // מלאי לא מספק - רק אם המלאי מנוהל
        missingProducts.push({
          ...product.toObject(),
          reason: 'לא במלאי'
        });
        continue; // ✅ דלג על שאר הבדיקות;
      } else if (product.status != "show") {
        // המוצר אינו זמין
        missingProducts.push({
          ...product.toObject(),
          reason: 'המוצר אינו זמין'
        });
        continue; // ✅ דלג על שאר הבדיקות;
      } else if (product.purchaseLimit && item.quantity > product.purchaseLimit) {
        // כמות הכמות שביקש הלוקוח עוברת את ההגבלה
        missingProducts.push({
          ...product.toObject(),
          reason: `הכמות המבוקשת חורגת ממגבלת הקנייה (${product.purchaseLimit})`
        });
        continue; // ✅ דלג על שאר הבדיקות;
      };

      // השוואת מחיר בסיס (ללא מבצע) - לפי המחירון של הלקוח
      const serverPrice = getFinalPrice(product, customer);
      const clientPrice = item.price || item.prices?.price || 0;

      if (Math.abs(clientPrice - serverPrice) > 0.01) {
        // console.log('server product :>> ', product);
        priceConflicts.push({
          product: product.toObject(),
          clientPrice: clientPrice,
          serverPrice: serverPrice
        });
      }
    };

    // אם יש מוצרים חסרים, החזר אותם לקליינט וסיים את הביצוע
    if (missingProducts.length > 0) {
      return res.status(409).send({
        keyWord: "missingProducts",
        message: "המוצרים הבאים אינם זמינים יותר",
        missingProducts
      });
    };

    // אם יש פריטים בקונפליקט מחירים, נחזיר תשובה ללקוח ונפסיק את הביצוע
    if (priceConflicts.length > 0) {
      return res.status(409).send({
        keyWord: "priceConflicts",
        message: "למוצרים הבאים השתנה המחיר",
        priceConflicts
      });
    };

    const cartItemsForOrder = cartItems.map((item) => {
      const base = item.toObject ? item.toObject() : { ...item };
      if (item.isRewardProduct) return base;
      const product = productMap.get(item._id?.toString?.() ?? String(item._id));
      if (!product) return base;
      return { ...base, isVatFree: product.isVatFree !== false };
    });

    // שלב 5: שליפת המבצעים
    const getNotActiveOffers = process.env.GET_NOT_ACTIVE_OFFERS === "true";

    let offerFilter = {};

    // אם לא במצב development - סנן מבצעים פעילים
    if (!getNotActiveOffers) {
      const now = new Date();
      const offerFilterConditions = [
        { isActive: true },
        {
          $or: [
            { startsAt: { $exists: false } },
            { startsAt: null },
            { startsAt: { $lte: now } }
          ]
        },
        {
          $or: [
            { endsAt: { $exists: false } },
            { endsAt: null },
            { endsAt: { $gte: now } }
          ]
        }
      ];

      // סינון מבצעים שהלקוח כבר ניצל (oncePerCustomer: true)
      if (customer && customer.redeemedOffers && customer.redeemedOffers.length > 0) {
        offerFilterConditions.push({
          $or: [
            { oncePerCustomer: { $ne: true } },
            { oncePerCustomer: false },
            { oncePerCustomer: { $exists: false } },
            { _id: { $nin: customer.redeemedOffers } }
          ]
        });
      }

      offerFilter = { $and: offerFilterConditions };
    }

    // משיכת כל המבצעים הרלוונטים
    let offers = await Offer.find(offerFilter)
      .populate({ path: "products" })
      .populate({ path: "rewardProduct" })
      .populate({ path: "triggerProduct" });

    // סינון מבצעים ללקוחות חדשים בלבד
    // הלקוח כבר מחובר (כי זה addOrder), אז נבדוק את זכאותו
    if (customer) {
      offers = offers.filter(offer => {
        // אם המבצע מיועד ללקוחות חדשים בלבד
        if (offer.forNewCustomersOnly) {
          // תאריך התחלת המבצע (או תאריך יצירת המבצע אם אין startsAt)
          const offerStartDate = offer.startsAt || offer.createdAt;
          // תאריך יצירת החשבון של הלקוח
          const customerCreatedAt = customer.createdAt;

          // הלקוח זכאי למבצע רק אם החשבון שלו נפתח לאחר תחילת המבצע
          return customerCreatedAt >= offerStartDate;
        }
        // אם המבצע לא מיועד ללקוחות חדשים בלבד, הלקוח זכאי לו
        return true;
      });
    } else {
      offers = offers.filter(offer => !offer.forNewCustomersOnly);
    }

    // שלב 6: חישוב המחירים בהתבסס על המבצעים הרלוונטים
    const {
      updatedCartItems: itemsWithOffers,
      totalDiscount: offerDiscount,
      appliedOffers,
      thresholdDiscount
    } = findOptimalOfferCombination(cartItemsForOrder, offers, customer);
    totalDiscount += offerDiscount;

    // אם יש מבצעים לא מעודכנים שהגיעו מהקליינט נחזיר קונפליקט ללקוח
    let offerConflicts = []; // מערך לשמירת מוצרים שהשתנה להם המבצע
    for (let i = 0; i < cartItemsForOrder.length; i++) {
      const clientItem = cartItemsForOrder[i];
      const serverItem = itemsWithOffers[i];
      // console.log('server Item :>> ', serverItem);

      // נבדוק אם הקליינט ציפה למחיר מבצע שונה
      const clientDiscounted = clientItem.discountedPrice ?? null;
      const serverDiscounted = serverItem.discountedPrice ?? null;

      // שם המבצע
      const offerTitle = serverItem.offerTitle?.he;

      // בדיקת הבדלים
      if (clientDiscounted !== serverDiscounted) {
        offerConflicts.push({
          product: serverItem,
          clientDiscounted,
          serverDiscounted,
          offerTitle,
        });
      }
    };

    // חישוב הסכום הכולל לאחר החלת המבצעים
    // שימוש ב-finalPriceAtPurchase שכבר מכיל את כל החישובים (מבצעים, מחירון, וכו')
    itemsWithOffers.forEach(item => {
      serverCalculatedTotal += item.finalPriceAtPurchase.total;
    });

    // שמירת המחיר הכולל לפני הנחות
    serverSubTotal = serverCalculatedTotal;

    // הפחתת הנחת קניה מעל סכום (THRESHOLD_DISCOUNT) אם קיימת
    if (thresholdDiscount && thresholdDiscount > 0) {
      serverCalculatedTotal -= thresholdDiscount;
    }

    // שלב 7: חישוב הנחה מקופון
    let couponDiscount = 0;
    let coupon = req.body.coupon;
    if (coupon) {
      coupon = await Coupon.findById(req.body.coupon);
      if (coupon) {
        if (!coupon) {
          return res.status(404).send({ message: "קופון לא נמצא!" });
        }

        if (coupon.isUsed) {
          return res.status(400).send({ message: "הקופון כבר שומש ואינו ניתן לשימוש חוזר!" });
        }

        const currentTime = dayjs().utc().toDate();
        if (coupon.startTime && currentTime < coupon.startTime) {
          return res.status(400).send({ message: "קופון עדיין לא בתוקף!" });
        }

        if (coupon.endTime && currentTime > coupon.endTime) {
          return res.status(400).send({ message: "קופון פג תוקף!" });
        }

        if (coupon.status == 'hide') {
          return res.status(400).send({ message: "קופון לא פעיל!" });
        }

        if (coupon.discountType.type === "fixed" && coupon.discountType.value < serverCalculatedTotal) {
          couponDiscount = coupon.discountType.value;
        } else if (coupon.discountType.type === "percentage") {
          couponDiscount = (coupon.discountType.value / 100) * serverCalculatedTotal;
        }
        console.log('couponDiscount: ', couponDiscount)
        serverCalculatedTotal -= couponDiscount;
      }
    };

    // שלב 8: חישוב עלות המשלוח – לפי אזור וכללי תמחור (סכום אחרי הנחות)
    let shippingCost = 0;
    if (req.body.shippingOption == 2) {
      const cityName = req.body.city?.city_name_he ||
        req.body.user_info?.address?.city?.city_name_he ||
        customer?.address?.city?.city_name_he;

      if (cityName) {
        const deliveryInfo = await Delivery.findOne({ 'city.city_name_he': cityName.trim() }).populate('region');
        if (deliveryInfo) {
          const orderTotalAfterDiscounts = serverCalculatedTotal;
          shippingCost = getShippingCostByRegionRules(deliveryInfo, orderTotalAfterDiscounts);
        }
      }
      serverCalculatedTotal += shippingCost;
    }

    // שלב 9: חילוץ המבצעים למערך "נוצלו מהעגלה" לצורך מעקב אחר מבצעים חד פעמיים
    const usedOfferIds = [];
    itemsWithOffers.forEach(item => {
      // מבצעים על מוצרי פרס
      if (item.isRewardProduct && item.rewardOfferId) {
        const offerIdStr = item.rewardOfferId.toString();
        if (!usedOfferIds.includes(offerIdStr)) {
          usedOfferIds.push(offerIdStr);
        }
      }
      // מבצעים על מוצרים רגילים
      if (item.appliedOffers && Array.isArray(item.appliedOffers)) {
        item.appliedOffers.forEach(offer => {
          if (offer.offerId) {
            const offerIdStr = offer.offerId.toString();
            if (!usedOfferIds.includes(offerIdStr)) {
              usedOfferIds.push(offerIdStr);
            }
          }
        });
      }
    });

    // הוספת מבצעי THRESHOLD_DISCOUNT ל-usedOfferIds
    appliedOffers.forEach(offer => {
      if (offer.type === 'THRESHOLD_DISCOUNT' && offer.offerId) {
        const offerIdStr = offer.offerId.toString();
        if (!usedOfferIds.includes(offerIdStr)) {
          usedOfferIds.push(offerIdStr);
        }
      }
    });

    // שלב 10: אימות הסכום הכולל
    const clientTotal = Number(req.body.total);
    if (!Number.isFinite(clientTotal)) {
      console.error("Client total is not a valid number:", req.body.total);
      return res.status(400).send({ message: "שגיאה! סכום הזמנה לא תואם לסכום הפריטים. מומלץ להתנתק ולהתחבר שוב." });
    }

    const serverTotal = Number(serverCalculatedTotal.toFixed(2));
    const clientTotalRounded = Number(clientTotal.toFixed(2));

    console.log(`FINAL serverTotal for user ${req.user.email}: ${serverTotal}, clientTotal: ${clientTotalRounded}`);

    if (Math.abs(serverTotal - clientTotalRounded) > 0.01) {
      console.error("***Server Calculated Total does not match with req.body.total!***");
      return res.status(400).send({ message: "שגיאה! סכום הזמנה לא תואם לסכום הפריטים. מומלץ להתנתק ולהתחבר שוב." });
    }

    // שלב 11: יצירת user_info עבור אורחים (אם לא קיים)
    let userInfo = req.body.user_info;
    // אם user_info לא נשלח מהקליינט, ניצור אותו עבור אורחים
    if (!userInfo) {
      // בדיקה אם זה לקוח אורח (לא רשום)
      const isGuest = (!customer.isRegistered);
      if (isGuest) {
        // יצירת user_info עבור אורח מהמידע ב-req.user, req.body ו-customer
        userInfo = {
          name: req.user.name || req.body.name || "",
          lastName: req.user.lastName || req.body.lastName || "",
          email: req.user.email || req.body.email || "",
          contact: req.user.phone || req.body.phone || "",
          address: {
            city: req.body.city || req.user.address?.city || customer?.address?.city || null,
            street: req.body.street || req.user.address?.street || customer?.address?.street || "",
            houseNumber: req.body.houseNumber || req.user.address?.houseNumber || customer?.address?.houseNumber || "",
            apartmentNumber: req.body.apartmentNumber || req.user.address?.apartmentNumber || customer?.address?.apartmentNumber || "",
            floor: req.body.floor || req.user.address?.floor || customer?.address?.floor || "",
            entryCode: req.body.entryCode || req.user.address?.entryCode || customer?.address?.entryCode || "",
            postalCode: req.body.postalCode || req.user.address?.postalCode || customer?.address?.postalCode || "",
          },
          country: req.body.country || "Israel",
          zipCode: req.body.zipCode || req.body.postalCode || "",
        };
      }
    }

    // שלב 12: יצירת ההזמנה החדשה
    console.log("creating new order...", req.user._id);

    // נוסיף חישוב invoice ידני
    const lastOrder = await Order.findOne().sort({ invoice: -1 }).select('invoice');
    const nextInvoice = (lastOrder && lastOrder.invoice) ? lastOrder.invoice + 1 : 10000;

    // המרת cart items ל-plain objects כדי להבטיח שכל השדות (כולל מוצרי פרס) יישמרו נכון ב-DB
    const cartForSave = itemsWithOffers.map(item => {
      // אם זה Mongoose document, נמיר אותו ל-plain object
      const plainItem = item.toObject ? item.toObject() : { ...item };
      // וידוא ששדות מוצר פרס נשמרים
      if (item.isRewardProduct) {
        plainItem.isRewardProduct = true;
        plainItem.rewardPrice = item.rewardPrice;
        plainItem.rewardOfferId = item.rewardOfferId;
        plainItem.rewardOfferName = item.rewardOfferName;
        plainItem.rewardOfferType = item.rewardOfferType;
      }
      return plainItem;
    });

    // הוספת המחירון ל-user_info (אם יש ללקוח מחירון)
    if (customer && customer.mainCustomer && customer.mainCustomer.priceList) {
      if (userInfo) {
        userInfo.priceList = customer.mainCustomer.priceList;
      } else if (req.body.user_info) {
        req.body.user_info.priceList = customer.mainCustomer.priceList;
      }
    }

    // בניית נתוני ההזמנה
    const orderData = {
      ...req.body,
      cart: cartForSave,
      user: req.user._id,
      mainCustomer: customer.mainCustomer?._id || customer.mainCustomer,
      user_info: userInfo || req.body.user_info,
      subTotal: Number(serverSubTotal.toFixed(2)),
      total: Number(serverCalculatedTotal.toFixed(2)),
      discount: Number(couponDiscount.toFixed(2)),
      offerDiscount: Number((thresholdDiscount || 0).toFixed(2)), // הנחת קניה מעל סכום (THRESHOLD_DISCOUNT)
      shippingCost: Number(shippingCost.toFixed(2)),
      invoice: nextInvoice,
      usedOfferIds: usedOfferIds, // שמירת המבצעים שנוצלו
    };

    // בדיקה אם זה הזמנה בהקפה או תשלום בכרטיס
    const isCreditOrder = req.body.paymentMethod === "credit";

    if (isCreditOrder) {
      // יצירת הזמנה בהקפה
      const order = await createCreditOrder(orderData, customer);
      res.status(201).send(order);
    } else {
      // יצירת הזמנה עם תשלום בכרטיס (מודולרי - תומך Cardcom ו-iCredit)
      const { paymentUrl } = await createCheckout({
        orderData,
        customer,
        reqBody: req.body,
        reqUser: req.user,
        itemsWithOffers,
        serverCalculatedTotal,
        shippingCost,
        couponDiscount,
        coupon,
        thresholdDiscount,
        appliedOffers,
      });

      return res.status(201).send({ paymentUrl });
    }
  } catch (err) {
    console.log('addOrder error: ', err);
    res.status(500).send({ message: err.message });
  }
};

// get all orders user
const getOrderCustomer = async (req, res) => {
  try {
    const { page, limit } = req.query;

    const pages = Number(page) || 1;
    const limits = Number(limit) || 8;
    const skip = (pages - 1) * limits;

    // מציאת המזהים של הסטטוסים
    const pendingStatus = await Status.findOne({ name: "Pending" });

    const processingStatus = await Status.findOne({ name: "Processing" });
    const likutStatus = await Status.findOne({ name: "Likut" });

    const deliveredStatus = await Status.findOne({ name: "Delivered" });
    // מציאת סטטוסי מלקטים (סטטוסים עם מספר טלפון)
    const melaketStatuses = await Status.find({ phone: { $exists: true } });
    // המזהים של הסטטוסי מלקטים
    const melaketStatusIds = melaketStatuses.map(status => status._id);

    if (!pendingStatus || !processingStatus || !deliveredStatus) {
      return res.status(400).send({ message: "Statuses not found" });
    }

    const totalDoc = await Order.countDocuments({
      user: req.user._id,
    });

    const totalPendingOrder = await Order.aggregate([
      {
        $match: {
          status: pendingStatus._id,
          user: req.user._id,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalProcessingOrder = await Order.aggregate([
      {
        $match: {
          status: { $in: [processingStatus._id, likutStatus._id] },
          user: req.user._id,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalDeliveredOrder = await Order.aggregate([
      {
        $match: {
          status: { $in: [deliveredStatus._id, ...melaketStatusIds] },
          user: req.user._id,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
    ]);

    const orders = await Order.find({
      user: req.user._id,
    })
      .populate({ path: 'status' })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limits);

    res.send({
      orders,
      limits,
      pages,
      pending: totalPendingOrder.length === 0 ? 0 : totalPendingOrder[0].count,
      processing: totalProcessingOrder.length === 0 ? 0 : totalProcessingOrder[0].count,
      delivered: totalDeliveredOrder.length === 0 ? 0 : totalDeliveredOrder[0].count,
      totalDoc,
    });
  } catch (err) {
    console.log('getOrderCustomer error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id
    }).populate({ path: "status" });

    if (!order) {
      return res.status(404).send({
        message: "ההזמנה לא נמצאה",
      });
    }

    res.send(order);
  } catch (err) {
    console.log('getOrderById error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

module.exports = {
  addOrder,
  getOrderById,
  getOrderCustomer,
};
