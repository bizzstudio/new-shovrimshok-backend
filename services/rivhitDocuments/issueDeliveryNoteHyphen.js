// services/rivhitDocuments/issueDeliveryNoteHyphen.js
// תעודת-משלוח (עם מקף) — סוג מסמך נפרד בריווחית מ"תעודת משלוח"
const { documentNew } = require("../../utils/rivhit");
const { getDocumentTypeByKind } = require("../../utils/rivhitDocumentTypes");
const {
  buildDeliveryReferenceHyphen,
  buildItemsFromOrderCart,
  formatIssueDateTime,
  extractDocumentInfo,
  validateDocumentNewResponse,
  saveRivhitCustomerIdIfNeeded,
} = require("../../utils/rivhitHelpers");
const { clearCustomerCache } = require("./fetch");
const Order = require("../../models/Order");
const Customer = require("../../models/Customer");

async function issueDeliveryNoteHyphenForOrder({
  orderId,
  notes,
  issue_date,
  issue_time,
}) {
  if (!orderId) {
    const err = new Error();
    err.message = { en: "Please provide an order ID", he: "נא לספק מזהה הזמנה" };
    throw err;
  }

  const documentType = await getDocumentTypeByKind("delivery_note_hyphen");

  const order = await Order.findById(orderId).populate("user");
  if (!order) {
    const err = new Error();
    err.message = { en: "Order not found", he: "ההזמנה לא נמצאה" };
    throw err;
  }

  if (
    order.accountingDocs?.deliveryNoteHyphen?.url ||
    order.accountingDocs?.deliveryNoteHyphen?.document_number
  ) {
    const err = new Error();
    err.message = {
      en: "This delivery note type already exists for this order",
      he: "כבר קיימת תעודת-משלוח (מקף) עבור הזמנה זו",
    };
    throw err;
  }

  const customerId = order.user?._id;
  if (!customerId) {
    const err = new Error();
    err.message = {
      en: "Customer not found for this order",
      he: "לא נמצא לקוח עבור ההזמנה זו",
    };
    throw err;
  }

  const customer = await Customer.findById(customerId).lean();
  if (!customer) {
    const err = new Error();
    err.message = { en: "Customer not found in system", he: "הלקוח לא נמצא במערכת" };
    throw err;
  }

  const request_reference = buildDeliveryReferenceHyphen(order);
  const dateTimeFields = formatIssueDateTime(issue_date, issue_time);

  const itemsCount = Array.isArray(order.cart) ? order.cart.length : 0;
  const totalAmount = Number(order.total || 0);
  const description = `תעודת-משלוח עבור הזמנה ${order.invoice}`;

  const detailedComments = notes
    ? `${notes} | ${description}, ${itemsCount} פריטים, סה"כ ${totalAmount}₪`
    : `${description}, ${itemsCount} פריטים, סה"כ ${totalAmount}₪`;

  const existingRivhitId = customer.accounting?.externalCustomerId;
  const shouldCreateCustomer = !existingRivhitId;

  const payload = {
    document_type: Number(documentType),
    customer_id: existingRivhitId ? Number(existingRivhitId) : 0,
    create_customer: shouldCreateCustomer,
    customer,
    request_reference,
    items: await buildItemsFromOrderCart(order),
    price_include_vat: false,
    currency_id: 1,
    comments: String(detailedComments),
    prevent_duplicates: true,
    ...dateTimeFields,
  };

  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const resp = await documentNew(payload);

  validateDocumentNewResponse(resp, "הנפקת תעודת-המשלוח");

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
      "accountingDocs.deliveryNoteHyphen": docObj,
    },
  });

  console.log(`[issueDeliveryNoteHyphenForOrder] Saved to order ${order.invoice}`);

  if (rivhitCustomerId) clearCustomerCache(rivhitCustomerId);

  return { orderId, invoice: order.invoice, document: docObj, rivhitResponse: resp };
}

module.exports = { issueDeliveryNoteHyphenForOrder };
