// routes/paymentsRoutes.js
// Routes אחיד לכל ספקי התשלום (Cardcom, iCredit)

const express = require("express");
const router = express.Router();

const { handleProviderWebhook } = require("../controller/paymentsController");

// Cardcom webhook (POST)
router.post("/cardcom/webhook/:orderId", handleProviderWebhook);

// iCredit IPN webhook (POST)
router.post("/icredit/ipn/:orderId", handleProviderWebhook);

module.exports = router;