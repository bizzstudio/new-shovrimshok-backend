// controller/paymentsController.js
const Order = require("../models/Order");
const { getPaymentProvider } = require("../payments/paymentFactory");
const { finalizePaidOrder } = require("../services/orderFinalizeService");

// פונקציה לזיהוי הספק מה-path של ה-request
function getProviderFromPath(req) {
    // /api/payments/cardcom/webhook/:orderId
    // /api/payments/icredit/ipn/:orderId
    const p = String(req.path || "");
    if (p.startsWith("/cardcom/")) return "cardcom";
    if (p.startsWith("/icredit/")) return "icredit";
    return null;
};

// טיפול אחיד ב-webhooks של כל הספקים
const handleProviderWebhook = async (req, res) => {
    const providerName = getProviderFromPath(req);
    const orderId = req.params.orderId;

    console.log(`[handleProviderWebhook] provider: ${providerName}, orderId: ${orderId}`);
    console.log('[handleProviderWebhook] req.body: ', req.body);

    if (!providerName) return res.status(400).send("Unknown provider");
    if (!orderId) return res.status(400).send("Missing orderId");

    try {
        const provider = getPaymentProvider(providerName);

        // 1) שליפת ההזמנה עם ה-webhookToken (שדה select: false)
        const tokenSelect =
            providerName === "cardcom" ? "+cardcom.webhookToken" : "+icredit.webhookToken";

        const order = await Order.findById(orderId).select(tokenSelect).populate("status");
        if (!order) return res.status(404).send("Order not found");

        // 2) אימות ה-token הפנימי שלנו (?token=...)
        const providedToken = req.query?.token;
        const expectedToken = provider.getOrderWebhookToken(order);

        if (!providedToken || !expectedToken || providedToken !== expectedToken) {
            console.error("[handleProviderWebhook] Unauthorized: token mismatch");
            return res.status(401).send("Unauthorized");
        }

        // 3) אימות ספציפי לספק (NEVER trust req.body alone)
        console.log("[handleProviderWebhook] Verifying with provider...");
        const verified = await provider.verifyWebhook({ order, req });

        // verified must include: { ok: true/false, paid: true/false, data, message? }
        if (!verified?.ok) {
            // הספק לא הצליח לאמת (bad request / mismatch / etc)
            console.log("[handleProviderWebhook] Verification failed:", verified?.message);
            return res.status(200).json({ ok: false, message: verified?.message || "Not verified" });
        }

        if (!verified.paid) {
            // אומת אבל לא שולם (failed/cancelled/pending)
            console.log("[handleProviderWebhook] Payment not confirmed");
            return res.status(200).json({ ok: true, paid: false, message: "Payment not confirmed" });
        }

        // 4) סיום התשלום (idempotent + atomic)
        console.log("[handleProviderWebhook] Finalizing paid order...");
        const result = await finalizePaidOrder({
            orderId: order._id,
            provider: providerName,
            verifiedData: verified.data,
            webhookBody: req.body || {},
        });

        console.log("[handleProviderWebhook] Success:", result);
        return res.status(200).json({ ok: true, paid: true, ...result });
    } catch (err) {
        console.error("[handleProviderWebhook] Error:", err);
        return res.status(500).json({ ok: false, message: err.message });
    }
};

module.exports = { handleProviderWebhook };