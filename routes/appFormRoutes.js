const express = require("express");
const router = express.Router();
const { createFormSubmission } = require("../controller/formSubmissionController");

router.post("/submissions", createFormSubmission);

module.exports = router;
