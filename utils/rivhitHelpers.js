// utils/rivhitHelpers.js
// Helper functions למסמכי ריווחית

const { parseRivhitDateTime, toDDMMYYYY } = require("./date");
const Customer = require("../models/Customer");
const MainCustomer = require("../models/MainCustomer");
const Product = require("../models/Product");

// ============================================
// Helpers לשליפת מסמכים
// ============================================

function buildCacheKey({ customerId, dateFrom, dateTo }) {
  return `rivhit:Document.List:${customerId}:${dateFrom || ""}:${dateTo || ""}`;
}

function buildReceiptCacheKey({ customerId, dateFrom, dateTo }) {
  return `rivhit:Receipt.List:${customerId}:${dateFrom || ""}:${dateTo || ""}`;
}

/** ממיר פריט קבלה מ-Receipt.List לצורה דומה ל-document (להצגה ב-group קבלות) */
function normalizeReceiptDoc(r) {
  const document_date = r.receipt_date; // DD/MM/YYYY
  const document_time = r.receipt_time; // HH:mm:ss
  const iso = parseRivhitDateTime(document_date, document_time);
  const ts = iso ? Date.parse(iso) : null;
  return {
    ...r,
    document_type: r.receipt_type,
    document_number: r.receipt_number,
    document_type_name: r.receipt_type_name,
    document_date,
    document_time,
    document_link: r.receipt_link,
    id: `receipt_${r.receipt_type}_${r.receipt_number}`,
    datetime_iso: iso,
    datetime_ts: ts,
  };
}

function normalizeDoc(d) {
  const iso = parseRivhitDateTime(d.document_date, d.document_time);
  const ts = iso ? Date.parse(iso) : null;

  return {
    // keep originals
    ...d,

    // useful computed fields
    id: `${d.document_type}_${d.document_number}`,
    datetime_iso: iso,
    datetime_ts: ts,
  };
};

function groupDocumentsByType(documents = []) {
  const map = new Map();

  for (const raw of documents) {
    const doc = normalizeDoc(raw);
    const type = doc.document_type;
    const name = doc.document_type_name || `Type ${type}`;

    if (!map.has(type)) {
      map.set(type, {
        document_type: type,
        document_type_name: name,
        count: 0,
        documents: [],
      });
    }

    const bucket = map.get(type);
    bucket.documents.push(doc);
    bucket.count += 1;
  }

  // sort docs inside each group (newest first)
  for (const bucket of map.values()) {
    bucket.documents.sort((a, b) => {
      const at = a.datetime_ts ?? -Infinity;
      const bt = b.datetime_ts ?? -Infinity;
      return bt - at;
    });
  }

  const groups = Array.from(map.values());

  // מיזוג "חשבונית מס" (ללא מקף) לתוך "חשבוניות - מס" / "חשבונית-מס" (עם מקף)
  // ריווחית מחזירה לפעמים שני סוגים דומים; מציגים רק את הגרסה עם המקף
  const PLAIN_INVOICE_NAME = "חשבונית מס";
  const plainInvoiceIdx = groups.findIndex(g => g.document_type_name === PLAIN_INVOICE_NAME);
  if (plainInvoiceIdx !== -1) {
    const hyphenInvoiceIdx = groups.findIndex(
      g => g.document_type_name !== PLAIN_INVOICE_NAME &&
           g.document_type_name.includes("חשבונ") &&
           (g.document_type_name.includes("-מס") || g.document_type_name.includes("- מס"))
    );
    if (hyphenInvoiceIdx !== -1) {
      // מזג את המסמכים לתוך קבוצת המקף
      const plain = groups[plainInvoiceIdx];
      const hyphen = groups[hyphenInvoiceIdx];
      const mergedDocs = [...hyphen.documents, ...plain.documents];
      mergedDocs.sort((a, b) => (b.datetime_ts ?? -Infinity) - (a.datetime_ts ?? -Infinity));
      groups[hyphenInvoiceIdx] = { ...hyphen, count: mergedDocs.length, documents: mergedDocs };
      groups.splice(plainInvoiceIdx, 1);
    }
  }

  return groups;
};

// ============================================
// Helpers להנפקת מסמכים
// ============================================

// Helper להמרת תאריך ושעה לפורמט ריווחית
function formatIssueDateTime(issue_date, issue_time) {
  const result = {};

  if (issue_date) {
    // המרה מ-YYYY-MM-DD או DD/MM/YYYY ל-DDMMYYYY
    const formattedDate = toDDMMYYYY(issue_date);
    if (formattedDate) {
      result.issue_date = formattedDate;
    } else if (/^\d{8}$/.test(issue_date)) {
      // כבר בפורמט DDMMYYYY
      result.issue_date = issue_date;
    }
  }

  if (issue_time) {
    // ריווחית מצפה ל-HH:mm:ss
    const timeStr = String(issue_time).trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(timeStr)) {
      // כבר בפורמט HH:mm:ss
      result.issue_time = timeStr;
    } else if (/^\d{2}:\d{2}$/.test(timeStr)) {
      // HH:mm - נוסיף שניות
      result.issue_time = `${timeStr}:00`;
    } else if (/^\d{6}$/.test(timeStr)) {
      // HHmmss - נמיר ל-HH:mm:ss
      result.issue_time = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;
    } else if (/^\d{4}$/.test(timeStr)) {
      // HHmm - נמיר ל-HH:mm:00
      result.issue_time = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:00`;
    }
  }

  return result;
};

// בניית Reference יציב לפי הזמנות (כדי שריווחית ידחו כפילויות)
function buildInvoiceReference(orders) {
  const invoices = orders
    .map(o => Number(o.invoice || 0))
    .filter(Boolean)
    .sort((a, b) => a - b);

  return `inv:${invoices.join("+")}`; // למשל inv:10023+10024
};

function sumOrdersTotal(orders) {
  return Number(
    orders.reduce((sum, o) => sum + Number(o.total || 0), 0).toFixed(2)
  );
};

function buildDeliveryReference(order) {
  // יציב, כדי שריווחית ידחו כפילות אם ינסו שוב על אותה הזמנה
  return `dn:${order.invoice || order._id}`;
}

/** אסמכתא נפרדת מתעודת משלוח רגילה — למניעת התנגשות ב-prevent_duplicates בריווחית */
function buildDeliveryReferenceHyphen(order) {
  return `dnh:${order.invoice || order._id}`;
}

/** אסמכתא לתעודת החזרה — נפרדת משאר המסמכים למניעת כפילויות בריווחית */
function buildReturnNoteReference(order) {
  return `rn:${order.invoice || order._id}`;
}

/** עיגול סכומי כסף לשתי ספרות אחרי הנקודה (אגורות) — לשליחה לריווחית ולתצוגה עקבית */
function roundMoney2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** מסנכרן isVatFree מכרטיס המוצר במסד (מקור אמת כמו אדמין/מחירון), לא רק מהעגלה השמורה */
async function resolveCartLinesVatFromProducts(cart) {
  const ids = [
    ...new Set(
      cart
        .filter((line) => line && line._id)
        .map((line) => line._id.toString?.() ?? String(line._id))
    ),
  ];
  const exemptByProductId = new Map();
  if (ids.length) {
    const docs = await Product.find({ _id: { $in: ids } }).select("isVatFree").lean();
    for (const doc of docs) {
      exemptByProductId.set(String(doc._id), doc.isVatFree !== false);
    }
  }
  return cart.map((line) => {
    const plain = typeof line.toObject === "function" ? line.toObject() : { ...line };
    const idStr = plain._id?.toString?.() ?? "";
    const fromDb = idStr ? exemptByProductId.get(idStr) : undefined;
    const isVatFree = fromDb !== undefined ? fromDb : plain.isVatFree !== false;
    return { ...plain, isVatFree };
  });
}

async function buildItemsFromOrderCart(order) {
  const rawCart = Array.isArray(order.cart) ? order.cart : [];
  const vatPercent = Number(process.env.VAT_PERCENTAGE) || 18;

  if (!rawCart.length) {
    const items = [
      {
        description: `תעודת משלוח עבור הזמנה ${order.invoice || order._id}`,
        quantity: 1
      },
    ];

    const shippingCost = Number(order.shippingCost || 0);
    if (shippingCost > 0) {
      items.push({
        description: "דמי משלוח",
        quantity: 1,
        price_nis: roundMoney2(shippingCost / (1 + vatPercent / 100)),
        exempt_vat: false,
      });
    }

    return items;
  }

  const cart = await resolveCartLinesVatFromProducts(rawCart);

  const items = cart.map((p) => {
    const qty = Number(p.quantity || 1);
    const title = p?.title?.he || p?.title?.en || p?.title || p?.name || "מוצר";
    // פטור מע״מ: כמו ב־priceUtils — רק isVatFree === false נחשב חייב
    const vatExempt = p.isVatFree !== false;
    // פריט פטור: המחיר כפי שהוא (ללא רכיב מע״מ)
    // פריט חייב: שולחים מחיר נטו; ריווחית מוסיפה מע״מ כך ש־נטו × (1 + %) = perUnit
    const rawPriceNis = vatExempt
      ? p.finalPriceAtPurchase.perUnit
      : p.finalPriceAtPurchase.perUnit / (1 + vatPercent / 100);
    const priceNis = roundMoney2(rawPriceNis);

    // בלי catalog_number / item_id: אחרת ריווחית עלולה למשוך מע״מ מכרטיס פריט במלאי שלהם ולדרוס את exempt_vat
    return {
      description: String(title).slice(0, 120),
      quantity: qty,
      price_nis: priceNis,
      exempt_vat: vatExempt,
    };
  });

  // הוספת דמי משלוח כפריט — כך שסה"כ לתשלום בריווחית יכלול את המשלוח
  const shippingCost = Number(order.shippingCost || 0);
  if (shippingCost > 0) {
    items.push({
      description: "דמי משלוח",
      quantity: 1,
      price_nis: roundMoney2(shippingCost / (1 + vatPercent / 100)),
      exempt_vat: false,
    });
  }

  return items;
};

function buildCreditReference({ customerId, amount }) {
  // לא "דוחה כפילויות" כמו הזמנות - פה אין צורך חזק, אבל עדיין יציב וקריא
  const a = Number(amount || 0).toFixed(2);
  return `credit:${customerId}:${a}:${Date.now()}`;
};

// Helper לחילוץ פרטי מסמך מתשובת ריווחית
function extractDocumentInfo(resp, documentType) {
  const docNumber =
    resp?.document_number ||
    resp?.data?.document_number ||
    resp?.data?.DocumentNumber ||
    null;

  const docUrl =
    resp?.document_link ||
    resp?.data?.document_url ||
    resp?.data?.document_link ||
    resp?.document_url ||
    null;

  const docType = resp?.data?.document_type || resp?.document_type || documentType;

  const docIdentity =
    resp?.document_identity ||
    resp?.data?.document_identity ||
    null;

  // מספר הקצאה ממס הכנסה (יוחזר כערך חיובי בסביבת PROD בלבד)
  const confirmationNumber =
    resp?.data?.confirmation_number ||
    resp?.confirmation_number ||
    null;

  return { docNumber, docUrl, docType, docIdentity, confirmationNumber };
};

// Helper לבניית מערך תשלומים (payments) עבור חשבונית מס קבלה
function buildPaymentsArray(paymentsInput) {
  if (!Array.isArray(paymentsInput) || paymentsInput.length === 0) {
    return [];
  }

  return paymentsInput.map((p, idx) => {
    const payment = {
      payment_type: Number(p.payment_type),
      amount_nis: Number(p.amount_nis),
    };

    // שדות אופציונליים
    if (p.due_date) {
      const dueDateStr = p.due_date;
      // אם זה YYYY-MM-DD נמיר ל-DDMMYYYY
      const formatted = toDDMMYYYY(dueDateStr);
      if (formatted) {
        payment.due_date = formatted;
      } else if (/^\d{8}$/.test(dueDateStr)) {
        // כבר בפורמט DDMMYYYY
        payment.due_date = dueDateStr;
      }
    }

    if (p.description) {
      payment.description = String(p.description);
    }

    if (p.bank_code) {
      payment.bank_code = Number(p.bank_code);
    }

    if (p.branch_number) {
      payment.branch_number = Number(p.branch_number);
    }

    if (p.bank_account_number) {
      payment.bank_account_number = Number(p.bank_account_number);
    }

    if (p.check_number) {
      payment.check_number = Number(p.check_number);
    }

    if (p.amount_mtc) {
      payment.amount_mtc = Number(p.amount_mtc);
    }

    if (p.number_of_payments) {
      payment.number_of_payments = Number(p.number_of_payments);
    }

    // מחיקת undefined
    Object.keys(payment).forEach(k => payment[k] === undefined && delete payment[k]);

    return payment;
  });
};

// Helper לוולידציה של מערך תשלומים
function validatePaymentsArray(payments, totalAmount) {
  if (!Array.isArray(payments) || payments.length === 0) {
    const err = new Error();
    err.message = {
      en: "Payments list is required for the receipt",
      he: "יש לספק רשימת תקבולים עבור הקבלה"
    };
    throw err;
  }

  // בדיקה שכל תשלום תקין
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];

    if (!p.payment_type || !Number.isInteger(p.payment_type) || p.payment_type <= 0) {
      const err = new Error();
      err.message = {
        en: `Payment #${i + 1}: payment type is required and must be a valid positive integer`,
        he: `תשלום #${i + 1}: סוג תשלום הוא שדה חובה וחייב להיות מספר שלם חיובי`
      };
      throw err;
    }

    if (!p.amount_nis || !Number.isFinite(p.amount_nis) || p.amount_nis <= 0) {
      const err = new Error();
      err.message = {
        en: `Payment #${i + 1}: amount is required and must be a positive number`,
        he: `תשלום #${i + 1}: סכום התשלום הוא שדה חובה וחייב להיות מספר חיובי`
      };
      throw err;
    }
  }

  // בדיקה שסכום התשלומים שווה לסכום החשבונית
  const paymentsTotal = Number(
    payments.reduce((sum, p) => sum + Number(p.amount_nis || 0), 0).toFixed(2)
  );

  if (Math.abs(paymentsTotal - totalAmount) > 0.01) {
    const err = new Error();
    err.message = {
      en: `Total payments amount (${paymentsTotal}) must equal invoice total (${totalAmount})`,
      he: `סכום התקבולים (${paymentsTotal}) חייב להיות שווה לסכום החשבונית (${totalAmount})`
    };
    throw err;
  }

  return true;
};

// בדיקת תקינות תשובה מ-Document.New
function validateDocumentNewResponse(resp, operation = "document creation") {
  if (!resp || resp.error_code !== 0) {
    const err = new Error();
    err.message = {
      en: resp?.client_message || resp?.debug_message || `Failed ${operation}`,
      he: resp?.client_message || resp?.debug_message || `התרחשה שגיאה ב${operation}`
    };
    err.status = 502;
    err.rivhit = resp;
    throw err;
  }
}

// בדיקת תקינות תשובה מ-Receipt.New
function validateReceiptNewResponse(resp, operation = "הנפקת הקבלה") {
  if (!resp || resp.error_code !== 0) {
    const err = new Error();
    err.message = {
      en: resp?.client_message || resp?.debug_message || `Failed ${operation}`,
      he: resp?.client_message || resp?.debug_message || `התרחשה שגיאה ב${operation}`
    };
    err.status = 502;
    err.rivhit = resp;
    throw err;
  }
}

// חילוץ פרטי מסמך מתשובת Receipt.New (document_number, document_link, document_type)
function extractReceiptInfo(resp) {
  const data = resp?.data || resp;
  const docNumber = data?.document_number ?? null;
  const docUrl = data?.document_link ?? "";
  const docType = data?.document_type ?? null;
  const docIdentity = data?.document_identity ?? docNumber ?? docUrl;
  const confirmationNumber = data?.confirmation_number || null;
  return { docNumber, docUrl, docType, docIdentity, confirmationNumber };
}

// עדכון כרטיס הלקוח אצלנו עם מספר לקוח ריווחית (אחרי הנפקת מסמך)
async function saveRivhitCustomerIdIfNeeded(customerDbId, rivhitCustomerId) {
  if (!customerDbId || !rivhitCustomerId) return;
  await Customer.updateOne(
    { _id: customerDbId },
    {
      $set: {
        "accounting.provider": "rivhit",
        "accounting.externalCustomerId": rivhitCustomerId,
        "accounting.syncedAt": new Date(),
      },
      $unset: { "accounting.lastSyncError": "" },
    }
  );
  console.log(`Updated customer ${customerDbId} with Rivhit CustomerId ${rivhitCustomerId}`);
};

// עדכון כרטיס הלקוח הראשי אצלנו עם מספר לקוח ריווחית (אחרי הנפקת מסמך כספי)
async function saveRivhitMainCustomerIdIfNeeded(mainCustomerId, rivhitCustomerId) {
  if (!mainCustomerId || !rivhitCustomerId) return;

  await MainCustomer.updateOne(
    { _id: mainCustomerId },
    {
      $set: {
        externalCustomerId: rivhitCustomerId,
        updatedAt: new Date(),
      },
    }
  );
  console.log(`Updated MainCustomer ${mainCustomerId} with Rivhit CustomerId ${rivhitCustomerId}`);
};

module.exports = {
  // שליפת מסמכים
  buildCacheKey,
  buildReceiptCacheKey,
  normalizeDoc,
  normalizeReceiptDoc,
  groupDocumentsByType,

  // הנפקת מסמכים
  buildInvoiceReference,
  sumOrdersTotal,
  buildDeliveryReference,
  buildDeliveryReferenceHyphen,
  buildReturnNoteReference,
  buildItemsFromOrderCart,
  buildCreditReference,
  extractDocumentInfo,
  extractReceiptInfo,
  buildPaymentsArray,
  validatePaymentsArray,
  formatIssueDateTime,
  validateDocumentNewResponse,
  validateReceiptNewResponse,
  saveRivhitCustomerIdIfNeeded,
  saveRivhitMainCustomerIdIfNeeded,
};