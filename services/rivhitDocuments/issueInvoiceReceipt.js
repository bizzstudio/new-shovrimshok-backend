// services/rivhitDocuments/issueInvoiceReceipt.js
const { documentNew } = require("../../utils/rivhit");
const { getDocumentTypeByKind } = require("../../utils/rivhitDocumentTypes");
const {
    buildInvoiceReference,
    sumOrdersTotal,
    buildPaymentsArray,
    validatePaymentsArray,
    formatIssueDateTime,
    extractDocumentInfo,
    validateDocumentNewResponse,
    saveRivhitMainCustomerIdIfNeeded,
} = require("../../utils/rivhitHelpers");
const { clearCustomerCache } = require("./fetch");
const Order = require("../../models/Order");
const MainCustomer = require("../../models/MainCustomer");

// הנפקת חשבונית מס קבלה ידני על מספר הזמנות בהקפה
async function issueInvoiceReceiptForOrders({
    orderIds,
    paymentMethodKey, // למשל: "check" | "bank_transfer" | "cash" | ...
    notes,
    payments, // מערך תקבולים (שדה חובה לחשבונית מס קבלה)
    issue_date, // תאריך הנפקה (YYYY-MM-DD או DDMMYYYY) - אופציונלי
    issue_time, // שעת הנפקה (HH:mm:ss או HHmmss) - אופציונלי
}) {
    if (!Array.isArray(orderIds) || orderIds.length < 1) {
        const err = new Error();
        err.message = { en: "Please provide a list of orders", he: "נא לספק רשימת הזמנות" };
        throw err;
    }

    // קבלת documentType אוטומטית מריווחית
    const documentType = await getDocumentTypeByKind("invoice_receipt");

    // 1) שליפה
    const orders = await Order.find({ _id: { $in: orderIds } }).populate("user");
    if (orders.length !== orderIds.length) {
        const err = new Error();
        err.message = { en: "Some orders were not found", he: "חלק מההזמנות לא נמצאו" };
        throw err;
    }

    // 2) ולידציות
    const invalid = orders.filter(o => o.paymentMethod !== "credit");
    if (invalid.length) {
        const err = new Error();
        err.message = {
            en: `All orders must be credit. Invalid: ${invalid.map(o => o.invoice).join(", ")}`,
            he: `כל ההזמנות חייבות להיות הזמנות בהקפה. הזמנות לא תקינות: ${invalid.map(o => o.invoice).join(", ")}`
        };
        throw err;
    }

    // בדיקה אם ההזמנות כבר שולמו (דרך קארדקום, iCredit, או ריווחית)
    const alreadyPaid = orders.filter(o =>
        o.cardcom?.isPaid === true ||
        o.icredit?.isPaid === true ||
        o.accountingDocs?.invoiceReceipt?.url ||
        o.accountingDocs?.invoiceReceipt?.document_number
    );
    if (alreadyPaid.length) {
        const err = new Error();
        err.message = {
            en: `Some orders have already been paid: ${alreadyPaid.map(o => o.invoice).join(", ")}`,
            he: `חלק מההזמנות שנבחרו כבר שולמו: ${alreadyPaid.map(o => o.invoice).join(", ")}`
        };
        throw err;
    }

    // 3) כולם חייבים להיות של אותו לקוח ראשי
    const mainCustomerId = String(orders[0].mainCustomer || "");
    if (!mainCustomerId) {
        const err = new Error();
        err.message = {
            en: "Some orders are missing a customer",
            he: "חלק מההזמנות שנבחרו חסרות לקוח"
        };
        throw err;
    }
    const mixedMain = orders.some(o => String(o.mainCustomer || "") !== mainCustomerId);
    if (mixedMain) {
        const err = new Error();
        err.message = {
            en: "All selected orders must belong to the same main customer",
            he: "כל ההזמנות הנבחרות חייבות להיות של אותו לקוח ראשי"
        };
        throw err;
    }

    const mainCustomer = await MainCustomer.findById(mainCustomerId).lean();
    if (!mainCustomer) {
        const err = new Error();
        err.message = { en: "Customer not found in system", he: "הלקוח לא נמצא במערכת" };
        throw err;
    }

    // 4) בניית מסמך לריווחית (חשבונית מס קבלה) – ריווחית תאתר/תיצור לקוח לפי מייל
    const request_reference = buildInvoiceReference(orders);
    const totalAmount = sumOrdersTotal(orders);

    // 4.1) בניית מערך תשלומים ווולידציה
    const paymentsArray = buildPaymentsArray(payments);
    validatePaymentsArray(paymentsArray, totalAmount);

    // 4.2) פורמט תאריך ושעה (אם קיימים)
    const dateTimeFields = formatIssueDateTime(issue_date, issue_time);

    // 4.3) בניית הערות מפורטות
    const orderNumbers = orders.map(o => o.invoice).join(", ");
    const paymentsSummary = paymentsArray.map(p => {
        const amount = p.amount_nis;
        return `${amount}₪`;
    }).join(" + ");

    const description = orders.length > 1
        ? `חשבונית מס קבלה עבור ${orders.length} הזמנות: ${orderNumbers}`
        : `חשבונית מס קבלה עבור הזמנה ${orders[0].invoice}`;

    const detailedComments = notes
        ? `${notes} | ${description}, תשלום: ${paymentsSummary}, סה"כ ${totalAmount}₪`
        : `${description}, תשלום: ${paymentsSummary}, סה"כ ${totalAmount}₪`;

    const payload = {
        document_type: Number(documentType),
        customer_id: 0,
        create_customer: true,
        find_by_mail: true,
        customer: mainCustomer,
        request_reference,
        items: [
            {
                description: orders.length > 1 ?
                    `תשלום עבור הזמנות: ${orderNumbers}` :
                    `תשלום עבור הזמנה ${orders[0].invoice}`,
                quantity: 1,
                price_nis: totalAmount,
            },
        ],
        price_include_vat: true, // המחיר כולל מע"מ - כך הסכום בפריט יהיה זהה לסכום בתשלום
        payments: paymentsArray, // מערך תקבולים (שדה חובה לחשבונית מס קבלה)
        comments: String(detailedComments),
        prevent_duplicates: true, // מניעת כפילויות
        ...dateTimeFields, // תאריך ושעה (אם קיימים)
    };

    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    const resp = await documentNew(payload);

    validateDocumentNewResponse(resp, "הנפקת החשבונית מס קבלה");

    const { docNumber, docUrl, docType, docIdentity, confirmationNumber } = extractDocumentInfo(resp, documentType);
    const rivhitCustomerId = Number(resp?.data?.customer_id ?? 0);

    const docObj = {
        provider: "rivhit",
        document_type: docType,
        document_number: docNumber,
        document_identity: docIdentity,
        confirmation_number: confirmationNumber || undefined,
        url: docUrl,
        reference: request_reference,
        notes: notes || "",
        issuedAt: new Date(),
        raw: resp,
    };

    // 5) עדכון כרטיס הלקוח הראשי עם מספר לקוח ריווחית (לשליפת מסמכים בהמשך)
    await saveRivhitMainCustomerIdIfNeeded(mainCustomerId, rivhitCustomerId);

    // 6) עדכון הזמנות: לשמור חשבונית מס קבלה + לסמן שולמו + לעדכן paymentMethod לפי הבחירה
    const paymentMethodValue = `credit_${paymentMethodKey}`; // למשל credit_check

    await Order.updateMany(
        { _id: { $in: orderIds } },
        {
            $set: {
                paymentMethod: paymentMethodValue,
                "icredit.isPaid": true,
                "icredit.paidAt": new Date(),
                "accountingDocs.invoiceReceipt": docObj,
            },
        }
    );

    console.log(`[issueInvoiceReceiptForOrders] Updated ${orders.length} orders successfully`);

    // Clear cache for this customer after creating a document
    if (rivhitCustomerId) clearCustomerCache(rivhitCustomerId);

    return {
        reference: request_reference,
        totalAmount,
        document: docObj,
        updatedOrders: orders.map(o => ({ orderId: o._id, invoice: o.invoice })),
        rivhitResponse: resp,
    };
};

module.exports = { issueInvoiceReceiptForOrders };