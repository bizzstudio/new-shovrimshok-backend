// services/rivhitCustomerService.js
const Customer = require("../models/Customer");
const { customerGet, customerNew } = require("../utils/rivhit");

// מחזיר מספר לקוח בריווחית (customer_id) ודואג לשמור אותו אצלך ב-DB
async function ensureRivhitCustomer(customerId) {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error("Customer not found");

  // 1) כבר מסונכרן
  if (customer.accounting?.externalCustomerId) {
    return Number(customer.accounting.externalCustomerId);
  }

  const email = (customer.email || "").toLowerCase().trim();
  if (!email) throw new Error("Customer missing email");

  // 2) נסה למצוא בריווחית לפי אימייל
  try {
    const found = await customerGet({ email });
    console.log('found :>> ', found);
    // התשובה: { error_code: 0, data: { customer_id: ... } } או { customer_id: ... }
    const rivhitId = Number(
      found?.data?.customer_id ||
      found?.customer_id ||
      found?.customerId ||
      0
    );
    if (rivhitId > 0) {
      customer.accounting = customer.accounting || {};
      customer.accounting.provider = "rivhit";
      customer.accounting.externalCustomerId = rivhitId;
      customer.accounting.syncedAt = new Date();
      customer.accounting.lastSyncError = undefined;
      await customer.save();
      return rivhitId;
    }
  } catch (e) {
    // Customer.Get מחזיר 204 אם לא נמצא - אצל axios זה יכול להיות שגיאה או לא תלוי שרת.
    // נתייחס "לא נמצא" כרגיל ונמשיך ליצירה.
  }

  // 3) לא נמצא - צור חדש (מינימום)
  const fallbackLastName = customer.lastName || customer.name || email;
  const fallbackFirstName = customer.name || email;

  const created = await customerNew({
    last_name: fallbackLastName,  // חובה בריווחית
    first_name: fallbackFirstName,
    vat_number: Number(customer.companyNumber),
    email,
    comments: "נוצר אוטומטית מהאתר",
  });

  // התשובה: { error_code: 0, data: { customer_id: ... } }
  const newId = Number(
    created?.data?.customer_id ||
    created?.customer_id ||
    0
  );
  if (!newId) {
    customer.accounting = customer.accounting || {};
    customer.accounting.lastSyncError = "Failed creating customer in Rivhit (no customer_id)";
    await customer.save();
    throw new Error("Failed creating customer in Rivhit");
  }

  customer.accounting = customer.accounting || {};
  customer.accounting.provider = "rivhit";
  customer.accounting.externalCustomerId = newId;
  customer.accounting.syncedAt = new Date();
  customer.accounting.lastSyncError = undefined;
  await customer.save();

  return newId;
}

module.exports = { ensureRivhitCustomer };