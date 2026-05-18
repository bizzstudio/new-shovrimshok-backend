const mongoose = require("mongoose");
const FormSubmission = require("../models/FormSubmission");

function parseSubmittedAt(value) {
  if (value === undefined || value === null || value === "") {
    return { date: new Date() };
  }
  if (typeof value !== "string" || !value.trim()) {
    return { error: { he: "submittedAt לא תקין", en: "Invalid submittedAt" } };
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return { error: { he: "submittedAt לא תאריך תקין (ISO-8601)", en: "Invalid submittedAt ISO-8601 date" } };
  }
  return { date: d };
}

function resolveMelaketId(body, reqUser) {
  const fromBody = body.melaketId;
  if (fromBody != null && String(fromBody).trim()) {
    const id = String(fromBody).trim();
    if (mongoose.Types.ObjectId.isValid(id)) {
      return new mongoose.Types.ObjectId(id);
    }
  }
  if (reqUser && reqUser._id && mongoose.Types.ObjectId.isValid(String(reqUser._id))) {
    return new mongoose.Types.ObjectId(String(reqUser._id));
  }
  return null;
}

/**
 * POST — שמירת הגשת טופס דיגיטלי.
 * נשמרים כפי שהם: formCode + אובייקט data גולמי (JSON) ללא מיפוי שדה־שדה בבקר או ב־DB.
 * אימות יחיד: formCode מוכר ב־shared/forms (T01/T02/T03).
 */
const createFormSubmission = async (req, res) => {
  try {
    const { formCode, submittedAt, data } = req.body;

    if (typeof formCode !== "string" || formCode.trim() === "") {
      return res.status(400).json({
        ok: false,
        message: {
          he: "formCode חייב להיות מחרוזת לא ריקה",
          en: "formCode must be a non-empty string",
        },
      });
    }

    const codeUpper = formCode.trim().toUpperCase();
    const { isKnownFormCode, listFormCodes } = await import(
      "../shared/forms/registry.js"
    );
    if (!isKnownFormCode(codeUpper)) {
      return res.status(400).json({
        ok: false,
        error: "unknown_form_code",
        allowed: listFormCodes(),
        message: {
          he: "קוד טופס לא מוכר",
          en: "Unknown form code",
        },
      });
    }

    if (data === undefined || data === null) {
      return res.status(400).json({
        ok: false,
        message: { he: "חסר data", en: "Missing data" },
      });
    }

    const parsed = parseSubmittedAt(submittedAt);
    if (parsed.error) {
      return res.status(400).json({ ok: false, message: parsed.error });
    }

    const melaketObjectId = resolveMelaketId(req.body, req.user);

    const doc = await FormSubmission.create({
      formCode: codeUpper,
      submittedAt: parsed.date,
      melaketId: melaketObjectId,
      data,
    });

    return res.status(201).json({
      ok: true,
      id: doc._id.toString(),
    });
  } catch (err) {
    console.error("createFormSubmission error:", err);
    return res.status(500).json({
      ok: false,
      message: { he: "שגיאה בשמירת הטופס", en: "Failed to save form submission" },
    });
  }
};

module.exports = {
  createFormSubmission,
};
