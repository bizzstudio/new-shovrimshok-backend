const mongoose = require("mongoose");
const FormSubmission = require("../models/FormSubmission");
const { submissionPdfBufferFromHtml } = require("../services/submissionPdfFromHtml");

/**
 * GET — רשימת כל הגשות הטפסים (אדמין), לפי createdAt יורד.
 */
const listFormSubmissions = async (req, res) => {
  try {
    const docs = await FormSubmission.find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const submissions = docs.map((d) => ({
      id: String(d._id),
      formCode: d.formCode,
      submittedAt: d.submittedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      melaketId: d.melaketId ? String(d.melaketId) : null,
      data: d.data,
    }));

    return res.status(200).json({ submissions, items: submissions });
  } catch (err) {
    console.error("listFormSubmissions error:", err);
    return res.status(500).json({
      message: { he: "שגיאה בטעינת רשימת הטפסים", en: "Failed to list form submissions" },
    });
  }
};

/**
 * GET — PDF להגשה לפי id (הורדה).
 */
const getFormSubmissionPdf = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        message: { he: "הגשה לא נמצאה", en: "Submission not found" },
      });
    }
    const doc = await FormSubmission.findById(id).lean();
    if (!doc) {
      return res.status(404).json({
        message: { he: "הגשה לא נמצאה", en: "Submission not found" },
      });
    }

    const filename = `form-submission-${String(doc._id)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const { getFormSchema } = await import("../shared/forms/registry.js");
    const { buildPrintHtml } = await import("../shared/pdf/htmlReport.js");
    const schema = getFormSchema(doc.formCode);
    const html = buildPrintHtml(schema, doc.data);
    const pdfBuffer = await submissionPdfBufferFromHtml(html);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("getFormSubmissionPdf error:", err);
    if (!res.headersSent) {
      return res.status(500).json({
        message: { he: "שגיאה ביצירת PDF", en: "Failed to generate PDF" },
      });
    }
  }
};

/**
 * GET — HTML להדפסה לפי schema משותף (shared/pdf).
 */
const getFormSubmissionPrintHtml = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).send("not found");
    }
    const doc = await FormSubmission.findById(id).lean();
    if (!doc) return res.status(404).send("not found");

    const { getFormSchema } = await import("../shared/forms/registry.js");
    const { buildPrintHtml } = await import("../shared/pdf/htmlReport.js");
    const schema = getFormSchema(doc.formCode);
    if (!schema) return res.status(404).send("unknown form");

    const html = buildPrintHtml(schema, doc.data);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    console.error("getFormSubmissionPrintHtml error:", err);
    if (!res.headersSent) return res.status(500).send("error");
  }
};

const listFormSchemas = async (_req, res) => {
  try {
    const { listFormCodes } = await import("../shared/forms/registry.js");
    return res.status(200).json({ codes: listFormCodes() });
  } catch (err) {
    console.error("listFormSchemas error:", err);
    return res.status(500).json({
      message: { he: "שגיאה בטעינת רשימת הטפסים", en: "Failed to list form schemas" },
    });
  }
};

const getFormSchemaJson = async (req, res) => {
  try {
    const { getFormSchema } = await import("../shared/forms/registry.js");
    const s = getFormSchema(req.params.code);
    if (!s) {
      return res.status(404).json({
        message: { he: "טופס לא נמצא", en: "Form schema not found" },
      });
    }
    return res.status(200).json(s);
  } catch (err) {
    console.error("getFormSchemaJson error:", err);
    return res.status(500).json({
      message: { he: "שגיאה בטעינת הטופס", en: "Failed to load form schema" },
    });
  }
};

module.exports = {
  listFormSubmissions,
  getFormSubmissionPdf,
  getFormSubmissionPrintHtml,
  listFormSchemas,
  getFormSchemaJson,
};
