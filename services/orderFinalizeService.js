// services/orderFinalizeService.js
// שירות סיום תשלום הזמנה - גנרי לכל ספקי התשלום (idempotent + atomic)

const Order = require("../models/Order");
const Status = require("../models/Status");
const Coupon = require("../models/Coupon");
const Customer = require("../models/Customer");
const Offer = require("../models/Offer");
const { handleProductQuantity } = require("../lib/stock-controller/others");
const { sendOrderNotificationEmail } = require("../lib/email-sender/sender");
const logStatusChange = require("../utils/logStatusChange");
const { checkSubCustomerAlert } = require("./subCustomerAlertService");

// Helper לחילוץ פרטי מסמך מ-provider
function extractProviderDoc(provider, verifiedData, webhookBody) {
    if (provider === "cardcom") {
        const docUrl =
            verifiedData?.TranzactionInfo?.DocumentUrl ||
            verifiedData?.DocumentInfo?.DocumentUrl ||
            null;

        const docNum =
            verifiedData?.DocumentInfo?.DocumentNumber ||
            verifiedData?.TranzactionInfo?.DocumentNumber ||
            null;

        const docType =
            verifiedData?.DocumentInfo?.DocumentType ||
            verifiedData?.TranzactionInfo?.DocumentType ||
            null;

        const docIdentity =
            verifiedData?.DocumentInfo?.DocumentIdentity ||
            verifiedData?.TranzactionInfo?.DocumentIdentity ||
            null;

        return { url: docUrl, document_number: docNum, document_type: docType, document_identity: docIdentity };
    }

    if (provider === "icredit") {
        const docUrl = verifiedData?.documentUrl || webhookBody?.DocumentURL || null;
        const docNum = verifiedData?.documentNum || webhookBody?.DocumentNum || null;
        const docType = verifiedData?.documentType || webhookBody?.DocumentType || null;

        return { url: docUrl, document_number: docNum, document_type: docType, document_identity: null };
    }

    return { url: null, document_number: null, document_type: null, document_identity: null };
}

// קבלת נתיב השדה isPaid לפי ספק
function getProviderPaidPath(provider) {
    if (provider === "cardcom") return "cardcom.isPaid";
    if (provider === "icredit") return "icredit.isPaid";
    throw new Error(`Unknown provider: ${provider}`);
}

// בניית אובייקט עדכון ספציפי לספק
function buildProviderUpdate(provider, verifiedData, webhookBody) {
    console.log('[buildProviderUpdate] provider: ', provider);
    console.log('[buildProviderUpdate] verifiedData: ', JSON.stringify(verifiedData, null, 2));

    const now = new Date();

    if (provider === "cardcom") {
        const lpResult = verifiedData || {};
        const txn = lpResult?.TranzactionInfo || {};
        const docInfo = lpResult?.DocumentInfo || {};

        const update = {
            "cardcom.isPaid": true,
            "cardcom.paidAt": now,
            "cardcom.transactionId": String(txn.TranzactionId || ""),
            "cardcom.approvalNumber": String(txn.ApprovalNumber || ""),
            "cardcom.documentUrl": txn.DocumentUrl || docInfo.DocumentUrl || null,
            "cardcom.documentNum": docInfo.DocumentNumber || txn.DocumentNumber || null,
            "cardcom.documentType": docInfo.DocumentType || txn.DocumentType || null,
            "cardcom.lastWebhookAt": now,
            "cardcom.body": webhookBody || {},
        };

        console.log('[buildProviderUpdate] Cardcom update object:', JSON.stringify(update, null, 2));
        return update;
    }

    if (provider === "icredit") {
        const saleId = verifiedData?.saleId || verifiedData?.SaleId || "";

        // הנתונים מגיעים ישירות מה-webhookBody (לא מה-verifyRes)
        const docUrl = verifiedData?.documentUrl || webhookBody?.DocumentURL || null;
        const docNum = verifiedData?.documentNum || webhookBody?.DocumentNum || null;
        const docType = verifiedData?.documentType || webhookBody?.DocumentType || null;
        const authNum = verifiedData?.transactionAuthNum || webhookBody?.TransactionAuthNum || null;

        const update = {
            "icredit.isPaid": true,
            "icredit.paidAt": now,
            "icredit.saleId": String(saleId || ""),
            "icredit.documentUrl": docUrl,
            "icredit.documentNum": docNum,
            "icredit.documentType": docType,
            "icredit.transactionAuthNum": authNum,
            "icredit.body": webhookBody || {},
        };

        console.log('[buildProviderUpdate] iCredit update object:', JSON.stringify(update, null, 2));
        return update;
    }

    throw new Error(`Unknown provider: ${provider}`);
}

/**
 * סיום תשלום הזמנה (idempotent + atomic)
 * פונקציה זו מטפלת בכל הפעולות שקורות אחרי תשלום מוצלח:
 * - סימון כ-paid (atomic)
 * - עדכון סטטוס ל-Processing
 * - הורדת מלאי
 * - סימון קופון/מבצעים כמנוצלים
 * - שליחת אימייל
 */
async function finalizePaidOrder({ orderId, provider, verifiedData, webhookBody }) {
    console.log(`[finalizePaidOrder] Starting for order ${orderId}, provider: ${provider}`);

    const paidPath = getProviderPaidPath(provider);

    // 1) Atomic update - סימון כ-paid רק אם עדיין לא paid
    const update = buildProviderUpdate(provider, verifiedData, webhookBody);

    const atomic = await Order.findOneAndUpdate(
        { _id: orderId, [paidPath]: { $ne: true } }, // רק אם עדיין לא שולם
        { $set: update },
        { new: false } // מחזיר את המסמך לפני העדכון
    );

    if (!atomic) {
        // ההזמנה כבר סומנה כ-paid (idempotent)
        console.log(`[finalizePaidOrder] Order ${orderId} already finalized (atomic check)`);
        return { success: true, message: "Order already finalized" };
    }

    // 2) שליפת ההזמנה המעודכנת מה-DB (עם כל השדות העדכניים)
    const selectField = provider === "cardcom" ? "+cardcom.body" : "+icredit.body";
    const freshOrder = await Order.findById(orderId)
        .select(selectField)
        .populate("status")
        .populate("user")
        .populate("coupon");

    if (!freshOrder) {
        throw new Error("Order not found after update");
    }

    console.log(`[finalizePaidOrder] Order ${freshOrder.invoice} marked as paid`);

    // 3) עדכון סטטוס ל-Processing (אם צריך)
    const processingStatus = await Status.findOne({ name: "Processing" });
    if (!processingStatus) {
        throw new Error("Processing status not found");
    }

    const currentStatusId = String(freshOrder.status?._id || freshOrder.status);
    const processingId = String(processingStatus._id);

    if (currentStatusId !== processingId) {
        freshOrder.status = processingStatus._id;
        await freshOrder.save();

        logStatusChange({
            from: "Pending",
            to: "Processing",
            functionName: `finalizePaidOrder:${provider}`,
            order: freshOrder,
        });
    }

    // 4) הורדת מלאי
    try {
        console.log(`[finalizePaidOrder] Decreasing stock for order ${freshOrder.invoice}`);
        await handleProductQuantity(freshOrder.cart);
        console.log(`[finalizePaidOrder] Stock decreased successfully`);
    } catch (e) {
        console.error(`[finalizePaidOrder] Stock decrease error:`, e.message);
        // ממשיכים הלאה גם אם יש שגיאה במלאי
    }

    // 5) סימון קופון כמנוצל
    if (freshOrder.coupon) {
        try {
            const coupon = await Coupon.findById(freshOrder.coupon);
            if (coupon && !coupon.isUsed) {
                if (coupon.discountType.type === "percentage") {
                    coupon.timesIsUsed = (coupon.timesIsUsed || 0) + 1;
                } else if (coupon.discountType.type === "fixed") {
                    coupon.timesIsUsed = (coupon.timesIsUsed || 0) + 1;
                    coupon.isUsed = true;
                }
                await coupon.save();
                console.log(`[finalizePaidOrder] Coupon ${coupon._id} marked as used`);
            }
        } catch (e) {
            console.error(`[finalizePaidOrder] Coupon mark used error:`, e.message);
        }
    }

    // 6) סימון מבצעים oncePerCustomer כמנוצלים
    if (freshOrder.usedOfferIds?.length) {
        try {
            const customer = await Customer.findById(freshOrder.user);
            if (customer) {
                // שליפת המבצעים שנוצלו עם oncePerCustomer: true
                const usedOffers = await Offer.find({
                    _id: { $in: freshOrder.usedOfferIds },
                    oncePerCustomer: true,
                });

                if (usedOffers.length > 0) {
                    const toAdd = usedOffers
                        .map(o => o._id.toString())
                        .filter(id => !customer.redeemedOffers.some(x => x.toString() === id));

                    if (toAdd.length > 0) {
                        customer.redeemedOffers.push(...toAdd);
                        await customer.save();
                        console.log(`[finalizePaidOrder] Marked ${toAdd.length} offers as redeemed for customer ${customer.email}`);
                    }
                }
            }
        } catch (e) {
            console.error(`[finalizePaidOrder] Offer redemption error:`, e.message);
        }
    }

    // 6.5) אם הגיע CustomerId מהספק (iCredit) - לשמור אותו על הלקוח אצלנו
    if (provider === "icredit" && freshOrder.user) {
        try {
            const ipnCustomerIdRaw = webhookBody?.CustomerId || freshOrder?.icredit?.body?.CustomerId;
            const ipnCustomerId = Number(ipnCustomerIdRaw || 0);

            if (ipnCustomerId > 0) {
                const customer = await Customer.findById(freshOrder.user);
                if (customer) {
                    const current = customer.accounting?.externalCustomerId || null;

                    if (!current) {
                        customer.accounting = customer.accounting || {};
                        customer.accounting.provider = "rivhit";
                        customer.accounting.externalCustomerId = ipnCustomerId;
                        customer.accounting.syncedAt = new Date();
                        customer.accounting.lastSyncError = undefined;
                        await customer.save();
                        console.log(`[finalizePaidOrder] Saved Rivhit CustomerId ${ipnCustomerId} to customer ${customer.email}`);
                    } else if (Number(current) !== ipnCustomerId) {
                        console.log(`[finalizePaidOrder] No need to update Rivhit CustomerId (${ipnCustomerId}) for customer ${customer.email} because it already exists as ${current}`);
                        // console.warn(
                        //     `[finalizePaidOrder] Overwriting RivhitId: customer ${customer.email} had RivhitId=${current}, IPN returned ${ipnCustomerId} - updating to IPN value`
                        // );
                        // customer.accounting = customer.accounting || {};
                        // customer.accounting.provider = "rivhit";
                        // customer.accounting.externalCustomerId = ipnCustomerId;
                        // customer.accounting.syncedAt = new Date();
                        // customer.accounting.lastSyncError = undefined;
                        // await customer.save();
                        // console.log(`[finalizePaidOrder] Updated Rivhit CustomerId to ${ipnCustomerId} for customer ${customer.email}`);
                    }
                }
            }
        } catch (e) {
            console.error("[finalizePaidOrder] Failed saving Rivhit CustomerId from IPN:", e.message);
        }
    }

    // 7) שמירת אסמכתא מסמך (חשבונית מס קבלה) על ההזמנה
    try {
        const { url, document_number, document_type, document_identity } = extractProviderDoc(provider, verifiedData, webhookBody);

        console.log(`[finalizePaidOrder] Document info for ${provider}:`, { url, document_number, document_type });

        if (url) {
            // אל תדרוס אם כבר קיים (idempotent)
            if (!freshOrder.accountingDocs?.invoiceReceipt?.url) {
                freshOrder.accountingDocs = freshOrder.accountingDocs || {};
                freshOrder.accountingDocs.invoiceReceipt = {
                    provider: "rivhit",
                    url,
                    document_number,
                    document_type,
                    document_identity,
                    reference: `auto:${provider}:${freshOrder.invoice || freshOrder._id}`,
                    notes: "נוצר אוטומטית לאחר סליקה",
                    issuedAt: new Date(),
                    raw: { verifiedData },
                };
                await freshOrder.save();
                console.log(`[finalizePaidOrder] Invoice receipt saved to order ${freshOrder.invoice}`);
            } else {
                console.log(`[finalizePaidOrder] Invoice receipt already exists for order ${freshOrder.invoice}`);
            }
        } else {
            console.log(`[finalizePaidOrder] No document URL found for order ${freshOrder.invoice}`);
        }
    } catch (docError) {
        console.error(`[finalizePaidOrder] Error saving invoice receipt to order:`, docError.message);
    }

    // 8) שליחת אימייל הודעה על הזמנה
    try {
        await sendOrderNotificationEmail(freshOrder, freshOrder.user_info);
        console.log(`[finalizePaidOrder] Order notification email sent for order ${freshOrder.invoice}`);
    } catch (e) {
        console.error(`[finalizePaidOrder] Email error:`, e.message);
    }

    // 9) בדיקת התראת סכום תקופתי לתת-לקוח (גם עבור תשלום כרטיס)
    try {
        await checkSubCustomerAlert(freshOrder.user, parseFloat(freshOrder.total || 0));
    } catch (alertError) {
        console.error(`[finalizePaidOrder] Alert check error:`, alertError.message);
    }

    console.log(`[finalizePaidOrder] Order ${freshOrder.invoice} finalized successfully`);

    return {
        success: true,
        message: "Order finalized successfully",
        orderId: freshOrder._id,
        invoice: freshOrder.invoice,
    };
}

module.exports = { finalizePaidOrder };