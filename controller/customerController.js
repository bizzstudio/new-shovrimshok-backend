// controller/customerController.js
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const Customer = require("../models/Customer");
const MainCustomer = require("../models/MainCustomer");
const Order = require("../models/Order");
const Application = require("../models/Application");
const Setting = require("../models/Setting");
const PriceList = require("../models/PriceList");
const { signInToken, tokenForVerify } = require("../config/auth");
const { sendEmail } = require("../lib/email-sender/sender");
const { getCustomerUnpaidBalance } = require("../services/orderServices");
const {
  customerRegisterBody,
} = require("../lib/email-sender/templates/register");
const {
  forgetPasswordEmailBody,
} = require("../lib/email-sender/templates/forget-password");
const { newApplicationBody } = require("../lib/email-sender/templates/new-application");

// פונקציה עזר לקבלת מחירון ברירת מחדל
const getDefaultPriceList = async () => {
  try {
    const defaultPriceList = await PriceList.findOne({ isDefault: true });
    return defaultPriceList ? defaultPriceList._id : null;
  } catch (error) {
    console.error('Error getting default price list:', error);
    return null;
  }
};

// פונקציה לבדיקת תקפות הטוקן
const validateToken = async (req, res) => {
  try {
    const { authorization } = req.headers;
    const token = authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.send(true);
  } catch (err) {
    console.error("validateToken error:", err.message);
    res.status(200).send(false);
  }
};

const verifyEmailAddress = async (req, res) => {
  try {
    const email = req.body.email.toLowerCase();
    console.log('verifyEmailAddress req.body: ', req.body);

    // שליפת כל תתי-הלקוחות (Customer) עם האימייל הזה
    const existingCustomers = await Customer.find({ email }).populate('mainCustomer');

    // האם יש תת-לקוח עם האימייל הזה שלא רשום עדיין (אורח)
    const existingGuest = existingCustomers.find(c => !c.isRegistered);

    if (existingGuest) {
      // קיים גם לקוח ראשי וגם תת-לקוח עם האימייל והוא לא רשום – מעדכנים אותו לרשום
      const existingCustomer = existingGuest;
      existingCustomer.isRegistered = true;
      existingCustomer.name = req.body.name;
      if (req.body.lastName) existingCustomer.lastName = req.body.lastName;
      if (req.body.phone) existingCustomer.phone = req.body.phone;
      if (req.body.password) {
        existingCustomer.password = bcrypt.hashSync(req.body.password);
      }

      // עדכון MainCustomer
      const mainCustomer = existingCustomer.mainCustomer;
      mainCustomer.customerType = 'casual';
      const defaultPriceListId = await getDefaultPriceList();
      if (defaultPriceListId) {
        mainCustomer.priceList = defaultPriceListId;
      }
      await mainCustomer.save();
      await existingCustomer.save();
      console.log('Updated existing guest customer to registered in verifyEmailAddress: ', existingCustomer.email);

      // שולחים token ומחזירים תשובה שההרשמה בוצעה בהצלחה
      const token = signInToken(existingCustomer, mainCustomer);
      const unpaidBalance = await getCustomerUnpaidBalance(existingCustomer._id);
      const availableCredit = (existingCustomer.creditLimit || 0) - unpaidBalance;
      return res.send({
        token,
        _id: existingCustomer._id,
        name: existingCustomer.name,
        lastName: existingCustomer.lastName,
        email: existingCustomer.email,
        phone: existingCustomer.phone,
        priceList: mainCustomer.priceList,
        paymentTerms: mainCustomer.paymentTerms,
        creditLimit: existingCustomer.creditLimit,
        customerType: mainCustomer.customerType,
        companyNumber: mainCustomer.companyNumber,
        institutionType: mainCustomer.institutionType,
        weeklyDeliveryDay: existingCustomer.weeklyDeliveryDay,
        unpaidBalance,
        availableCredit,
        message: "ההרשמה בוצעה בהצלחה, ברוכים הבאים!",
        keyWord: "customerRegistered",
      });
    }

    // יש תת-לקוח/ים עם האימייל וכולם רשומים – האימייל תפוס
    if (existingCustomers.length > 0) {
      return res.status(403).send({
        message: "האימייל כבר רשום במערכת!",
      });
    }

    // אין תת-לקוח עם האימייל – בודקים אם יש לקוח ראשי עם האימייל (בלי תת-לקוח לא רשום)
    const mainCustomerWithEmail = await MainCustomer.findOne({ email });
    if (mainCustomerWithEmail) {
      return res.status(403).send({
        message: "האימייל כבר קיים במערכת!",
      });
    }

    // אין לקוח ראשי ולא תת-לקוח עם האימייל – ממשיכים עם הרשמה חדשה (שליחת אימייל אימות)
    const token = tokenForVerify(req.body);
    const option = {
      name: req.body.name,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone,
      token: token,
    };
    const body = {
      from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
      to: `${req.body.email}`,
      subject: "אימות האימייל שלך",
      html: customerRegisterBody(option),
    };

    const message = "הרשמתך בוצעה בהצלחה. נא לגשת לתיבת האימייל שלך לבצע אימות הרשמה. במידה ולא קיבלת אימייל נא לבדוק בתיבת הספאם";
    sendEmail(body, res, message);
  } catch (error) {
    console.error('Error verifying email: ', error);
    if (!res.headersSent) {
      res.status(500).send({
        message: "התרחשה שגיאה, אנא נסו מאוחר יותר",
      });
    }
  }
};

const registerCustomer = async (req, res) => {
  const token = req.params.token;
  const { name, lastName, email, password, phone } = jwt.decode(token);
  console.log('name: ', name)
  console.log('lastName: ', lastName)
  console.log('email: ', email)
  console.log('password: ', password)
  console.log('phone: ', phone)
  const isAdded = await Customer.findOne({ email: email }).populate('mainCustomer');

  if (isAdded) {
    const token = signInToken(isAdded, isAdded.mainCustomer);
    const unpaidBalance = await getCustomerUnpaidBalance(isAdded._id);
    const availableCredit = (isAdded.creditLimit || 0) - unpaidBalance;
    return res.send({
      token,
      _id: isAdded._id,
      name: isAdded.name,
      lastName: isAdded.lastName,
      email: isAdded.email,
      phone: isAdded.phone,
      priceList: isAdded.mainCustomer.priceList,
      paymentTerms: isAdded.mainCustomer.paymentTerms,
      creditLimit: isAdded.creditLimit,
      customerType: isAdded.mainCustomer.customerType,
      companyNumber: isAdded.mainCustomer.companyNumber,
      institutionType: isAdded.mainCustomer.institutionType,
      weeklyDeliveryDay: isAdded.weeklyDeliveryDay,
      unpaidBalance,
      availableCredit,
      message: "האימייל כבר אומת",
    });
  }

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET_FOR_VERIFY, async (err, decoded) => {
      if (err) {
        return res.status(401).send({
          message: "פג תוקף הבקשה, אנא נסה שוב",
        });
      } else {
        const existingUser = await Customer.findOne({ email });
        if (existingUser) {
          return res.status(400).send({
            message: "האימייל כבר קיים במערכת",
          });
        }

        // קבלת מחירון ברירת מחדל
        const defaultPriceListId = await getDefaultPriceList();

        // יצירת MainCustomer
        const newMainCustomer = new MainCustomer({
          name,
          email,
          phone,
          customerType: 'casual',
          priceList: defaultPriceListId,
        });

        // יצירת Customer
        const newUser = new Customer({
          name,
          lastName,
          email,
          phone,
          password: bcrypt.hashSync(password),
          isRegistered: true,
          mainCustomer: newMainCustomer._id,
        });

        try {
          await newMainCustomer.save();
          await newUser.save();

          // עדכון MainCustomer.subCustomers
          newMainCustomer.subCustomers = [newUser._id];
          await newMainCustomer.save();

          console.log('newUser: ', newUser)
          const token = signInToken(newUser, newMainCustomer);
          const unpaidBalance = await getCustomerUnpaidBalance(newUser._id);
          const availableCredit = (newUser.creditLimit || 0) - unpaidBalance;
          res.send({
            token,
            _id: newUser._id,
            name: newUser.name,
            lastName: newUser.lastName,
            email: newUser.email,
            phone: newUser.phone,
            priceList: newMainCustomer.priceList,
            paymentTerms: newMainCustomer.paymentTerms,
            creditLimit: newUser.creditLimit,
            customerType: newMainCustomer.customerType,
            companyNumber: newMainCustomer.companyNumber,
            institutionType: newMainCustomer.institutionType,
            weeklyDeliveryDay: newUser.weeklyDeliveryDay,
            unpaidBalance,
            availableCredit,
            message: "האימייל אומת, אפשר להתחבר עכשיו!",
          });
        } catch (error) {
          console.error('Error registering customer: ', error);
          return res.status(500).send({
            message: "התרחשה שגיאה בעת שמירת המשתמש החדש",
          });
        }
      }
    });
  }
};

const addAllCustomers = async (req, res) => {
  try {
    await Customer.deleteMany();
    await Customer.insertMany(req.body);
    res.send({
      message: "Added all users successfully!",
    });
  } catch (err) {
    console.log('addAllCustomers error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const loginCustomer = async (req, res) => {
  try {
    const { registerEmail, password, rivhitCustomerNumber } = req.body;

    const email =
      typeof registerEmail === "string"
        ? registerEmail.trim().toLowerCase()
        : "";

    if (!email || !password) {
      return res.status(400).send({
        message: "נא למלא אימייל וסיסמה",
      });
    }

    // חיפוש אימייל ללא תלות ברישיות (קלט מנורמל + תאימות לנתונים ישנים ב-DB)
    const emailEscaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const customers = await Customer.find({
      email: new RegExp(`^${emailEscaped}$`, "i"),
    }).populate("mainCustomer");

    if (!customers || customers.length === 0) {
      return res.status(401).send({
        message: "אימייל או סיסמה שגויים",
      });
    }

    // סינון לקוחות עם סיסמה תואמת
    const matchingCustomers = customers.filter(c =>
      c.password && bcrypt.compareSync(password, c.password)
    );

    if (matchingCustomers.length === 0) {
      return res.status(401).send({
        message: "אימייל או סיסמה שגויים",
      });
    }

    const rivhitRaw =
      rivhitCustomerNumber != null && rivhitCustomerNumber !== ""
        ? String(rivhitCustomerNumber).trim()
        : "";

    const sendLoginSuccess = async (customer) => {
      const token = signInToken(customer, customer.mainCustomer);
      const unpaidBalance = await getCustomerUnpaidBalance(customer._id);
      const availableCredit = (customer.creditLimit || 0) - unpaidBalance;
      return res.send({
        token,
        _id: customer._id,
        name: customer.name,
        lastName: customer.lastName,
        email: customer.email,
        address: customer.address,
        phone: customer.phone,
        image: customer.image,
        priceList: customer.mainCustomer.priceList,
        paymentTerms: customer.mainCustomer.paymentTerms,
        creditLimit: customer.creditLimit,
        customerType: customer.mainCustomer.customerType,
        companyNumber: customer.mainCustomer.companyNumber,
        institutionType: customer.mainCustomer.institutionType,
        weeklyDeliveryDay: customer.weeklyDeliveryDay,
        unpaidBalance,
        availableCredit,
        ...(customer.isCashier ? { isCashier: customer.isCashier } : {}),
      });
    };

    // אם נשלח מספר לקוח בריווחית (לא ריק) — בחירת פרופיל עסקי
    if (rivhitRaw !== "") {
      const rivhitNum = Number(rivhitRaw);
      if (Number.isNaN(rivhitNum)) {
        return res.status(401).send({
          message: "מספר לקוח בריווחית לא תקין",
        });
      }

      const customer = matchingCustomers.find(
        (c) =>
          c.accounting?.externalCustomerId != null &&
          Number(c.accounting.externalCustomerId) === rivhitNum
      );

      if (customer) {
        return await sendLoginSuccess(customer);
      }

      // כניסה עסקית אבל יש רק חשבון אחד בלי מזהה ריווחית — מתייחסים כמו כניסה רגילה
      if (
        matchingCustomers.length === 1 &&
        matchingCustomers[0].accounting?.externalCustomerId == null
      ) {
        return await sendLoginSuccess(matchingCustomers[0]);
      }

      return res.status(401).send({
        message: "מספר לקוח בריווחית לא תואם",
      });
    }

    // לוגין רגיל (ללא מספר ריווחית)
    if (matchingCustomers.length > 1) {
      // שגיאה: אותו אימייל לכמה לקוחות רגילים
      return res.status(409).send({
        message: "נמצאו מספר חשבונות עם אימייל זה. אם הנך לקוח עסקי/מוסדי אנא התחבר באמצעות מספר לקוח בריווחית. אחרת פנה לתמיכה.",
      });
    }

    return await sendLoginSuccess(matchingCustomers[0]);
  } catch (err) {
    console.log('loginCustomer error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

// קבלת מידע עדכני של הלקוח המחובר
const getCurrentCustomer = async (req, res) => {
  try {
    // req.user מגיע מה-middleware isAuth
    const customer = await Customer.findById(req.user._id).populate('mainCustomer');

    if (!customer) {
      return res.status(404).send({
        message: "משתמש לא נמצא",
      });
    }

    const unpaidBalance = await getCustomerUnpaidBalance(customer._id);
    const availableCredit = (customer.creditLimit || 0) - unpaidBalance;
    customer.unpaidBalance = unpaidBalance;
    customer.availableCredit = availableCredit;

    // יצירת טוקן חדש כדי לרענן את תוקף ההתחברות
    const token = signInToken(customer, customer.mainCustomer);

    res.send({
      token,
      _id: customer._id,
      name: customer.name,
      lastName: customer.lastName,
      email: customer.email,
      address: customer.address,
      phone: customer.phone,
      image: customer.image,
      priceList: customer.mainCustomer.priceList,
      paymentTerms: customer.mainCustomer.paymentTerms,
      creditLimit: customer.creditLimit,
      customerType: customer.mainCustomer.customerType,
      companyNumber: customer.mainCustomer.companyNumber,
      institutionType: customer.mainCustomer.institutionType,
      weeklyDeliveryDay: customer.weeklyDeliveryDay,
      unpaidBalance,
      availableCredit,
      ...(customer.isCashier ? { isCashier: customer.isCashier } : {})
    });
  } catch (err) {
    console.log('getCurrentCustomer error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const forgetPassword = async (req, res) => {
  try {
    const { verifyEmail, rivhitCustomerNumber } = req.body;

    // חיפוש כל הלקוחות עם האימייל
    const customers = await Customer.find({ email: verifyEmail.toLowerCase() });

    if (!customers || customers.length === 0) {
      return res.status(404).send({
        message: "לא נמצא משתמש עם אימייל כזה",
      });
    }

    let customer;

    // אם נשלח מספר לקוח בריווחית - זה לקוח עיסקי/מוסדי
    if (rivhitCustomerNumber) {
      const rivhitNum = Number(rivhitCustomerNumber);
      customer = customers.find(c =>
        c.accounting?.externalCustomerId === rivhitNum
      );

      if (!customer) {
        return res.status(404).send({
          message: "מספר לקוח בריווחית לא תואם",
        });
      }
    } else {
      // לוגין רגיל (ללא מספר ריווחית)
      if (customers.length > 1) {
        // שגיאה: אותו אימייל לכמה לקוחות
        return res.status(409).send({
          message: "נמצאו מספר חשבונות עם אימייל זה. אם הנך לקוח עסקי/מוסדי אנא הזן את מספר הלקוח בריווחית. אחרת פנה לתמיכה.",
        });
      }
      customer = customers[0];
    }

    // יצירת טוקן עם ה-ID של הלקוח כדי לזהות אותו במדויק
    const token = tokenForVerify({
      _id: customer._id,
      email: customer.email,
      name: customer.name,
      lastName: customer.lastName,
    });

    const option = {
      name: customer.name,
      lastName: customer.lastName || '',
      email: customer.email,
      token: token,
    };

    const body = {
      from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
      to: `${customer.email}`,
      subject: "הסיסמה אופסה",
      html: forgetPasswordEmailBody(option),
    };

    const message = "זה הצליח! יש לבדוק את חשבון האימייל כדי לאפס את הסיסמה";
    sendEmail(body, res, message);
  } catch (err) {
    console.log('forgetPassword error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const token = req.body.token;

    if (!token) {
      return res.status(400).send({
        message: "הקישור אינו תקין או פג תוקף",
      });
    }

    const decoded = jwt.decode(token);
    const { _id, email } = decoded;

    // חיפוש לפי _id כדי לזהות את הלקוח המדויק
    const customer = await Customer.findById(_id);

    if (!customer) {
      return res.status(404).send({
        message: "לא נמצא משתמש",
      });
    }

    // וידוא שהאימייל תואם (בטיחות נוספת)
    if (customer.email !== email.toLowerCase()) {
      return res.status(403).send({
        message: "הקישור אינו תקין או פג תוקף",
      });
    }

    jwt.verify(token, process.env.JWT_SECRET_FOR_VERIFY, async (err, verified) => {
      if (err) {
        console.log('resetPassword error: ', err);
        return res.status(401).send({
          message: "פג תוקף הבקשה, אנא נסה שוב",
        });
      } else {
        customer.password = bcrypt.hashSync(req.body.newPassword);
        await customer.save();
        res.send({
          message: "הסיסמה הוחלפה בהצלחה, אפשר להתחבר עכשיו!",
        });
      }
    });
  } catch (err) {
    console.log('resetPassword error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

// שינוי סיסמה על ידי הלקוח
const changePassword = async (req, res) => {
  try {
    // שימוש ב-_id מ-req.user כדי למצוא את הלקוח המדויק (req.user מגיע מה-isAuth middleware)
    const customer = await Customer.findById(req.user._id);

    if (!customer) {
      return res.status(404).send({
        message: "משתמש לא נמצא",
      });
    }

    // בדיקת הרשאות - וידוא שהלקוח המחובר הוא אכן הלקוח שמבצע את השינוי
    if (req.user._id.toString() !== customer._id.toString()) {
      return res.status(403).send({
        message: "You are not authorized to change this password!",
      });
    }

    if (!customer.password) {
      return res.send({
        message: "כדי לשנות סיסמה - יש להתחבר עם אימייל וסיסמה",
      });
    }

    // בדיקת הסיסמה הנוכחית
    if (!bcrypt.compareSync(req.body.currentPassword, customer.password)) {
      return res.status(401).send({
        message: "הסיסמה הנוכחית שגויה!",
      });
    }

    // עדכון הסיסמה
    customer.password = bcrypt.hashSync(req.body.newPassword);
    await customer.save();

    res.send({
      message: "הסיסמה שונתה בהצלחה!",
    });
  } catch (err) {
    console.log('changePassword error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

// הרשמה/התחברות עם גוגל
const signUpWithProvider = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).send({
        message: {
          en: "An error occurred while logging in with Google, please try again later",
          he: "התרחשה שגיאה בכניסה עם גוגל, נסו שוב מאוחר יותר"
        }
      });
    }

    // קבלת google_client_id מה-Setting
    const storeSetting = await Setting.findOne({ name: "storeSetting" });
    if (!storeSetting || !storeSetting.setting?.google_client_id) {
      console.error("An error occurred while logging in with Google");
      console.error("googleClientId :>> ", storeSetting.setting?.google_client_id);
      return res.status(500).send({
        message: {
          en: "An error occurred while logging in with Google, please try again later",
          he: "התרחשה שגיאה בכניסה עם גוגל, נסו שוב מאוחר יותר"
        }
      });
    }

    const googleClientId = storeSetting.setting.google_client_id;

    // אימות הטוקן מגוגל
    const client = new OAuth2Client(googleClientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();
    const email = payload.email.toLowerCase();
    const name = payload.given_name || payload.name || '';
    const lastName = payload.family_name || '';
    const picture = payload.picture || '';

    // שליפת כל תתי-הלקוחות (Customer) עם האימייל הזה
    const existingCustomers = await Customer.find({ email }).populate('mainCustomer');

    // "לקוח רגיל" = תת-לקוח שהלקוח הראשי שלו עם אותו אימייל (רק הוא רשאי להתחבר עם גוגל)
    const regularCustomer = existingCustomers.find(c =>
      c.mainCustomer && String(c.mainCustomer.email || '').toLowerCase() === email
    );

    if (regularCustomer) {
      // יש תת-לקוח עם האימייל והלקוח הראשי שלו עם אותו אימייל – ממשיכים (התחברות או שדרוג אורח)
      const existingCustomer = regularCustomer;
      if (!existingCustomer.isRegistered) {
        existingCustomer.isRegistered = true;
        // מעדכנים פרטים נוספים אם קיימים
        if (name) existingCustomer.name = name;
        if (lastName) existingCustomer.lastName = lastName;
        if (picture) existingCustomer.image = picture;

        // עדכון MainCustomer
        const mainCustomer = existingCustomer.mainCustomer;
        mainCustomer.customerType = 'casual';
        const defaultPriceListId = await getDefaultPriceList();
        if (defaultPriceListId) {
          mainCustomer.priceList = defaultPriceListId;
        }

        await mainCustomer.save();
        await existingCustomer.save();
        console.log('Updated existing guest customer to registered via provider: ', existingCustomer._id);
      }

      const token = signInToken(existingCustomer, existingCustomer.mainCustomer);
      const unpaidBalance = await getCustomerUnpaidBalance(existingCustomer._id);
      const availableCredit = (existingCustomer.creditLimit || 0) - unpaidBalance;
      return res.send({
        token,
        _id: existingCustomer._id,
        name: existingCustomer.name,
        lastName: existingCustomer.lastName,
        email: existingCustomer.email,
        address: existingCustomer.address,
        phone: existingCustomer.phone,
        image: existingCustomer.image,
        priceList: existingCustomer.mainCustomer.priceList,
        paymentTerms: existingCustomer.mainCustomer.paymentTerms,
        creditLimit: existingCustomer.creditLimit,
        customerType: existingCustomer.mainCustomer.customerType,
        companyNumber: existingCustomer.mainCustomer.companyNumber,
        institutionType: existingCustomer.mainCustomer.institutionType,
        weeklyDeliveryDay: existingCustomer.weeklyDeliveryDay,
        unpaidBalance,
        availableCredit,
        ...(existingCustomer.isCashier ? { isCashier: existingCustomer.isCashier } : {})
      });
    }

    // יש תת-לקוח/ים עם האימייל אבל כולם תחת לקוח ראשי עם אימייל אחר (עסקי/מוסדי) – שגיאה
    if (existingCustomers.length > 0) {
      return res.status(409).send({
        message: {
          en: "Multiple accounts found with this email. Please use business/institutional login or contact support.",
          he: "נמצאו מספר חשבונות עם אימייל זה. אנא השתמשו בהתחברות ללקוחות עיסקיים/מוסדיים או פנו לתמיכה."
        }
      });
    }

    // אין תת-לקוח עם האימייל – בודקים אם יש לקוח ראשי עם האימייל (בלי תת-לקוח תואם)
    const mainCustomerWithEmail = await MainCustomer.findOne({ email });
    if (mainCustomerWithEmail) {
      return res.status(403).send({
        message: {
          en: "Multiple accounts found with this email. Please use business/institutional login or contact support.",
          he: "נמצאו מספר חשבונות עם אימייל זה. אנא השתמשו בהתחברות ללקוחות עיסקיים/מוסדיים או פנו לתמיכה."
        }
      });
    }

    // אם הלקוח לא קיים - יוצרים לקוח חדש רשום
    // קבלת מחירון ברירת מחדל
    const defaultPriceListId = await getDefaultPriceList();

    // יצירת MainCustomer
    const newMainCustomer = new MainCustomer({
      name: name,
      email: email,
      phone: '',
      customerType: 'casual',
      priceList: defaultPriceListId,
    });

    // יצירת Customer
    const newUser = new Customer({
      name: name,
      lastName: lastName || '',
      email: email,
      image: picture,
      isRegistered: true,
      mainCustomer: newMainCustomer._id,
    });

    await newMainCustomer.save();
    const signUpCustomer = await newUser.save();

    // עדכון MainCustomer.subCustomers
    newMainCustomer.subCustomers = [signUpCustomer._id];
    await newMainCustomer.save();

    console.log('Created new registered customer via provider: ', signUpCustomer.email);
    const token = signInToken(signUpCustomer, newMainCustomer);
    const unpaidBalance = await getCustomerUnpaidBalance(signUpCustomer._id);
    const availableCredit = (signUpCustomer.creditLimit || 0) - unpaidBalance;
    res.send({
      token,
      _id: signUpCustomer._id,
      name: signUpCustomer.name,
      lastName: signUpCustomer.lastName,
      email: signUpCustomer.email,
      image: signUpCustomer.image,
      priceList: newMainCustomer.priceList,
      paymentTerms: newMainCustomer.paymentTerms,
      creditLimit: signUpCustomer.creditLimit,
      customerType: newMainCustomer.customerType,
      companyNumber: newMainCustomer.companyNumber,
      institutionType: newMainCustomer.institutionType,
      weeklyDeliveryDay: signUpCustomer.weeklyDeliveryDay,
      unpaidBalance,
      availableCredit,
    });
  } catch (err) {
    console.log('signUpWithProvider error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getAllCustomers = async (req, res) => {
  try {
    const users = await Customer.find({}).populate('mainCustomer');
    users.sort((a, b) => {
      const isANameHebrew = /^[\u0590-\u05FF]+$/.test(a.name);
      const isBNameHebrew = /^[\u0590-\u05FF]+$/.test(b.name);

      if (isANameHebrew && !isBNameHebrew) return -1;
      if (!isANameHebrew && isBNameHebrew) return 1;
      return a.name.localeCompare(b.name);
    });
    res.send(users);
  } catch (err) {
    console.log('getAllCustomers error: ', err);
    res.status(500).send({ message: err.message });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate('mainCustomer');
    const unpaidBalance = await getCustomerUnpaidBalance(customer._id);
    const availableCredit = (customer.creditLimit || 0) - unpaidBalance;

    // שליפת כל ההזמנות של הלקוח עם populate
    const orders = await Order.find({ user: customer._id })
      .select('-cart')
      .populate({ path: "status" })
      .populate({ path: "user_info.priceList" })
      .populate({ path: "coupon" })
      .populate({ path: "actualMelaket" })
      .sort({ _id: -1 });

    res.send({
      ...customer.toObject(),
      unpaidBalance,
      availableCredit,
      orders
    });
  } catch (err) {
    console.log('getCustomerById error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

// עדכון לקוח עצמי (שדות בסיסיים)
const updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate('mainCustomer');
    if (customer) {
      // בדיקת הרשאות - רק הלקוח עצמו יכול לעדכן את עצמו
      if (req?.user?.email !== customer.email) {
        return res.status(403).send({
          message: "You are not authorized to update this customer!",
        });
      }

      // לקוח יכול לעדכן רק את השדות הבסיסיים הבאים:
      customer.name = req.body.name;
      customer.lastName = req.body.lastName;
      customer.email = req.body.email;
      customer.address = req.body.address;
      customer.phone = req.body.phone;
      customer.image = req.body.image;
      const updatedUser = await customer.save();
      const token = signInToken(updatedUser, customer.mainCustomer);
      const unpaidBalance = await getCustomerUnpaidBalance(updatedUser._id);
      const availableCredit = (updatedUser.creditLimit || 0) - unpaidBalance;
      res.send({
        token,
        _id: updatedUser._id,
        name: updatedUser.name,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        address: updatedUser.address,
        phone: updatedUser.phone,
        image: updatedUser.image,
        isCashier: updatedUser.isCashier,
        priceList: customer.mainCustomer.priceList,
        paymentTerms: customer.mainCustomer.paymentTerms,
        creditLimit: updatedUser.creditLimit,
        customerType: customer.mainCustomer.customerType,
        companyNumber: customer.mainCustomer.companyNumber,
        institutionType: customer.mainCustomer.institutionType,
        weeklyDeliveryDay: updatedUser.weeklyDeliveryDay,
        unpaidBalance,
        availableCredit,
        message: "Customer Updated Successfully!",
      });
    }
  } catch (err) {
    console.log('updateCustomer error: ', err);
    res.status(404).send({
      message: "Your email is not valid!",
    });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (customer) {
      if (req?.user?.email !== customer.email && req?.user?.role !== "Admin" && req?.user?.role !== "CEO") {
        return res.status(403).send({
          message: "You are not authorized to delete this customer!",
        });
      }
    }

    await Customer.deleteOne({ _id: req.params.id });
    res.status(200).send({
      message: "המשתמש נמחק בהצלחה!",
    });
  } catch (err) {
    console.log('deleteCustomer error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

// הוספת לקוח לרשימה השחורה - לא מקבל הודעות סקר בוואטסאפ
const addToBlackListByPhone = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).send({
        message: "Please send a phone number to update the blacklist",
      });
    }

    // ניקוי הספרות מהמספר (הורדת מקפים, רווחים, וכו')
    const cleanedPhone = phone.replace(/[^0-9]/g, "");

    // גרסאות שונות של המספר לבדיקה
    const variations = [
      cleanedPhone,
      "972" + cleanedPhone.slice(-9),
      "+972" + cleanedPhone.slice(-9),
    ];

    // חיפוש לפי אחת האפשרויות
    const updatedCustomer = await Customer.findOneAndUpdate(
      { phone: { $in: variations } },     // תנאי החיפוש
      { $set: { inBlackList: true } },    // העדכון
      { new: true }                       // החזרה של המסמך המעודכן
    );

    if (!updatedCustomer) {
      return res.status(404).send({
        message: "No customer found with the requested phone number",
      });
    }

    return res.send({
      message: "Customer successfully added to the blacklist",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Error adding to blacklist:", error);
    if (!res.headersSent) {
      res.status(500).send({
        message: "An error occurred, please try again later",
      });
    }
  }
};

// החלפת לקוח לקופאי/לקוח רגיל
const toggleCustomerCashier = async (req, res) => {
  try {
    const { id } = req.params;
    const isCashier = req.body.isCashier;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).send({
        message: "Customer not found",
      });
    }

    customer.isCashier = isCashier;
    await customer.save();

    const message = isCashier ? {
      en: "Customer is now a cashier",
      he: "הלקוח שונה לקופאי"
    } : {
      en: "Customer is now a regular customer",
      he: "הקופאי שונה ללקוח רגיל"
    };

    console.log(customer.name + " " + message.en)

    const unpaidBalance = await getCustomerUnpaidBalance(customer._id);
    const availableCredit = (customer.creditLimit || 0) - unpaidBalance;
    res.send({
      message,
      customer: {
        ...customer.toObject(),
        unpaidBalance,
        availableCredit
      },
    });
  } catch (error) {
    console.error("Error toggling customer cashier:", error);
  }
};

// contact-us
const contactUs = async (req, res) => {
  try {
    // Get application data from request body
    const {
      message,
      name,
      email,
      subject
    } = req.body;

    // Validate required fields
    if (!message || !name || !email || !subject) {
      return res.status(400).send({
        message: {
          en: "Please fill all required fields",
          he: "אנא מלא את כל השדות הנדרשים"
        }
      });
    }

    // Create new application
    const newApplication = new Application({
      message,
      name,
      email,
      subject,
    });

    // Save application to database
    const savedApplication = await newApplication.save();

    // Prepare email to admin
    const option = {
      message,
      name,
      email,
      subject,
    };

    const to = [process.env.EMAIL_USER, process.env.OUR_EMAIL];

    if (process.env.NODE_ENV === "development") {
      to.push("israelbenari1000@gmail.com");
    }

    const body = {
      from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: `פנייה חדשה מאת ${name} - ${subject}`,
      html: newApplicationBody(option)
    };

    // Send email to admin
    const response = {
      en: "Your message has been sent successfully. We will contact you soon.",
      he: "הודעתך נשלחה בהצלחה. ניצור איתך קשר בהקדם."
    };

    sendEmail(body, res, response);

  } catch (err) {
    console.error("contactUs error:", err);
    if (!res.headersSent) {
      res.status(500).send({
        message: {
          en: "An error occurred while processing your request",
          he: "אירעה שגיאה בעת עיבוד הבקשה שלך"
        }
      });
    }
  }
};

// Middleware: יצירת/עדכון לקוח אורח לפני יצירת הזמנה
const createGuestCustomer = async (req, res, next) => {
  try {
    const {
      name,
      lastName,
      email,
      phone,
      city,
      street,
      houseNumber,
      apartmentNumber,
      floor,
      entryCode,
      postalCode
    } = req.body;

    // בדיקת שדות חובה
    if (!name || !lastName || !email || !phone || !city || !street || !houseNumber || !apartmentNumber) {
      return res.status(400).send({
        message: "נא להזין את כל השדות החובה",
      });
    }

    const emailLower = email.toLowerCase();

    // שליפת כל תתי-הלקוחות (Customer) עם האימייל הזה
    const existingCustomers = await Customer.find({ email: emailLower }).populate('mainCustomer');

    // האם יש תת-לקוח עם האימייל הזה שלא רשום עדיין (אורח)
    const existingGuest = existingCustomers.find(c => !c.isRegistered);

    if (existingGuest) {
      // קיים תת-לקוח לא רשום – מעדכנים את הפרטים וממשיכים
      const existingCustomer = existingGuest;
      existingCustomer.name = name;
      if (lastName) existingCustomer.lastName = lastName;
      if (phone) existingCustomer.phone = phone;

      // עדכון כתובת
      if (city) existingCustomer.address.city = city;
      if (street) existingCustomer.address.street = street;
      if (houseNumber) existingCustomer.address.houseNumber = houseNumber;
      if (apartmentNumber) existingCustomer.address.apartmentNumber = apartmentNumber;
      if (floor) existingCustomer.address.floor = floor;
      if (entryCode) existingCustomer.address.entryCode = entryCode;
      if (postalCode) existingCustomer.address.postalCode = postalCode;

      // עדכון MainCustomer
      const mainCustomer = existingCustomer.mainCustomer;
      if (name) mainCustomer.name = name;
      if (email) mainCustomer.email = emailLower;
      if (phone) mainCustomer.phone = phone;

      await mainCustomer.save();
      await existingCustomer.save();

      // הוספת פרטי הלקוח ל-req.user בדומה ל-isAuth
      req.user = {
        _id: existingCustomer._id,
        name: existingCustomer.name,
        lastName: existingCustomer.lastName,
        email: existingCustomer.email,
        address: existingCustomer.address,
        phone: existingCustomer.phone,
        image: existingCustomer.image,
        isCashier: existingCustomer.isCashier,
        priceList: mainCustomer.priceList,
        paymentTerms: mainCustomer.paymentTerms,
        creditLimit: existingCustomer.creditLimit,
        customerType: mainCustomer.customerType,
        companyNumber: mainCustomer.companyNumber,
      };

      console.log('createGuestCustomer user updated :>> ', req.user);

      return next();
    }

    // יש תת-לקוח/ים עם האימייל וכולם רשומים – האימייל תפוס
    if (existingCustomers.length > 0) {
      return res.status(409).send({
        keyWord: "customerAlreadyRegistered",
        message: "האימייל כבר רשום במערכת. יש להתחבר לפני הרכישה באמצעות סיסמה או עם גוגל.",
      });
    }

    // אין תת-לקוח עם האימייל – בודקים אם יש לקוח ראשי עם האימייל
    const mainCustomerWithEmail = await MainCustomer.findOne({ email: emailLower });
    if (mainCustomerWithEmail) {
      return res.status(409).send({
        keyWord: "customerAlreadyRegistered",
        message: "האימייל כבר רשום במערכת. יש להתחבר לפני הרכישה באמצעות סיסמה או עם גוגל.",
      });
    }

    // יצירת לקוח חדש (לא רשום)
    // קבלת מחירון ברירת מחדל
    const defaultPriceListId = await getDefaultPriceList();

    // יצירת MainCustomer
    const newMainCustomer = new MainCustomer({
      name,
      email: emailLower,
      phone: phone || "",
      customerType: 'casual',
      priceList: defaultPriceListId,
    });

    // יצירת Customer
    const newCustomer = new Customer({
      name,
      lastName: lastName || "",
      email: emailLower,
      phone: phone || "",
      address: {
        city: city || {},
        street: street || "",
        houseNumber: houseNumber || "",
        apartmentNumber: apartmentNumber || "",
        floor: floor || "",
        entryCode: entryCode || "",
        postalCode: postalCode || "",
      },
      isRegistered: false,
      mainCustomer: newMainCustomer._id,
    });

    await newMainCustomer.save();
    await newCustomer.save();

    // עדכון MainCustomer.subCustomers
    newMainCustomer.subCustomers = [newCustomer._id];
    await newMainCustomer.save();

    // הוספת פרטי הלקוח ל-req.user בדומה ל-isAuth
    req.user = {
      _id: newCustomer._id,
      name: newCustomer.name,
      lastName: newCustomer.lastName,
      email: newCustomer.email,
      address: newCustomer.address,
      phone: newCustomer.phone,
      image: newCustomer.image,
      isCashier: newCustomer.isCashier,
      priceList: newMainCustomer.priceList,
      paymentTerms: newMainCustomer.paymentTerms,
      creditLimit: newCustomer.creditLimit,
      customerType: newMainCustomer.customerType,
      companyNumber: newMainCustomer.companyNumber,
    };

    console.log('createGuestCustomer user created :>> ', req.user);

    next();
  } catch (err) {
    console.error("Error in createGuestCustomer middleware:", err);
    res.status(500).send({
      message: "שגיאה ביצירת ההזמנה, אנא נסו שוב מאוחר יותר או פנו לשירות הלקוחות שלנו.",
    });
  }
};

module.exports = {
  getDefaultPriceList,
  loginCustomer,
  getCurrentCustomer,
  registerCustomer,
  addAllCustomers,
  signUpWithProvider,
  verifyEmailAddress,
  forgetPassword,
  changePassword,
  resetPassword,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  addToBlackListByPhone,
  toggleCustomerCashier,
  validateToken,
  contactUs,
  createGuestCustomer,
};