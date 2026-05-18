// routes/customerRoutes.js
const express = require("express");
const router = express.Router();
const {
  loginCustomer,
  getCurrentCustomer,
  registerCustomer,
  signUpWithProvider,
  verifyEmailAddress,
  forgetPassword,
  changePassword,
  resetPassword,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  addAllCustomers,
  addToBlackListByPhone,
  toggleCustomerCashier,
  validateToken,
  contactUs,
} = require("../controller/customerController");
const {
  createCustomerByAdmin,
  updateCustomerByAdmin,
  getAllMainCustomers,
  getMainCustomer,
  deleteMainCustomer,
  importPermittedBarcodes,
  getPermittedProducts,
  addPermittedProduct,
  removePermittedProduct,
} = require("../controller/customerAdminController");
const {
  passwordVerificationLimit,
  emailVerificationLimit,
} = require("../lib/email-sender/sender");
const { isAdmin, isAuth, isWhatsappServer } = require("../config/auth");

// verify email
router.post("/verify-email",
  emailVerificationLimit,
  verifyEmailAddress);

// register a user
router.post("/register/:token", registerCustomer);

// login a user
router.post("/login", loginCustomer);

// get current user data (refresh user info)
router.get("/me", isAuth, getCurrentCustomer);

// validate token
router.get("/validate-token", validateToken);

// contact-us
router.post("/contact-us", contactUs);

// register or login with google
router.post("/signup-with-google", signUpWithProvider);

// add user to black list
router.put("/add-to-black-list", isWhatsappServer, addToBlackListByPhone);

// forget-password
router.put("/forget-password", passwordVerificationLimit, forgetPassword);

// reset-password
router.put("/reset-password", resetPassword);

// change password
router.post("/change-password", isAuth, changePassword);

// add all users
router.post("/add/all", isAdmin, addAllCustomers);

// get all main customers (for admin)
router.get("/all/main", isAdmin, getAllMainCustomers);

// get all user
router.get("/", isAdmin, getAllCustomers);

// get a user
router.get("/:id", isAdmin, getCustomerById);

// get main customer with all sub-customers and orders
router.get("/main/:id", isAdmin, getMainCustomer);

// create a customer by admin
router.post("/admin/create", isAdmin, createCustomerByAdmin);

// update a user (regular customer can only update basic fields)
router.put("/:id", isAuth, updateCustomer);

// update a customer by admin (can update all fields)
router.put("/admin/:id", isAdmin, updateCustomerByAdmin);

// import permitted barcodes for a main customer
router.post("/admin/:id/permitted-barcodes/import", isAdmin, importPermittedBarcodes);
router.get("/admin/:id/permitted-products", isAdmin, getPermittedProducts);
router.post("/admin/:id/permitted-products/add", isAdmin, addPermittedProduct);
router.post("/admin/:id/permitted-products/remove", isAdmin, removePermittedProduct);

// delete a main customer by admin (doesn't delete sub-customers)
router.delete("/admin/main/:id", isAdmin, deleteMainCustomer);

// delete a user
router.delete("/:id", isAuth, deleteCustomer);

// toggle customer cashier
router.put("/toggle-cashier/:id", isAdmin, toggleCustomerCashier);

module.exports = router;
