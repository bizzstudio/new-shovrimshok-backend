// config/auth.js
require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Status = require("../models/Status"); // הנח שאני מביא את המודל המתאים

const signInToken = (user, mainCustomer) => {
  return jwt.sign(
    {
      _id: user._id,
      name: user.name,
      lastName: user.lastName,
      email: user.email,
      address: user.address,
      phone: user.phone,
      image: user.image,
      role: user.role,
      isCashier: user.isCashier,
      priceList: mainCustomer?.priceList,
      paymentTerms: mainCustomer?.paymentTerms,
      creditLimit: user.creditLimit,
      unpaidBalance: user.unpaidBalance,
      availableCredit: user.availableCredit,
      customerType: mainCustomer?.customerType,
      companyNumber: mainCustomer?.companyNumber,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "14d", // 14 days
    }
  );
};

const tokenForVerify = (user) => {
  return jwt.sign(
    {
      _id: user._id,
      name: user.name,
      lastName: user.lastName,
      email: user.email,
      password: user.password,
      phone: user.phone,
    },
    process.env.JWT_SECRET_FOR_VERIFY,
    { expiresIn: "15m" }
  );
};

const isAuth = async (req, res, next) => {
  const { authorization } = req.headers;
  // console.log('authorization',authorization)
  try {
    const token = authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).send({
      // message: err.message,
      message: "ההזדהות נכשלה, יש להתנתק ולהתחבר לחשבונך מחדש.",
    });
  }
};

const isAdmin = async (req, res, next) => {
  const { authorization } = req.headers;
  try {
    const token = authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "Admin" && decoded.role !== "CEO") throw new Error("User is not Admin");
    const admin = await Admin.findOne({ email: decoded.email });
    if (!admin) throw new Error("User is not Admin");
    req.user = {
      _id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      iat: decoded.iat,
      exp: decoded.exp
    };
    next();
  } catch (err) {
    console.log(err)
    res.status(401).send({
      // message: err.message,
      message: "ההזדהות נכשלה, יש לצאת ולהכנס לחשבונך מחדש.",
    });
  }
};

const isApp = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const token = authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).send('Invalid or expired token');
  }
};

const loginApp = async (req, res) => {
  const { phone, password } = req.body;
  try {
    const melaket = await Status.findOne({ phone, password });
    if (!melaket) {
      return res.status(401).send("טלפון או סיסמה שגויים");
    }

    if (!melaket.isActive) {
      return res.status(403).send("מלקט לא פעיל!");
    }
    console.log(melaket.name + ` just log in to the App!`)

    const token = jwt.sign(
      {
        _id: melaket._id,
        isActive: melaket.isActive,
        name: melaket.name,
        heName: melaket.heName,
        phone: melaket.phone,
        color: melaket.color,
      },
      process.env.JWT_SECRET,
    );

    res.send({ token, melaketId: melaket._id });
  } catch (error) {
    res.status(500).send("Error logging in, please try again later");
  }
};

// Middleware: אימות שרת WhatsApp
const isWhatsappServer = async (req, res, next) => {
  try {
    // בדיקה אם המשתמש הוא אדמין
    const { authorization } = req.headers;
    if (authorization) {
      const token = authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role === "Admin" || decoded.role === "CEO") {
        // המשתמש הוא אדמין, מאפשר להמשיך
        req.user = decoded;
        return next();
      }
    }

    // אם לא אדמין, בדיקה של ה-API key
    const apiKey = req.headers["x-api-key"];
    if (!apiKey || apiKey !== process.env.KIRSHNER_WHATSAPP_API_KEY) {
      return res.status(403).send({
        success: false,
        message: "Unauthorized: Invalid WhatsApp API key",
      });
    }

    // אם ה-API key תקין, מאפשר להמשיך
    next();
  } catch (err) {
    console.error("Error in isWhatsappServer middleware:", err);
    res.status(401).send({
      success: false,
      message: "Unauthorized access",
    });
  }
};

const isCashier = async (req, res, next) => {
  const { authorization } = req.headers;
  try {
    const token = authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.isCashier) {
      throw new Error("User is not a cashier");
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.log(err);
    res.status(401).send({
      message: {
        he: "גישה נדחתה - רק קופאים מורשים יכולים לבצע פעולה זו.",
        en: "Access denied - only authorized cashiers can perform this action.",
      },
    });
  }
};

// חילוץ פרטי היוזר מהבקשה
const extractUserDetails = (req, res, next) => {
  const { authorization } = req.headers;
  try {
    const token = authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    req.user = {};
    next();
  }
};

/**
 * ברירת מחדל: אורח יכול לגשת לקטלוג (ללא מחירים ב-controller).
 * דורש JWT רק כש-STORE_REQUIRES_CUSTOMER_LOGIN=true (מפורש).
 */
const storeCustomerOrExtract = (req, res, next) => {
  const v = (process.env.STORE_REQUIRES_CUSTOMER_LOGIN || "")
    .toLowerCase()
    .trim();
  if (v === "true" || v === "1" || v === "yes" || v === "on") {
    return isAuth(req, res, next);
  }
  return extractUserDetails(req, res, next);
};

// יצירת טוקן זמני לשלב האימות הדו שלבי
const signTempMfaToken = (userId) => {
  return jwt.sign(
    { sub: String(userId), amr: 'pwd' }, // עבר סיסמה, מחכה לאימות (Authentication Method Reference)
    process.env.JWT_SECRET_MFA,
    { expiresIn: '10m' } // טוקן זמני לשלב MFA
  );
};

// יצירת טוקן חתום ל-30 יום
const signTrustedDeviceToken = (userId) => {
  return jwt.sign(
    { sub: String(userId), typ: 'trusted' },
    process.env.JWT_SECRET_TRUSTED,
    { expiresIn: '30d' }                            // לזכור מכשיר ל-30 יום
  );
};

// בדיקת טוקן חתום ל-30 יום
const verifyTrustedDeviceToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET_TRUSTED);
  } catch {
    return null;
  }
};

module.exports = {
  signInToken,
  tokenForVerify,
  isAuth,
  isAdmin,
  isApp,
  loginApp,
  isWhatsappServer,
  isCashier,
  extractUserDetails,
  storeCustomerOrExtract,
  signTempMfaToken,
  signTrustedDeviceToken,
  verifyTrustedDeviceToken,
};
