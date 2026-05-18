// payments/providers/icreditProvider.js
// מימוש ספציפי לספק iCredit (ריווחית)

const Order = require("../../models/Order");
const Customer = require("../../models/Customer");
const { icreditGetUrl, icreditVerify } = require("../../utils/icredit");
const { buildShippingDescription, buildFullAddress } = require("../paymentShared");

const icreditProvider = {
  name: "icredit",

  // קבלת ה-webhookToken מההזמנה
  getOrderWebhookToken(order) {
    return order?.icredit?.webhookToken;
  },

  // קבלת GroupPrivateToken (Payment Page Token) לפי סביבה
  getGroupPrivateToken() {
    const env = String(process.env.ICREDIT_ENV || "test").toLowerCase();
    return env === "prod"
      ? process.env.ICREDIT_PAYMENT_PAGE_TOKEN
      : process.env.ICREDIT_PAYMENT_PAGE_TOKEN_TEST;
  },

  /**
   * יצירת קישור תשלום iCredit
   */
  async createPaymentUrl({
    order,
    reqBody,
    reqUser,
    customer,
    customerSnap,
    itemsWithOffers,
    serverCalculatedTotal,
    shippingCost,
    couponDiscount,
    coupon,
    thresholdDiscount,
    appliedOffers,
  }) {
    console.log(`[iCredit] Creating payment for order ${order._id}`);

    const groupPrivateToken = this.getGroupPrivateToken();
    if (!groupPrivateToken) {
      throw new Error("Missing iCredit GroupPrivateToken (payment page token)");
    }

    // אם כבר יש מספר לקוח בריווחית אצלנו - נשלח CustomerId (יותר טוב מ-FindByMail)
    let rivhitCustomerId = null;
    try {
      const dbCustomer = await Customer.findById(customer._id).select("accounting email");
      rivhitCustomerId = dbCustomer?.accounting?.externalCustomerId || null;
    } catch (e) {
      console.log(`[iCredit] Failed to fetch Rivhit CustomerId: ${e.message}`);
    }

    // בניית Items - מוצרים + משלוח
    const items = itemsWithOffers.map((p, index) => {
      // חישוב תיאור המוצר
      let description = 'מוצר';
      if (p.isRewardProduct) {
        const title = p.title || p._doc?.title;
        description = title?.he || title;
        description += " (" + (p.rewardOfferName?.he || p.rewardOfferName || 'מוצר מתנה') + ")";
      } else {
        const title = p.title || p._doc?.title;
        description = title?.he || title || 'מוצר';
      }

      return {
        CatalogNumber: String(p.sku || p._id?.toString()?.slice(-5) || index + 1), // מומלץ מק"ט/sku; אם אין אז fallback
        Quantity: Number(p.quantity),
        UnitPrice: Number(p.finalPriceAtPurchase.perUnit),
        Description: description,
      };
    });

    // הוספת שורת משלוח אם קיימת
    if (Number(shippingCost) > 0) {
      items.push({
        CatalogNumber: "משלוח",
        Quantity: 1,
        UnitPrice: Number(shippingCost),
        Description: buildShippingDescription({ reqBody, customer }),
      });
    }

    // חישוב הנחות כולל
    const discountSum = Number(((couponDiscount || 0) + (thresholdDiscount || 0)).toFixed(2));

    // בניית כתובת מלאה
    const addressFields = buildFullAddress({ reqBody, customer });

    // בניית payload ל-iCredit GetUrl
    const payload = {
      GroupPrivateToken: groupPrivateToken,
      Items: items,
      Discount: discountSum > 0 ? discountSum : undefined,

      Order: String(order.invoice || order._id),
      Reference: Number(order.invoice),

      // Prefer CustomerId אם קיים, אחרת fallback לאיתור+יצירה לפי מייל
      // ...(rivhitCustomerId
      //   ? { CustomerId: Number(rivhitCustomerId) }
      //   : { 
      CreateCustomer: true, FindByMail: true,
      //  }),

      // פרטי הלקוח
      CustomerFirstName: customerSnap.firstName,
      CustomerLastName: customerSnap.lastName,
      EmailAddress: customerSnap.email,
      PhoneNumber: customerSnap.phone,

      // כתובת
      Address: addressFields.Address,
      City: addressFields.City,
      Zipcode: addressFields.Zipcode,
      Country: addressFields.Country,

      RedirectURL: `${process.env.STORE_URL}/success?orderId=${order._id}`,
      FailRedirectURL: `${process.env.STORE_URL}/failed?orderId=${order._id}`,

      // IPN עם token ייחודי
      IPNURL: `${process.env.API_BASE_URL}/payments/icredit/ipn/${order._id}?token=${order.icredit.webhookToken}`,

      Custom1: String(order._id),

      Comments: [
        // הנחת קופון
        couponDiscount > 0
          ? (coupon && coupon.discountType && coupon.discountType.type === "percentage"
            ? `הנחה ${coupon.discountType.value}% (-${couponDiscount.toFixed(2)}₪)`
            : `הנחה: -${couponDiscount.toFixed(2)}₪`)
          : null,

        // הנחת קניה מעל סכום
        thresholdDiscount > 0
          ? (() => {
            const thresholdOffer = appliedOffers.find(o => o.type === 'THRESHOLD_DISCOUNT');
            const offerName = thresholdOffer?.name?.he || thresholdOffer?.name?.en || 'הנחת קניה מעל סכום';
            return `${offerName}: -${thresholdDiscount.toFixed(2)}₪`;
          })()
          : null,

        // הערות לקוח
        order.customer_note
          ? `הערות לקוח: ${String(order.customer_note).trim().slice(0, 200)}`
          : null,

        // מספר הזמנה
        `מספר הזמנה: ${order.invoice}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    // ניקוי שדות undefined כדי לא לשלוח שדות מיותרים
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    console.log(`[iCredit] Calling GetUrl with payload:`, JSON.stringify(payload, null, 2));

    // קריאה ל-iCredit GetUrl
    const result = await icreditGetUrl(payload);

    // שמירת tokens בהזמנה
    await Order.findByIdAndUpdate(order._id, {
      $set: {
        "icredit.publicSaleToken": result.publicSaleToken,
        "icredit.privateSaleToken": result.privateSaleToken,
      },
    });

    console.log(`[iCredit] Payment URL created: ${result.url}`);
    return result.url;
  },

  /**
   * אימות IPN מ-iCredit
   * ה-IPN צריך להעביר SaleId או מזהה אחר.
   * 
   * אנחנו:
   * 1) מחלצים saleId מה-body/query
   * 2) קוראים Verify עם GroupPrivateToken + SaleId + TotalAmount
   * 3) אם VERIFIED => paid
   */
  async verifyWebhook({ order, req }) {
    const body = req.body || {};

    // חילוץ SaleId (יכול להגיע בשמות שונים)
    const saleId =
      body.SaleId ||
      body.saleId ||
      req.query?.saleId ||
      body.PublicSaleToken || // fallback (לא תמיד נכון)
      null;

    if (!saleId) {
      console.error(`[iCredit] Missing SaleId in IPN`);
      return { ok: false, paid: false, message: "Missing SaleId in iCredit IPN" };
    }

    const groupPrivateToken = this.getGroupPrivateToken();
    if (!groupPrivateToken) {
      return { ok: false, paid: false, message: "Missing iCredit GroupPrivateToken" };
    }

    // קריאה ל-iCredit Verify
    let verifyRes;
    try {
      verifyRes = await icreditVerify({
        groupPrivateToken,
        saleId,
        totalAmount: Number(order.total || 0),
      });
    } catch (e) {
      console.error(`[iCredit] Failed to verify with iCredit:`, e);
      return { ok: false, paid: false, message: "Failed to verify with iCredit" };
    }

    // בדרך כלל Verify מחזיר Status: "VERIFIED" / "NOTVERIFIED"
    const status = String(verifyRes?.Status || "").toUpperCase();
    const paid = status === "VERIFIED";

    console.log(`[iCredit] Verification result: ${paid ? "PAID" : "NOT PAID"}`);

    // החזרת כל הנתונים הרלוונטיים מה-webhook
    return {
      ok: true,
      paid,
      data: {
        saleId,
        verifyRes,
        // נתונים נוספים מה-webhook שצריך לשמור
        documentUrl: body.DocumentURL || null,
        documentNum: body.DocumentNum || null,
        documentType: body.DocumentType || null,
        transactionAuthNum: body.TransactionAuthNum || null,
        transactionCardNum: body.TransactionCardNum || null,
        transactionCardName: body.TransactionCardName || null,
      },
    };
  },
};

module.exports = icreditProvider;
