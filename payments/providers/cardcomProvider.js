// payments/providers/cardcomProvider.js
// מימוש ספציפי לספק Cardcom

const Order = require("../../models/Order");
const {
  createLowProfilePayment,
  getLowProfileResult,
} = require("../../utils/cardcom");
const {
  buildShippingDescription,
  buildAddressLine1,
  buildAddressLine2,
} = require("../paymentShared");

const cardcomProvider = {
  name: "cardcom",

  // קבלת ה-webhookToken מההזמנה
  getOrderWebhookToken(order) {
    return order?.cardcom?.webhookToken;
  },

  // קבלת credentials לפי סביבה
  getCardcomCredentials() {
    const env = String(process.env.CARDCOM_ENV || "test").toLowerCase();
    return {
      terminalNumber: env === "prod"
        ? process.env.CARDCOM_TERMINAL_NUMBER
        : process.env.CARDCOM_TERMINAL_NUMBER_TEST,
      apiName: env === "prod"
        ? process.env.CARDCOM_API_NAME
        : process.env.CARDCOM_API_NAME_TEST,
    };
  },

  /**
   * יצירת קישור תשלום Cardcom
   */
  async createPaymentUrl({
    order,
    reqBody,
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
    console.log(`[Cardcom] Creating payment for order ${order._id}`);

    const credentials = this.getCardcomCredentials();

    // בניית מוצרים לפורמט Cardcom
    const products = itemsWithOffers.map(p => {
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
        Description: description,
        Quantity: p.quantity,
        UnitCost: p.finalPriceAtPurchase.perUnit,
        TotalLineCost: p.finalPriceAtPurchase.total,
        IsVatFree: p.isVatFree !== undefined ? p.isVatFree : true,
      };
    });

    // הוספת שורת משלוח אם קיימת
    if (shippingCost > 0) {
      products.push({
        Description: buildShippingDescription({ reqBody, customer }),
        Quantity: 1,
        UnitCost: shippingCost,
        IsVatFree: false,
      });
    }

    // הוספת שורת הנחת קופון אם קיימת
    if (couponDiscount > 0) {
      products.push({
        Description: coupon && coupon.discountType && coupon.discountType.type === "percentage" ? `הנחה ${coupon.discountType.value}%` : "הנחה",
        Quantity: 1,
        UnitCost: -couponDiscount,
        IsVatFree: true,
      });
    }

    // הוספת שורת הנחת קניה מעל סכום אם קיימת
    if (thresholdDiscount > 0) {
      const thresholdOffer = appliedOffers.find(o => o.type === 'THRESHOLD_DISCOUNT');
      const offerName = thresholdOffer ? (thresholdOffer.name?.he || thresholdOffer.name?.en || 'הנחת קניה מעל סכום') : 'הנחת קניה מעל סכום';
      products.push({
        Description: offerName,
        Quantity: 1,
        UnitCost: -thresholdDiscount,
        IsVatFree: true,
      });
    }

    // בניית אובייקט Cardcom
    const cardcomObj = {
      TerminalNumber: credentials.terminalNumber,
      ApiName: credentials.apiName,
      ReturnValue: String(order._id),
      Amount: Number(Number(serverCalculatedTotal).toFixed(2)),
      SuccessRedirectUrl: `${process.env.STORE_URL}/success?orderId=${order._id}`,
      FailedRedirectUrl: `${process.env.STORE_URL}/failed?orderId=${order._id}`,

      // webhook עם token ייחודי
      WebHookUrl: `${process.env.API_BASE_URL}/payments/cardcom/webhook/${order._id}?token=${order.cardcom.webhookToken}`,

      Document: {
        Name: customerSnap.fullName,
        Mobile: customerSnap.phone,
        To: customerSnap.firstName,
        Email: customerSnap.email,

        AddressLine1: buildAddressLine1({ reqBody, customer }),
        AddressLine2: buildAddressLine2({ reqBody, customer }),

        Comments: `${order.customer_note ? "הערות לקוח: " + order.customer_note?.trim()?.slice(0, 200) : ""}

מספר הזמנה: ${order.invoice}`,

        Products: products,
      },
    };

    // יצירת תשלום ב-Cardcom
    const result = await createLowProfilePayment(cardcomObj);

    // שמירת LowProfileId בהזמנה
    await Order.findByIdAndUpdate(order._id, {
      $set: { "cardcom.lowProfileId": result.LowProfileId || null },
    });

    console.log(`[Cardcom] Payment URL created: ${result.Url}`);
    return result.Url;
  },

  /**
   * אימות webhook מ-Cardcom
   * - בדיקת LowProfileId קיים
   * - בדיקת התאמה ל-lowProfileId בהזמנה
   * - קריאה ל-GetLpResult ואימות:
   *   ResponseCode=0, ReturnValue=orderId, Amount=order.total
   */
  async verifyWebhook({ order, req }) {
    const body = req.body || {};
    const LowProfileId = body.LowProfileId;

    console.log(`[Cardcom] Verifying webhook for order ${order._id}, LowProfileId: ${LowProfileId}`);
    console.log(`[Cardcom] Webhook body:`, JSON.stringify(body, null, 2));

    if (!LowProfileId) {
      return { ok: false, paid: false, message: "Missing LowProfileId" };
    }

    // בדיקת התאמת LowProfileId אם קיים בהזמנה
    if (order.cardcom?.lowProfileId && LowProfileId !== order.cardcom.lowProfileId) {
      return { ok: true, paid: false, message: "LowProfileId mismatch" };
    }

    const credentials = this.getCardcomCredentials();

    // אימות מול Cardcom - NEVER trust req.body alone
    let lpResult;
    try {
      console.log(`[Cardcom] Calling GetLpResult for LowProfileId: ${LowProfileId}`);
      lpResult = await getLowProfileResult({
        TerminalNumber: credentials.terminalNumber,
        ApiName: credentials.apiName,
        LowProfileId,
      });
      console.log(`[Cardcom] GetLpResult response:`, JSON.stringify(lpResult, null, 2));
    } catch (e) {
      console.error(`[Cardcom] Failed to verify with Cardcom:`, e);
      return { ok: false, paid: false, message: "Failed to verify with Cardcom" };
    }

    // בדיקת ResponseCode
    if (Number(lpResult?.ResponseCode) !== 0) {
      console.log(`[Cardcom] Payment not confirmed, ResponseCode: ${lpResult?.ResponseCode}`);
      return { ok: true, paid: false, message: "Cardcom payment not confirmed", data: lpResult };
    }

    // בדיקות התאמה בסיסיות
    const lpTxnId = String(lpResult?.TranzactionInfo?.TranzactionId ?? "");
    const hookTxnId = String(body?.TranzactionInfo?.TranzactionId ?? "");

    if (hookTxnId && lpTxnId && hookTxnId !== lpTxnId) {
      console.error('[Cardcom] TranzactionId mismatch:', { hookTxnId, lpTxnId });
      return { ok: true, paid: false, message: "TranzactionId mismatch" };
    }

    // בדיקת ReturnValue מול order ID
    const returnValue = String(lpResult?.ReturnValue ?? "");
    const orderId = String(req.params.orderId || ""); // תיקון: orderId במקום id

    if (returnValue && returnValue !== orderId) {
      console.error(`[Cardcom] ReturnValue mismatch: ${returnValue} !== ${orderId}`);
      return { ok: true, paid: false, message: "ReturnValue mismatch", data: lpResult };
    }

    // בדיקת התאמת סכום
    const lpAmount = Number(lpResult?.TranzactionInfo?.Amount ?? 0);
    const orderTotal = Number(order.total ?? 0);

    if (Math.abs(lpAmount - orderTotal) > 0.01) {
      console.error(`[Cardcom] Amount mismatch: ${lpAmount} !== ${orderTotal}`);
      return { ok: true, paid: false, message: "Amount mismatch", data: lpResult };
    }

    console.log(`[Cardcom] ✅ Payment verified successfully - All checks passed`);
    return { ok: true, paid: true, data: lpResult };
  },
};

module.exports = cardcomProvider;