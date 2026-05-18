// services/rivhitDocuments/issueDeliveryNote.js
const { documentNew } = require("../../utils/rivhit");
const { getDocumentTypeByKind } = require("../../utils/rivhitDocumentTypes");
const {
    buildDeliveryReference,
    buildItemsFromOrderCart,
    formatIssueDateTime,
    extractDocumentInfo,
    validateDocumentNewResponse,
    saveRivhitCustomerIdIfNeeded,
} = require("../../utils/rivhitHelpers");
const { clearCustomerCache } = require("./fetch");
const Order = require("../../models/Order");
const Customer = require("../../models/Customer");

// הנפקת תעודת משלוח ידנית על הזמנה
async function issueDeliveryNoteForOrder({
    orderId,
    notes,
    issue_date, // תאריך הנפקה (YYYY-MM-DD או DDMMYYYY) - אופציונלי
    issue_time, // שעת הנפקה (HH:mm:ss או HHmmss) - אופציונלי
}) {
    if (!orderId) {
        const err = new Error();
        err.message = { en: "Please provide an order ID", he: "נא לספק מזהה הזמנה" };
        throw err;
    }

    // קבלת documentType אוטומטית מריווחית
    const documentType = await getDocumentTypeByKind("delivery_note");

    const order = await Order.findById(orderId).populate("user");
    if (!order) {
        const err = new Error();
        err.message = { en: "Order not found", he: "ההזמנה לא נמצאה" };
        throw err;
    }

    // אל תנפיק כפול
    if (order.accountingDocs?.deliveryNote?.url || order.accountingDocs?.deliveryNote?.document_number) {
        const err = new Error();
        err.message = {
            en: "Delivery note already exists for this order",
            he: "כבר קיימת תעודת משלוח עבור הזמנה זו"
        };
        throw err;
    }

    const customerId = order.user?._id;
    if (!customerId) {
        const err = new Error();
        err.message = {
            en: "Customer not found for this order",
            he: "לא נמצא לקוח עבור ההזמנה זו"
        };
        throw err;
    }

    const customer = await Customer.findById(customerId).lean();
    if (!customer) {
        const err = new Error();
        err.message = { en: "Customer not found in system", he: "הלקוח לא נמצא במערכת" };
        throw err;
    }

    const request_reference = buildDeliveryReference(order);

    // פורמט תאריך ושעה (אם קיימים)
    const dateTimeFields = formatIssueDateTime(issue_date, issue_time);

    // בניית הערות מפורטות
    const itemsCount = Array.isArray(order.cart) ? order.cart.length : 0;
    const totalAmount = Number(order.total || 0);
    const description = `תעודת משלוח עבור הזמנה ${order.invoice}`;

    const detailedComments = notes
        ? `${notes} | ${description}, ${itemsCount} פריטים, סה"כ ${totalAmount}₪`
        : `${description}, ${itemsCount} פריטים, סה"כ ${totalAmount}₪`;

    // בדיקה אם לתת לקוח כבר יש customer_id בריווחית
    const existingRivhitId = customer.accounting?.externalCustomerId;
    const shouldCreateCustomer = !existingRivhitId;

    const payload = {
        document_type: Number(documentType),
        customer_id: existingRivhitId ? Number(existingRivhitId) : 0,
        create_customer: shouldCreateCustomer,
        customer,
        request_reference,
        items: await buildItemsFromOrderCart(order),
        // תואם לשורות: נטו לחייב במע״מ + exempt_vat לפטור; מסמך מעורב בריווחית חייב שקל (תיעוד ריווחית)
        price_include_vat: false,
        currency_id: 1,
        comments: String(detailedComments),
        prevent_duplicates: true, // מניעת כפילויות
        ...dateTimeFields, // תאריך ושעה (אם קיימים)
    };

    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    const resp = await documentNew(payload);

    // בדיקת תקינות התשובה
    validateDocumentNewResponse(resp, "הנפקת תעודת המשלוח");

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

    await saveRivhitCustomerIdIfNeeded(customerId, rivhitCustomerId);

    await Order.findByIdAndUpdate(orderId, {
        $set: {
            "accountingDocs.deliveryNote": docObj,
        },
    });

    console.log(`[issueDeliveryNoteForOrder] Delivery note saved to order ${order.invoice}`);

    // Clear cache for this customer after creating a document
    if (rivhitCustomerId) clearCustomerCache(rivhitCustomerId);

    return { orderId, invoice: order.invoice, document: docObj, rivhitResponse: resp };
};

module.exports = { issueDeliveryNoteForOrder };