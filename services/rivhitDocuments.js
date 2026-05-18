// services/rivhitDocuments.js
// Re-export from rivhitDocuments folder so controller keeps same require path

const {
  fetchRivhitDocumentList,
  getCustomerDocumentsGrouped,
  clearCustomerCache,
} = require("./rivhitDocuments/fetch");
const { issueInvoiceReceiptForOrders } = require("./rivhitDocuments/issueInvoiceReceipt");
const { issueInvoiceForOrders } = require("./rivhitDocuments/issueInvoice");
const { issueReceiptForInvoices } = require("./rivhitDocuments/issueReceipt");
const { issueDeliveryNoteForOrder } = require("./rivhitDocuments/issueDeliveryNote");
const { issueDeliveryNoteHyphenForOrder } = require("./rivhitDocuments/issueDeliveryNoteHyphen");
const { issueCreditInvoice } = require("./rivhitDocuments/issueCreditInvoice");
const { issueReturnNoteForOrder } = require("./rivhitDocuments/issueReturnNote");

module.exports = {
  fetchRivhitDocumentList,
  getCustomerDocumentsGrouped,
  clearCustomerCache,
  issueInvoiceReceiptForOrders,
  issueInvoiceForOrders,
  issueReceiptForInvoices,
  issueDeliveryNoteForOrder,
  issueDeliveryNoteHyphenForOrder,
  issueCreditInvoice,
  issueReturnNoteForOrder,
};