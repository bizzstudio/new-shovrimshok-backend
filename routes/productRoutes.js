// routes/productRoutes.js
const express = require("express");
const router = express.Router();
const {
  addProduct,
  addAllProducts,
  getAllProducts,
  getShowingProducts,
  getProductById,
  getProductBySlug,
  getProductByBarcode,
  addStockByBarcode,
  deductStockByBarcode,
  updateProduct,
  updateProductPrice,
  updateManyProducts,
  updateStatus,
  deleteProduct,
  deleteManyProducts,
  getShowingStoreProducts,
  findProductByTranscript,
  getFacebookFeedCSV,
  exportProductsImportCsv,
  downloadProductImagesZip,
} = require("../controller/productController");
const { isAdmin, isApp, storeCustomerOrExtract } = require("../config/auth");

// add a product
router.post("/add", isAdmin, addProduct);

// add multiple products
router.post("/all", isAdmin, addAllProducts);

// get a product by barcode (אדמין)
router.get("/barcode/:barcode", isAdmin, getProductByBarcode);
// get product by barcode for likut app
router.get("/barcode/:barcode/app", isApp, getProductByBarcode);

// add stock by barcode (קליטת סחורה) – אדמין
router.patch("/barcode/:barcode/add-stock", isAdmin, addStockByBarcode);
// add stock from likut app (אותו endpoint, אימות אפליקציה)
router.patch("/barcode/:barcode/add-stock-app", isApp, addStockByBarcode);
// deduct stock (ליקוט – הורדה ממלאי)
router.patch("/barcode/:barcode/deduct-stock", isAdmin, deductStockByBarcode);
router.patch("/barcode/:barcode/deduct-stock-app", isApp, deductStockByBarcode);

// get a product
router.post("/:id", getProductById);

// get showing products only
router.get("/show", getShowingProducts);

// get showing products CSV
router.get("/show/facebook-feed-csv", getFacebookFeedCSV);

// ייצוא מלא לאדמין (כולל מלאי) — תואם כותרות ייבוא
router.get("/export/import-csv", isAdmin, exportProductsImportCsv);

// הורדת כל תמונות המוצרים כ-ZIP
router.get("/export/images-zip", isAdmin, downloadProductImagesZip);

// get a product by transcript
router.get('/voice-search', storeCustomerOrExtract, findProductByTranscript);

// get showing products in store
router.get("/store", storeCustomerOrExtract, getShowingStoreProducts);

// get all products
router.get("/", getAllProducts);

// get a product by slug
router.get("/product/:slug", storeCustomerOrExtract, getProductBySlug);

// update a product
router.patch("/:id", isAdmin, updateProduct);

// update only product price
router.patch("/updatePrice/:id/:priceListId", isAdmin, updateProductPrice);

// update many products
router.patch("/update/many", isAdmin, updateManyProducts);

// update a product status
router.put("/status/:id", isAdmin, updateStatus);

// delete a product
router.delete("/:id", isAdmin, deleteProduct);

// delete many product
router.patch("/delete/many", isAdmin, deleteManyProducts);

module.exports = router;
