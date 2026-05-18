/**
 * נרמול ערכי query string
 * מטפל בערכים כמו "undefined", "null", מחרוזות ריקות, מערכים וכו'
 */
const normalizeQueryValue = (v) => {
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v)) return normalizeQueryValue(v[0]);
    const s = String(v).trim();
    if (!s) return undefined;
    const lower = s.toLowerCase();
    if (lower === "undefined" || lower === "null") return undefined;
    return s;
};

module.exports = {
    normalizeQueryValue,
};