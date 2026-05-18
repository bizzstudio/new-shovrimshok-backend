// routes/rivhitDocumentsRoutes.js
const express = require("express");
const router = express.Router();

const {
    getRivhitCustomerDocuments,
    manualIssueInvoiceReceipt,
    manualIssueInvoice,
    manualIssueReceipt,
  manualIssueDeliveryNote,
  manualIssueDeliveryNoteHyphen,
  manualIssueCreditInvoice,
  manualIssueReturnNote,
  getPaymentTypes,
} = require("../controller/rivhitDocumentsController");
const { isAuth, isAdmin } = require("../config/auth");

// query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/customers/:customerId/documents", isAuth, getRivhitCustomerDocuments);

// קבלת רשימת סוגי תשלום
router.get("/payment-types", isAuth, getPaymentTypes);

// הנפקת חשבונית מס קבלה על מספר הזמנות בהקפה
router.post("/manual/invoice-receipt", isAdmin, manualIssueInvoiceReceipt);

// הנפקת חשבונית מס רגילה על הזמנות (ללא תשלום)
router.post("/manual/invoice", isAdmin, manualIssueInvoice);

// הנפקת קבלה על חשבונית מס קיימת (לא על חשבונית מס קבלה!)
router.post("/manual/receipt", isAdmin, manualIssueReceipt);

// הנפקת תעודת משלוח על הזמנה אחת
router.post("/manual/delivery-note", isAdmin, manualIssueDeliveryNote);

// הנפקת תעודת-משלוח (מקף) — סוג מסמך נפרד בריווחית
router.post("/manual/delivery-note-hyphen", isAdmin, manualIssueDeliveryNoteHyphen);

// הנפקת חשבונית מס זיכוי על חשבונית מס/חשבונית מס קבלה קיימת
router.post("/manual/credit-invoice", isAdmin, manualIssueCreditInvoice);

// הנפקת תעודת החזרה על הזמנה
router.post("/manual/return-note", isAdmin, manualIssueReturnNote);

module.exports = router;