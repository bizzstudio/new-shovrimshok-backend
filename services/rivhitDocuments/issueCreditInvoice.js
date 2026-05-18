// services/rivhitDocuments/issueCreditInvoice.js
const { documentNew } = require("../../utils/rivhit");
const { getDocumentTypeByKind } = require("../../utils/rivhitDocumentTypes");
const {
    formatIssueDateTime,
    extractDocumentInfo,
    validateDocumentNewResponse,
} = require("../../utils/rivhitHelpers");
const { fetchRivhitDocumentList, clearCustomerCache } = require("./fetch");
const Order = require("../../models/Order");
const MainCustomer = require("../../models/MainCustomer");

// הנפקת חשבונית מס זיכוי על חשבונית מס/חשבונית מס קבלה קיימת
async function issueCreditInvoice({
    rivhitCustomerId,      // customer_id של ריווחית (externalCustomerId)
    invoiceDocumentNumber, // document_number של החשבונית המקורית מריווחית
    amount,                // סכום לזיכוי
    notes,
    issue_date, // תאריך הנפקה (YYYY-MM-DD או DDMMYYYY) - אופציונלי
    issue_time, // שעת הנפקה (HH:mm:ss או HHmmss) - אופציונלי
}) {
    if (!rivhitCustomerId) {
        const err = new Error();
        err.message = {
            en: "Please provide Rivhit customer number",
            he: "נא לספק מספר לקוח בריווחית"
        };
        throw err;
    }

    if (!invoiceDocumentNumber) {
        const err = new Error();
        err.message = {
            en: "Please provide invoice document number",
            he: "נא לספק מספר חשבונית מקורית"
        };
        throw err;
    }

    // קבלת documentType אוטומטית מריווחית
    const documentType = await getDocumentTypeByKind("credit_invoice");

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
        const err = new Error();
        err.message = {
            en: "amount must be a positive number",
            he: "הסכום חייב להיות מספר חיובי"
        };
        throw err;
    }

    // 1) שליפת כל המסמכים של הלקוח מריווחית
    console.log(`[issueCreditInvoice] Fetching documents for Rivhit customer ${rivhitCustomerId}`);
    const rawDocuments = await fetchRivhitDocumentList({
        customerId: rivhitCustomerId
    });

    // 2) חיפוש החשבונית המבוקשת ברשימה
    const originalInvoice = rawDocuments.find(doc =>
        doc.document_number === Number(invoiceDocumentNumber)
    );

    if (!originalInvoice) {
        const err = new Error();
        err.message = {
            en: `Invoice ${invoiceDocumentNumber} not found for this customer in Rivhit`,
            he: `חשבונית ${invoiceDocumentNumber} לא נמצאה עבור לקוח זה בריווחית`
        };
        throw err;
    }

    // 3) בדיקה שזו חשבונית חשבונאית (invoice או invoice_receipt)
    if (!originalInvoice.is_accounting) {
        const err = new Error();
        err.message = {
            en: `Document ${invoiceDocumentNumber} is not an accounting invoice`,
            he: `מסמך ${invoiceDocumentNumber} אינו חשבונית חשבונאית`
        };
        throw err;
    }

    // 4) בדיקה שהחשבונית לא מבוטלת
    if (originalInvoice.is_cancelled) {
        const err = new Error();
        err.message = {
            en: `Invoice ${invoiceDocumentNumber} has been cancelled`,
            he: `חשבונית ${invoiceDocumentNumber} בוטלה`
        };
        throw err;
    }

    // 5) בדיקה שסכום הזיכוי לא עולה על סכום החשבונית המקורית
    const originalAmount = Number(originalInvoice.amount || 0);
    if (numAmount > originalAmount) {
        const err = new Error();
        err.message = {
            en: `Credit amount (${numAmount}) cannot exceed original invoice total (${originalAmount})`,
            he: `סכום הזיכוי (${numAmount}) לא יכול לעלות על סכום החשבונית המקורית (${originalAmount})`
        };
        throw err;
    }

    // 6) שליפת לקוח ראשי מה-DB שלנו
    const mainCustomer = await MainCustomer.findOne({
        externalCustomerId: Number(rivhitCustomerId)
    }).lean();

    if (!mainCustomer) {
        const err = new Error();
        err.message = {
            en: "Customer not found in system",
            he: "הלקוח לא נמצא במערכת"
        };
        throw err;
    }

    // 7) בניית reference מקושר לחשבונית המקורית
    const originalReference = originalInvoice.reference || `inv:${invoiceDocumentNumber}`;
    const request_reference = `credit:${originalReference}:${numAmount}`;

    // פורמט תאריך ושעה (אם קיימים)
    const dateTimeFields = formatIssueDateTime(issue_date, issue_time);

    // 8) בניית תיאור מפורט
    const invoiceType = originalInvoice.document_type_name || "חשבונית";
    const description = `זיכוי עבור ${invoiceType} מספר ${invoiceDocumentNumber}`;

    // בניית הערות מפורטות
    const orderRef = originalInvoice.order || originalInvoice.reference || "";
    const detailedComments = notes
        ? `${notes} | ${description}${orderRef ? `, הזמנה ${orderRef}` : ""}, סכום ${numAmount} ₪`
        : `${description}${orderRef ? `, הזמנה ${orderRef}` : ""}, סכום ${numAmount} ₪`;

    const payload = {
        document_type: Number(documentType),
        customer_id: Number(rivhitCustomerId),
        create_customer: false, // הלקוח כבר קיים בריווחית
        request_reference,
        price_include_vat: false, // חשבונית זיכוי ללא מע"מ
        items: [
            {
                description,
                quantity: 1,
                price_nis: -numAmount, // ריווחית מצפה לסכום שלילי בחשבונית זיכוי
            },
        ],
        comments: String(detailedComments),
        ...dateTimeFields,
    };

    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    console.log('[issueCreditInvoice] Rivhit payload:', payload);

    const resp = await documentNew(payload);

    // בדיקת תקינות התשובה
    validateDocumentNewResponse(resp, "הנפקת החשבונית מס זיכוי");

    const { docNumber, docUrl, docType, docIdentity, confirmationNumber } = extractDocumentInfo(resp, documentType);

    const docObj = {
        provider: "rivhit",
        document_type: docType,
        document_number: docNumber,
        document_identity: docIdentity,
        confirmation_number: confirmationNumber || undefined,
        url: docUrl,
        amount: numAmount,
        reference: request_reference,
        originalInvoiceNumber: invoiceDocumentNumber,
        originalInvoiceType: invoiceType,
        originalInvoiceReference: originalReference,
        notes: notes || "",
        issuedAt: new Date(),
        raw: resp,
    };

    // 9) שמירת חשבונית הזיכוי בהזמנה (אם יש reference להזמנה)
    if (orderRef) {
        // ניסיון למצוא הזמנה לפי ה-reference או ה-invoice number
        const order = await Order.findOne({
            $or: [
                { invoice: Number(orderRef) },
                { "accountingDocs.invoice.reference": originalReference },
                { "accountingDocs.invoiceReceipt.reference": originalReference }
            ]
        });

        if (order) {
            await Order.findByIdAndUpdate(order._id, {
                $set: {
                    "accountingDocs.creditInvoice": docObj,
                },
            });
            console.log(`[issueCreditInvoice] Credit invoice saved to order ${order.invoice}`);
        }
    }

    console.log(`[issueCreditInvoice] Credit invoice ${docNumber} created for original invoice ${invoiceDocumentNumber}`);

    // Clear cache for this customer after creating a document
    clearCustomerCache(rivhitCustomerId);

    return {
        document: docObj,
        originalInvoice: {
            document_number: invoiceDocumentNumber,
            document_type: originalInvoice.document_type,
            document_type_name: invoiceType,
            amount: originalAmount,
            date: originalInvoice.document_date,
            reference: originalReference,
        },
        rivhitResponse: resp,
    };
}

module.exports = { issueCreditInvoice };