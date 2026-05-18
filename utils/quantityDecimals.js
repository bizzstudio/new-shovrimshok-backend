/** תואם לחנות: לכל היותר 2 ספרות אחרי הנקודה בכמויות */
const QTY_DECIMAL_PLACES = 2;

function roundQuantity(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return n;
  const f = 10 ** QTY_DECIMAL_PLACES;
  return Math.round(n * f) / f;
}

module.exports = { QTY_DECIMAL_PLACES, roundQuantity };
