// payments/paymentFactory.js
// Factory לבחירת ספק התשלום הנכון

const cardcomProvider = require("./providers/cardcomProvider");
const icreditProvider = require("./providers/icreditProvider");

// קבלת ספק תשלום לפי שם
function getPaymentProvider(name) {
  const key = String(name || "").toLowerCase();
  if (key === "cardcom") return cardcomProvider;
  if (key === "icredit") return icreditProvider;
  throw new Error(`Unknown payment provider: ${name}`);
}

// קבלת ספק התשלום הפעיל (מה-env)
function getActivePaymentProvider() {
  const gateway = (process.env.PAYMENT_GATEWAY || "icredit").toLowerCase();
  return getPaymentProvider(gateway);
}

module.exports = { getPaymentProvider, getActivePaymentProvider };