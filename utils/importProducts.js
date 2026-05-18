// utils/importProducts.js
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const PriceList = require("../models/PriceList");
const {
    processMultilingualFields,
    getProductIdentifier,
    generateProductSlug
} = require("./productHelpers");

/**
 * וולידציה של שדה title
 * @param {Object} product - המוצר המעובד
 * @returns {Object|null} אובייקט שגיאה או null אם תקין
 */
const validateTitle = (product) => {
    if (!product.title || Object.keys(product.title).length === 0) {
        return {
            en: "Missing title. Ensure the Excel has a 'title' column and that this row has a product name.",
            he: "חסרה כותרת. ודא שבאקסל יש עמודה title ושבשורה זו יש שם מוצר."
        };
    }
    return null;
};

/**
 * עיבוד וולידציה של קטגוריות
 * @param {Array} categories - מערך slugs של קטגוריות
 * @param {Map} categoryMap - מפה של slug -> ObjectId (כולל כל הוריאציות)
 * @returns {Object} אובייקט עם categoryIds ו-notFoundCategories
 */
const processCategoriesForImport = (categories, categoryMap) => {
    if (!categories || !Array.isArray(categories)) {
        return { categoryIds: [], notFoundCategories: [] };
    }

    const categoryIds = [];
    const notFoundCategories = [];

    // מיפוי הקטגוריות המקוריות ל-ObjectIds
    for (const categorySlug of categories) {
        // אם זה כבר ObjectId, להשתמש בו ישירות
        if (mongoose.Types.ObjectId.isValid(categorySlug) && categorySlug.length === 24) {
            categoryIds.push(categorySlug);
            continue;
        }

        // חיפוש בכל הוריאציות (מקורי, lowercase, encoded)
        const originalSlug = categorySlug;
        const lowerSlug = categorySlug.toLowerCase();
        const encodedSlug = encodeURIComponent(categorySlug).toLowerCase();

        const foundId = categoryMap.get(originalSlug)
            || categoryMap.get(lowerSlug)
            || categoryMap.get(encodedSlug);

        if (foundId) {
            categoryIds.push(foundId);
        } else {
            notFoundCategories.push(categorySlug);
        }
    }

    return { categoryIds, notFoundCategories };
};

/**
 * עיבוד מחירונים - המרה משמות ל-ObjectIds
 * @param {Array} prices - מערך מחירים עם שמות מחירונים
 * @param {Map} priceListMap - מפת שמות מחירונים ל-ObjectIds
 * @returns {Object} אובייקט עם מערך המחירים המעובד ושגיאות
 */
const processPricesForImport = (prices, priceListMap) => {
    if (!prices || !Array.isArray(prices)) {
        return { processedPrices: [], errors: [] };
    }

    const processedPrices = [];
    const errors = [];

    for (const priceEntry of prices) {
        // וולידציה שיש שם מחירון
        if (!priceEntry.priceList) {
            errors.push({
                en: "Price list name is required for each price entry",
                he: "שם מחירון נדרש עבור כל מחיר"
            });
            continue;
        }

        // חיפוש מחירון לפי שם
        const priceListId = priceListMap.get(priceEntry.priceList.toLowerCase());

        if (!priceListId) {
            errors.push({
                en: `Price list not found: ${priceEntry.priceList}`,
                he: `מחירון לא נמצא: ${priceEntry.priceList}`
            });
            continue;
        }

        // בניית אובייקט המחיר
        const processedPriceEntry = {
            priceList: priceListId,
            price: priceEntry.price
        };

        // הוספת שדות אופציונליים אם קיימים
        if (priceEntry.salePrice !== undefined && priceEntry.salePrice !== null) {
            processedPriceEntry.salePrice = priceEntry.salePrice;
        }
        if (priceEntry.warehousePrice !== undefined && priceEntry.warehousePrice !== null) {
            processedPriceEntry.warehousePrice = priceEntry.warehousePrice;
        }
        if (priceEntry.purchaseLimit !== undefined && priceEntry.purchaseLimit !== null) {
            processedPriceEntry.purchaseLimit = priceEntry.purchaseLimit;
        }

        processedPrices.push(processedPriceEntry);
    }

    return { processedPrices, errors };
};

/**
 * עיבוד מוצר בודד לייבוא
 * @param {Object} product - נתוני המוצר הגולמיים
 * @param {Map} priceListMap - מפת מחירונים
 * @returns {Promise<Object>} מוצר מעובד
 */
const processProductForImport = async (product, priceListMap) => {
    // עיבוד שדות רב-לשוניים
    const processedProduct = processMultilingualFields(product);

    // חשוב: למנוע המרה אוטומטית למספרים (JSON.parse) כדי שלא יהיו false mismatches
    // לדוגמה: "7290011431843" (string) מול 7290011431843 (number)
    processedProduct.itemNumber = normalizeIdentifier(processedProduct.itemNumber);
    processedProduct.barcode = normalizeBarcode(processedProduct.barcode);

    // הסרת _id אם קיים - MongoDB ייצור אחד חדש אוטומטית
    // זה מונע שגיאות של כפילות _id
    if (processedProduct._id) {
        delete processedProduct._id;
    }

    // טיפול ב-productId - וולידציה שהוא ObjectId תקין
    if (
        !processedProduct.productId
        || !mongoose.Types.ObjectId.isValid(processedProduct.productId)
    ) {
        processedProduct.productId = new mongoose.Types.ObjectId().toString();
    }

    // יצירת slug אוטומטי אם לא סופק
    processedProduct.slug = generateProductSlug(processedProduct);

    // טיפול במלאי - המרה למספר, עדכון תאריך ואיפוס התראות
    if (processedProduct.stock !== undefined && processedProduct.stock !== null && processedProduct.stock !== "") {
        const sn = Number(processedProduct.stock);
        if (Number.isFinite(sn)) {
            processedProduct.stock = Math.max(0, Math.floor(sn));
        }
        processedProduct.lastStockUpdate = new Date();
        processedProduct.hasSentStockAlert = false;
    }

    // הסרת שדות עם ערכים ריקים או undefined שיכולים לגרום לשגיאות
    const fieldsToClean = ['weightUnit', 'unit', 'tags'];
    fieldsToClean.forEach(field => {
        if (processedProduct[field] === '' || processedProduct[field] === undefined) {
            delete processedProduct[field];
        }
    });

    return processedProduct;
};

/**
 * טיפול בשגיאות MongoDB
 * @param {Error} error - אובייקט השגיאה
 * @param {Object} product - המוצר שנכשל
 * @returns {Object} הודעת שגיאה מפורטת
 */
const handleMongoDBError = (error, product) => {
    let errorMessage = {
        en: error.message,
        he: error.message
    };

    // זיהוי שגיאות נפוצות
    if (error.code === 11000) {
        // Duplicate key error
        let duplicateField = null;
        let duplicateValue = null;

        // ניסיון לחלץ את המידע מ-keyPattern ו-keyValue
        if (error.keyPattern && Object.keys(error.keyPattern).length > 0) {
            duplicateField = Object.keys(error.keyPattern)[0];
            duplicateValue = error.keyValue?.[duplicateField];
        }

        // אם לא הצלחנו לחלץ, ננסה לנתח את הודעת השגיאה
        if (!duplicateField && error.message) {
            // דוגמה: "E11000 duplicate key error collection: mnm.products index: _id_ dup key: { _id: ObjectId('...') }"
            const indexMatch = error.message.match(/index:\s+(\w+)_?\s+dup key:/);
            if (indexMatch) {
                duplicateField = indexMatch[1];
            }

            // ניסיון לחלץ את הערך
            const valueMatch = error.message.match(/dup key:\s*\{\s*\w+:\s*(.+?)\s*\}/);
            if (valueMatch) {
                duplicateValue = valueMatch[1];
            }
        }

        // אם עדיין אין מידע, ננסה לחלץ מ-writeErrors
        if (!duplicateField && error.writeErrors && error.writeErrors.length > 0) {
            const firstError = error.writeErrors[0];
            if (firstError.err && firstError.err.errmsg) {
                const indexMatch = firstError.err.errmsg.match(/index:\s+(\w+)_?\s+dup key:/);
                if (indexMatch) {
                    duplicateField = indexMatch[1];
                }
            }
        }

        // בניית הודעת שגיאה לפי השדה
        if (duplicateField === '_id') {
            errorMessage = {
                en: `Internal ID conflict detected. This product may already exist in the database (ID: ${duplicateValue || 'unknown'}). Try importing without specifying the _id field.`,
                he: `זוהתה התנגשות במזהה פנימי. מוצר זה כבר קיים במסד הנתונים (ID: ${duplicateValue || 'לא ידוע'}). נסה לייבא ללא ציון שדה _id.`
            };
        } else if (duplicateField === 'barcode') {
            errorMessage = {
                en: `Barcode already exists: ${duplicateValue || 'unknown'}`,
                he: `ברקוד כבר קיים במערכת: ${duplicateValue || 'לא ידוע'}`
            };
        } else if (duplicateField === 'slug') {
            errorMessage = {
                en: `Slug already exists: ${duplicateValue || 'unknown'}`,
                he: `כתובת ייחודית כבר קיימת: ${duplicateValue || 'לא ידוע'}`
            };
        } else if (duplicateField === 'productId') {
            errorMessage = {
                en: `Product ID already exists: ${duplicateValue || 'unknown'}`,
                he: `מזהה מוצר כבר קיים: ${duplicateValue || 'לא ידוע'}`
            };
        } else if (duplicateField) {
            errorMessage = {
                en: `Duplicate value in field "${duplicateField}": ${duplicateValue || 'unknown'}`,
                he: `ערך כפול בשדה "${duplicateField}": ${duplicateValue || 'לא ידוע'}`
            };
        } else {
            // אם לא הצלחנו לזהות כלום, נחזיר את ההודעה המקורית
            errorMessage = {
                en: `Duplicate key error: ${error.message}`,
                he: `שגיאת מפתח כפול: ${error.message}`
            };
        }
    } else if (error.name === 'ValidationError') {
        // Validation error
        const validationErrors = Object.values(error.errors || {}).map(err => err.message);
        errorMessage = {
            en: `Validation error: ${validationErrors.join(', ')}`,
            he: `שגיאת ולידציה: ${validationErrors.join(', ')}`
        };
    } else if (error.name === 'CastError') {
        // Cast error (wrong type)
        errorMessage = {
            en: `Invalid value type for ${error.path}: ${error.value}`,
            he: `ערך לא תקין עבור ${error.path}: ${error.value}`
        };
    }

    return errorMessage;
};

/**
 * יצירת אובייקט שגיאה למוצר
 * @param {number} index - אינדקס המוצר
 * @param {Object} product - נתוני המוצר
 * @param {Object} error - הודעת השגיאה
 * @returns {Object} אובייקט שגיאה מפורמט
 */
const createProductError = (index, product, error) => {
    const resolvedBarcode = resolveFieldValue(product, BARCODE_ALIASES);
    const resolvedItemNumber = resolveFieldValue(product, ITEM_NUMBER_ALIASES);
    return {
        index,
        product: getProductIdentifier(product, index),
        itemNumber: normalizeIdentifier(resolvedItemNumber) || 'לא סופק',
        barcode: normalizeIdentifier(resolvedBarcode) || 'לא סופק',
        error
    };
};

const normalizeIdentifier = (value) => {
    if (value === undefined || value === null) return "";
    return String(value).trim();
};

const normalizeBarcode = (value) => {
    return normalizeIdentifier(value).replace(/\D/g, "");
};

const normalizeHeaderKey = (key) => {
    return String(key || "")
        .replace(/\uFEFF/g, "") // BOM
        .replace(/["'`׳״]/g, "") // quote variants
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
};

const parseNumberish = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const normalized = String(value).replace(/,/g, ".").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const resolveFieldValue = (product, aliases) => {
    const normalizedKeyToValue = new Map();
    const normalizedEntries = [];
    for (const [key, value] of Object.entries(product || {})) {
        const normalizedKey = normalizeHeaderKey(key);
        normalizedKeyToValue.set(normalizedKey, value);
        normalizedEntries.push([normalizedKey, value]);
    }

    for (const alias of aliases) {
        if (product[alias] !== undefined && product[alias] !== null && String(product[alias]).trim() !== "") {
            return product[alias];
        }

        const normalizedAlias = normalizeHeaderKey(alias);
        if (normalizedKeyToValue.has(normalizedAlias)) {
            const value = normalizedKeyToValue.get(normalizedAlias);
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return value;
            }
        }
    }

    // Fuzzy fallback for messy headers (extra words / punctuation / spacing)
    for (const [normalizedKey, value] of normalizedEntries) {
        if (value === undefined || value === null || String(value).trim() === "") continue;
        for (const alias of aliases) {
            const normalizedAlias = normalizeHeaderKey(alias);
            if (!normalizedAlias) continue;
            if (normalizedKey.includes(normalizedAlias) || normalizedAlias.includes(normalizedKey)) {
                return value;
            }
        }
    }

    return undefined;
};

// כותרות עברית מומלצות: מס' פריט, שם פריט, ברקוד, מחיר קנייה לפני מע"מ, מחיר מכירה לפני מע"מ, מחיר מבצע, משקל, יחידת משקל, שם ספק, כשרות, שם קבוצה
const ITEM_NUMBER_ALIASES = [
    "itemNumber",
    "item_number",
    "item number",
    "ItemNumber",
    "מס' פריט",
    "מס פריט",
    "מספר פריט",
    "מס פריט רווחית"
];
const BARCODE_ALIASES = ["barcode", "Barcode", "ברקוד", "ברקוד מוצר"];
const TITLE_ALIASES = ["title_he", "title", "שם פריט", "שם הפריט", "שם מוצר", "שם המצר", "שם המוצר"];
const CATEGORY_ALIASES = ["categories", "שם קבוצה", "קטגוריה", "קטגוריות", "קבוצה"];
const KASHRUT_ALIASES = ["kashrut", "כשרות"];
const SALE_PRICE_ALIASES = ["salePrice", "sale_price", "מחיר מכירה לפני מע\"מ", "מחיר מכירה לפני מעמ", "מחיר מכירה", "salePriceBeforeVat"];
const OFFER_ALIASES = ["offer", "מחיר מבצע", "מבצע"];
const WEIGHT_ALIASES = ["weight", "משקל"];
/** תואם ל-Product.weightUnit.enum — רק התאמה מדויקת (אחרי trim) נשמרת */
const WEIGHT_UNIT_ENUM_VALUES = ["", "גרם", "קילו", "ליטר", "מ״ל", "יחידה", "מ״ק", "ק״ג", "מ״ג"];
const WEIGHT_UNIT_ALIASES = ["weightUnit", "weight_unit", "WeightUnit", "יחידת משקל", "יחידתמשקל"];

/** מיישר מירכאות מאקסל/אנגלית (U+0022 וכו׳) לגרשיים עבריים (U+05F4) כמו ב-enum */
const normalizeWeightUnitQuotes = (s) =>
    String(s)
        .trim()
        .replace(/[\u201C\u201D\u0022\uFF02]/g, "\u05F4");

const sanitizeWeightUnitForImport = (value) => {
    if (value === undefined || value === null) return undefined;
    const normalized = normalizeWeightUnitQuotes(value);
    if (!normalized) return undefined;
    const canonical = WEIGHT_UNIT_ENUM_VALUES.find((v) => v === normalized);
    return canonical !== undefined ? canonical : undefined;
};

const SUPPLIER_ALIASES = ["supplier", "שם ספק", "ספק"];
const COST_PRICE_ALIASES = ["warehousePrice", "מחיר קנייה לפני מע\"מ", "מחיר קנייה לפני מעמ", "מחיר מחסן", "costPriceBeforeVat"];
const STOCK_ALIASES = [
    "stock",
    "Stock",
    "מלאי",
    "כמות במלאי",
    "quantity",
    "qty",
    "inventory",
];
const MANAGE_STOCK_ALIASES = [
    "manageStock",
    "ניהול מלאי",
    "מנהל מלאי",
    "ManageStock",
];

/** ממיר מחרוזת מופרדת בפסיקים למערך (לקטגוריות, כשרות) */
const stringToArray = (value) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value;
    const str = String(value).trim();
    if (!str) return undefined;
    return str.split(",").map((s) => s.trim()).filter(Boolean);
};

const normalizeRawImportProduct = (rawProduct, defaultPriceListName) => {
    const normalized = { ...rawProduct };

    const itemNumber = resolveFieldValue(rawProduct, ITEM_NUMBER_ALIASES);
    const barcode = resolveFieldValue(rawProduct, BARCODE_ALIASES);
    const title = resolveFieldValue(rawProduct, TITLE_ALIASES);
    const category = resolveFieldValue(rawProduct, CATEGORY_ALIASES);
    const kashrutRaw = resolveFieldValue(rawProduct, KASHRUT_ALIASES);
    const salePrice = parseNumberish(resolveFieldValue(rawProduct, SALE_PRICE_ALIASES));
    const offer = parseNumberish(resolveFieldValue(rawProduct, OFFER_ALIASES));
    const weight = parseNumberish(resolveFieldValue(rawProduct, WEIGHT_ALIASES));
    const weightUnitResolved = sanitizeWeightUnitForImport(resolveFieldValue(rawProduct, WEIGHT_UNIT_ALIASES));
    const supplier = resolveFieldValue(rawProduct, SUPPLIER_ALIASES);
    const costPrice = parseNumberish(resolveFieldValue(rawProduct, COST_PRICE_ALIASES));
    const stockParsed = parseNumberish(resolveFieldValue(rawProduct, STOCK_ALIASES));
    const manageStockRaw = resolveFieldValue(rawProduct, MANAGE_STOCK_ALIASES);

    if (!normalized.itemNumber && itemNumber !== undefined) normalized.itemNumber = itemNumber;
    if (!normalized.barcode && barcode !== undefined) normalized.barcode = barcode;
    // תמיד להעביר כותרת ל-title_he כדי ש-processMultilingualFields יבנה title: { he: "..." }
    const titleValue =
        (title !== undefined && title !== null && String(title).trim() !== "")
            ? String(title).trim()
            : (typeof normalized.title === "string" && normalized.title.trim() !== "")
                ? normalized.title.trim()
                : (typeof normalized.title_he === "string" && normalized.title_he.trim() !== "")
                    ? normalized.title_he.trim()
                    : undefined;
    if (titleValue) {
        normalized.title_he = titleValue;
        delete normalized.title;
    }
    if (!normalized.categories && category !== undefined) {
        normalized.categories = stringToArray(category) || (typeof category === "string" ? [category.trim()] : category);
    }
    if (!normalized.kashrut && kashrutRaw !== undefined) {
        const kashrutArr = stringToArray(kashrutRaw);
        normalized.kashrut = kashrutArr && kashrutArr.length ? kashrutArr : (kashrutRaw ? [String(kashrutRaw).trim()] : undefined);
    }
    if (weight !== null && normalized.weight === undefined) normalized.weight = weight;
    if (weightUnitResolved !== undefined && normalized.weightUnit === undefined) {
        normalized.weightUnit = weightUnitResolved;
    }
    if (supplier !== undefined && supplier !== null && String(supplier).trim() !== "" && normalized.supplier === undefined) {
        normalized.supplier = String(supplier).trim();
    }

    if ((!normalized.prices || normalized.prices.length === 0) && (salePrice !== null || offer !== null) && defaultPriceListName) {
        const basePrice = salePrice !== null ? salePrice : offer;
        normalized.prices = [{
            priceList: defaultPriceListName,
            price: basePrice,
            ...(offer !== null ? { salePrice: offer } : {}),
            ...(costPrice !== null ? { warehousePrice: costPrice } : {})
        }];
    }

    if (stockParsed !== null && (normalized.stock === undefined || normalized.stock === null)) {
        normalized.stock = Math.max(0, Math.floor(stockParsed));
    }

    if (
        manageStockRaw !== undefined &&
        manageStockRaw !== null &&
        String(manageStockRaw).trim() !== "" &&
        normalized.manageStock === undefined
    ) {
        const s = String(manageStockRaw).trim().toLowerCase();
        if (["כן", "yes", "true", "1", "y", "on"].includes(s)) {
            normalized.manageStock = true;
        } else if (["לא", "no", "false", "0", "n", "off"].includes(s)) {
            normalized.manageStock = false;
        }
    }

    return normalized;
};

/** דורש רק ברקוד; מספר פריט אופציונלי */
/** בודק אם לערך יש "תוכן" בייבוא (לא ריק) – לשימוש בעדכון חלקי */
const hasImportValue = (value) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return String(value).trim() !== "";
    if (typeof value === "number") return true;
    if (typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") {
        return Object.keys(value).length > 0 &&
            Object.values(value).some(v => v !== undefined && v !== null && String(v).trim?.() !== "");
    }
    return true;
};

/**
 * בונה אובייקט עדכון חלקי: רק שדות שיש להם ערך ב-processedProduct.
 * בעדכון מוצר קיים – מעדכן רק שדות שמגיעים מהייבוא, לא מוחק ערכים קיימים.
 */
const buildMergePatch = (processedProduct, existingProduct) => {
    const patch = {};
    const updatableFields = [
        "barcode", "itemNumber", "categories", "kashrut", "weight", "weightUnit", "supplier",
        "prices", "stock", "tag", "description", "image", "expiryDate",
        "manageStock", "minStockThreshold", "lastStockUpdate", "hasSentStockAlert"
    ];

    for (const field of updatableFields) {
        const v = processedProduct[field];
        if (!hasImportValue(v)) continue;
        patch[field] = v;
    }

    if (hasImportValue(processedProduct.title)) {
        const existingTitle = existingProduct.title && typeof existingProduct.title === "object" ? existingProduct.title : {};
        patch.title = { ...existingTitle, ...processedProduct.title };
    }

    return patch;
};

const validateRequiredIdentifiers = (product) => {
    const itemNumber = normalizeIdentifier(resolveFieldValue(product, ITEM_NUMBER_ALIASES));
    const barcode = normalizeBarcode(resolveFieldValue(product, BARCODE_ALIASES));

    if (!barcode || String(barcode).trim() === "") {
        return {
            itemNumber: itemNumber || "",
            barcode: barcode || "",
            error: {
                en: "Missing barcode. Ensure the Excel has a column named 'barcode' and that this row has a value.",
                he: "חסר ברקוד (מק\"ט). ודא שבאקסל יש עמודה ברקוד ושבשורה זו יש ערך."
            }
        };
    }

    return { itemNumber: itemNumber || "", barcode, error: null };
};

/**
 * עיבוד רשימת מוצרים לייבוא
 * ייבוא חלקי (upsert) - כל שורה מעובדת בנפרד, שורות שגויות נדלגות
 * @param {Array} products - מערך מוצרים לייבוא
 * @returns {Promise<Object>} תוצאות הייבוא
 */
const importProductsList = async (products) => {
    const insertedProducts = [];
    const updatedProducts = [];
    const errors = [];

    // שליפת כל המחירונים מראש לביצועים טובים יותר
    const priceLists = await PriceList.find({}).lean();
    const priceListMap = new Map();
    priceLists.forEach(pl => {
        priceListMap.set(pl.name.toLowerCase(), pl._id);
    });

    // שליפת כל הקטגוריות מראש לביצועים טובים יותר
    const categories = await Category.find({}).lean();
    const categoryMap = new Map();
    // יצירת מפה עם כל הוריאציות של כל slug (מקורי, lowercase, encoded)
    categories.forEach(category => {
        const slug = category.slug;
        const lowerSlug = slug.toLowerCase();
        const encodedSlug = encodeURIComponent(slug).toLowerCase();

        // הוספה למפה עם כל הוריאציות
        categoryMap.set(slug, category._id);
        categoryMap.set(lowerSlug, category._id);
        categoryMap.set(encodedSlug, category._id);

        // תמיכה בקטגוריות לפי שם (עברית/אנגלית)
        const heName = category?.name?.he ? String(category.name.he).trim() : "";
        const enName = category?.name?.en ? String(category.name.en).trim() : "";
        if (heName) {
            categoryMap.set(heName, category._id);
            categoryMap.set(heName.toLowerCase(), category._id);
            categoryMap.set(encodeURIComponent(heName).toLowerCase(), category._id);
        }
        if (enName) {
            categoryMap.set(enName, category._id);
            categoryMap.set(enName.toLowerCase(), category._id);
            categoryMap.set(encodeURIComponent(enName).toLowerCase(), category._id);
        }
    });

    const defaultPriceListName = priceLists[0]?.name || null;

    // עיבוד כל המוצרים שורה-שורה – זיהוי רק לפי ברקוד, ללא התחשבות במספר פריט
    for (let i = 0; i < products.length; i++) {
        const rawProduct = products[i];
        const productIndex = i + 1;

        try {
            const normalizedRawProduct = normalizeRawImportProduct(rawProduct, defaultPriceListName);
            const {
                barcode,
                error: identifierError
            } = validateRequiredIdentifiers(normalizedRawProduct);

            if (identifierError) {
                errors.push(createProductError(productIndex, normalizedRawProduct, identifierError));
                continue;
            }

            // עיבוד המוצר – שומרים את מספר הפריט מהקובץ אם קיים
            const itemNumberFromFile = normalizeIdentifier(normalizedRawProduct.itemNumber);
            const processedProduct = await processProductForImport({
                ...normalizedRawProduct,
                itemNumber: itemNumberFromFile,
                barcode
            }, priceListMap);

            // טיפול בקטגוריות
            if (processedProduct.categories && Array.isArray(processedProduct.categories)) {
                const { categoryIds, notFoundCategories } = processCategoriesForImport(
                    processedProduct.categories,
                    categoryMap
                );

                if (notFoundCategories.length > 0) {
                    errors.push(createProductError(productIndex, processedProduct, {
                        en: `Categories not found in system (use exact slug or name): ${notFoundCategories.join(', ')}`,
                        he: `קטגוריות לא נמצאו במערכת (השתמש ב-slug או בשם מדויק): ${notFoundCategories.join(', ')}`
                    }));
                    continue;
                }

                processedProduct.categories = categoryIds;
            }

            // טיפול במחירים
            if (processedProduct.prices && Array.isArray(processedProduct.prices)) {
                const { processedPrices, errors: priceErrors } = processPricesForImport(
                    processedProduct.prices,
                    priceListMap
                );

                if (priceErrors.length > 0) {
                    errors.push(createProductError(productIndex, processedProduct, priceErrors[0]));
                    continue;
                }

                processedProduct.prices = processedPrices;
            }

            const hasBarcodeForLookup = processedProduct.barcode && String(processedProduct.barcode).trim() !== "";
            const existingByBarcode = hasBarcodeForLookup
                ? await Product.findOne({ barcode: processedProduct.barcode })
                : null;

            const targetProduct = existingByBarcode || null;

            if (targetProduct) {
                // עדכון חלקי: רק שדות שיש להם ערך בייבוא – לא משנים תאים ריקים
                const patch = buildMergePatch(processedProduct, targetProduct);
                Object.assign(targetProduct, patch);
                await targetProduct.save();
                updatedProducts.push(targetProduct);
            } else {
                // מוצר חדש – כותרת חובה בסכמה; אם חסרה, ברירת מחדל לפי ברקוד
                if (!processedProduct.title || Object.keys(processedProduct.title || {}).length === 0) {
                    processedProduct.title = { he: `מוצר ${processedProduct.barcode || ""}`, en: `Product ${processedProduct.barcode || ""}` };
                }
                const titleError = validateTitle(processedProduct);
                if (titleError) {
                    errors.push(createProductError(productIndex, processedProduct, titleError));
                    continue;
                }
                const newProduct = new Product(processedProduct);
                await newProduct.save();
                insertedProducts.push(newProduct);
            }
        } catch (err) {
            // שגיאה כללית בעיבוד המוצר
            const currentProduct = products[i] || {};
            errors.push(createProductError(productIndex, currentProduct, {
                en: err.message || "Unknown error",
                he: err.message || "שגיאה לא ידועה"
            }));
        }
    }

    return {
        insertedProducts,
        updatedProducts,
        errors: []
            .concat(errors)
    };
};

/**
 * יצירת תשובת API מפורטת
 * @param {Array} insertedProducts - מוצרים שהוכנסו בהצלחה
 * @param {Array} updatedProducts - מוצרים שעודכנו בהצלחה
 * @param {Array} errors - שגיאות שנוצרו
 * @param {number} totalCount - סך כל המוצרים
 */
const createImportResponse = (insertedProducts, updatedProducts, errors, totalCount) => {
    const insertedCount = insertedProducts.length;
    const updatedCount = updatedProducts.length;
    const successCount = insertedCount + updatedCount;
    const errorCount = errors.length;
    const statusCode = errorCount > 0 && successCount === 0 ? 400 : 200;

    return {
        statusCode,
        data: {
            message: {
                en: errorCount > 0
                    ? `Import completed with issues. Inserted: ${insertedCount}, updated: ${updatedCount}, skipped: ${errorCount}.`
                    : `Import completed. Inserted: ${insertedCount}, updated: ${updatedCount}.`,
                he: errorCount > 0
                    ? `הייבוא הסתיים עם בעיות. נוספו: ${insertedCount}, עודכנו: ${updatedCount}, דולגו: ${errorCount}.`
                    : `הייבוא הסתיים. נוספו: ${insertedCount}, עודכנו: ${updatedCount}.`
            },
            summary: {
                total: totalCount,
                succeeded: successCount,
                failed: errorCount,
                inserted: insertedCount,
                updated: updatedCount,
                skipped: errorCount
            },
            ...(errors.length > 0 && { errors }),
            ...(insertedProducts.length > 0 && {
                insertedProducts: insertedProducts.map(p => ({
                    _id: p._id,
                    title: p.title,
                    itemNumber: p.itemNumber,
                    barcode: p.barcode,
                    slug: p.slug
                }))
            }),
            ...(updatedProducts.length > 0 && {
                updatedProducts: updatedProducts.map(p => ({
                    _id: p._id,
                    title: p.title,
                    itemNumber: p.itemNumber,
                    barcode: p.barcode,
                    slug: p.slug
                }))
            })
        }
    };
};

module.exports = {
    validateTitle,
    processCategoriesForImport,
    processPricesForImport,
    processProductForImport,
    handleMongoDBError,
    createProductError,
    importProductsList,
    createImportResponse
};
