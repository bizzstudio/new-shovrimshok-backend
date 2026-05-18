// services/rivhitDocuments/fetch.js
// שליפת מסמכי ריווחית + cache

const { documentList, receiptList } = require("../../utils/rivhit");
const { TTLCache } = require("../../utils/ttlCache");
const { toDDMMYYYY } = require("../../utils/date");
const {
    buildCacheKey,
    buildReceiptCacheKey,
    groupDocumentsByType,
    normalizeDoc,
    normalizeReceiptDoc,
} = require("../../utils/rivhitHelpers");

// TTL cache (5 דקות כברירת מחדל)
const cache = new TTLCache({ defaultTtlMs: 5 * 60 * 1000, maxSize: 1000 });

const KEY_ALL_DOCS_PREFIX = "rivhit:Document.List:all:";
const KEY_ALL_RECEIPTS_PREFIX = "rivhit:Receipt.List:all:";

function validateDateParams(from, to) {
    const from_date = from ? toDDMMYYYY(from) : null;
    const to_date = to ? toDDMMYYYY(to) : null;

    // אם המשתמש שלח פורמט לא תקין – עדיף 400 מיידי
    if (from && !from_date) {
        const err = new Error();
        err.message = {
            en: "Invalid 'from' format. Use YYYY-MM-DD",
            he: "פורמט 'from' שגוי. השתמש ב-YYYY-MM-DD"
        };
        err.status = 400;
        throw err;
    }
    if (to && !to_date) {
        const err = new Error();
        err.message = {
            en: "Invalid 'to' format. Use YYYY-MM-DD",
            he: "פורמט 'to' שגוי. השתמש ב-YYYY-MM-DD"
        };
        err.status = 400;
        throw err;
    }
    return { from_date, to_date };
}

/** משיכת כל המסמכים מריווחית בטווח תאריכים (ללא סינון לקוח). ממלא קאש per-customer. */
async function fetchAllRivhitDocuments(from, to) {
    const { from_date, to_date } = validateDateParams(from, to);
    const keyAll = `${KEY_ALL_DOCS_PREFIX}${from_date || ""}:${to_date || ""}`;
    const cached = cache.get(keyAll);
    if (cached) return cached;

    const resp = await documentList({ from_date, to_date });
    if (!resp) {
        cache.set(keyAll, []);
        return [];
    }
    if (resp.error_code && resp.error_code !== 0) {
        const err = new Error();
        err.message = { en: resp.client_message || resp.debug_message || "Rivhit error", he: resp.client_message || resp.debug_message || "שגיאה מריווחית" };
        err.status = resp.error_code === 401 ? 401 : 502;
        err.rivhit = resp;
        throw err;
    }

    const list = resp?.data?.document_list || [];
    const byCustomer = new Map();
    for (const doc of list) {
        const cid = doc.customer_id != null ? Number(doc.customer_id) : 0;
        if (!byCustomer.has(cid)) byCustomer.set(cid, []);
        byCustomer.get(cid).push(doc);
    }
    for (const [cid, docs] of byCustomer) {
        const key = buildCacheKey({ customerId: cid, dateFrom: from_date, dateTo: to_date });
        cache.set(key, docs);
    }
    cache.set(keyAll, list);
    console.log(`[Rivhit Documents] Fetched ${list.length} documents (all), ${byCustomer.size} customers`);
    return list;
}

/** משיכת כל הקבלות מריווחית בטווח תאריכים (ללא סינון לקוח). ממלא קאש per-customer. */
async function fetchAllRivhitReceipts(from, to) {
    const { from_date, to_date } = validateDateParams(from, to);
    const keyAll = `${KEY_ALL_RECEIPTS_PREFIX}${from_date || ""}:${to_date || ""}`;
    const cached = cache.get(keyAll);
    if (cached) return cached;

    const resp = await receiptList({ from_date, to_date });
    if (!resp) {
        cache.set(keyAll, []);
        return [];
    }
    if (resp.error_code && resp.error_code !== 0) {
        const err = new Error();
        err.message = { en: resp.client_message || resp.debug_message || "Rivhit error", he: resp.client_message || resp.debug_message || "שגיאה מריווחית" };
        err.status = resp.error_code === 401 ? 401 : 502;
        err.rivhit = resp;
        throw err;
    }

    const list = resp?.data?.receipt_list || [];
    const byCustomer = new Map();
    for (const r of list) {
        const cid = r.customer_id != null ? Number(r.customer_id) : 0;
        if (!byCustomer.has(cid)) byCustomer.set(cid, []);
        byCustomer.get(cid).push(r);
    }
    for (const [cid, receipts] of byCustomer) {
        const key = buildReceiptCacheKey({ customerId: cid, dateFrom: from_date, dateTo: to_date });
        cache.set(key, receipts);
    }
    cache.set(keyAll, list);
    console.log(`[Rivhit Documents] Fetched ${list.length} receipts (all), ${byCustomer.size} customers`);
    return list;
}

/** Fetch raw document list for one customer. Uses global fetch + per-customer cache. */
async function fetchRivhitDocumentList({ customerId, from, to }) {
    const { from_date, to_date } = validateDateParams(from, to);
    const key = buildCacheKey({ customerId, dateFrom: from_date, dateTo: to_date });
    const cached = cache.get(key);
    if (cached) return cached;

    // שליפת כל המסמכים מריווחית בטווח תאריכים (ללא סינון לקוח)
    await fetchAllRivhitDocuments(from, to);
    return cache.get(key) || [];
}

/** Fetch raw receipt list for one customer. Uses global fetch + per-customer cache. */
async function fetchRivhitReceiptList({ customerId, from, to }) {
    const { from_date, to_date } = validateDateParams(from, to);
    const key = buildReceiptCacheKey({ customerId, dateFrom: from_date, dateTo: to_date });
    const cached = cache.get(key);
    if (cached) return cached;

    // שליפת כל הקבלות מריווחית בטווח תאריכים (ללא סינון לקוח)
    await fetchAllRivhitReceipts(from, to);
    return cache.get(key) || [];
}

/**
 * @param {Object} opts
 * @param {string|number} [opts.customerId] - Rivhit customer_id (יחיד)
 * @param {Array<string|number>} [opts.customerIds] - רשימת Rivhit customer_id (למשל לקוח ראשי + תתי לקוחות)
 */
async function getCustomerDocumentsGrouped({ customerId, customerIds, from, to }) {
    const ids = Array.isArray(customerIds) && customerIds.length > 0
        ? customerIds.map((id) => Number(id))
        : [Number(customerId)];
    const uniq = [...new Set(ids)];

    console.log(`[Rivhit Documents] Getting documents for customer(s) ${uniq.join(", ")} from ${from} to ${to}`);

    const docPromises = uniq.map((id) => fetchRivhitDocumentList({ customerId: id, from, to }));
    const receiptPromises = uniq.map((id) => fetchRivhitReceiptList({ customerId: id, from, to }));
    const docArrays = await Promise.all(docPromises);
    const receiptArrays = await Promise.all(receiptPromises);

    const rawDocuments = docArrays.flat();
    const rawReceipts = receiptArrays.flat();

    const groups = groupDocumentsByType(rawDocuments);

    const receiptDocs = (rawReceipts || []).map(normalizeReceiptDoc);
    receiptDocs.sort((a, b) => {
        const at = a.datetime_ts ?? -Infinity;
        const bt = b.datetime_ts ?? -Infinity;
        return bt - at;
    });
    groups.push({
        document_type: "receipts",
        document_type_name: "קבלה",
        count: receiptDocs.length,
        documents: receiptDocs,
    });

    const allDocuments = [...(rawDocuments || []).map(normalizeDoc), ...receiptDocs];
    allDocuments.sort((a, b) => {
        const at = a.datetime_ts ?? -Infinity;
        const bt = b.datetime_ts ?? -Infinity;
        return bt - at;
    });
    groups.unshift({
        document_type: "all",
        document_type_name: "הכל",
        count: allDocuments.length,
        documents: allDocuments,
    });

    return groups;
}

// Clear cache for a customer + invalidate global "all" caches
function clearCustomerCache(customerId) {
    const docPrefix = `rivhit:Document.List:${customerId}:`;
    const receiptPrefix = `rivhit:Receipt.List:${customerId}:`;
    let total = cache.delByPrefix(docPrefix) + cache.delByPrefix(receiptPrefix);
    total += cache.delByPrefix(KEY_ALL_DOCS_PREFIX);
    total += cache.delByPrefix(KEY_ALL_RECEIPTS_PREFIX);
    if (total > 0) {
        console.log(`[Rivhit Documents] Cleared cache for customer ${customerId} and global lists`);
    }
}

module.exports = {
    fetchRivhitDocumentList,
    fetchRivhitReceiptList,
    getCustomerDocumentsGrouped,
    clearCustomerCache,
};