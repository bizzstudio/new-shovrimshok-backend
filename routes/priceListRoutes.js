// routes/priceListRoutes.js
const express = require('express');
const router = express.Router();
const {
    // Admin functions
    addPriceList,
    getAllPriceLists,
    getPriceListById,
    updatePriceList,
    deletePriceList,
    deleteManyPriceLists,
    importPriceListPrices,
    exportPriceListExcel,
} = require('../controller/priceListController');

// Admin routes - CRUD מלא
// הוספת מחירון חדש
router.post('/add', addPriceList);

// קבלת כל המחירונים
router.get('/all', getAllPriceLists);

// ייצוא מחירון לאקסל (לפני /:id כדי שלא יילכד כמזהה)
router.get('/:id/export', exportPriceListExcel);

// קבלת מחירון לפי ID
router.get('/:id', getPriceListById);

// עדכון מחירון
router.put('/:id', updatePriceList);

// ייבוא מחירים מקובץ למחירון ספציפי
router.post('/:id/import', importPriceListPrices);

// מחיקת מחירון
router.delete('/:id', deletePriceList);

// מחיקת מספר מחירונים
router.patch('/delete-many', deleteManyPriceLists);

module.exports = router;
