/**
 * מצב התחלתי לפי schema (בלי חתימה — נשלפת מ-ref בזמן submit)
 */
export function buildEmptyFormState(schema) {
  if (!schema) return {};
  if (schema.layout === "matrix") {
    const matrix = {};
    for (const row of schema.matrix.rows) {
      matrix[row.key] = {};
      for (const col of schema.matrix.columns) {
        matrix[row.key][col.key] = false;
      }
    }
    const out = { matrix };
    for (const fRow of schema.footer?.rows || []) {
      for (const cell of fRow.cells || []) {
        if (cell.type === "date" || cell.type === "text") {
          out[cell.key] = "";
        }
      }
    }
    return out;
  }
  if (schema.layout === "table") {
    const entry = {};
    for (const col of schema.columns || []) {
      if (col.type === "group" && col.fields) {
        for (const f of col.fields) {
          if (f.type !== "signature") entry[f.key] = "";
        }
      } else if (col.type !== "signature") {
        entry[col.key] = "";
      }
    }
    return entry;
  }
  return {};
}
