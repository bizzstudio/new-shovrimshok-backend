// utils/rivhitReceiptTypes.js
// לוגיקה פנימית לקבלת receiptType לפי סוג הקבלה

const { receiptTypeList } = require("./rivhit");
const { TTLCache } = require("./ttlCache");

// Cache ל-receipt types (10 דקות)
const receiptTypesCache = new TTLCache({ defaultTtlMs: 10 * 60 * 1000, maxSize: 1 });

/**
 * קבלת receiptType אוטומטית לפי סוג הקבלה
 * עם cache כדי למנוע קריאות מיותרות ל-API
 */
async function getReceiptTypeByKind(kind = "receipt") {
  // בדיקה ב-cache
  const cached = receiptTypesCache.get("types");
  if (cached) {
    return pick(cached, kind);
  }

  // שליפה מריווחית
  const resp = await receiptTypeList();
  // התשובה: { error_code: 0, data: { receipt_type_list: [...] } }
  const types = resp?.data?.receipt_type_list || [];

  if (types.length === 0) {
    throw new Error("No receipt types found in Rivhit response");
  }

  // שמירה ב-cache
  receiptTypesCache.set("types", types);

  return pick(types, kind);
}

/**
 * חיפוש receiptType ברשימה לפי סוג הקבלה
 */
function pick(types, kind) {
  if (!Array.isArray(types) || types.length === 0) {
    throw new Error("No receipt types found in Rivhit response");
  }

  if (kind === "receipt") {
    // קבלה רגילה - מחפש לפי receipt_name
    const receipts = types
      .filter(t => {
        const name = (t.receipt_name || "").trim();
        return name === "קבלה";
      })
      .sort((a, b) => a.receipt_type - b.receipt_type);

    if (receipts.length === 0) {
      throw new Error("No receipt type found in Rivhit");
    }

    return receipts[0].receipt_type;
  }

  throw new Error(`Unsupported receipt kind: ${kind}`);
}

module.exports = { getReceiptTypeByKind };