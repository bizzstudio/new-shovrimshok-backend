// services/rivhitDocuments/issueReceipt.js
const { receiptNew } = require("../../utils/rivhit");
const { getReceiptTypeByKind } = require("../../utils/rivhitReceiptTypes");
const {
    buildPaymentsArray,
    validatePaymentsArray,
    formatIssueDateTime,
    extractReceiptInfo,
    validateReceiptNewResponse,
} = require("../../utils/rivhitHelpers");
const { fetchRivhitDocumentList, clearCustomerCache } = require("./fetch");
const Order = require("../../models/Order");
const MainCustomer = require("../../models/MainCustomer");

// הנפקת קבלה על חשבונית מס קיימת (לא על חשבונית מס קבלה!)
async function issueReceiptForInvoices({
    rivhitCustomerId,      // customer_id של ריווחית (externalCustomerId)
    invoiceDocumentNumber, // document_number של החשבונית המקורית מריווחית
    payments,              // מערך תקבולים (חובה)
    paymentMethodKey,
    notes,
    issue_date,
    issue_time,
}) {
    if (!rivhitCustomerId) {
        const err = new Error();
        err.message = {
            en: "Please provide Rivhit customer ID",
            he: "נא לספק מזהה לקוח ריווחית"
        };
        throw err;
    }

    if (!invoiceDocumentNumber) {
        const err = new Error();
        err.message = {
            en: "Please provide invoice document number",
            he: "נא לספק מספר חשבונית מס מקורית"
        };
        throw err;
    }

    if (!Array.isArray(payments) || payments.length < 1) {
        const err = new Error();
        err.message = {
            en: "Please provide payment details (payment list)",
            he: "נא לספק פרטי תשלום (רשימת תקבולים)"
        };
        throw err;
    }

    // קבלת receiptType אוטומטית מריווחית
    const receiptType = await getReceiptTypeByKind("receipt");

    // 1) שליפת כל המסמכים של הלקוח מריווחית
    console.log(`[issueReceiptForInvoices] Fetching documents for Rivhit customer ${rivhitCustomerId}`);
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

    // 3) בדיקה שזו חשבונית חשבונאית
    if (!originalInvoice.is_accounting) {
        const err = new Error();
        err.message = {
            en: `Document ${invoiceDocumentNumber} is not an accounting invoice`,
            he: `מסמך ${invoiceDocumentNumber} אינו חשבונית חשבונאית`
        };
        throw err;
    }

    // 4) בדיקה שזו חשבונית מס רגילה (לא חשבונית מס קבלה!)
    // חשבונית מס קבלה כבר כוללת קבלה, אי אפשר להנפיק עליה קבלה נוספת
    if (originalInvoice.is_invoice_receipt === true) {
        const err = new Error();
        err.message = {
            en: `Cannot issue receipt for invoice-receipt ${invoiceDocumentNumber}. Invoice-receipts already include payment.`,
            he: `לא ניתן להנפיק קבלה עבור חשבונית מס קבלה ${invoiceDocumentNumber}. חשבונית מס קבלה כבר כוללת תשלום.`
        };
        throw err;
    }

    // 5) בדיקה שהחשבונית לא מבוטלת
    if (originalInvoice.is_cancelled) {
        const err = new Error();
        err.message = {
            en: `Invoice ${invoiceDocumentNumber} has been cancelled`,
            he: `חשבונית ${invoiceDocumentNumber} בוטלה`
        };
        throw err;
    }

    // 6) בדיקה שהחשבונית לא סגורה/שולמה כבר
    if (originalInvoice.is_closed) {
        const err = new Error();
        err.message = {
            en: `Invoice ${invoiceDocumentNumber} is already closed/paid`,
            he: `חשבונית ${invoiceDocumentNumber} כבר סגורה/שולמה`
        };
        throw err;
    }

    // 6) בניית מערך תשלומים ווולידציה
    const originalAmount = Number(originalInvoice.amount || 0);
    const paymentsArray = buildPaymentsArray(payments);
    validatePaymentsArray(paymentsArray, originalAmount);

    // 7) שליפת לקוח ראשי מה-DB שלנו
    const mainCustomer = await MainCustomer.findOne({
        externalCustomerId: Number(rivhitCustomerId)
    }).lean();

    if (!mainCustomer) {
        const err = new Error();
        err.message = {
            en: "Main customer not found in system",
            he: "הלקוח הראשי לא נמצא במערכת"
        };
        throw err;
    }

    // 8) בניית reference מקושר לחשבונית המקורית
    const originalReference = originalInvoice.reference || `inv:${invoiceDocumentNumber}`;
    const request_reference = `receipt:${originalReference}`;

    // פורמט תאריך ושעה (אם קיימים)
    const dateTimeFields = formatIssueDateTime(issue_date, issue_time);

    // 9) בניית הערות מפורטות
    const invoiceType = originalInvoice.document_type_name || "חשבונית";
    const orderRef = originalInvoice.order || originalInvoice.reference || "";

    const paymentsSummary = paymentsArray.map(p => `${p.amount_nis}₪`).join(" + ");

    const description = `קבלה עבור ${invoiceType} מספר ${invoiceDocumentNumber}`;
    const detailedComments = notes
        ? `${notes} | ${description}${orderRef ? `, הזמנה ${orderRef}` : ""}, תשלום: ${paymentsSummary}, סה"כ ${originalAmount}₪`
        : `${description}${orderRef ? `, הזמנה ${orderRef}` : ""}, תשלום: ${paymentsSummary}, סה"כ ${originalAmount}₪`;

    const payload = {
        receipt_type: Number(receiptType),
        customer_id: Number(rivhitCustomerId),
        reference: Number(invoiceDocumentNumber), // אסמכתא – חשבונית שמשולמת
        request_reference: request_reference,
        prevent_duplicates: true,
        payments: paymentsArray,
        comments: String(detailedComments),
        digital_signature: true,
        send_mail: true,
        ...(mainCustomer?.email ? { email_to: mainCustomer.email } : {}),
        ...dateTimeFields,
        last_name: mainCustomer.name,
        first_name: ""
    };

    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    const resp = await receiptNew(payload);

    validateReceiptNewResponse(resp, "הנפקת הקבלה");

    const { docNumber, docUrl, docType, docIdentity, confirmationNumber } = extractReceiptInfo(resp);

    const docObj = {
        provider: "rivhit",
        document_type: docType,
        document_number: docNumber,
        document_identity: docIdentity,
        confirmation_number: confirmationNumber || undefined,
        url: docUrl,
        reference: request_reference,
        originalInvoiceNumber: invoiceDocumentNumber,
        originalInvoiceType: invoiceType,
        originalInvoiceReference: originalReference,
        notes: notes || "",
        issuedAt: new Date(),
        raw: resp,
    };

    // 10) שמירת הקבלה בכל ההזמנות המקושרות לחשבונית זו + סימון שולם + עדכון paymentMethod
    const mainCustomerId = mainCustomer._id;
    const updatePayload = {
        "accountingDocs.receipt": docObj,
        "icredit.isPaid": true,
        "icredit.paidAt": new Date(),
    };
    if (paymentMethodKey) {
        updatePayload.paymentMethod = `credit_${paymentMethodKey}`;
    }
    const updated = await Order.updateMany(
        {
            mainCustomer: mainCustomerId,
            $or: [
                { "accountingDocs.invoice.document_number": Number(invoiceDocumentNumber) },
                { "accountingDocs.invoiceReceipt.document_number": Number(invoiceDocumentNumber) },
            ],
        },
        { $set: updatePayload }
    );
    if (updated.modifiedCount > 0) {
        console.log(`[issueReceiptForInvoices] Receipt saved to ${updated.modifiedCount} order(s) and marked as paid`);
    }

    console.log(`[issueReceiptForInvoices] Receipt ${docNumber} created for invoice ${invoiceDocumentNumber}`);

    // Clear cache for this customer after creating a document
    clearCustomerCache(rivhitCustomerId);

    return {
        reference: request_reference,
        totalAmount: originalAmount,
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
};

module.exports = { issueReceiptForInvoices };