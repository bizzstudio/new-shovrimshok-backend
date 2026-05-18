/**
 * מבנה תיאורי ל־PDF (בלי ספריית PDF) — אדמין/שרת יכולים לצייר מזה.
 * כולל טקסטים בעברית מה-schema בלבד.
 */

function colHeaderText(col) {
  return col.labelShort || col.label || col.labelTitle || "";
}

export function layoutFormForPdf(schema, dataIn) {
  if (!schema) return { error: "no_schema" };
  let data = dataIn;
  if (
    schema.layout === "table" &&
    schema.payload?.wrapDataAs?.entries === "singleRowArray"
  ) {
    const arr = dataIn?.entries;
    if (Array.isArray(arr) && arr[0]) data = arr[0];
  }
  const sections = [];

  if (schema.layout === "matrix") {
    sections.push({ type: "title", text: schema.title });
    for (const line of schema.header?.metaLines || []) {
      sections.push({ type: "meta", text: line });
    }
    if (schema.instructions?.parts) {
      const t = schema.instructions.parts
        .map((p) => `${p.bold || ""}${p.text || ""}`)
        .join(" ");
      sections.push({ type: "note", text: t });
    }
    const headerRow = [
      schema.matrix.cornerHeaderLabel,
      ...schema.matrix.columns.map((c) => c.label),
    ];
    const tableRows = [headerRow];
    for (const row of schema.matrix.rows) {
      const cells = [row.label];
      for (const col of schema.matrix.columns) {
        const checked = !!data?.matrix?.[row.key]?.[col.key];
        cells.push(checked ? "✓" : "□");
      }
      tableRows.push(cells);
    }
    sections.push({ type: "table", rows: tableRows });
    for (const fRow of schema.footer?.rows || []) {
      for (const cell of fRow.cells || []) {
        if (cell.type === "date") {
          sections.push({
            type: "field",
            label: cell.label,
            value: data?.[cell.key] || "",
          });
        }
        if (cell.type === "signature") {
          sections.push({
            type: "signature",
            label: cell.label,
            dataUrl: data?.[cell.key] || null,
          });
        }
      }
    }
    return { formCode: schema.formCode, sections };
  }

  if (schema.layout === "table") {
    sections.push({ type: "title", text: schema.title });
    for (const line of schema.header?.metaLines || []) {
      sections.push({ type: "meta", text: line });
    }
    if (schema.intro) sections.push({ type: "note", text: schema.intro });
    const row0 = schema.columns.map((c) =>
      c.type === "group" ? c.label : colHeaderText(c)
    );
    const values = [];
    for (const col of schema.columns) {
      if (col.type === "group") {
        const bits = [];
        for (const f of col.fields || []) {
          if (f.type === "signature") {
            bits.push(
              `[חתימה: ${data?.[f.key] ? "מצורפת" : "—"}]`
            );
          } else {
            bits.push(`${f.label}: ${data?.[f.key] ?? ""}`);
          }
        }
        values.push(bits.join(" | "));
      } else if (col.type === "signature") {
        values.push(data?.[col.key] ? "[חתימה מצורפת]" : "");
      } else {
        values.push(data?.[col.key] ?? "");
      }
    }
    sections.push({ type: "table", rows: [row0, values] });
    for (const col of schema.columns || []) {
      if (col.type === "signature" && data?.[col.key]) {
        sections.push({
          type: "signature",
          label: col.label,
          dataUrl: data[col.key],
        });
      }
      if (col.type === "group") {
        for (const f of col.fields || []) {
          if (f.type === "signature" && data?.[f.key]) {
            sections.push({
              type: "signature",
              label: f.label || col.label,
              dataUrl: data[f.key],
            });
          }
        }
      }
    }
    return { formCode: schema.formCode, sections };
  }

  return { error: "unknown_layout" };
}
