const bcrypt = require("bcryptjs");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
const jwt = require("jsonwebtoken");
const {
  signInToken,
  tokenForVerify,
  signTempMfaToken,
  signTrustedDeviceToken,
  verifyTrustedDeviceToken,
} = require("../config/auth");
const Admin = require("../models/Admin");
const { sendEmail, sendEmailSilent } = require("../lib/email-sender/sender");
const { generateOtpEmailHtml } = require("../lib/email-sender/templates/otp-email");
const gen6 = require("../utils/gen6");

const registerAdmin = async (req, res) => {
  try {
    const isAdded = await Admin.findOne({ email: req.body.email });
    if (isAdded) {
      return res.status(403).send({
        message: "This Email already Added!",
      });
    } else {
      const newStaff = new Admin({
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        password: bcrypt.hashSync(req.body.password),
      });
      const staff = await newStaff.save();
      const token = signInToken(staff);
      res.send({
        token,
        _id: staff._id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        joiningData: Date.now(),
      });
    }
  } catch (err) {
    console.log('registerAdmin error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const sendLoginOtpEmail = async (to, code) => {
  await sendEmailSilent({
    from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject: "קוד האימות שלך למערכת MNM יבוא שיווק והפצה",
    html: generateOtpEmailHtml(code, "MNM יבוא שיווק והפצה"),
  });
};

const loginAdmin = async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const { password, trustedToken } = req.body;

    // 1) מצא משתמש עם סיסמה
    const admin = await Admin.findOne({ email }).select('+password +emailOtp.codeHash');
    if (!admin) {
      return res.status(401).send({
        message: { en: "Invalid Email or password!", he: "האימייל או הסיסמה שגויים" },
      });
    }

    // 2) בדיקת סיסמה
    const passOK = bcrypt.compareSync(password, admin.password);
    if (!passOK) {
      return res.status(401).send({
        message: { en: "Invalid Email or password!", he: "האימייל או הסיסמה שגויים" },
      });
    }

    // 3) בדיקת trustedDevice (אם הגיע) - דילוג על MFA
    if (trustedToken) {
      const payload = verifyTrustedDeviceToken(trustedToken);
      if (payload?.sub === String(admin._id) && payload?.typ === 'trusted') {
        const token = signInToken(admin);
        return res.send({
          token,
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          image: admin.image,
          phone: admin.phone,
          skippedMfa: true,
        });
      }
    }

    // 4) אימות דו שלבי באימייל (6 ספרות, 5 דקות)
    const code = gen6();
    const codeHash = bcrypt.hashSync(code, 10);
    admin.emailOtp = {
      codeHash,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };
    await admin.save();

    await sendLoginOtpEmail(admin.email, code);

    // 5) temp token לשלב MFA
    const tempToken = signTempMfaToken(admin._id);

    return res.send({
      step: 'mfa_required',
      method: 'email',
      tempToken,
      message: { en: "We emailed you a 6-digit code.", he: "שלחנו אליך קוד בן 6 ספרות למייל" },
    });
  } catch (err) {
    console.log('loginAdmin error: ', err);
    res.status(500).send({ message: err.message });
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

const forgetPassword = async (req, res) => {
  const isAdded = await Admin.findOne({ email: req.body.verifyEmail });
  if (!isAdded) {
    return res.status(404).send({
      message: "Admin/Staff Not found with this email!",
    });
  } else {
    const token = tokenForVerify(isAdded);
    const body = {
      from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
      to: `${req.body.verifyEmail}`,
      subject: "Password Reset",
      html: `<h2>Hello ${req.body.verifyEmail}</h2>
      <p>A request has been received to change the password for your <strong>MNM יבוא שיווק והפצה</strong> account </p>

        <p>This link will expire in <strong> 15 minute</strong>.</p>

        <p style="margin-bottom:20px;">Click this link for reset your password</p>

        <a href=${process.env.ADMIN_URL}/reset-password/${token}  style="background:#22c55e;color:white;border:1px solid #22c55e; padding: 10px 15px; border-radius: 4px; text-decoration:none;">Reset Password </a>

        
        <p style="margin-top: 35px;">If you did not initiate this request, please contact us immediately at ${process.env.EMAIL_USER}</p>

        <p style="margin-bottom:0px;">Thank you</p>
        <strong>MNM יבוא שיווק והפצה Team</strong>
             `,
    };
    const message = "Please check your email to reset password!";
    sendEmail(body, res, message);
  }
};

const resetPassword = async (req, res) => {
  const token = req.body.token;
  const { email } = jwt.decode(token);
  const staff = await Admin.findOne({ email: email });

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET_FOR_VERIFY, (err, decoded) => {
      if (err) {
        console.log('resetPassword error: ', err);
        return res.status(500).send({
          message: "Token expired, please try again!",
        });
      } else {
        staff.password = bcrypt.hashSync(req.body.newPassword);
        staff.save();
        res.send({
          message: "Your password change successful, you can login now!",
        });
      }
    });
  }
};

const addStaff = async (req, res) => {
  // console.log("add staf....", req.body.staffData);
  try {
    const isAdded = await Admin.findOne({ email: req.body.email });
    if (isAdded) {
      return res.status(500).send({
        message: "This Email already Added!",
      });
    } else {
      const newStaff = new Admin({
        name: { ...req.body.name },
        email: req.body.email,
        password: bcrypt.hashSync(req.body.password),
        phone: req.body.phone,
        joiningDate: req.body.joiningDate,
        role: req.body.role,
        image: req.body.image,
      });
      await newStaff.save();
      res.status(200).send({
        message: "Staff Added Successfully!",
      });
    }
  } catch (err) {
    console.log('addStaff error: ', err);
    res.status(500).send({
      message: err.message,
    });
    // console.log("error", err);
  }
};

const getAllStaff = async (req, res) => {
  // console.log('allamdin')
  try {
    const admins = await Admin.find({}).sort({ _id: -1 });
    res.send(admins);
  } catch (err) {
    console.log('getAllStaff error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getStaffById = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);
    res.send(admin);
  } catch (err) {
    console.log('getStaffById error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const updateStaff = async (req, res) => {
  try {
    const admin = await Admin.findOne({ _id: req.params.id });

    if (admin) {
      admin.name = { ...admin.name, ...req.body.name };
      admin.email = req.body.email;
      admin.phone = req.body.phone;
      admin.role = req.body.role;
      admin.joiningData = req.body.joiningDate;
      admin.password =
        req.body.password !== undefined
          ? bcrypt.hashSync(req.body.password)
          : admin.password;
      admin.image = req.body.image;
      const updatedAdmin = await admin.save();
      const token = signInToken(updatedAdmin);
      res.send({
        token,
        message: "Staff Updated Successfully!",
        _id: updatedAdmin._id,
        name: updatedAdmin.name,
        email: updatedAdmin.email,
        role: updatedAdmin.role,
        image: updatedAdmin.image,
      });
    } else {
      res.status(404).send({
        message: "This Staff not found!",
      });
    }
  } catch (err) {
    console.log('updateStaff error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const deleteStaff = async (req, res) => {
  try {
    const staffId = req.params.id;

    // בחינה שהמשתמש קיים לפני המחיקה
    const staff = await Admin.findById(staffId);
    if (!staff) {
      return res.status(404).send({
        message: {
          en: "Staff member not found",
          he: "מנהל לא נמצא"
        }
      });
    }

    // מחיקת המנהל
    await Admin.deleteOne({ _id: staffId });

    res.status(200).send({
      message: {
        en: "Staff member deleted successfully",
        he: "המנהל נמחק בהצלחה"
      }
    });

  } catch (err) {
    console.log('deleteStaff error:', err);
    res.status(500).send({
      message: {
        en: "An error occurred while deleting the staff member",
        he: "אירעה שגיאה במחיקת המנהל"
      }
    });
  }
};

const updatedStatus = async (req, res) => {
  try {
    const newStatus = req.body.status;

    await Admin.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: newStatus,
        },
      }
    );
    res.send({
      message: `Staff ${newStatus} Successfully!`,
    });
  } catch (err) {
    console.log('updatedStatus error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

// אימות דו שלבי באימייל
const verifyMfa = async (req, res) => {
  try {
    const { tempToken, code, rememberDevice = true } = req.body;
    console.log('verifyMfa req.body: ', req.body);

    if (!tempToken || !code) {
      console.log('verifyMfa error: missing data');
      return res.status(400).send({ message: { en: "Expired or invalid MFA code", he: "קוד האימות שגוי או פג תוקף" } });
    }

    // אימות הטוקן הזמני
    let payload;
    try {
      payload = jwt.verify(tempToken, process.env.JWT_SECRET_MFA);
    } catch (e) {
      return res.status(401).send({ message: { en: "Expired or invalid MFA code", he: "קוד האימות שגוי או פג תוקף" } });
    }

    if (payload?.amr !== 'pwd' || !payload?.sub) {
      return res.status(401).send({ message: { en: "Expired or invalid MFA code", he: "קוד האימות שגוי או פג תוקף" } });
    }

    // בדיקת קוד מול הדטאבייס
    const admin = await Admin.findById(payload.sub).select('+emailOtp.codeHash');
    if (!admin || !admin.emailOtp) {
      return res.status(400).send({ message: { en: "Expired or invalid MFA code", he: "קוד האימות שגוי או פג תוקף" } });
    }

    if (admin.emailOtp.expiresAt < new Date()) {
      // פג תוקף
      admin.emailOtp = undefined;
      await admin.save();
      return res.status(400).send({ message: { en: "Code expired, please try again", he: "הקוד פג תוקף, נסו שנית" } });
    }

    const ok = bcrypt.compareSync(String(code), admin.emailOtp.codeHash);
    if (!ok) {
      return res.status(401).send({ message: { en: "Expired or invalid MFA code", he: "קוד האימות שגוי או פג תוקף" } });
    }

    // הצלחה – ננקה את ה-OTP
    admin.emailOtp = undefined;
    await admin.save();

    const token = signInToken(admin);
    const result = {
      token,
      _id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      image: admin.image,
      phone: admin.phone,
    };

    // "זכור מכשיר" – טוקן חתום ל-30 יום, נשמר בצד לקוח
    if (rememberDevice) {
      result.trustedToken = signTrustedDeviceToken(admin._id);
    }

    return res.send(result);
  } catch (err) {
    console.log('verifyMfa error: ', err);
    res.status(500).send({ message: err.message });
  }
};

module.exports = {
  registerAdmin,
  loginAdmin,
  validateToken,
  forgetPassword,
  resetPassword,
  addStaff,
  getAllStaff,
  getStaffById,
  updateStaff,
  deleteStaff,
  updatedStatus,
  verifyMfa,
};
