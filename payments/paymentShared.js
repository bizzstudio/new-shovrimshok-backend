// payments/paymentShared.js
// פונקציות משותפות לכל ספקי התשלום

/**
 * בניית snapshot של נתוני הלקוח לספק התשלום
 */
function buildCustomerSnapshot({ reqUser, customer }) {
  const fullName =
    (reqUser?.name && reqUser?.lastName)
      ? `${reqUser.name} ${reqUser.lastName}`
      : `${customer?.name || ""} ${customer?.lastName || ""}`.trim();

  return {
    fullName,
    firstName: reqUser?.name || customer?.name || "",
    lastName: reqUser?.lastName || customer?.lastName || "",
    phone: reqUser?.phone || customer?.phone || "",
    email: reqUser?.email || customer?.email || "",
  };
}

/**
 * בניית תיאור משלוח (כתובת מלאה)
 */
function buildShippingDescription({ reqBody, customer }) {
  const city = reqBody?.city?.city_name_he || reqBody?.user_info?.address?.city?.city_name_he || customer?.address?.city?.city_name_he || '';
  const street = reqBody?.street || reqBody?.user_info?.address?.street || customer?.address?.street || '';
  const house = reqBody?.houseNumber || reqBody?.user_info?.address?.houseNumber || customer?.address?.houseNumber || '';
  const apt = reqBody?.apartmentNumber || reqBody?.user_info?.address?.apartmentNumber || customer?.address?.apartmentNumber || '';

  return `משלוח ל${city}, ${street} ${house}${apt ? `/${apt}` : ''}`;
}

/**
 * בניית כתובת שורה ראשונה (עיר + רחוב + מספר בית)
 */
function buildAddressLine1({ reqBody, customer }) {
  const city = reqBody?.city?.city_name_he || reqBody?.user_info?.address?.city?.city_name_he || customer?.address?.city?.city_name_he || '';
  const street = reqBody?.street || reqBody?.user_info?.address?.street || customer?.address?.street || '';
  const house = reqBody?.houseNumber || reqBody?.user_info?.address?.houseNumber || customer?.address?.houseNumber || '';

  return `${city.trim()}, ${street ? `${street} ${house}`.trim() : ''}`;
}

/**
 * בניית כתובת שורה שנייה (דירה + קומה + קוד כניסה)
 */
function buildAddressLine2({ reqBody, customer }) {
  const apt = reqBody?.apartmentNumber || reqBody?.user_info?.address?.apartmentNumber || customer?.address?.apartmentNumber || '';
  const floor = reqBody?.floor || reqBody?.user_info?.address?.floor || customer?.address?.floor || '';
  const entryCode = reqBody?.entryCode || reqBody?.user_info?.address?.entryCode || customer?.address?.entryCode || '';

  const parts = [];
  if (apt) parts.push(`דירה ${apt}`);
  if (floor) parts.push(`קומה ${floor}`);
  if (entryCode) parts.push(`(קוד כניסה ${entryCode})`);

  return parts.join(' ');
}

/**
 * בניית אובייקט כתובת מלא (לשימוש ב-iCredit)
 */
function buildFullAddress({ reqBody, customer }) {
  const city = reqBody?.city?.city_name_he || reqBody?.user_info?.address?.city?.city_name_he || customer?.address?.city?.city_name_he || '';
  const street = reqBody?.street || reqBody?.user_info?.address?.street || customer?.address?.street || '';
  const house = reqBody?.houseNumber || reqBody?.user_info?.address?.houseNumber || customer?.address?.houseNumber || '';
  const apt = reqBody?.apartmentNumber || reqBody?.user_info?.address?.apartmentNumber || customer?.address?.apartmentNumber || '';
  const zipcode = reqBody?.postalCode || reqBody?.zipCode || reqBody?.user_info?.address?.postalCode || customer?.address?.postalCode || '';

  return {
    Address: street && house ? `${street} ${house}${apt ? `/${apt}` : ''}` : '',
    City: city,
    Zipcode: zipcode,
    Country: 'Israel',
  };
}

module.exports = {
  buildCustomerSnapshot,
  buildShippingDescription,
  buildAddressLine1,
  buildAddressLine2,
  buildFullAddress,
};