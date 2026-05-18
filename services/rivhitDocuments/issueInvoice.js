// services/rivhitDocuments/issueInvoice.js
const { documentNew } = require("../../utils/rivhit");
const { getDocumentTypeByKind } = require("../../utils/rivhitDocumentTypes");
const {
  buildInvoiceReference,
  sumOrdersTotal,
  formatIssueDateTime,
  extractDocumentInfo,
  validateDocumentNewResponse,
  saveRivhitMainCustomerIdIfNeeded,
} = require("../../utils/rivhitHelpers");
const { clearCustomerCache } = require("./fetch");
const Order = require("../../models/Order");
const MainCustomer = require("../../models/MainCustomer");

// הנפקת חשבונית מס רגילה (ללא תשלום) על הזמנות ו/או תעודות החזרה מריווחית
async function issueInvoiceForOrders({
    orderIds,
    rivhitReturnNotes, // [{ document_number, amount, description }] — תעודות החזרה מריווחית שאינן קשורות להזמנה
    rivhitCustomerId,  // מזהה לקוח ריווחית (כאשר אין orderIds)
    notes,
    issue_date,
    issue_time,
}) {
    const hasOrders = Array.isArray(orderIds) && orderIds.length > 0;
    const hasRivhitReturns = Array.isArray(rivhitReturnNotes) && rivhitReturnNotes.length > 0;

    if (!hasOrders && !hasRivhitReturns) {
        const err = new Error();
        err.message = { en: "Please provide a list of orders or return notes", he: "נא לספק רשימת הזמנות או תעודות החזרה" };
        throw err;
    }

    const documentType = await getDocumentTypeByKind("invoice");

    // --- שליפת הזמנות מה-DB (אם קיימות) ---
    let orders = [];
    let mainCustomer = null;
    let mainCustomerId = null;

    if (hasOrders) {
        orders = await Order.find({ _id: { $in: orderIds } });
        if (orders.length !== orderIds.length) {
            const err = new Error();
            err.message = { en: "Some orders were not found", he: "חלק מההזמנות לא נמצאו" };
            throw err;
        }

        // בדיקה שאף הזמנה לא כוללת כבר חשבונית
        const ordersWithInvoice = orders.filter(o =>
            o.accountingDocs?.invoice?.document_number ||
            o.accountingDocs?.invoiceReceipt?.document_number
        );
        if (ordersWithInvoice.length > 0) {
            const invoiceNumbers = ordersWithInvoice.map(o => o.invoice).join(", ");
            const isPlural = ordersWithInvoice.length > 1;
            const err = new Error();
            err.message = {
                en: isPlural
                    ? `Cannot create invoice: orders ${invoiceNumbers} already have an invoice`
                    : `Cannot create invoice: order ${invoiceNumbers} already has an invoice`,
                he: isPlural
                    ? `לא ניתן להנפיק חשבונית: הזמנות ${invoiceNumbers} כבר כוללות חשבונית`
                    : `לא ניתן להנפיק חשבונית: הזמנה ${invoiceNumbers} כבר כוללת חשבונית`
            };
            throw err;
        }

        // כולם חייבים להיות של אותו לקוח ראשי
        mainCustomerId = String(orders[0].mainCustomer || "");
        const mixedMain = orders.some(o => String(o.mainCustomer || "") !== mainCustomerId);
        if (mixedMain) {
            const err = new Error();
            err.message = {
                en: "All selected orders must belong to the same main customer",
                he: "כל ההזמנות הנבחרות חייבות להיות של אותו לקוח ראשי"
            };
            throw err;
        }

        mainCustomer = await MainCustomer.findById(mainCustomerId).lean();
        if (!mainCustomer) {
            const err = new Error();
            err.message = { en: "Customer not found in system", he: "הלקוח לא נמצא במערכת" };
            throw err;
        }
    } else {
        // אין הזמנות — משתמשים ב-rivhitCustomerId למציאת הלקוח הראשי
        if (!rivhitCustomerId) {
            const err = new Error();
            err.message = { en: "Missing customer ID", he: "חסר מזהה לקוח" };
            throw err;
        }
        mainCustomer = await MainCustomer.findOne({ externalCustomerId: Number(rivhitCustomerId) }).lean();
        if (!mainCustomer) {
            mainCustomer = { externalCustomerId: Number(rivhitCustomerId) };
        }
        mainCustomerId = mainCustomer._id ? String(mainCustomer._id) : null;
    }

    // --- בניית הפריטים לחשבונית ---
    const items = [];

    if (orders.length > 0) {
        const ordersTotal = sumOrdersTotal(orders);
        const orderNumbers = orders.map(o => o.invoice).join(", ");
        items.push({
            description: orders.length > 1
                ? `חשבונית עבור הזמנות: ${orderNumbers}`
                : `חשבונית עבור הזמנה ${orders[0].invoice}`,
            quantity: 1,
            price_nis: ordersTotal,
        });
    }

    if (hasRivhitReturns) {
        rivhitReturnNotes.forEach(rn => {
            items.push({
                description: rn.description || `תעודת החזרה #${rn.document_number}`,
                quantity: 1,
                price_nis: Number(rn.amount || 0),
            });
        });
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.price_nis || 0), 0);

    // --- אסמכתא ---
    const request_reference = hasOrders
        ? buildInvoiceReference(orders)
        : `inv:rn:${rivhitReturnNotes.map(r => r.document_number).join("+")}`;

    const dateTimeFields = formatIssueDateTime(issue_date, issue_time);

    const parts = [];
    if (orders.length > 0) parts.push(`הזמנות: ${orders.map(o => o.invoice).join(", ")}`);
    if (hasRivhitReturns) parts.push(`תעודות החזרה: ${rivhitReturnNotes.map(r => r.document_number).join(", ")}`);
    const description = `חשבונית מס עבור ${parts.join(" | ")}`;
    const detailedComments = notes
        ? `${notes} | ${description}, סה"כ ${totalAmount}₪`
        : `${description}, סה"כ ${totalAmount}₪`;

    const payload = {
        document_type: Number(documentType),
        customer_id: mainCustomer?.externalCustomerId ? Number(mainCustomer.externalCustomerId) : 0,
        create_customer: !mainCustomer?.externalCustomerId,
        find_by_mail: !mainCustomer?.externalCustomerId,
        customer: mainCustomer,
        request_reference,
        items,
        price_include_vat: true,
        comments: String(detailedComments),
        prevent_duplicates: true,
        ...dateTimeFields,
    };

    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    const resp = await documentNew(payload);

    validateDocumentNewResponse(resp, "הנפקת חשבונית המס");

    const { docNumber, docUrl, docType, docIdentity, confirmationNumber } = extractDocumentInfo(resp, documentType);
    const rivhitCustomerIdFromResp = Number(resp?.data?.customer_id ?? 0);

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

    if (mainCustomerId) {
        await saveRivhitMainCustomerIdIfNeeded(mainCustomerId, rivhitCustomerIdFromResp);
    }

    if (hasOrders) {
        await Order.updateMany(
            { _id: { $in: orderIds } },
            { $set: { "accountingDocs.invoice": docObj } }
        );
        console.log(`[issueInvoiceForOrders] Invoice created for ${orders.length} orders`);
    }

    if (hasRivhitReturns) {
        console.log(`[issueInvoiceForOrders] Invoice created for ${rivhitReturnNotes.length} rivhit return notes`);
    }

    if (rivhitCustomerIdFromResp) clearCustomerCache(rivhitCustomerIdFromResp);

    return {
        reference: request_reference,
        totalAmount,
        document: docObj,
        updatedOrders: orders.map(o => ({ orderId: o._id, invoice: o.invoice })),
        rivhitResponse: resp,
    };
}

module.exports = { issueInvoiceForOrders };
