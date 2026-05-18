// utils/rivhitDocumentTypes.js
// לוגיקה פנימית לקבלת documentType לפי סוג המסמך

const { documentTypeList } = require("./rivhit");
const { TTLCache } = require("./ttlCache");

// Cache ל-document types (10 דקות)
const cache = new TTLCache({ defaultTtlMs: 10 * 60 * 1000, maxSize: 1 });

/**
 * קבלת documentType אוטומטית לפי סוג המסמך
 * עם cache כדי למנוע קריאות מיותרות ל-API
 */
async function getDocumentTypeByKind(kind) {
  const cached = cache.get("types");
  if (cached) return find(cached, kind);

  // שליפה מריווחית
  const resp = await documentTypeList();
  // התשובה: { error_code: 0, data: { document_type_list: [...] } }
  const types = resp?.data?.document_type_list || [];
  if (!types.length) throw new Error("No document types from Rivhit");

  cache.set("types", types);
  return find(types, kind);
};

/**
 * חיפוש documentType ברשימה לפי סוג המסמך
 */
function find(types, kind) {
  switch (kind) {
    // חשבונית מס
    case "invoice":
      return pick(types, t =>
        t.document_name === "חשבונית מס" && t.is_accounting === true
      );

    // חשבונית מס קבלה
    case "invoice_receipt":
      return pick(types, t =>
        t.is_invoice_receipt === true && t.is_accounting === true
      );

    // חשבונית מס זיכוי
    case "credit_invoice":
      return pick(types, t =>
        t.document_name === "חשבונית מס זיכוי"
      );

    // תעודת משלוח
    case "delivery_note":
      return pick(types, t =>
        t.document_name.trim() === "תעודת משלוח"
      );

    // תעודת-משלוח (עם מקף) — סוג נפרד בריווחית
    case "delivery_note_hyphen":
      return pick(types, t =>
        t.document_name.trim() === "תעודת-משלוח"
      );

    // תעודת החזרה
    case "return_note":
      return pick(types, t =>
        t.document_name.trim() === "תעודת החזרה"
      );

    default:
      throw new Error(`Unsupported document kind: ${kind}`);
  }
};

/**
 * בחירת document type הראשון שעונה על התנאי
 */
function pick(types, predicate) {
  const found = types
    .filter(predicate)
    .sort((a, b) => a.document_type - b.document_type);

  if (!found.length) {
    throw new Error("Matching document type not found in Rivhit");
  }

  return found[0].document_type;
};

module.exports = { getDocumentTypeByKind };