// controller/offerController.js
const Offer = require("../models/Offer");
const Customer = require("../models/Customer");

/** אורחים לא מקבלים מחירי מוצר מקוננים (עקביות עם productController) */
const stripNestedProductPricesForGuest = (product) => {
  if (!product) return product;
  const p = product.toObject ? product.toObject() : { ...product };
  p.prices = [];
  return p;
};

const sanitizeOfferNestedProductsForGuest = (offer, req) => {
  if (req.user?._id) return offer;
  const o = offer.toObject ? offer.toObject({ virtuals: true }) : { ...offer };
  if (Array.isArray(o.products)) {
    o.products = o.products.map(stripNestedProductPricesForGuest);
  }
  if (o.rewardProduct) o.rewardProduct = stripNestedProductPricesForGuest(o.rewardProduct);
  if (o.triggerProduct) o.triggerProduct = stripNestedProductPricesForGuest(o.triggerProduct);
  return o;
};

const addOffer = async (req, res) => {
  try {
    const {
      name,
      description,
      image,
      type,
      isActive,
      startsAt,
      endsAt,
      oncePerCustomer,
      forNewCustomersOnly,

      // BUNDLE_PRICE fields
      quantity,
      price,
      products,

      // THRESHOLD_GET_ITEM fields
      thresholdAmount,

      // BUY_X_GET_Y fields
      triggerProduct,
      triggerQuantity,

      // Shared reward fields
      rewardProduct,
      rewardPrice,
      rewardQuantity,

      // THRESHOLD_DISCOUNT fields
      discountType,
      discountValue,
    } = req.body;

    const offerData = {
      name,
      type: type || "BUNDLE_PRICE",
      isActive,
      startsAt,
      endsAt,
      oncePerCustomer,
      forNewCustomersOnly,
    };

    // Add optional fields if provided
    if (description) offerData.description = description;
    if (image) offerData.image = image;

    // Add type-specific fields based on offer type
    if (type === "BUNDLE_PRICE" || !type) {
      offerData.quantity = quantity;
      offerData.price = price;
      offerData.products = products;
    } else if (type === "THRESHOLD_GET_ITEM") {
      offerData.thresholdAmount = thresholdAmount;
      offerData.rewardProduct = rewardProduct;
      offerData.rewardPrice = rewardPrice;
      if (rewardQuantity) offerData.rewardQuantity = rewardQuantity;
    } else if (type === "BUY_X_GET_Y") {
      offerData.triggerProduct = triggerProduct;
      offerData.triggerQuantity = triggerQuantity;
      offerData.rewardProduct = rewardProduct;
      offerData.rewardPrice = rewardPrice;
      if (rewardQuantity) offerData.rewardQuantity = rewardQuantity;
    } else if (type === "THRESHOLD_DISCOUNT") {
      offerData.thresholdAmount = thresholdAmount;
      offerData.discountType = discountType;
      offerData.discountValue = discountValue;
    }

    const newOffer = new Offer(offerData);
    await newOffer.save();
    res.send(newOffer);
  } catch (err) {
    console.log('addOffer error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getAllOffers = async (req, res) => {
  try {
    let filter = {};
    const isAdmin = req.user && (req.user.role === "Admin" || req.user.role === "CEO");
    const getNotActiveOffers = process.env.GET_NOT_ACTIVE_OFFERS === "true";

    // אם זה לא Admin/CEO/development - סנן מבצעים פעילים ובתקופת זמן פעילה
    if (!isAdmin && !getNotActiveOffers) {
      const now = new Date();
      const filterConditions = [
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

      // אם יש לקוח מחובר, סנן מבצעים שנוצלו על ידו (רק אם oncePerCustomer: true)
      if (req.user && req.user._id) {
        try {
          const customer = await Customer.findById(req.user._id);
          if (customer && customer.redeemedOffers && customer.redeemedOffers.length > 0) {
            // סנן מבצעים עם oncePerCustomer: true שנוצלו על ידי הלקוח
            filterConditions.push({
              $or: [
                { oncePerCustomer: { $ne: true } },
                { oncePerCustomer: false },
                { oncePerCustomer: { $exists: false } },
                { _id: { $nin: customer.redeemedOffers } }
              ]
            });
          }
        } catch (customerErr) {
          // אם לא מצאנו לקוח, נמשיך בלי סינון
          console.log('getAllOffers customer lookup error: ', customerErr);
        }
      }

      filter = { $and: filterConditions };
    }

    let offers = await Offer.find(filter)
      .populate({
        path: "products",
        // select: "_id title image prices"
      })
      .populate({
        path: "rewardProduct",
        // select: "_id title image prices"
      })
      .populate({
        path: "triggerProduct",
        // select: "_id title image prices"
      });

    // סינון מבצעים ללקוחות חדשים בלבד
    // Admin/CEO תמיד רואים את כל המבצעים
    if (!isAdmin) {
      // אם יש לקוח מחובר, נסנן מבצעים עם forNewCustomersOnly: true
      if (req.user && req.user._id) {
        try {
          const customer = await Customer.findById(req.user._id);
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
          }
        } catch (customerErr) {
          // אם לא מצאנו לקוח, נסנן מבצעים ללקוחות חדשים בלבד (לקוחות לא מחוברים לא יראו אותם)
          console.log('getAllOffers customer lookup error for new customers filter: ', customerErr);
          offers = offers.filter(offer => !offer.forNewCustomersOnly);
        }
      } else {
        // אם אין לקוח מחובר, נסנן מבצעים ללקוחות חדשים בלבד (לקוחות לא מחוברים לא יראו אותם)
        offers = offers.filter(offer => !offer.forNewCustomersOnly);
      }
    }

    const payload = offers.map((o) => sanitizeOfferNestedProductsForGuest(o, req));
    res.send(payload);
  } catch (err) {
    console.log('getAllOffers error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getOfferById = async (req, res) => {
  try {
    const isAdmin = req.user && (req.user.role === "Admin" || req.user.role === "CEO");
    const getNotActiveOffers = process.env.GET_NOT_ACTIVE_OFFERS === "true";

    const offer = await Offer.findById(req.params.id)
      .populate({
        path: "products",
        // select: "_id title image prices"
      })
      .populate({
        path: "rewardProduct",
        // select: "_id title image prices"
      })
      .populate({
        path: "triggerProduct",
        // select: "_id title image prices"
      });

    if (!offer) {
      return res.status(404).send({
        message: "Offer Not Found!",
      });
    }

    // אם זה לא Admin/CEO/development - בדוק שהמבצע פעיל ובתקופת זמן פעילה
    if (!isAdmin && !getNotActiveOffers) {
      const now = new Date();

      // בדוק אם המבצע פעיל
      if (!offer.isActive) {
        return res.status(404).send({
          message: "Offer Not Found!",
        });
      }

      // בדוק תקופת זמן פעילה
      if (offer.startsAt && offer.startsAt > now) {
        return res.status(404).send({
          message: "Offer Not Found!",
        });
      }

      if (offer.endsAt && offer.endsAt < now) {
        return res.status(404).send({
          message: "Offer Not Found!",
        });
      }

      // אם יש לקוח מחובר, בדוק אם ניצל את המבצע (רק אם oncePerCustomer: true)
      if (req.user && req.user._id && offer.oncePerCustomer) {
        try {
          const customer = await Customer.findById(req.user._id);
          if (customer && customer.redeemedOffers && customer.redeemedOffers.length > 0) {
            // בדוק אם המבצע נמצא ברשימת המבצעים שנוצלו
            const isRedeemed = customer.redeemedOffers.some(
              redeemedId => redeemedId.toString() === offer._id.toString()
            );
            if (isRedeemed) {
              return res.status(404).send({
                message: "Offer Not Found!",
              });
            }
          }
        } catch (customerErr) {
          // אם לא מצאנו לקוח, נמשיך בלי סינון
          console.log('getOfferById customer lookup error: ', customerErr);
        }
      }

      // בדיקת זכאות למבצע ללקוחות חדשים בלבד
      // Admin/CEO תמיד רואים את כל המבצעים
      if (offer.forNewCustomersOnly && !isAdmin) {
        // אם אין לקוח מחובר, לא יראו את המבצע
        if (!req.user || !req.user._id) {
          return res.status(404).send({
            message: "Offer Not Found!",
          });
        }

        try {
          const customer = await Customer.findById(req.user._id);
          if (customer) {
            // תאריך התחלת המבצע (או תאריך יצירת המבצע אם אין startsAt)
            const offerStartDate = offer.startsAt || offer.createdAt;
            // תאריך יצירת החשבון של הלקוח
            const customerCreatedAt = customer.createdAt;

            // הלקוח זכאי למבצע רק אם החשבון שלו נפתח לאחר תחילת המבצע
            if (customerCreatedAt < offerStartDate) {
              return res.status(404).send({
                message: "Offer Not Found!",
              });
            }
          } else {
            // אם לא מצאנו לקוח, לא יראו את המבצע
            return res.status(404).send({
              message: "Offer Not Found!",
            });
          }
        } catch (customerErr) {
          // אם יש שגיאה, לא יראו את המבצע
          console.log('getOfferById customer lookup error for new customers check: ', customerErr);
          return res.status(404).send({
            message: "Offer Not Found!",
          });
        }
      }
    }

    res.send(sanitizeOfferNestedProductsForGuest(offer, req));
  } catch (err) {
    console.log('getOfferById error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const updateOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);

    if (offer) {
      // Update common fields
      if (req.body.name) offer.name = { ...offer.name, ...req.body.name };
      if (req.body.description) offer.description = { ...offer.description, ...req.body.description };
      offer.image = req.body.image;
      if (req.body.type) offer.type = req.body.type;
      if (req.body.isActive !== undefined) offer.isActive = req.body.isActive;
      if (req.body.startsAt !== undefined) offer.startsAt = req.body.startsAt;
      if (req.body.endsAt !== undefined) offer.endsAt = req.body.endsAt;
      if (req.body.oncePerCustomer !== undefined) offer.oncePerCustomer = req.body.oncePerCustomer;
      if (req.body.forNewCustomersOnly !== undefined) offer.forNewCustomersOnly = req.body.forNewCustomersOnly;

      // Update type-specific fields
      if (offer.type === "BUNDLE_PRICE") {
        if (req.body.quantity !== undefined) offer.quantity = req.body.quantity;
        if (req.body.price !== undefined) offer.price = req.body.price;
        if (req.body.products !== undefined) offer.products = req.body.products;
      } else if (offer.type === "THRESHOLD_GET_ITEM") {
        if (req.body.thresholdAmount !== undefined) offer.thresholdAmount = req.body.thresholdAmount;
        if (req.body.rewardProduct !== undefined) offer.rewardProduct = req.body.rewardProduct;
        if (req.body.rewardPrice !== undefined) offer.rewardPrice = req.body.rewardPrice;
        if (req.body.rewardQuantity !== undefined) offer.rewardQuantity = req.body.rewardQuantity;
      } else if (offer.type === "BUY_X_GET_Y") {
        if (req.body.triggerProduct !== undefined) offer.triggerProduct = req.body.triggerProduct;
        if (req.body.triggerQuantity !== undefined) offer.triggerQuantity = req.body.triggerQuantity;
        if (req.body.rewardProduct !== undefined) offer.rewardProduct = req.body.rewardProduct;
        if (req.body.rewardPrice !== undefined) offer.rewardPrice = req.body.rewardPrice;
        if (req.body.rewardQuantity !== undefined) offer.rewardQuantity = req.body.rewardQuantity;
      } else if (offer.type === "THRESHOLD_DISCOUNT") {
        if (req.body.thresholdAmount !== undefined) offer.thresholdAmount = req.body.thresholdAmount;
        if (req.body.discountType !== undefined) offer.discountType = req.body.discountType;
        if (req.body.discountValue !== undefined) offer.discountValue = req.body.discountValue;
      }

      await offer.save();
      res.send({
        data: offer, message: {
          en: "Offer updated successfully!",
          he: "המבצע עודכן בהצלחה!",
        }
      });
    } else {
      res.status(404).send({
        message: "Offer Not Found!",
      });
    }
  } catch (err) {
    console.log('updateOffer error: ', err);
    res.status(404).send(err.message);
  }
};

const deleteOffer = async (req, res) => {
  try {
    await Offer.deleteOne({ _id: req.params.id });
    res.status(200).send({
      message: {
        en: "Offer Deleted Successfully!",
        he: "המבצע נמחק בהצלחה!",
      }
    });
  } catch (err) {
    console.log('deleteOffer error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const deleteManyOffers = async (req, res) => {
  try {
    await Offer.deleteMany({ _id: req.body.ids });

    res.send({
      message: {
        en: "Offers Deleted Successfully!",
        he: "המבצעים נמחקו בהצלחה!",
      }
    });
  } catch (err) {
    console.log('deleteManyOffers error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

module.exports = {
  addOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
  deleteManyOffers,
};