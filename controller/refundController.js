// controller/refundController.js
const Order = require("../models/Order");
const { refundByTransactionId } = require("../utils/cardcom");

/**
 * זיכוי הזמנה חלקי/מלא לפי מזהה עסקה קיים
 * POST /api/orders/:id/refunds
 */
const refundOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, reason = "" } = req.body || {};
        const refundAmount = Number(amount);

        // בדיקת תקינות סכום
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
            return res.status(400).send({
                message: "סכום זיכוי לא תקין"
            });
        }

        // שליפת הזמנה
        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).send({
                message: "הזמנה לא נמצאה"
            });
        }

        // בדיקה שיש TransactionId לזיכוי
        const txnId = order?.cardcom?.transactionId || order?.payment?.cardcomRes?.TranzactionInfo?.TranzactionId || null;

        if (!txnId) {
            return res.status(400).send({
                message: "לא ניתן לבצע זיכוי - אין מזהה עסקה בהזמנה"
            });
        }

        // חישוב יתרת זיכוי זמינה
        const refundedSoFar = Array.isArray(order?.cardcom?.refunds)
            ? order.cardcom.refunds.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
            : 0;

        const orderTotal = Number(order.total || 0);
        const refundableRemaining = Number((orderTotal - refundedSoFar).toFixed(2));

        // בדיקות תקינות
        if (refundableRemaining <= 0) {
            return res.status(409).send({
                message: "אין יתרה זמינה לזיכוי להזמנה זו"
            });
        }

        if (refundAmount > refundableRemaining) {
            return res.status(400).send({
                message: `סכום הזיכוי (${refundAmount.toFixed(2)} ש"ח) גדול מהיתרה שנותרה (${refundableRemaining.toFixed(2)} ש"ח)`
            });
        }

        // ביצוע זיכוי ב-Cardcom
        let cardcomResponse;
        try {
            cardcomResponse = await refundByTransactionId({
                transactionId: txnId,
                amount: refundAmount,
                cancelOnly: false,
            });
        } catch (cardcomError) {
            console.error('Cardcom refund failed:', cardcomError);
            return res.status(502).send({
                message: "זיכוי בקרדקום נכשל",
                error: cardcomError.cardcom || cardcomError.message,
            });
        }

        // בניית רשומת זיכוי
        const refundDoc = {
            amount: Number(Number(refundAmount).toFixed(2)),
            reason,
            at: new Date(),
            by: req.user?._id || null,
            refundTransactionId: String(cardcomResponse?.TranzactionId ?? ""),
            cancelOnly: false,
            gatewayResponse: cardcomResponse,
        };

        // עדכון ההזמנה
        order.cardcom = order.cardcom || {};
        order.cardcom.refunds = order.cardcom.refunds || [];
        order.cardcom.refunds.push(refundDoc);
        await order.save();

        console.log(`Refund of ${refundAmount} completed for order ${order.invoice || order._id}`);

        return res.status(200).send({
            message: "הזיכוי נוצר בהצלחה",
            refundableRemaining: Number((refundableRemaining - refundAmount).toFixed(2)),
            refund: refundDoc,
        });

    } catch (err) {
        console.error("refundOrderById error:", err);
        return res.status(500).send({
            message: "התרחשה שגיאה, נסו שנית מאוחר יותר"
        });
    }
};

module.exports = {
    refundOrderById
};