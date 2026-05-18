// controller/priceListController.js
const XLSX = require("xlsx");
const PriceList = require("../models/PriceList");
const Product = require("../models/Product");

const addPriceList = async (req, res) => {
    try {
        const newPriceList = new PriceList({
            ...req.body,
        });

        await newPriceList.save();
        res.status(201).send({
            message: {
                he: "המחירון נוסף בהצלחה",
                en: "Price list added successfully",
            },
            priceList: newPriceList,
        });
    } catch (err) {
        console.log('addPriceList error: ', err);
        
        // בדיקה אם השגיאה היא שם כפול
        if (err.code === 11000 && err.keyPattern?.name) {
            return res.status(409).send({
                message: {
                    he: "מחירון עם שם זה כבר קיים",
                    en: "A price list with this name already exists",
                }
            });
        }
        
        res.status(500).send({
            message: err.message,
        });
    }
};

const getAllPriceLists = async (req, res) => {
    try {
        const priceLists = await PriceList.find({}).sort({ createdAt: -1 });
        res.send(priceLists);
    } catch (err) {
        console.log('getAllPriceLists error: ', err);
        res.status(500).send({
            message: err.message,
        });
    }
};

const getPriceListById = async (req, res) => {
    try {
        const priceList = await PriceList.findById(req.params.id);
        if (!priceList) {
            return res.status(404).send({
                message: {
                    he: "המחירון לא נמצא",
                    en: "Price list not found",
                }
            });
        }
        res.send(priceList);
    } catch (err) {
        console.log('getPriceListById error: ', err);
        res.status(500).send({
            message: err.message,
        });
    }
};

const updatePriceList = async (req, res) => {
    try {
        const updatedPriceList = await PriceList.findByIdAndUpdate(
            req.params.id,
            { ...req.body },
            { new: true }
        );

        if (!updatedPriceList) {
            return res.status(404).send({
                message: {
                    he: "המחירון לא נמצא",
                    en: "Price list not found",
                }
            });
        }

        res.send({
            message: {
                he: "המחירון עודכן בהצלחה",
                en: "Price list updated successfully",
            },
            priceList: updatedPriceList,
        });
    } catch (err) {
        console.log('updatePriceList error: ', err);
        
        // בדיקה אם השגיאה היא שם כפול
        if (err.code === 11000 && err.keyPattern?.name) {
            return res.status(409).send({
                message: {
                    he: "מחירון עם שם זה כבר קיים",
                    en: "A price list with this name already exists",
                }
            });
        }
        
        res.status(500).send({
            message: err.message,
        });
    }
};

const deletePriceList = async (req, res) => {
    try {
        const priceList = await PriceList.findById(req.params.id);

        if (!priceList) {
            return res.status(404).send({
                message: {
                    he: "המחירון לא נמצא",
                    en: "Price list not found",
                }
            });
        }

        if (priceList.isDefault) {
            return res.status(400).send({
                message: {
                    he: "לא ניתן למחוק מחירון ברירת מחדל",
                    en: "Cannot delete default price list",
                }
            });
        }

        await PriceList.findByIdAndDelete(req.params.id);

        res.send({
            message: {
                he: "המחירון נמחק בהצלחה",
                en: "Price list deleted successfully",
            },
        });
    } catch (err) {
        console.log('deletePriceList error: ', err);
        res.status(500).send({
            message: err.message,
        });
    }
};

const deleteManyPriceLists = async (req, res) => {
    try {
        // בדיקה אם יש מחירונים default במערך
        const priceLists = await PriceList.find({ _id: { $in: req.body.ids } });
        const defaultPriceLists = priceLists.filter(pl => pl.isDefault);

        if (defaultPriceLists.length > 0) {
            return res.status(400).send({
                message: {
                    he: "לא ניתן למחוק מחירון ברירת מחדל",
                    en: "Cannot delete default price list",
                }
            });
        }

        // מחיקת מספר מחירונים לפי מערך של IDs
        await PriceList.deleteMany({ _id: req.body.ids });

        res.send({
            message: {
                he: "המחירונים נמחקו בהצלחה!",
                en: "Price lists deleted successfully!",
            },
        });
    } catch (err) {
        console.log('deleteManyPriceLists error: ', err);
        res.status(500).send({
            message: err.message,
        });
    }
};

const toNumberOrNull = (value) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    // Keep digits, decimal separators and minus only (supports "₪ 12.90", "12,90", "1,234.56", "1.234,56")
    let cleaned = raw.replace(/[^\d.,-]/g, "");
    if (!cleaned) return null;

    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");

    if (lastComma > -1 && lastDot > -1) {
        // If both exist, treat the last separator as decimal and remove the other as thousands
        if (lastComma > lastDot) {
            cleaned = cleaned.replace(/\./g, "").replace(",", ".");
        } else {
            cleaned = cleaned.replace(/,/g, "");
        }
    } else if (lastComma > -1) {
        cleaned = cleaned.replace(",", ".");
    } else {
        // dot only / integer
        cleaned = cleaned;
    }

    const normalized = Number(cleaned);
    return Number.isFinite(normalized) ? normalized : null;
};

const normalizeHeader = (value) =>
    String(value || "")
        .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
        .replace(/["']/g, "")
        .trim()
        .toLowerCase();

const getRowValue = (row, aliases = []) => {
    const keys = Object.keys(row || {});
    const normalizedAliasSet = new Set(aliases.map(normalizeHeader));

    for (const key of keys) {
        if (normalizedAliasSet.has(normalizeHeader(key))) {
            return row[key];
        }
    }

    return undefined;
};

/**
 * ייבוא מחירון מאקסל:
 * - dryRun: אימות שורות בלבד.
 * - ייבוא אמיתי: מעדכן מחירים לפי הקובץ; מוצרים שהיו עם מחירון זה ואינם מופיעים בקובץ —
 *   נמחקת מהמוצר הרשומה למחירון הזה, כך שחישוב המחיר חוזר למחירון ברירת המחדל של האתר (priceUtils).
 */
const importPriceListPrices = async (req, res) => {
    try {
        const { id } = req.params;
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        const dryRun = req.query?.dryRun === "true" || req.body?.dryRun === true;

        const priceList = await PriceList.findById(id);
        if (!priceList) {
            return res.status(404).send({
                message: {
                    he: "המחירון לא נמצא",
                    en: "Price list not found",
                }
            });
        }

        if (rows.length === 0) {
            return res.status(400).send({
                message: {
                    he: "הקובץ ריק או לא תקין",
                    en: "File is empty or invalid",
                },
                summary: { total: 0, succeeded: 0, failed: 0 },
                errors: [],
            });
        }

        const barcodeAliases = ["barcode", "barcod", "Barcode", "BARCODE", "ברקוד"];
        const priceAliases = ["price", "Price", "מחיר", "מחיר מכירה לפני"];
        const warehousePriceAliases = ["warehousePrice", "WarehousePrice", "warehouse price", "מחיר מחסן"];

        const errors = [];
        /** ברקוד → מחירים (שורה אחרונה גוברת בכפילות) */
        const barcodeToPayload = new Map();

        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i] || {};
            const rowNumber = i + 2;

            const barcodeRaw = getRowValue(row, barcodeAliases);
            const barcode = barcodeRaw === undefined || barcodeRaw === null ? "" : String(barcodeRaw).trim();
            const priceValue = toNumberOrNull(getRowValue(row, priceAliases));
            const warehousePriceValue = toNumberOrNull(getRowValue(row, warehousePriceAliases));

            if (!barcode) {
                errors.push({
                    index: rowNumber,
                    barcode: "",
                    error: { he: "חסר ברקוד", en: "Missing barcode" },
                });
                continue;
            }

            if (priceValue === null) {
                errors.push({
                    index: rowNumber,
                    barcode,
                    error: { he: "מחיר לא תקין", en: "Invalid price value" },
                });
                continue;
            }

            const product = await Product.findOne({ barcode });
            if (!product) {
                errors.push({
                    index: rowNumber,
                    barcode,
                    error: { he: "לא נמצא מוצר עם ברקוד זה", en: "Product with this barcode was not found" },
                });
                continue;
            }

            barcodeToPayload.set(barcode, { priceValue, warehousePriceValue });
        }

        const successCount = rows.length - errors.length;
        const failedCount = errors.length;
        const total = rows.length;

        if (dryRun) {
            return res.send({
                message: {
                    he: `בדיקת ייבוא הסתיימה. תקינים: ${successCount}, שגויים: ${failedCount}`,
                    en: `Import validation completed. Valid: ${successCount}, Invalid: ${failedCount}`,
                },
                summary: {
                    total,
                    succeeded: successCount,
                    failed: failedCount,
                },
                dryRun,
                errors,
            });
        }

        if (barcodeToPayload.size === 0) {
            return res.status(400).send({
                message: {
                    he: "לא נמצאו שורות תקינות לייבוא — לא בוצע שינוי",
                    en: "No valid rows to import — no changes were made",
                },
                summary: { total, succeeded: 0, failed: failedCount },
                errors,
            });
        }

        const priceListIdStr = String(id);

        const productsWithThisList = await Product.find({ "prices.priceList": id }).select("_id barcode prices");

        for (const product of productsWithThisList) {
            const bc = product.barcode ? String(product.barcode).trim() : "";
            const prices = Array.isArray(product.prices) ? [...product.prices] : [];
            const idx = prices.findIndex((entry) => String(entry?.priceList) === priceListIdStr);
            if (idx < 0) {
                continue;
            }

            if (bc && barcodeToPayload.has(bc)) {
                const { priceValue, warehousePriceValue } = barcodeToPayload.get(bc);
                prices[idx].price = priceValue;
                if (warehousePriceValue !== null) {
                    prices[idx].warehousePrice = warehousePriceValue;
                }
            } else {
                prices.splice(idx, 1);
            }

            product.prices = prices;
            await product.save();
        }

        for (const [barcode, { priceValue, warehousePriceValue }] of barcodeToPayload) {
            const product = await Product.findOne({ barcode });
            if (!product) {
                continue;
            }

            const hasEntry = product.prices.some(
                (entry) => String(entry?.priceList) === priceListIdStr
            );
            if (hasEntry) {
                continue;
            }

            product.prices.push({
                priceList: id,
                price: priceValue,
                warehousePrice: warehousePriceValue === null ? undefined : warehousePriceValue,
            });
            await product.save();
        }

        return res.send({
            message: {
                he: `ייבוא הסתיים. הצליחו: ${successCount}, נכשלו: ${failedCount}. מוצרים שלא בקובץ הוסרו ממחירון זה ויציגו מחיר ברירת מחדל.`,
                en: `Import completed. Succeeded: ${successCount}, Failed: ${failedCount}. Products not in the file were removed from this price list and use the default catalog price.`,
            },
            summary: {
                total,
                succeeded: successCount,
                failed: failedCount,
            },
            dryRun: false,
            errors,
        });
    } catch (err) {
        console.log("importPriceListPrices error: ", err);
        return res.status(500).send({
            message: {
                he: "שגיאה בייבוא מחירון",
                en: "Price list import failed",
            },
            summary: { total: 0, succeeded: 0, failed: 0 },
            errors: [],
        });
    }
};

/** ייצוא לאקסל: עמודות תואמות ייבוא (barcode, price, warehousePrice) */
const exportPriceListExcel = async (req, res) => {
    try {
        const { id } = req.params;
        const priceList = await PriceList.findById(id);
        if (!priceList) {
            return res.status(404).send({
                message: {
                    he: "המחירון לא נמצא",
                    en: "Price list not found",
                },
            });
        }

        const priceListIdStr = String(id);
        const products = await Product.find({ "prices.priceList": id })
            .select("barcode prices")
            .lean();

        const rows = [];
        for (const product of products) {
            const entry = (product.prices || []).find(
                (p) => String(p.priceList) === priceListIdStr
            );
            if (!entry) {
                continue;
            }
            rows.push({
                barcode: product.barcode != null ? String(product.barcode).trim() : "",
                price: entry.price != null ? entry.price : "",
                warehousePrice:
                    entry.warehousePrice != null && entry.warehousePrice !== ""
                        ? entry.warehousePrice
                        : "",
            });
        }

        rows.sort((a, b) => String(a.barcode).localeCompare(String(b.barcode)));

        const sheetData = [
            ["barcode", "price", "warehousePrice"],
            ...rows.map((r) => [r.barcode, r.price, r.warehousePrice]),
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Prices");

        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        const rawName = priceList.name || "price-list";
        const safeAscii = String(rawName)
            .replace(/[^\w\-]+/g, "_")
            .slice(0, 60) || "price-list";
        const filenameUtf8 = `${rawName}.xlsx`;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safeAscii}.xlsx"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`
        );
        return res.send(buffer);
    } catch (err) {
        console.log("exportPriceListExcel error: ", err);
        return res.status(500).send({
            message: {
                he: "שגיאה בייצוא מחירון",
                en: "Price list export failed",
            },
        });
    }
};

module.exports = {
    addPriceList,
    getAllPriceLists,
    getPriceListById,
    updatePriceList,
    deletePriceList,
    deleteManyPriceLists,
    importPriceListPrices,
    exportPriceListExcel,
};
