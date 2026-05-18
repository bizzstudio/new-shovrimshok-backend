// api/index.js
require("dotenv").config({ quiet: true });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");

const { connectDB } = require("../config/db");
const { startStockAlertJob } = require("../jobs/stockAlertJob");
const productRoutes = require("../routes/productRoutes");
const offerRoutes = require("../routes/offerRoutes");
const customerRoutes = require("../routes/customerRoutes");
const adminRoutes = require("../routes/adminRoutes");
const orderRoutes = require("../routes/orderRoutes");
const appOrderRoutes = require("../routes/appOrderRoutes");
const appProductRoutes = require("../routes/appProductRoutes");
const appFormRoutes = require("../routes/appFormRoutes");
const adminFormRoutes = require("../routes/adminFormRoutes");
const customerOrderRoutes = require("../routes/customerOrderRoutes");
const categoryRoutes = require("../routes/categoryRoutes");
const couponRoutes = require("../routes/couponRoutes");
const attributeRoutes = require("../routes/attributeRoutes");
const settingRoutes = require("../routes/settingRoutes");
const currencyRoutes = require("../routes/currencyRoutes");
const languageRoutes = require("../routes/languageRoutes");
const notificationRoutes = require("../routes/notificationRoutes");
const statusRoutes = require("../routes/statusRoutes");
const deliveryRoutes = require('../routes/deliveryRoutes');
const deliveryRegionRoutes = require('../routes/deliveryRegionRoutes');
const popupRoutes = require('../routes/popupRoutes');
const messageRoutes = require('../routes/messageRoutes');
const cashierOrderRoutes = require("../routes/cashierOrderRoutes");
const blogRoutes = require("../routes/blogRoutes");
const priceListRoutes = require("../routes/priceListRoutes");
const paymentsRoutes = require("../routes/paymentsRoutes");
const rivhitDocumentsRoutes = require("../routes/rivhitDocumentsRoutes");

const { isAuth, isAdmin, isApp, loginApp } = require("../config/auth");
const { upload } = require("../utils/imgurUploader");
const { uploadFileToS3 } = require("../utils/awsUploader");

connectDB();

// הפעלת job לבדיקת מלאי נמוך כל 10 דקות
startStockAlertJob();

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));
app.use(helmet());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// root route
app.get("/", (req, res) => {
  res.send("mnm-backend works properly! 29-12-2025 17:28");
});

// Route for uploading images to S3
app.post('/api/upload', isAuth, upload.single('file'), async (req, res) => {
  try {
    // AWS S3
    const folder = req.body.folder || 'Uploads';
    const link = await uploadFileToS3(req.file, folder); // מעבירים את שם התיקייה לפונקציה
    console.log(`File uploaded successfully to ${folder} :`, link);
    res.json({ link });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).send('Error uploading file');
  }
});

//this for route will need for store front, also for admin dashboard
app.use("/api/products/", productRoutes);
app.use("/api/offers/", offerRoutes);
app.use("/api/category/", categoryRoutes);
app.use("/api/coupon/", couponRoutes);
app.use("/api/customer/", customerRoutes);
app.use("/api/order/", customerOrderRoutes);
app.use("/api/cashier-orders/", cashierOrderRoutes);
app.use("/api/attributes/", attributeRoutes);
app.use("/api/setting/", settingRoutes);
app.use("/api/currency/", isAuth, currencyRoutes);
app.use("/api/language/", languageRoutes);
app.use("/api/notification/", isAuth, notificationRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/delivery-regions', deliveryRegionRoutes);
app.use('/api/popup', popupRoutes);
app.use('/api/message', messageRoutes);
app.use("/api/blog/", blogRoutes);
app.use("/api/payments/", paymentsRoutes);
app.use("/api/rivhit", rivhitDocumentsRoutes);

app.use("/api/admin/", adminRoutes);
app.use("/api/admin/forms", isAdmin, adminFormRoutes);
app.use("/api/orders/", orderRoutes);
app.use("/api/status/", isAdmin, statusRoutes);
app.use("/api/price-list/", isAdmin, priceListRoutes);

// Sync the app with the orders
app.use("/api/app/login", loginApp);
app.use("/api/app/orders/", isApp, appOrderRoutes);
app.use("/api/app/products", isApp, appProductRoutes);
app.use("/api/app/forms", isApp, appFormRoutes);

// Use express's default error handling middleware
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ message: err.message });
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

server.listen(PORT, () => console.log(`server running on port ${PORT}`));