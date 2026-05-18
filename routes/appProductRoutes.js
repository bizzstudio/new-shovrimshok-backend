// routes/appProductRoutes.js
const express = require("express");
const router = express.Router();
const { createProductFromApp } = require("../controller/productController");
const { isApp } = require("../config/auth");

// יצירת מוצר מהאפליקציה (קליטת סחורה – כשברקוד לא נמצא)
router.post("/", isApp, createProductFromApp);

module.exports = router;
