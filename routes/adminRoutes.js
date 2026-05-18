// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const {
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
} = require("../controller/adminController");
const { passwordVerificationLimit, mfaLimit } = require("../lib/email-sender/sender");
const { isAdmin } = require("../config/auth");

// login admin
router.post("/login", loginAdmin);

// אימות שלב ה-OTP
router.post("/mfa/verify", mfaLimit, verifyMfa);

// validate token
router.get("/validate-token", validateToken);

// forget password
router.put("/forget-password", passwordVerificationLimit, forgetPassword);

// reset password
router.put("/reset-password", resetPassword);

//register a staff
router.post("/register", isAdmin, registerAdmin);

//add a staff
router.post("/add", isAdmin, addStaff);

//get all staff
router.get("/", isAdmin, getAllStaff);

//get a staff
router.post("/:id", isAdmin, getStaffById);

//update a staff
router.put("/:id", isAdmin, updateStaff);

//update staf status
router.put("/update-status/:id", isAdmin, updatedStatus);

//delete a staff
router.delete("/:id", isAdmin, deleteStaff);

module.exports = router;
