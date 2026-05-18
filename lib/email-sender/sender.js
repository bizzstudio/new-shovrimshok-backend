// lib/email-sender/sender.js
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");
const { newOrderNotificationBody } = require("./templates/new-order-notification");

// שליחת אימייל עם תגובה לקליינט
const sendEmail = (body, res, message) => {
  const transporter = nodemailer.createTransport({
    host: process.env.HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_SECURE === "true", // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  transporter.verify((err, success) => {
    if (err) {
      console.log(`Error when verifying: ${err.message}`);
      if (!res.headersSent) {
        return res.status(403).send({
          message: {
            he: `שגיאה באימות השרת: ${err.message}`,
            en: `Error happen when verify ${err.message}`
          }
        });
      }
    } else {
      console.log("Server is ready to take our messages");

      transporter.sendMail(body, (err, data) => {
        if (err) {
          console.log(`Error when sending email: ${err.message}`);
          if (!res.headersSent) {
            return res.status(403).send({
              message: {
                he: `שגיאה בשליחת האימייל: ${err.message}`,
                en: `Error happen when sending email ${err.message}`
              }
            });
          }
        } else {
          if (!res.headersSent) {
            return res.send({
              message: message,
              waitingForVerification: body.to,
            });
          }
        }
      });
    }
  });
};

// פונקציה חדשה לשליחת אימיילים ללא תגובה
const sendEmailSilent = async (body) => {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      host: process.env.HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    transporter.verify((err, success) => {
      if (err) {
        console.log(`Error when verifying: ${err.message}`);
        reject(err);
      } else {
        console.log("Email sent successfully");

        transporter.sendMail(body, (err, data) => {
          if (err) {
            console.log(`Error when sending email: ${err.message}`);
            reject(err);
          } else {
            console.log(`Email sent successfully to: ${body.to}`);
            resolve(data);
          }
        });
      }
    });
  });
};

// פונקציה לשליחת הודעות על הזמנות חדשות
const sendOrderNotificationEmail = async (order, customer) => {
  try {
    // הכנת נתוני האימייל
    const orderEmailData = {
      // פרטי ההזמנה
      invoice: order.invoice,
      orderDate: order.createdAt,
      total: order.total,
      discount: order.discount || 0,
      shippingCost: order.shippingCost || 0,
      paymentMethod: order.paymentMethod || 'card',
      shippingOption: order.shippingOption,

      // פרטי הלקוח
      customerName: customer.name + (customer.lastName ? ' ' + customer.lastName : ''),
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerAddress: customer.address ?
        `${customer.address.street || ''} ${customer.address.houseNumber || ''}${customer.address.apartmentNumber ? '/' + customer.address.apartmentNumber : ''}, ${customer.address.city?.city_name_he || ''}`.trim() : '',

      // פרטים נוספים
      orderItems: order.cart || [],
      totalItems: (order.cart || []).reduce((sum, item) => sum + (item.quantity || 1), 0),
      customerNote: order.customer_note,
      isBusinessCustomer: customer.isBusiness || false,
      // המחירון של הלקוח בעת הקנייה (נשמר ב-user_info)
      priceList: order.user_info?.priceList || customer?.priceList || null
    };

    // הכנת רשימת נמענים מנהלים
    const adminEmails = process.env.ADMINS_EMAILS ?
      process.env.ADMINS_EMAILS.split(',').map(email => email.trim()).filter(email => email) :
      [process.env.EMAIL_USER];

    // הוספת אימייל הלקוח לרשימה (אם יש)
    const allRecipients = [...adminEmails];
    if (customer.email && customer.email.trim()) {
      allRecipients.push(customer.email.trim());
    }

    // יצירת אובייקט האימייל
    const emailBody = {
      from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
      to: allRecipients.join(','),
      subject: `🛒 התקבלה הזמנה חדשה - מספר ${order.invoice}`,
      html: newOrderNotificationBody(orderEmailData)
    };

    // שליחה אסינכרונית לכל הנמענים ללא חסימת התגובה
    sendEmailSilent(emailBody).catch(emailError => {
      console.error("Failed to send order notification email:", emailError);
    });

    console.log(`Order notification email sent successfully for order ${order.invoice}`);

  } catch (emailError) {
    // לא נכשיל את ההזמנה אם שליחת המייל נכשלת
    console.error("Error preparing order notification email:", emailError);
  }
};

//limit email verification and forget password
const minutes = 30;
const emailVerificationLimit = rateLimit({
  windowMs: minutes * 60 * 1000,
  max: process.env.ENV === "dev" ? 100 : 3,
  handler: (req, res) => {
    res.status(429).send({
      success: false,
      message: {
        he: `ביצעת יותר מדי בקשות. אנא נסה שוב בעוד ${minutes} דקות.`,
        en: `You made too many requests. Please try again after ${minutes} minutes.`
      }
    });
  },
});

const passwordVerificationLimit = rateLimit({
  windowMs: minutes * 60 * 1000,
  max: process.env.ENV === "dev" ? 100 : 3,
  handler: (req, res) => {
    res.status(429).send({
      success: false,
      message: {
        he: `ביצעת יותר מדי בקשות. אנא נסה שוב בעוד ${minutes} דקות.`,
        en: `You made too many requests. Please try again after ${minutes} minutes.`
      }
    });
  },
});

const supportMessageLimit = rateLimit({
  windowMs: minutes * 60 * 1000,
  max: process.env.ENV === "dev" ? 100 : 5,
  handler: (req, res) => {
    res.status(429).send({
      success: false,
      message: {
        he: `ביצעת יותר מדי בקשות. אנא נסה שוב בעוד ${minutes} דקות.`,
        en: `You made too many requests. Please try again after ${minutes} minutes.`
      }
    });
  },
});

const mfaLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 דקות
  max: process.env.ENV === "dev" ? 100 : 60, // עד 60 פעמים בשעה
  handler: (req, res) => {
    res.status(429).send({
      success: false,
      message: {
        he: `ביצעת יותר מדי ניסיונות אימות דו שלבי. אנא נסה שוב בעוד שעה.`,
        en: `Too many MFA attempts. Please try again in an hour.`
      }
    });
  },
});

module.exports = {
  sendEmail,
  sendEmailSilent,
  emailVerificationLimit,
  passwordVerificationLimit,
  supportMessageLimit,
  sendOrderNotificationEmail,
  mfaLimit,
};