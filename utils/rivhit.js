// utils/rivhit.js
const axios = require("axios");
const { buildFullAddress } = require("../payments/paymentShared");

const RIVHIT_BASE_URL = "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc";

function getApiToken() {
  const env = String(process.env.ICREDIT_ENV || "test").toLowerCase();
  const token = env === "prod"
    ? process.env.RIVHIT_API_TOKEN
    : process.env.RIVHIT_API_TOKEN_TEST;
  if (!token) {
    const envName = env === "prod" ? "RIVHIT_API_TOKEN" : "RIVHIT_API_TOKEN_TEST";
    throw new Error(`Missing env ${envName}`);
  }
  return token;
}

async function post(methodName, payload, log = true) {
  if (log) console.log(`[Rivhit] post ${methodName} payload:`, payload);
  const token = getApiToken();

  // inject token in both keys to handle doc inconsistencies
  const body = {
    api_token: token,
    ...(payload || {}),
  };

  const url = `${RIVHIT_BASE_URL}/${methodName}`;
  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (log) console.log(`[Rivhit] ${methodName} response:`);
  if (log) console.dir(res.data, { depth: null, colors: true });

  return res.data;
}

// Customer.Get: by email OR customer_id
async function customerGet({ email, customer_id }) {
  const body = {};
  if (email) body.email = String(email).toLowerCase();
  if (customer_id) body.customer_id = Number(customer_id);

  return post("Customer.Get", body);
}

// Customer.New
async function customerNew({ last_name, first_name, email, comments }) {
  const body = {
    last_name: String(last_name || "").trim(), // חובה
    first_name: first_name ? String(first_name).trim() : undefined,
    email: email ? String(email).toLowerCase() : undefined,
    comments: comments ? String(comments).trim() : undefined,
  };

  // אל תשלח undefined
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  return post("Customer.New", body);
}

// Document.List: fetch documents.
// אם customerId לא מועבר – מחזיר את כל המסמכים בטווח תאריכים
async function documentList({ customerId, from_date, to_date }) {
  const payload = {};
  if (customerId != null && customerId !== "") {
    payload.from_customer_id = Number(customerId);
    payload.to_customer_id = Number(customerId);
  }
  if (from_date) payload.from_date = from_date;
  if (to_date) payload.to_date = to_date;

  return post("Document.List", payload, false);
}

// Document.New: הפקת מסמך חדש (חשבונית, תעודת משלוח, חשבונית זיכוי וכו')
async function documentNew(payload) {
  payload.digital_signature = true;
  // payload.signature_pin = process.env.RIVHIT_SIGNATURE_PIN;
  payload.send_mail = true;

  // שמירת customer זמנית למטרות בניית השדות
  const customer = payload.customer;

  if (customer) {
    payload.email_to = customer.email;
    payload.last_name = customer.lastName || customer.last_name || customer.name || customer.first_name;
    payload.first_name = customer.name || customer.first_name;

    // בניית כתובת מלאה באמצעות buildFullAddress
    const addressFields = buildFullAddress({ reqBody: null, customer });
    if (addressFields.Address) payload.address = addressFields.Address;
    if (addressFields.City) payload.city = addressFields.City;
    if (addressFields.Zipcode) payload.zipcode = addressFields.Zipcode;

    if (customer.phone) payload.phone = customer.phone;

    // מחיקת customer מה-payload - לא צריך לשלוח אותו לריווחית
    delete payload.customer;
  }

  // אל תשלח undefined
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  return post("Document.New", payload);
}

// Document.TypeList: קבלת רשימת סוגי המסמכים (פנימי)
async function documentTypeList(documentType = null) {
  const payload = {};
  if (documentType) payload.document_type = Number(documentType);
  return post("Document.TypeList", payload, false);
}

// Payment.TypeList: קבלת רשימת סוגי תשלום
async function paymentTypeList() {
  return post("Payment.TypeList", {}, false);
}

// Receipt.TypeList: קבלת רשימת סוגי קבלות
async function receiptTypeList() {
  return post("Receipt.TypeList", {}, false);
}

// Receipt.List: קבלת רשימת קבלות.
// אם customerId לא מועבר – מחזיר את כל הקבלות בטווח תאריכים
async function receiptList({ customerId, from_date, to_date }) {
  const payload = {};
  if (customerId != null && customerId !== "") {
    payload.from_customer_id = Number(customerId);
    payload.to_customer_id = Number(customerId);
  }
  if (from_date) payload.from_date = from_date;
  if (to_date) payload.to_date = to_date;
  return post("Receipt.List", payload, false);
}

// Receipt.New: הפקת קבלה
function buildReceiptPaymentsForRivhit(paymentsArray) {
  if (!Array.isArray(paymentsArray) || paymentsArray.length === 0) return [];
  return paymentsArray.map((p) => {
    const row = {
      payment_type: Number(p.payment_type),
      amount_nis: Number(p.amount_nis),
    };
    if (p.due_date) row.due_date = String(p.due_date);
    if (p.description) row.description = String(p.description);
    if (p.bank_code != null) row.bank_code = Number(p.bank_code);
    if (p.branch_number != null) row.branch_number = Number(p.branch_number);
    if (p.bank_account_number != null) row.bank_account_number = Number(p.bank_account_number);
    if (p.check_number != null) row.check_number = Number(p.check_number);
    if (p.amount_mtc != null) row.amount_mtc = Number(p.amount_mtc);
    if (p.number_of_payments != null) row.number_of_payments = Number(p.number_of_payments);
    Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
    return row;
  });
};

async function receiptNew(payload) {
  const body = {
    receipt_type: Number(payload.receipt_type),
    last_name: payload.last_name,
    first_name: payload.first_name,
    customer_id: Number(payload.customer_id),
    comments: payload.comments ? String(payload.comments) : undefined,
    request_reference: payload.request_reference,
    prevent_duplicates: payload.prevent_duplicates !== false,
    payments: buildReceiptPaymentsForRivhit(payload.payments || []),
  };
  if (payload.reference != null) body.reference = payload.reference;
  const dateIssue = payload.issue_date ?? payload.issue_date;
  const timeIssue = payload.issue_time ?? payload.issue_time;
  if (dateIssue) body.issue_date = String(dateIssue);
  if (timeIssue) body.issue_time = String(timeIssue);
  if (payload.email_to) body.email_to = String(payload.email_to).toLowerCase();
  body.digital_signature = payload.digital_signature !== false;
  body.send_mail = payload.send_mail !== false;
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  return post("Receipt.New", body);
};

module.exports = {
  customerGet,
  customerNew,
  documentList,
  documentNew,
  documentTypeList,
  paymentTypeList,
  receiptTypeList,
  receiptList,
  receiptNew,
  getApiToken,
  RIVHIT_BASE_URL,
};