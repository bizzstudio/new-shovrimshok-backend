// utils/date.js
const dayjs = require("dayjs");

/**
 * Converts date from YYYY-MM-DD or DD/MM/YYYY to DDMMYYYY format (as required by Rivhit)
 * @param {string} input - Date string in YYYY-MM-DD or DD/MM/YYYY format
 * @returns {string|null} - Date in DDMMYYYY format or null if invalid
 */
function toDDMMYYYY(input) {
  if (!input || typeof input !== "string") return null;

  // YYYY-MM-DD
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${d}${m}${y}`;
  }

  // DD/MM/YYYY
  const slash = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${d}${m}${y}`;
  }

  return null;
}

/**
 * Parses Rivhit date and time into ISO format
 * @param {string} document_date - Date in DD/MM/YYYY format
 * @param {string} document_time - Time in HH:mm:ss format (optional)
 * @returns {string|null} - ISO datetime string or null if invalid
 */
function parseRivhitDateTime(document_date, document_time) {
  if (!document_date) return null;

  // Parse DD/MM/YYYY using dayjs
  const parsed = dayjs(document_date, "DD/MM/YYYY", true);
  if (!parsed.isValid()) return null;

  // Add time if provided
  let result = parsed;
  if (document_time && /^\d{2}:\d{2}:\d{2}$/.test(document_time)) {
    const [hours, minutes, seconds] = document_time.split(":");
    result = parsed.hour(parseInt(hours, 10))
      .minute(parseInt(minutes, 10))
      .second(parseInt(seconds, 10));
  }

  return result.toISOString();
}

module.exports = {
  toDDMMYYYY,
  parseRivhitDateTime,
};