// controller/rivhitDocumentsController.js
const {
  getCustomerDocumentsGrouped,
  issueInvoiceReceiptForOrders,
  issueInvoiceForOrders,
  issueReceiptForInvoices,
  issueDeliveryNoteForOrder,
  issueDeliveryNoteHyphenForOrder,
  issueCreditInvoice,
  issueReturnNoteForOrder,
} = require("../services/rivhitDocuments");
const { paymentTypeList } = require("../utils/rivhit");
const Customer = require("../models/Customer");
const MainCustomer = require("../models/MainCustomer");

// Helper function לטיפול בשגיאות מריווחית
function extractRivhitErrorMessage(err, defaultMessage = null) {
  // בדיקה אם יש client_message בתשובת rivhit
  const rivhitResponse = err?.response?.data || err?.rivhit;
  if (rivhitResponse?.client_message) {
    return {
      en: rivhitResponse.client_message,
      he: rivhitResponse.client_message,
    };
  }

  // אם יש message object עם שתי שפות
  if (typeof err.message === 'object' && err.message.en && err.message.he) {
    return err.message;
  }

  // אחרת - הודעה ברירת מחדל
  if (defaultMessage) {
    return defaultMessage;
  }

  return {
    en: err.message || "An error occurred",
    he: err.message || "התרחשה שגיאה",
  };
}

// קבלת מסמכי לקוח מריווחית
async function getRivhitCustomerDocuments(req, res) {
  try {
    const { customerId } = req.params;
    const { from, to, scope } = req.query; // scope: "sub" או "main"

    if (!customerId) {
      return res.status(400).send({ message: "Missing customerId" });
    }

    // בדיקה אם המשתמש הוא admin - אם כן, אפשר להמשיך
    const isUserAdmin = req.user?.role === "Admin" || req.user?.role === "CEO";

    if (!isUserAdmin) {
      const requestedCustomerId = Number(customerId);

      if (scope === "main") {
        // בדיקת הרשאה ללקוח ראשי
        const customer = await Customer.findById(req.user._id).select("mainCustomer").populate("mainCustomer");
        if (!customer) {
          return res.status(404).send({
            message: {
              he: "לקוח לא נמצא",
              en: "Customer not found",
            }
          });
        }

        const mainCustomerExternalId = customer.mainCustomer?.externalCustomerId;

        if (!mainCustomerExternalId || mainCustomerExternalId !== requestedCustomerId) {
          return res.status(401).send({
            message: {
              he: "אין לך הרשאה לצפות במסמכים של לקוח ראשי זה",
              en: "You are not authorized to view documents for this main customer",
            }
          });
        }
      } else {
        // בדיקת הרשאה ללקוח משני (sub) - התנהגות ברירת מחדל
        const customer = await Customer.findById(req.user._id).select("accounting.externalCustomerId");
        if (!customer) {
          return res.status(404).send({
            message: {
              he: "לקוח לא נמצא",
              en: "Customer not found",
            }
          });
        }

        const userExternalCustomerId = customer.accounting?.externalCustomerId;

        if (!userExternalCustomerId || userExternalCustomerId !== requestedCustomerId) {
          return res.status(401).send({
            message: {
              he: "אין לך הרשאה לצפות במסמכים של לקוח זה",
              en: "You are not authorized to view documents for this customer",
            }
          });
        }
      }
    }

    // אם to הוא היום - לא נשלח אותו לריווחית כדי לקבל מסמכים עתידיים
    let toDate = to;
    if (to) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      if (to === today) {
        toDate = undefined; // לא נשלח אם זה היום
      }
    }

    let grouped;
    if (scope === "main") {
      // מסמכים של הלקוח הראשי + כל התתי-לקוחות שלו (לפי Rivhit customer_id) – שאילתה אחת עם populate
      const mainCustomer = await MainCustomer.findOne({ externalCustomerId: Number(customerId) })
        .populate("subCustomers", "accounting.externalCustomerId")
        .lean();
      if (!mainCustomer) {
        return res.status(404).send({
          message: { he: "לקוח ראשי לא נמצא", en: "Main customer not found" },
        });
      }

      const mainRivhitId = mainCustomer.externalCustomerId;
      const subRivhitIds = (mainCustomer.subCustomers || [])
        .map((s) => s.accounting?.externalCustomerId)
        .filter((id) => id != null);
      const customerIds = [mainRivhitId, ...subRivhitIds];
      grouped = await getCustomerDocumentsGrouped({
        customerIds,
        from,
        to: toDate,
      });
    } else {
      grouped = await getCustomerDocumentsGrouped({
        customerId,
        from,
        to: toDate,
      });
    }

    return res.send({
      customerId: Number(customerId),
      from: from || null,
      to: to || null,
      groups: grouped,
    });
  } catch (err) {
    console.log('err :>> ', err?.response?.data);
    console.error("getRivhitCustomerDocuments Error:", err.message);
    if (err.rivhit) {
      console.log("getRivhitCustomerDocuments Rivhit payload:", err.rivhit);
    }

    const status = err.status || 500;
    const message = extractRivhitErrorMessage(err, {
      en: "Internal error occurred, please try again later",
      he: "התרחשה שגיאה פנימית, אנא נסו שוב מאוחר יותר"
    });

    return res.status(status).send({ message });
  }
};

// הנפקת חשבונית מס קבלה על הזמנות בהקפה
async function manualIssueInvoiceReceipt(req, res) {
  try {
    const { orderIds, paymentMethodKey, notes, payments, issue_date, issue_time } = req.body;

    const result = await issueInvoiceReceiptForOrders({
      orderIds,
      paymentMethodKey,
      notes,
      payments,
      issue_date,
      issue_time,
    });

    return res.status(200).send({ ok: true, ...result });
  } catch (err) {
    console.log('err :>> ', err?.response?.data);
    console.error("manualIssueInvoiceReceipt error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(400).send({ ok: false, message });
  }
};

// הנפקת חשבונית מס רגילה על הזמנות ו/או תעודות החזרה מריווחית (ללא תשלום)
async function manualIssueInvoice(req, res) {
  try {
    const { orderIds, rivhitReturnNotes, rivhitCustomerId, notes, issue_date, issue_time } = req.body;

    const result = await issueInvoiceForOrders({
      orderIds,
      rivhitReturnNotes,
      rivhitCustomerId,
      notes,
      issue_date,
      issue_time,
    });

    return res.status(200).send({ ok: true, ...result });
  } catch (err) {
    console.log('err :>> ', err?.response?.data);
    console.error("manualIssueInvoice error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(400).send({ ok: false, message });
  }
};

// הנפקת קבלה על חשבונית מס קיימת (לא על חשבונית מס קבלה!)
async function manualIssueReceipt(req, res) {
  try {
    const {
      rivhitCustomerId,
      invoiceDocumentNumber,
      payments,
      paymentMethodKey,
      notes,
      issue_date,
      issue_time
    } = req.body;

    const result = await issueReceiptForInvoices({
      rivhitCustomerId,
      invoiceDocumentNumber,
      payments,
      paymentMethodKey,
      notes,
      issue_date,
      issue_time,
    });

    return res.status(200).send({ ok: true, ...result });
  } catch (err) {
    console.log('err :>> ', err?.response?.data);
    console.error("manualIssueReceipt error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(400).send({ ok: false, message });
  }
};

// הנפקת תעודת משלוח על הזמנה
async function manualIssueDeliveryNote(req, res) {
  try {
    const { orderId, notes, issue_date, issue_time } = req.body;

    const result = await issueDeliveryNoteForOrder({
      orderId,
      notes,
      issue_date,
      issue_time,
    });

    return res.status(200).send({ ok: true, ...result });
  } catch (err) {
    console.log('err :>> ', err?.response?.data);
    console.error("manualIssueDeliveryNote error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(400).send({ ok: false, message });
  }
};

// הנפקת תעודת-משלוח (מקף) — סוג מסמך נפרד בריווחית מתעודת משלוח רגילה
async function manualIssueDeliveryNoteHyphen(req, res) {
  try {
    const { orderId, notes, issue_date, issue_time } = req.body;

    const result = await issueDeliveryNoteHyphenForOrder({
      orderId,
      notes,
      issue_date,
      issue_time,
    });

    return res.status(200).send({ ok: true, ...result });
  } catch (err) {
    console.log("err :>> ", err?.response?.data);
    console.error("manualIssueDeliveryNoteHyphen error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(400).send({ ok: false, message });
  }
}

// הנפקת חשבונית מס זיכוי על חשבונית מס/חשבונית מס קבלה קיימת
async function manualIssueCreditInvoice(req, res) {
  try {
    const {
      rivhitCustomerId,
      invoiceDocumentNumber,
      amount,
      notes,
      issue_date,
      issue_time
    } = req.body;

    const result = await issueCreditInvoice({
      rivhitCustomerId,
      invoiceDocumentNumber,
      amount,
      notes,
      issue_date,
      issue_time,
    });

    return res.status(200).send({ ok: true, ...result });
  } catch (err) {
    console.log('err :>> ', err?.response?.data);
    console.error("manualIssueCreditInvoice error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(400).send({ ok: false, message });
  }
};

// הנפקת תעודת החזרה על הזמנה
async function manualIssueReturnNote(req, res) {
  try {
    const { orderId, notes, issue_date, issue_time } = req.body;

    const result = await issueReturnNoteForOrder({
      orderId,
      notes,
      issue_date,
      issue_time,
    });

    return res.status(200).send({ ok: true, ...result });
  } catch (err) {
    console.log("err :>> ", err?.response?.data);
    console.error("manualIssueReturnNote error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(400).send({ ok: false, message });
  }
}

// קבלת רשימת סוגי תשלום מריווחית
async function getPaymentTypes(req, res) {
  try {
    const resp = await paymentTypeList();

    if (resp.error_code && resp.error_code !== 0) {
      const message = {
        en: resp.client_message || resp.debug_message || "Failed to fetch payment types",
        he: resp.client_message || resp.debug_message || "שגיאה בשליפת סוגי תשלום מריווחית"
      };
      return res.status(resp.error_code === 401 ? 401 : 502).send({ message });
    }

    const paymentTypeListRes = resp?.data?.payment_type_list || [];
    return res.send(paymentTypeListRes);
  } catch (err) {
    console.log('err :>> ', err?.response?.data);
    console.error("getPaymentTypes error:", err.message);
    const message = extractRivhitErrorMessage(err);
    return res.status(500).send({ message });
  }
};

module.exports = {
  getRivhitCustomerDocuments,
  manualIssueInvoiceReceipt,
  manualIssueInvoice,
  manualIssueReceipt,
  manualIssueDeliveryNote,
  manualIssueDeliveryNoteHyphen,
  manualIssueCreditInvoice,
  manualIssueReturnNote,
  getPaymentTypes,
};