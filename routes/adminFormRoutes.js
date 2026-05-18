const express = require("express");
const router = express.Router();
const {
  listFormSubmissions,
  getFormSubmissionPdf,
  getFormSubmissionPrintHtml,
  listFormSchemas,
  getFormSchemaJson,
} = require("../controller/formSubmissionAdminController");

router.get("/schemas", listFormSchemas);
router.get("/schemas/:code", getFormSchemaJson);
router.get("/submissions", listFormSubmissions);
router.get("/submissions/:id/print", getFormSubmissionPrintHtml);
router.get("/submissions/:id/pdf", getFormSubmissionPdf);

module.exports = router;
