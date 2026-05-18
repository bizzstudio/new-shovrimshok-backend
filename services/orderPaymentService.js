// services/orderPaymentService.js
// שירות יצירת Checkout אחיד לכל ספקי התשלום

const crypto = require("crypto");
const Order = require("../models/Order");
const Status = require("../models/Status");
const { getActivePaymentProvider } = require("../payments/paymentFactory");
const { buildCustomerSnapshot } = require("../payments/paymentShared");
const logStatusChange = require("../utils/logStatusChange");

/**
 * יצירת Order Pending + החזרת paymentUrl לפי ספק התשלום הפעיל
 */
async function createCheckout({
  orderData,
  customer,
  reqBody,
  reqUser,
  itemsWithOffers,
  serverCalculatedTotal,
  shippingCost,
  couponDiscount,
  coupon,
  thresholdDiscount,
  appliedOffers,
}) {
  // קבלת ספק התשלום הפעיל (לפי PAYMENT_GATEWAY)
  const provider = getActivePaymentProvider();
  const providerName = provider.name; // "cardcom" | "icredit"

  console.log(`[createCheckout] Using provider: ${providerName}`);

  // שליפת סטטוס Pending
  const pendingStatus = await Status.findOne({ name: "Pending" });
  if (!pendingStatus) throw new Error("Pending status not found");

  // יצירת token פנימי ייחודי להזמנה (לאימות webhook)
  const webhookToken = crypto.randomBytes(32).toString("hex");

  // 1) יצירת הזמנה עם סטטוס Pending
  const newOrder = new Order({
    ...orderData,
    paymentMethod: "card",
    paymentProvider: providerName,
    status: pendingStatus._id,
    [providerName]: { webhookToken }, // שמירת ה-token תחת השדה של הספק
  });

  const order = await newOrder.save();
  console.log(`[createCheckout] Order created: ${order._id}, invoice: ${order.invoice}`);

  // רישום שינוי סטטוס
  logStatusChange({
    from: "No Status",
    to: "Pending",
    functionName: "createCheckout",
    order,
  });

  // 2) בניית snapshot של הלקוח
  const customerSnap = buildCustomerSnapshot({ reqUser, customer });

  // 3) יצירת קישור תשלום דרך הספק
  console.log(`[createCheckout] Creating payment URL with ${providerName}...`);
  const paymentUrl = await provider.createPaymentUrl({
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
  });

  console.log(`[createCheckout] Payment URL created successfully: ${paymentUrl}`);

  return { order, paymentUrl };
}

module.exports = { createCheckout };