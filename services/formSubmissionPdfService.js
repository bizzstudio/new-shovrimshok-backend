/**
 * יצירת תוכן PDF ב-PDFKit (לא בשימוש לנתיב ההורדה — שם HTML+Puppeteer).
 * נשמר לעתיד / גיבוי.
 */
const path = require("path");
const fs = require("fs");

const FONT_HEBREW_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "fonts",
  "NotoSansHebrew-Variable.ttf"
);

const T01_ROW_ORDER = [
  "cleaning",
  "foreign_body_control",
  "employee_hygiene",
  "corrective_action",
  "corrective_verification",
];

const T01_COL_ORDER = [
  "goods_in_out",
  "freezer_fridge",
  "employee_washrooms",
  "yard_trash",
];

const T01_ROW_LABELS = {
  cleaning: "ניקיון",
  foreign_body_control: "בקרת גופים זרים (מנורות, תשתיות, אחסון, אריזות)",
  employee_hygiene: "היגיינת עובדים",
  corrective_action: "פעולה מתקנת",
  corrective_verification: "אימות פ. מתקנת",
};

/** כמו תבנית הליקוט — טקסט מלא עם רווחים */
const T01_COL_LABELS = {
  goods_in_out:
    "אזור קבלת והוצאת סחורה: רצפה, קירות ותקרה, דלתות, תאורה, עמדת מחשב, כיור ומשטח",
  freezer_fridge: "מקפיא / מקרר: רצפה, קירות ותקרה, דלתות, מדפים, תאורה",
  employee_washrooms: "שירותי עובדים: רצפה, קירות ותקרה, אסלה, כיור",
  yard_trash: "חצר ופחי אשפה: אזור כניסה, אזור אשפה",
};

const T01_INSTRUCTION_LINE =
  "תדירות: מילוי שבועי – בתחילת שבוע עבודה. | סימון תקין (V) – סמן את התא. | לא תקין – השאר ללא סימון (לציין ליקוי שנמצא).";

/** סדר ציור בעמוד (משמאל לימין): חצר → … → קבלה → נושא — כך בקריאה RTL עמודת הקבלה ליד "נושא". */
const T01_COL_DRAW_ORDER = [...T01_COL_ORDER].reverse();

/** סדר שדות טיפוסי לטופס קבלה (T02 ומבנה דומה) */
const ENTRY_FIELD_ORDER = [
  "receiptDate",
  "receiptTime",
  "productName",
  "frozenTempIntegrity",
  "shelfLifeIntegrity",
  "manufacturerSupplier",
  "weightQuantity",
  "certificatesVeterinary",
  "shipmentIntegrityCleanliness",
  "receiverName",
  "signature",
];

const ENTRY_FIELD_LABELS = {
  receiptDate: "תאריך קבלה",
  receiptTime: "שעת קבלה",
  productName: "שם המוצר שהתקבל",
  frozenTempIntegrity: "תקינות טמפ' המזון המתקבל (קפוא)\nבדיקה קשה במגע",
  shelfLifeIntegrity: "תקינות תאריך חיי מדף",
  manufacturerSupplier: "יצרן/ספק המוצר / מענו",
  weightQuantity: "משקל / כמות",
  certificatesVeterinary: "שלימות תעודות, משלוח ווטרינרית",
  shipmentIntegrityCleanliness: "שלמות וניקיון המשלוח",
  receiverName: "שם מקבל",
  signature: "שם וחתימת מקבל",
};

/** T03 — תיעוד תקלה (שדות שטוחים ב־data) */
const T03_FIELD_ORDER = [
  "faultDate",
  "faultNature",
  "correctiveAction",
  "repairDate",
  "healthBureauReport",
  "conclusions",
];

const T03_FIELD_LABELS = {
  faultDate: "תאריך תקלה",
  faultNature: "אופי התקלה",
  correctiveAction: "פעולה מתקנת",
  repairDate: "תאריך תיקון",
  healthBureauReport: "דיווח למשרד הבריאות",
  conclusions: "מסקנות",
};

const FLAT_SKIP_KEYS = new Set(["entries", "matrix", "signature", "signatureMime"]);

function labelFlatField(key) {
  return (
    T03_FIELD_LABELS[key] ||
    ENTRY_FIELD_LABELS[key] ||
    key.replace(/_/g, " ")
  );
}

function hebrewFontAvailable() {
  return fs.existsSync(FONT_HEBREW_PATH);
}

function registerHebrewFont(doc) {
  if (hebrewFontAvailable()) {
    doc.registerFont("Hebrew", FONT_HEBREW_PATH);
    return "Hebrew";
  }
  return "Helvetica";
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch (_) {
    return String(d);
  }
}

/**
 * שורת מטא בשתי עמודות קבועות: ערכים מיושרים לקו אחד (ימין של עמודת הערכים),
 * תווית בעברית + נקודתיים (LRM לפני הנקודתיים כדי שלא יהפוך ל־:קוד).
 */
function drawRtlMetaLine(doc, fontName, margin, pageW, y, fontSize, hebrewLabel, value) {
  const vRaw = value === undefined || value === null ? "—" : String(value);
  const v = vRaw;
  const valueColW = Math.min(240, Math.max(150, Math.floor(pageW * 0.38)));
  const gap = 12;
  const labelColW = pageW - valueColW - gap;

  doc.save();
  doc.fontSize(fontSize);

  const hebrewInValue = /[\u0590-\u05FF]/.test(vRaw);
  if (hebrewInValue) {
    doc.font(fontName);
  } else {
    doc.font("Helvetica");
  }
  doc.text(v, margin, y, {
    width: valueColW,
    align: "right",
    lineBreak: false,
  });

  const labelWithColon = `${hebrewLabel}\u200e:`;
  doc.font(fontName);
  doc.text(labelWithColon, margin + valueColW + gap, y, {
    width: labelColW,
    align: "right",
    lineBreak: false,
  });

  doc.restore();
  return y + fontSize * 1.48;
}

function isCheckboxChecked(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1) return true;
  if (v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1";
  }
  return false;
}

function isMatrixCellCheckbox(val) {
  return (
    typeof val === "boolean" ||
    typeof val === "number" ||
    (typeof val === "string" && /^(true|false|1|0)$/i.test(val.trim()))
  );
}

function drawCheckbox(doc, cellX, cellY, cellW, cellH, checked) {
  const size = Math.min(cellW, cellH) * 0.42;
  const bx = cellX + (cellW - size) / 2;
  const by = cellY + (cellH - size) / 2;
  doc.save();
  doc.lineWidth(0.9).strokeColor("#111111");
  doc.rect(bx, by, size, size).stroke();
  if (checked) {
    doc.lineWidth(2).strokeColor("#000000");
    doc
      .moveTo(bx + size * 0.2, by + size * 0.52)
      .lineTo(bx + size * 0.38, by + size * 0.78)
      .lineTo(bx + size * 0.82, by + size * 0.22)
      .stroke();
  }
  doc.restore();
}

function drawRtlCell(doc, fontName, x, y, w, h, text, fontSize = 9) {
  doc.save();
  doc.font(fontName).fontSize(fontSize);
  doc.text(text || "", x + 4, y + 5, {
    width: Math.max(8, w - 8),
    height: Math.max(8, h - 8),
    align: "right",
    lineGap: 1,
  });
  doc.restore();
}

function drawTableGrid(doc, x, y, colWidths, rowHeights) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const totalH = rowHeights.reduce((a, b) => a + b, 0);
  doc.save();
  doc.lineWidth(0.5).strokeColor("#333333");
  let cx = x;
  for (const cw of colWidths) {
    doc.moveTo(cx, y).lineTo(cx, y + totalH).stroke();
    cx += cw;
  }
  doc.moveTo(x + totalW, y).lineTo(x + totalW, y + totalH).stroke();
  let cy = y;
  for (const rh of rowHeights) {
    doc.moveTo(x, cy).lineTo(x + totalW, cy).stroke();
    cy += rh;
  }
  doc.moveTo(x, y + totalH).lineTo(x + totalW, y + totalH).stroke();
  doc.restore();
}

/**
 * כותרת ממוסגרת כמו באפליקציית הליקוט: ימין חברה, מרכז כותרת, שמאל "קוד טופס" ואז הערך (בלי נקודתיים על גבול bidi).
 */
function drawFormalFormHeader(doc, fontName, margin, pageW, y, opts) {
  const { mainTitle, formCode, extraLine } = opts;
  const companyLine =
    process.env.COMPANY_FORM_PDF_LINE || "שוברים שוק — מחסן / אבטחת איכות";

  const leftW = pageW * 0.3;
  const centerW = pageW * 0.4;
  const rightW = pageW * 0.3;
  const leftX = margin + 6;
  const centerX = margin + leftW;
  const rightX = margin + leftW + centerW;

  const extraLines = String(extraLine || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const boxH = Math.max(86, 52 + extraLines.length * 11 + 36);

  doc.save();
  doc.lineWidth(0.85).strokeColor("#000000");
  doc.rect(margin, y, pageW, boxH).stroke();

  doc.font(fontName).fontSize(9).text(companyLine, rightX + 4, y + 8, {
    width: rightW - 12,
    align: "right",
    lineGap: 3,
  });

  doc.font(fontName).fontSize(12.5).text(mainTitle, centerX, y + 14, {
    width: centerW,
    align: "center",
    lineGap: 2,
  });

  doc.font(fontName).fontSize(9).text("קוד טופס", leftX, y + 8, {
    width: leftW - 8,
    align: "right",
  });
  doc.font("Helvetica").fontSize(11).text(String(formCode || "—"), leftX, y + 22, {
    width: leftW - 8,
    align: "right",
  });
  let ly = y + 38;
  for (const line of extraLines) {
    const useHeb = /[\u0590-\u05FF]/.test(line);
    doc.font(useHeb ? fontName : "Helvetica").fontSize(8);
    doc.text(line, leftX, ly, { width: leftW - 8, align: "right", lineGap: 2 });
    ly += 11;
  }
  doc.font(fontName).fontSize(8).text("עמוד 1 מתוך 1", leftX, ly, { width: leftW - 8, align: "right" });

  doc.font(fontName).fontSize(7.5).text("הטופס מתבצע באופן ממוחשב — בהתאם לפורמט זה", margin, y + boxH - 14, {
    width: pageW,
    align: "center",
  });
  doc.restore();
  return y + boxH + 10;
}

/**
 * טבלה ממוסגרת: עמודת ערכים (שמאל) + עמודת שמות שדות בעברית (ימין).
 */
function renderBorderedKvTable(doc, fontName, margin, pageW, y, orderedKeys, dataObj) {
  const keys = orderedKeys.filter((k) => dataObj[k] !== undefined && !FLAT_SKIP_KEYS.has(k));
  if (!keys.length) return y;

  const valueColW = Math.floor(pageW * 0.5);
  const labelColW = pageW - valueColW;
  const rowH = 30;
  const tableLeft = margin;
  const colWidths = [valueColW, labelColW];
  const rowHeights = keys.map(() => rowH);
  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  if (y + totalH > doc.page.height - margin - 40) {
    doc.addPage();
    y = margin;
  }

  drawTableGrid(doc, tableLeft, y, colWidths, rowHeights);

  let cy = y;
  for (const key of keys) {
    const raw = dataObj[key];
    if (typeof raw === "boolean" || isMatrixCellCheckbox(raw)) {
      drawCheckbox(doc, tableLeft + valueColW / 2 - 11, cy + 7, 22, 18, isCheckboxChecked(raw));
    } else {
      const display =
        raw === undefined || raw === null ? "—" : typeof raw === "object" ? "—" : String(raw);
      const fontVal = /[\u0590-\u05FF]/.test(display) ? fontName : "Helvetica";
      doc.font(fontVal).fontSize(9);
      doc.text(display, tableLeft + 4, cy + 6, {
        width: valueColW - 8,
        align: "right",
        lineGap: 1,
      });
    }
    const lab = `${labelFlatField(key)}\u200e:`;
    drawRtlCell(doc, fontName, tableLeft + valueColW, cy, labelColW, rowH, lab, 9);
    cy += rowH;
  }

  return y + totalH + 14;
}

function labelForRowKey(rowKey) {
  return T01_ROW_LABELS[rowKey] || rowKey;
}

function labelForColKey(colKey) {
  return T01_COL_LABELS[colKey] || colKey;
}

function colHeaderFromSchema(c) {
  if (!c || typeof c !== "object") return "";
  return (c.labelShort || c.label || c.labelTitle || c.key || "").trim();
}

/** עמודות שטוחות ל־PDF לפי shared/forms (כולל הרחבת group). */
function flattenPdfTableColumns(schema) {
  const out = [];
  for (const c of schema?.columns || []) {
    if (c.type === "group") {
      for (const f of c.fields || []) {
        out.push({
          key: f.key,
          header: String(f.label || c.label || f.key || "").trim(),
          isSignature: f.type === "signature",
        });
      }
    } else {
      out.push({
        key: c.key,
        header: colHeaderFromSchema(c),
        isSignature: c.type === "signature",
      });
    }
  }
  return out;
}

function getTableEntriesForPdf(data, schema) {
  if (!data || typeof data !== "object") return [];
  const arr = data.entries;
  if (Array.isArray(arr) && arr.length) return arr;
  return [];
}

/**
 * טבלה (T02/T03) — כותרות מ־schema, ערכים מ־data בלבד, חתימות כתמונות.
 */
function renderTableFormFromSchema(doc, submission, fontName, schema, parseSignatureImageBuffer) {
  const margin = 50;
  const pageW = doc.page.width - margin * 2;
  const data = submission.data && typeof submission.data === "object" ? submission.data : {};
  const entries = getTableEntriesForPdf(data, schema);
  const flatCols = flattenPdfTableColumns(schema);
  const dataCols = flatCols.filter((c) => !c.isSignature);
  const colsDraw = [...dataCols].reverse();

  let y = margin;
  const updated = fmtDate(submission.updatedAt || submission.submittedAt);
  const dateShort = updated.includes(",") ? updated.split(",")[0].trim() : updated;
  const melaket = submission.melaketId ? String(submission.melaketId) : "—";
  const extraBlock = `תאריך עדכון: ${dateShort}\nמזהה מלקט: ${melaket}`;

  y = drawFormalFormHeader(doc, fontName, margin, pageW, y, {
    mainTitle: schema.title || submission.formCode || "—",
    formCode: submission.formCode || "—",
    extraLine: extraBlock,
  });

  if (schema.intro) {
    doc.font(fontName).fontSize(8).text(schema.intro, margin, y, { width: pageW, align: "right", lineGap: 2 });
    y = doc.y + 8;
  }

  if (!entries.length || !colsDraw.length) {
    doc.font(fontName).fontSize(10).text("(אין נתוני טבלה להצגה)", margin, y, { width: pageW, align: "right" });
    doc.y = doc.y + 20;
    return;
  }

  const n = colsDraw.length;
  const colW = Math.floor(pageW / Math.max(1, n));
  const headerH = 56;
  const rowH = 44;
  const colWidths = colsDraw.map(() => colW);
  const rowHeights = [headerH, ...entries.map(() => rowH)];
  const totalH = rowHeights.reduce((a, b) => a + b, 0);
  const tableLeft = margin;

  if (y + totalH > doc.page.height - margin - 60) {
    doc.addPage();
    y = margin;
  }

  drawTableGrid(doc, tableLeft, y, colWidths, rowHeights);

  let cx = tableLeft;
  for (const colDef of colsDraw) {
    drawRtlCell(doc, fontName, cx, y, colW, headerH, colDef.header, 5.5);
    cx += colW;
  }

  let cy = y + headerH;
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    cx = tableLeft;
    for (const colDef of colsDraw) {
      const raw = entry[colDef.key];
      if (typeof raw === "boolean" || isMatrixCellCheckbox(raw)) {
        drawCheckbox(doc, cx, cy, colW, rowH, isCheckboxChecked(raw));
      } else if (raw !== undefined && raw !== null) {
        let s =
          typeof raw === "object" ? "—" : String(raw);
        if (s.length > 140) s = s.slice(0, 137) + "…";
        const fontVal = /[\u0590-\u05FF]/.test(s) ? fontName : "Helvetica";
        doc.font(fontVal).fontSize(7);
        doc.text(s, cx + 2, cy + 5, { width: colW - 4, align: "right", lineGap: 1 });
      }
      cx += colW;
    }
    cy += rowH;
  });

  doc.y = cy + 10;

  entries.forEach((entry, idx) => {
    for (const sd of flatCols.filter((c) => c.isSignature)) {
      const sig = entry && typeof entry[sd.key] === "string" ? entry[sd.key] : "";
      if (!sig.trim()) continue;
      const buf = parseSignatureImageBuffer(sig);
      if (!buf) continue;
      if (doc.y > doc.page.height - margin - 120) {
        doc.addPage();
        doc.y = margin;
      }
      doc.font(fontName).fontSize(9).text(`${sd.header} — רשומה ${idx + 1}`, margin, doc.y, {
        width: pageW,
        align: "right",
      });
      doc.moveDown(0.25);
      try {
        const rightEdge = margin + pageW;
        const imgW = Math.min(280, pageW);
        doc.image(buf, rightEdge - imgW, doc.y, { fit: [imgW, 72] });
        doc.y += 82;
      } catch (_) {
        doc.y += 8;
      }
    }
  });
}

/**
 * יומן קבלת סחורה — טבלה ממוסגרת עם עמודות בעברית (RTL: תאריך קבלה מימין).
 */
function renderEntriesForm(doc, submission, fontName, parseSignatureImageBuffer, entries) {
  const margin = 50;
  const pageW = doc.page.width - margin * 2;
  let y = doc.y;
  const code = (submission.formCode || "").trim();
  const updated = fmtDate(submission.updatedAt || submission.submittedAt);
  const dateShort = updated.includes(",") ? updated.split(",")[0].trim() : updated;
  const melaket = submission.melaketId ? String(submission.melaketId) : "—";
  const extraBlock = `תאריך עדכון: ${dateShort}\nמזהה מלקט: ${melaket}`;

  y = drawFormalFormHeader(doc, fontName, margin, pageW, y, {
    mainTitle: code === "T02" ? "טופס יומן קבלת סחורה" : "טופס רישום קבלה",
    formCode: code || "—",
    extraLine: extraBlock,
  });

  const dataCols = ENTRY_FIELD_ORDER.filter((k) => k !== "signature");
  const colsDraw = [...dataCols].reverse();
  const n = colsDraw.length;
  const colW = Math.floor(pageW / n);
  const headerH = 56;
  const rowH = 40;
  const colWidths = colsDraw.map(() => colW);
  const rowHeights = [headerH, ...entries.map(() => rowH)];
  const totalH = rowHeights.reduce((a, b) => a + b, 0);
  const tableLeft = margin;

  if (y + totalH > doc.page.height - margin - 60) {
    doc.addPage();
    y = margin;
  }

  drawTableGrid(doc, tableLeft, y, colWidths, rowHeights);

  let cx = tableLeft;
  for (const key of colsDraw) {
    const hdr = ENTRY_FIELD_LABELS[key] || key;
    drawRtlCell(doc, fontName, cx, y, colW, headerH, hdr, 5.5);
    cx += colW;
  }

  let cy = y + headerH;
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    cx = tableLeft;
    for (const key of colsDraw) {
      const raw = entry[key];
      if (typeof raw === "boolean" || isMatrixCellCheckbox(raw)) {
        drawCheckbox(doc, cx, cy, colW, rowH, isCheckboxChecked(raw));
      } else if (raw !== undefined && raw !== null) {
        let s = typeof raw === "object" ? "—" : String(raw);
        if (s.length > 120) s = s.slice(0, 117) + "…";
        const fontVal = /[\u0590-\u05FF]/.test(s) ? fontName : "Helvetica";
        doc.font(fontVal).fontSize(7);
        doc.text(s, cx + 2, cy + 5, { width: colW - 4, align: "right", lineGap: 1 });
      }
      cx += colW;
    }
    cy += rowH;
  });

  doc.y = cy + 10;

  entries.forEach((entry, idx) => {
    const sig = entry && typeof entry.signature === "string" ? entry.signature : "";
    if (!sig.trim()) return;
    const buf = parseSignatureImageBuffer(sig);
    if (!buf) return;
    if (doc.y > doc.page.height - margin - 120) {
      doc.addPage();
      doc.y = margin;
    }
    doc.font(fontName).fontSize(9).text(`חתימת מקבל — רשומה ${idx + 1}`, margin, doc.y, {
      width: pageW,
      align: "right",
    });
    doc.moveDown(0.25);
    try {
      const rightEdge = margin + pageW;
      const imgW = Math.min(280, pageW);
      doc.image(buf, rightEdge - imgW, doc.y, { fit: [imgW, 72] });
      doc.y += 82;
    } catch (_) {
      doc.y += 8;
    }
  });
}

function renderT03Form(doc, submission, fontName) {
  const data = submission.data && typeof submission.data === "object" ? submission.data : {};
  const margin = 50;
  const pageW = doc.page.width - margin * 2;
  let y = margin;
  const updated = fmtDate(submission.updatedAt || submission.submittedAt);
  const dateShort = updated.includes(",") ? updated.split(",")[0].trim() : updated;
  const melaket = submission.melaketId ? String(submission.melaketId) : "—";
  const extraBlock = `תאריך עדכון: ${dateShort}\nמזהה מלקט: ${melaket}`;

  y = drawFormalFormHeader(doc, fontName, margin, pageW, y, {
    mainTitle: "טופס תיעוד תקלה וטיפול",
    formCode: submission.formCode || "T03",
    extraLine: extraBlock,
  });

  const ordered = [
    ...T03_FIELD_ORDER.filter((k) => data[k] !== undefined),
    ...Object.keys(data).filter((k) => !T03_FIELD_ORDER.includes(k) && !FLAT_SKIP_KEYS.has(k)),
  ];

  y = renderBorderedKvTable(doc, fontName, margin, pageW, y, ordered, data);
  doc.y = y;
}

function renderT01Form(doc, submission, fontName, schema) {
  const data = submission.data && typeof submission.data === "object" ? submission.data : {};
  const matrix = data.matrix && typeof data.matrix === "object" && !Array.isArray(data.matrix) ? data.matrix : {};

  const margin = 50;
  const pageW = doc.page.width - margin * 2;
  const labelColW = Math.min(158, Math.floor(pageW * 0.3));

  const rowKeyList =
    schema?.matrix?.rows?.length > 0 ? schema.matrix.rows.map((r) => r.key) : T01_ROW_ORDER;
  const colKeysForward =
    schema?.matrix?.columns?.length > 0 ? schema.matrix.columns.map((c) => c.key) : T01_COL_ORDER;
  const colDrawOrder = [...colKeysForward].reverse();

  const dataColW = Math.floor((pageW - labelColW) / Math.max(1, colDrawOrder.length));

  const rowLabelText = (rk) => {
    const row = schema?.matrix?.rows?.find((r) => r.key === rk);
    return row?.label || labelForRowKey(rk);
  };
  const colLabelText = (ck) => {
    const col = schema?.matrix?.columns?.find((c) => c.key === ck);
    return col?.label || labelForColKey(ck);
  };
  const mainTitle = schema?.title || "טופס בדיקת ניקיון ותשתיות";
  const cornerHeader = schema?.matrix?.cornerHeaderLabel || "שם החדר / תאריך";
  const instrLine =
    schema?.instructions?.parts?.length > 0
      ? schema.instructions.parts.map((p) => `${p.bold || ""}${p.text || ""}`).join(" | ")
      : T01_INSTRUCTION_LINE;

  const rightEdge = margin + pageW;
  let y = margin;

  const updated = fmtDate(submission.updatedAt || submission.submittedAt);
  const dateShort = updated.includes(",") ? updated.split(",")[0].trim() : updated;
  const melaket = submission.melaketId ? String(submission.melaketId) : "—";
  const insp =
    data.inspectionDate != null && String(data.inspectionDate).trim() ? String(data.inspectionDate) : "—";
  const extraBlock = [
    `תאריך עדכון: ${dateShort}`,
    `תאריך הגשה: ${fmtDate(submission.submittedAt)}`,
    `נוצר במערכת: ${fmtDate(submission.createdAt)}`,
    `מזהה מלקט: ${melaket}`,
    `תאריך בדיקה: ${insp}`,
  ].join("\n");

  y = drawFormalFormHeader(doc, fontName, margin, pageW, y, {
    mainTitle,
    formCode: submission.formCode || "T01",
    extraLine: extraBlock,
  });

  doc.font(fontName).fontSize(8);
  doc.text(instrLine, margin, y, { width: pageW, align: "center", lineGap: 2 });
  y = doc.y + 8;
  doc.x = margin;
  doc.y = y;

  const headerH = 64;
  const rowH = 38;
  const colWidthsLTR = [...colDrawOrder.map(() => dataColW), labelColW];
  const rowHeights = [headerH, ...rowKeyList.map(() => rowH)];
  const totalTableW = colWidthsLTR.reduce((a, b) => a + b, 0);
  const tableLeft = rightEdge - totalTableW;
  const tableTop = doc.y + 4;

  drawTableGrid(doc, tableLeft, tableTop, colWidthsLTR, rowHeights);

  let cx = tableLeft;
  for (let c = 0; c < colDrawOrder.length; c++) {
    const colKey = colDrawOrder[c];
    drawRtlCell(doc, fontName, cx, tableTop, colWidthsLTR[c], headerH, colLabelText(colKey), 7);
    cx += colWidthsLTR[c];
  }
  drawRtlCell(doc, fontName, cx, tableTop, labelColW, headerH, cornerHeader, 8);

  let cy = tableTop + headerH;
  for (const rowKey of rowKeyList) {
    const rlab = rowLabelText(rowKey);
    const rowObj = matrix[rowKey];
    cx = tableLeft;
    for (let c = 0; c < colDrawOrder.length; c++) {
      const colKey = colDrawOrder[c];
      const rawVal = rowObj && typeof rowObj === "object" ? rowObj[colKey] : false;
      drawCheckbox(doc, cx, cy, colWidthsLTR[c], rowH, isCheckboxChecked(rawVal));
      cx += colWidthsLTR[c];
    }
    drawRtlCell(doc, fontName, cx, cy, labelColW, rowH, rlab, 8);
    cy += rowH;
  }

  doc.y = cy + 24;
}

function renderGenericForm(doc, submission, fontName, parseSignatureImageBuffer) {
  const margin = 50;
  const pageW = doc.page.width - margin * 2;
  const rightEdge = margin + pageW;
  const data = submission.data && typeof submission.data === "object" ? submission.data : {};
  const entries = Array.isArray(data.entries) ? data.entries : null;

  if (entries && entries.length > 0) {
    doc.x = margin;
    doc.y = margin;
    renderEntriesForm(doc, submission, fontName, parseSignatureImageBuffer, entries);
    return;
  }

  const matrix = data.matrix && typeof data.matrix === "object" && !Array.isArray(data.matrix) ? data.matrix : null;

  const flatKeys = Object.keys(data).filter(
    (k) => !FLAT_SKIP_KEYS.has(k) && k !== "entries" && k !== "matrix"
  );

  if (!matrix && flatKeys.length > 0) {
    let y = margin;
    const code = (submission.formCode || "").trim() || "—";
    const updated = fmtDate(submission.updatedAt || submission.submittedAt);
    const dateShort = updated.includes(",") ? updated.split(",")[0].trim() : updated;
    const melaket = submission.melaketId ? String(submission.melaketId) : "—";
    const extraBlock = `תאריך עדכון: ${dateShort}\nמזהה מלקט: ${melaket}`;
    y = drawFormalFormHeader(doc, fontName, margin, pageW, y, {
      mainTitle: `הגשת טופס ${code}`,
      formCode: code,
      extraLine: extraBlock,
    });
    const order = [
      ...T03_FIELD_ORDER.filter((k) => flatKeys.includes(k)),
      ...flatKeys.filter((k) => !T03_FIELD_ORDER.includes(k)),
    ];
    y = renderBorderedKvTable(doc, fontName, margin, pageW, y, order, data);
    doc.x = margin;
    doc.y = y;
    return;
  }

  let y = margin;

  y = drawRtlMetaLine(doc, fontName, margin, pageW, y, 16, "הגשת טופס", submission.formCode || "—");
  y += 4;
  y = drawRtlMetaLine(doc, fontName, margin, pageW, y, 10, "תאריך הגשה", fmtDate(submission.submittedAt));
  y = drawRtlMetaLine(doc, fontName, margin, pageW, y, 10, "נוצר במערכת", fmtDate(submission.createdAt));
  y = drawRtlMetaLine(doc, fontName, margin, pageW, y, 10, "מזהה מלקט", submission.melaketId ? String(submission.melaketId) : "—");
  y += 6;

  if (data.inspectionDate != null && String(data.inspectionDate).trim()) {
    y = drawRtlMetaLine(doc, fontName, margin, pageW, y, 10, "תאריך בדיקה", String(data.inspectionDate));
    y += 4;
  }

  doc.x = margin;
  doc.y = y;

  if (matrix) {
    const rowKeys = Object.keys(matrix);
    const colKeysSet = new Set();
    for (const rk of rowKeys) {
      const row = matrix[rk];
      if (row && typeof row === "object" && !Array.isArray(row)) {
        Object.keys(row).forEach((k) => colKeysSet.add(k));
      }
    }
    const colKeys = Array.from(colKeysSet);
    if (rowKeys.length && colKeys.length) {
      doc.font(fontName).fontSize(11).text("מטריצת סימונים", margin, doc.y, {
        width: pageW,
        align: "right",
      });
      doc.moveDown(0.3);

      const labelW = Math.min(130, Math.floor(pageW * 0.28));
      const rest = pageW - labelW;
      const colW = Math.max(48, Math.floor(rest / colKeys.length));
      const colWidthsLTR = [...colKeys.map(() => colW), labelW];
      const headerH = 44;
      const rowH = 32;
      const rowHeights = [headerH, ...rowKeys.map(() => rowH)];
      const totalTableW = colWidthsLTR.reduce((a, b) => a + b, 0);
      const tableLeft = rightEdge - totalTableW;
      let tableTop = doc.y + 4;

      if (tableTop + rowHeights.reduce((a, b) => a + b, 0) > doc.page.height - margin) {
        doc.addPage();
        doc.x = margin;
        doc.y = margin;
        tableTop = doc.y + 4;
      }

      drawTableGrid(doc, tableLeft, tableTop, colWidthsLTR, rowHeights);

      let cx = tableLeft;
      for (let c = 0; c < colKeys.length; c++) {
        drawRtlCell(doc, fontName, cx, tableTop, colW, headerH, labelForColKey(colKeys[c]), 7);
        cx += colW;
      }
      drawRtlCell(doc, fontName, cx, tableTop, labelW, headerH, "נושא", 9);

      let cy = tableTop + headerH;
      for (const rowKey of rowKeys) {
        cx = tableLeft;
        const row = matrix[rowKey];
        for (let c = 0; c < colKeys.length; c++) {
          const val = row && typeof row === "object" ? row[colKeys[c]] : undefined;
          if (isMatrixCellCheckbox(val)) {
            drawCheckbox(doc, cx, cy, colW, rowH, isCheckboxChecked(val));
          } else {
            drawRtlCell(doc, fontName, cx, cy, colW, rowH, val != null ? String(val) : "—", 8);
          }
          cx += colW;
        }
        drawRtlCell(doc, fontName, cx, cy, labelW, rowH, labelForRowKey(rowKey), 8);
        cy += rowH;
        if (cy > doc.page.height - margin - rowH) {
          doc.addPage();
          doc.x = margin;
          doc.y = margin;
          cy = doc.y;
        }
      }
      doc.y = cy + 16;
    } else {
      doc.font(fontName).fontSize(9).text("(מטריצה ריקה)", margin, doc.y, { width: pageW, align: "right" });
      doc.moveDown();
    }
  } else {
    doc
      .font(fontName)
      .fontSize(9)
      .text("(אין מטריצה או שדות מוצגים — נתונים לא בפורמט צפוי)", margin, doc.y, {
        width: pageW,
        align: "right",
      });
    doc.moveDown();
  }
}

function renderSignatureSection(doc, signatureRaw, fontName, parseSignatureImageBuffer) {
  const margin = 50;
  const pageW = doc.page.width - margin * 2;
  const rightEdge = margin + pageW;
  const sigBuf = parseSignatureImageBuffer(signatureRaw);

  if (doc.y > doc.page.height - margin - 200) {
    doc.addPage();
    doc.y = margin;
  }
  doc.font(fontName).fontSize(12).text("חתימה", margin, doc.y, { width: pageW, align: "right" });
  doc.moveDown(0.5);

  if (sigBuf) {
    try {
      if (doc.y > 620) {
        doc.addPage();
        doc.y = margin;
      }
      const imgW = Math.min(400, pageW);
      doc.image(sigBuf, rightEdge - imgW, doc.y, { fit: [imgW, 160] });
      doc.y += 170;
    } catch (e) {
      console.error("PDF signature image error:", e);
      doc.font(fontName).fontSize(9).text("(לא ניתן להציג את החתימה כתמונה)", margin, doc.y, {
        width: pageW,
        align: "right",
      });
      doc.moveDown();
    }
  } else if (signatureRaw && String(signatureRaw).trim()) {
    const rawShow = String(signatureRaw).slice(0, 1500) + (String(signatureRaw).length > 1500 ? "…" : "");
    const showSigText =
      /^data:/i.test(rawShow) || rawShow.length > 400
        ? "(חתימה לא נטענה כתמונה)"
        : rawShow;
    doc.font(fontName).fontSize(9).text(showSigText, margin, doc.y, {
      width: pageW,
      align: "right",
    });
    doc.moveDown();
  } else {
    doc.font(fontName).fontSize(9).text("(ללא חתימה)", margin, doc.y, { width: pageW, align: "right" });
    doc.moveDown();
  }
}

function renderFormSubmissionPdfContent(pdf, submissionLean, parseSignatureImageBuffer, schema) {
  const fontName = registerHebrewFont(pdf);
  if (!hebrewFontAvailable()) {
    console.warn(
      "formSubmissionPdfService: Hebrew font missing at",
      FONT_HEBREW_PATH,
      "— install assets/fonts/NotoSansHebrew-Variable.ttf"
    );
  }

  const data = submissionLean.data && typeof submissionLean.data === "object" ? submissionLean.data : {};
  const entries = Array.isArray(data.entries) ? data.entries : null;

  const code = (submissionLean.formCode || "").trim();

  if (schema && schema.layout === "matrix") {
    renderT01Form(pdf, submissionLean, fontName, schema);
  } else if (schema && schema.layout === "table") {
    renderTableFormFromSchema(pdf, submissionLean, fontName, schema, parseSignatureImageBuffer);
  } else if (code === "T01") {
    renderT01Form(pdf, submissionLean, fontName, null);
  } else if (code === "T03" && !entries) {
    renderT03Form(pdf, submissionLean, fontName);
  } else {
    renderGenericForm(pdf, submissionLean, fontName, parseSignatureImageBuffer);
  }

  const skipFooterSignature = schema && schema.layout === "table";
  if (skipFooterSignature) {
    return;
  }

  const hasNestedSignatures =
    entries && entries.some((e) => e && typeof e.signature === "string" && e.signature.trim());

  const rootSig = typeof data.signature === "string" ? data.signature : "";
  if (!hasNestedSignatures || (rootSig && rootSig.trim())) {
    renderSignatureSection(pdf, rootSig, fontName, parseSignatureImageBuffer);
  }
}

module.exports = {
  renderFormSubmissionPdfContent,
  hebrewFontAvailable,
  FONT_HEBREW_PATH,
};
