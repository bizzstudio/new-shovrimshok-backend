// controller/productController.js
const Product = require("../models/Product");
const PriceList = require("../models/PriceList");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const { languageCodes } = require("../utils/data");
const Offer = require("../models/Offer");
const Customer = require("../models/Customer");
const { parseText, generateHebrewVariations, createApostropheIgnoringRegex } = require("../utils/voiceParser");
const { importProductsList, createImportResponse } = require("../utils/importProducts");
const { generateProductSlug } = require("../utils/productHelpers");
const { normalizeQueryValue } = require("../utils/queryUtils");
const { roundQuantity } = require("../utils/quantityDecimals");
const JSZip = require("jszip");
const axios = require("axios");

/** מוצרים חדשים בבאנדל חנות (דף הבית): מספיק לרשימה + גלילה חוזרת */
const STORE_RECENT_PRODUCTS_LIMIT = 10;

const sanitizeStoreProduct = (product) => {
  if (!product) return product;
  const safeProduct = product.toObject ? product.toObject() : { ...product };
  delete safeProduct.itemNumber;
  return safeProduct;
};

/** מיון כותרת בעברית בלי לזרוק אם חסר title.he */
const compareStoreProductTitleHe = (a, b) =>
  String(a?.title?.he ?? "").localeCompare(String(b?.title?.he ?? ""), "he");

const sanitizeStoreProductForRequest = (product, req) => {
  if (!product) return null;
  return sanitizeStoreProduct(product);
};

const getPermittedBarcodeSet = async (userId) => {
  if (!userId) return null;
  const customer = await Customer.findById(userId)
    .select("mainCustomer")
    .populate({ path: "mainCustomer", select: "permittedBarcodes" })
    .lean();

  const barcodes = customer?.mainCustomer?.permittedBarcodes;
  if (!Array.isArray(barcodes) || barcodes.length === 0) return null;

  return new Set(
    barcodes
      .map((barcode) => String(barcode || "").trim())
      .filter(Boolean)
  );
};

const applyPermittedBarcodesToQuery = (queryObject, permittedBarcodes) => {
  if (!permittedBarcodes || permittedBarcodes.size === 0) return queryObject;
  return { ...queryObject, barcode: { $in: [...permittedBarcodes] } };
};

const addProduct = async (req, res) => {
  try {
    const productData = {
      ...req.body,
      productId: req.body.productId
        ? req.body.productId
        : new mongoose.Types.ObjectId(),
    };

    // יצירת slug אוטומטי אם לא סופק
    if (!productData.slug) {
      productData.slug = generateProductSlug(productData);
    }

    // אם יש מלאי, מעדכן את תאריך העדכון ומאפס את התראת המלאי
    if (productData.stock !== undefined && productData.stock !== null) {
      productData.lastStockUpdate = new Date();
      productData.hasSentStockAlert = false; // איפוס התראת המלאי בעת עדכון מלאי
    }

    const newProduct = new Product(productData);
    await newProduct.save();
    res.send(newProduct);
  } catch (err) {
    console.log('addProduct error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

/** יצירת מוצר מהאפליקציה (קליטת סחורה – כשלא נמצא ברקוד) */
const createProductFromApp = async (req, res) => {
  try {
    const {
      barcode,
      title,
      image,
      supplier,
      sortCode,
      weight,
      weightUnit,
      kashrut,
      categories: categoriesInput,
      stockQuantity,
      expiryDate,
      minStockAlert,
      salePrice,
      purchasePrice,
    } = req.body;

    if (!barcode || typeof barcode !== "string" || !barcode.trim()) {
      return res.status(400).send({
        message: { he: "חסר ברקוד", en: "Barcode is required" },
      });
    }
    const titleObj = title && typeof title === "object" ? title : {};
    if (!titleObj.he && !titleObj.en) {
      return res.status(400).send({
        message: { he: "נא למלא כותרת מוצר (עברית או אנגלית)", en: "Product title (Hebrew or English) is required" },
      });
    }

    const defaultPriceList = await PriceList.findOne().sort({ isDefault: -1 }).lean();
    const defaultCategory = await Category.findOne({ status: "show" }).lean();
    if (!defaultPriceList || !defaultCategory) {
      return res.status(500).send({
        message: { he: "חסר מחירון או קטגוריה ברירת מחדל במערכת", en: "Missing default price list or category in system" },
      });
    }

    const slugBase = generateProductSlug({ title: titleObj, barcode: barcode.trim() });
    let slug = slugBase;
    let counter = 0;
    while (await Product.findOne({ slug })) {
      slug = `${slugBase}-${++counter}`;
    }

    const weightUnitEnum = ["", "גרם", "קילו", "ליטר", "מ״ל", "יחידה", "מ״ק", "ק״ג", "מ״ג"];
    const safeWeightUnit =
      weightUnit && weightUnitEnum.includes(weightUnit) ? weightUnit : "";

    const kashrutArr = Array.isArray(kashrut)
      ? kashrut
      : typeof kashrut === "string" && kashrut.trim()
        ? kashrut.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

    let categoryIds = [defaultCategory._id];
    if (Array.isArray(categoriesInput) && categoriesInput.length > 0) {
      const found = await Category.find({
        $or: [
          { "name.he": { $in: categoriesInput } },
          { "name.en": { $in: categoriesInput } },
          { slug: { $in: categoriesInput.map((s) => String(s).trim().toLowerCase()) } },
        ],
      }).lean();
      if (found.length > 0) categoryIds = found.map((c) => c._id);
    }

    const stock = Number.isFinite(Number(stockQuantity)) ? Math.max(0, Number(stockQuantity)) : 0;
    const expiryDateParsed = expiryDate ? new Date(expiryDate) : undefined;
    const minStockThreshold =
      Number.isFinite(Number(minStockAlert)) && Number(minStockAlert) >= 0
        ? Number(minStockAlert)
        : undefined;
    const priceNum = Number.isFinite(Number(salePrice)) ? Number(salePrice) : 0;
    const warehousePriceNum = Number.isFinite(Number(purchasePrice)) ? Number(purchasePrice) : undefined;

    const productData = {
      productId: new mongoose.Types.ObjectId(),
      barcode: barcode.trim(),
      title: { he: titleObj.he || "", en: titleObj.en || "" },
      slug,
      image: image && typeof image === "string" && image.trim() ? [image.trim()] : [],
      categories: categoryIds,
      stock,
      expiryDate: expiryDateParsed,
      lastStockUpdate: stock > 0 ? new Date() : undefined,
      manageStock: true,
      minStockThreshold: minStockThreshold ?? null,
      hasSentStockAlert: false,
      kashrut: kashrutArr,
      supplier: supplier && typeof supplier === "string" ? supplier.trim() : undefined,
      sortCode: sortCode && typeof sortCode === "string" ? sortCode.trim() : undefined,
      weight: Number.isFinite(Number(weight)) ? Number(weight) : undefined,
      weightUnit: safeWeightUnit || undefined,
      status: "show",
      isWarehouseProduct: false,
      isVatFree: true,
      prices: [
        {
          priceList: defaultPriceList._id,
          price: priceNum,
          salePrice: priceNum || undefined,
          warehousePrice: warehousePriceNum,
        },
      ],
    };

    const newProduct = new Product(productData);
    await newProduct.save();
    const populated = await Product.findById(newProduct._id)
      .populate({ path: "prices.priceList" })
      .lean();
    res.status(201).send(populated);
  } catch (err) {
    console.log("createProductFromApp error:", err);
    res.status(500).send({
      message: {
        he: err.message || "שגיאה ביצירת מוצר",
        en: err.message || "Error creating product",
      },
    });
  }
};

/**
 * ייבוא מוצרים בכמות גדולה
 * מקבל מערך של מוצרים ומעבד אותם בצורה מקצועית עם וולידציות ודיווח מפורט
 */
const addAllProducts = async (req, res) => {
  try {
    // בדיקה שיש מערך מוצרים
    if (!req.body.products || !Array.isArray(req.body.products)) {
      return res.status(400).send({
        message: {
          en: "Please provide a list of products",
          he: "נא לספק רשימת מוצרים"
        }
      });
    }

    // ייבוא המוצרים באמצעות המודול המודולרי
    const { insertedProducts, updatedProducts, errors } = await importProductsList(req.body.products);

    // יצירת תשובה מפורטת
    const response = createImportResponse(
      insertedProducts,
      updatedProducts,
      errors,
      req.body.products.length
    );

    console.log('addAllProducts response: ',);
    console.dir(response, { depth: null, colors: true });

    // החזרת התשובה עם סטטוס קוד מתאים
    res.status(response.statusCode).send(response.data);
  } catch (err) {
    console.log('addAllProducts error: ', err);
    res.status(500).send({
      message: {
        en: "An error occurred, please try again later.",
        he: "התרחשה שגיאה, אנא נסו שנית מאוחר יותר."
      },
      error: err.message
    });
  }
};

const getShowingProducts = async (req, res) => {
  try {
    const products = await Product.find({
      status: "show",
      isWarehouseProduct: { $ne: true }
    })
      .populate({ path: "prices.priceList" })
      .sort({ _id: -1 });
    res.send(products.map(sanitizeStoreProduct));
    // console.log("products", products);
  } catch (err) {
    console.log('getShowingProducts error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

/** ייצוא CSV לאדמין: כולל עמודת מלאי וכותרות תואמות ייבוא (importProducts) */
const exportProductsImportCsv = async (req, res) => {
  try {
    const formatCsvField = (f) => {
      const s = String(f ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    // כמו getAllPriceLists + Products.jsx: רשימת מחירונים לפי createdAt יורד, אז isDefault או [0]
    // (לא sort לפי _id — זה נתן מחירון אחר מ"מחירון ברירת מחדל" באדמין כשאין isDefault)
    const allPriceLists = await PriceList.find({})
      .sort({ createdAt: -1 })
      .select("_id isDefault")
      .lean();
    const resolvedDefaultPl =
      allPriceLists.find((pl) => pl.isDefault === true) || allPriceLists[0] || null;
    const defaultPriceListId = resolvedDefaultPl?._id
      ? String(resolvedDefaultPl._id)
      : null;

    const pickPriceEntryForExport = (product) => {
      const arr = Array.isArray(product.prices) ? product.prices : [];
      if (!arr.length) return {};
      if (defaultPriceListId) {
        const match = arr.find((ep) => {
          const plId = ep.priceList?._id ?? ep.priceList;
          return plId != null && String(plId) === defaultPriceListId;
        });
        if (match) return match;
      }
      return arr[0];
    };

    const products = await Product.find({})
      .populate({ path: "categories", select: "name slug" })
      .populate({ path: "prices.priceList", select: "name" })
      .sort({ _id: -1 })
      .lean();

    const headers = [
      "barcode",
      "itemNumber",
      "שם פריט",
      "title_en",
      "מלאי",
      "manageStock",
      "שם קבוצה",
      "מחיר מכירה לפני מע\"מ",
      "מחיר מבצע",
      "מחיר קנייה לפני מע\"מ",
      "status",
    ];

    const csvRows = [headers.join(",")];

    for (const p of products) {
      const titleHe = p.title?.he ?? "";
      const titleEn = p.title?.en ?? "";
      const cats = (p.categories || [])
        .map((c) => c?.name?.he || c?.name?.en || c?.slug || "")
        .filter(Boolean)
        .join(", ");
      const pr0 = pickPriceEntryForExport(p);
      const listPrice = pr0.price != null ? Number(pr0.price) : "";
      const promo =
        pr0.salePrice != null && Number(pr0.salePrice) !== Number(pr0.price)
          ? Number(pr0.salePrice)
          : "";
      const cost = pr0.warehousePrice != null ? Number(pr0.warehousePrice) : "";

      const row = [
        p.barcode ?? "",
        p.itemNumber ?? "",
        titleHe,
        titleEn,
        p.stock != null ? p.stock : 0,
        p.manageStock === false ? "false" : "true",
        cats,
        listPrice,
        promo === "" ? "" : promo,
        cost === "" ? "" : cost,
        p.status || "show",
      ].map(formatCsvField);

      csvRows.push(row.join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="products-export.csv"'
    );
    res.send("\uFEFF" + csvRows.join("\n"));
  } catch (err) {
    console.error("exportProductsImportCsv error:", err);
    res.status(500).send({ message: err.message });
  }
};

const getFacebookFeedCSV = async (req, res) => {
  try {
    const BASE_URL = process.env.STORE_URL; // הדומיין הציבורי שלך (חייב להיות נגיש לפייסבוק)
    const BRAND_NAME = process.env.COMPANY_NAME;

    const products = await Product.find({
      status: 'show',
      isWarehouseProduct: { $ne: true }
    })
      .populate({ path: "prices.priceList" })
      .sort({ _id: -1 });

    const headers = [
      'id',
      'title',
      'description',
      'availability',
      'condition',
      'price',
      'link',
      'image_link',
      'brand',
      'item_group_id'
    ];

    const csvRows = [headers.join(',')];

    for (const p of products) {
      // חישוב מלאי כולל
      const totalStock = p.stock || 0;

      const placeholderImage = "https://res.cloudinary.com/ahossain/image/upload/v1655097002/placeholder_kvepfp.png";
      const imageSrc = Array.isArray(p?.image)
        ? (p.image.length > 0 ? p.image[0] : placeholderImage)
        : (p?.image || placeholderImage);

      // מציאת מחיר ברירת מחדל (המחיר הראשון)
      const defaultPrice = p.prices && p.prices.length > 0 ? p.prices[0].price : 0;

      const row = [
        p.barcode || p._id,
        p.title?.he || p.title?.en || '',
        p.description?.he || p.description?.en || p.title?.he || '',
        totalStock > 0 ? 'in stock' : 'out of stock',
        'new',
        `${Number(defaultPrice || 0).toFixed(2)} ILS`,
        `${BASE_URL}/product/${p.slug || ''}`,
        imageSrc,
        BRAND_NAME,
        p.productId || p._id
      ].map(f => {
        const s = String(f ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      });

      csvRows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="facebook-products-feed.csv"'
    );
    res.send('\uFEFF' + csvRows.join('\n'));
  } catch (err) {
    console.error('getFacebookFeedCSV error:', err);
    res.status(500).send({ message: err.message });
  }
};

// פונקציה לדירוג תוצאות לפי קרבה לשאילתא המקורית
const rankProductsByRelevance = (products, originalQuery, queryWords, variations = []) => {
  // console.log('originalQuery :>> ', originalQuery);
  // console.log('queryWords :>> ', queryWords);
  // console.log('variations :>> ', variations);

  const normalizeForComparison = (text) => {
    return text.toLowerCase()
      .replace(/['"''`ʼʻ]/g, '') // הסרת גרשים
      .replace(/[^\u0590-\u05ffa-z0-9\s]/g, ' ') // הסרת סימנים מיוחדים
      .replace(/\s+/g, ' ')
      .trim();
  };

  // פונקציה משופרת לבדיקה אם מילה מופיעה כמילה שלמה (תומכת בעברית)
  const isWholeWordMatch = (text, word) => {
    // פיצול הטקסט למילים ובדיקה אם המילה מופיעה כמילה נפרדת
    const words = text.split(/\s+/);
    return words.some(textWord => textWord === word);
  };

  return products.map(product => {
    const heTitle = normalizeForComparison(product.title.he || '');
    const enTitle = normalizeForComparison(product.title.en || '');
    const normalizedQuery = normalizeForComparison(originalQuery);

    let score = 0;

    // 1. בדיקה אם יש התאמה מושלמת לאחת מה-variations (הציון הכי גבוה!)
    let foundPerfectVariationMatch = false;
    if (variations && variations.length > 0) {
      for (const variation of variations) {
        const normalizedVariation = normalizeForComparison(variation);
        if (heTitle === normalizedVariation || enTitle === normalizedVariation) {
          score += 15000; // ציון הכי גבוה - התאמה מושלמת לווריאציה
          foundPerfectVariationMatch = true;
          break;
        }
        // בדיקה אם הווריאציה מופיעה כמילה שלמה בתחילת השם
        else if (heTitle.startsWith(normalizedVariation + ' ') || enTitle.startsWith(normalizedVariation + ' ') ||
          heTitle.startsWith(normalizedVariation + '(') || enTitle.startsWith(normalizedVariation + '(')) {
          score += 12000; // ציון גבוה מאוד - ווריאציה בתחילת השם
          foundPerfectVariationMatch = true;
          break;
        }
      }
    }

    // 2. התאמה מדויקת של השאילתה המעובדת (אם לא מצאנו התאמה מושלמת לווריאציה)
    if (!foundPerfectVariationMatch) {
      if (heTitle === normalizedQuery || enTitle === normalizedQuery) {
        score += 10000; // ציון גבוה להתאמה מושלמת לשאילתה המעובדת
      }
      // 3. התאמה של המחרוזת השלמה כ-substring
      else if (heTitle.includes(normalizedQuery) || enTitle.includes(normalizedQuery)) {
        score += 5000; // ציון גבוה אבל פחות מהתאמה מושלמת

        // בונוס אם זה בתחילת השם
        if (heTitle.startsWith(normalizedQuery) || enTitle.startsWith(normalizedQuery)) {
          score += 2000;
        }
      }
    }

    // 4. בדיקת התאמה של מילים בודדות - מילה שלמה vs חלק ממילה
    let wordMatchScore = 0;
    let foundWholeWords = 0;
    let foundPartialWords = 0;

    // בדיקה גם מול הvariations
    const allWordsToCheck = [...queryWords];
    if (variations && variations.length > 0) {
      // נוסיף את כל הvariations כמילים לבדיקה
      variations.forEach(variation => {
        const variationWords = variation.trim().split(/\s+/).filter(word => word.length > 1);
        allWordsToCheck.push(...variationWords);
      });
    }

    // הסרת כפילויות
    const uniqueWordsToCheck = [...new Set(allWordsToCheck.map(w => normalizeForComparison(w)))];

    uniqueWordsToCheck.forEach(word => {
      // בדיקה להתאמה של מילה שלמה
      const heWholeMatch = isWholeWordMatch(heTitle, word);
      const enWholeMatch = isWholeWordMatch(enTitle, word);

      if (heWholeMatch || enWholeMatch) {
        foundWholeWords++;

        // ציון גבוה יותר אם המילה מופיעה בvariations המקוריות
        const isFromOriginalVariation = variations && variations.some(v =>
          normalizeForComparison(v).includes(word)
        );

        const baseScore = isFromOriginalVariation ? 4000 : 3000;
        wordMatchScore += baseScore; // ציון גבוה מאוד למילה שלמה

        // בונוס אם המילה השלמה בתחילת השם
        const titleToCheck = heWholeMatch ? heTitle : enTitle;
        if (titleToCheck.startsWith(word + ' ') || titleToCheck === word) {
          wordMatchScore += isFromOriginalVariation ? 1500 : 1000;
        }
      }
      // אם לא מצאנו התאמה שלמה, בדוק כ-substring
      else if (heTitle.includes(word) || enTitle.includes(word)) {
        foundPartialWords++;
        wordMatchScore += 500; // ציון נמוך יותר לחלק ממילה
      }
    });

    score += wordMatchScore;

    // 5. ציון לפי אחוז המילים שנמצאו (עדיפות למילים שלמות)
    const totalWords = uniqueWordsToCheck.length;
    if (totalWords > 0) {
      const wholeWordPercentage = (foundWholeWords / totalWords) * 100;
      const partialWordPercentage = (foundPartialWords / totalWords) * 100;

      score += wholeWordPercentage * 10; // משקל גבוה למילים שלמות
      score += partialWordPercentage * 2;  // משקל נמוך למילים חלקיות
    }

    // 6. בונוס קל לשמות קצרים יותר (רק אם יש התאמה טובה)
    if (foundWholeWords > 0) {
      const titleLength = heTitle.length || enTitle.length;
      if (titleLength > 0) {
        score += Math.max(0, 30 - titleLength / 5); // בונוס גבוה יותר לשמות קצרים
      }
    }

    // console.log(`Product: "${product.title.he}" - WholeWords: ${foundWholeWords}, PartialWords: ${foundPartialWords}, Score: ${score}`);

    return { product, score };
  }).sort((a, b) => b.score - a.score);
};

// קבלת מוצר על פי חיפוש קולי
const findProductByTranscript = async (req, res) => {
  const { transcript } = req.query;
  // console.log('transcript :>> ', transcript);

  if (!transcript) {
    return res.status(400).json({
      message: {
        he: 'לא התקבל טקסט מתמלול',
        en: 'No transcript received'
      }
    });
  }

  /* ─── 1. ניתוח טקסט ─── */
  const { query, quantity, variations } = parseText(transcript);
  // console.log({ query, quantity, variations })

  if (!query) {
    return res.status(400).json({
      message: {
        he: 'לא נמצא שם מוצר בטקסט',
        en: 'No product name found in text'
      }
    });
  }

  /* ─── 2. חיפוש בדאטה־בייס ─── */
  try {
    const permittedBarcodes = await getPermittedBarcodeSet(req.user?._id);
    // יצירת תנאי חיפוש מרובה - כולל ווריאציות צליליות
    const searchConditions = [];

    // חיפוש עבור השאילתה הבסיסית וכל הווריאציות הצליליות
    const allQueries = variations && variations.length > 0 ? variations : [query];

    allQueries.forEach(currentQuery => {
      // פיצול השאילתה למילים נפרדות
      const queryWords = currentQuery.trim().split(/\s+/).filter(word => word.length > 1);

      // חיפוש רגיל (מחרוזת שלמה) - עם התעלמות מגרשים
      const fullRegex = createApostropheIgnoringRegex(currentQuery);
      searchConditions.push(
        { 'title.he': fullRegex },
        { 'title.en': fullRegex },
        { slug: fullRegex },
        { sku: currentQuery },
        { barcode: currentQuery }
      );

      // חיפוש מתקדם - כל מילה בנפרד (טוב לטיפול בסוגריים ואותיות סופיות)
      if (queryWords.length > 0) {
        // יצירת רגקסים עם ווריאציות של כל מילה (אותיות סופיות + זכר/נקבה)
        const wordVariationsRegexes = queryWords.map(word => {
          const hebrewVariations = generateHebrewVariations(word);
          // console.log(`🔍 Variations for "${word}":`, hebrewVariations);

          // יצירת regex שמחפש כל אחת מהווריאציות תוך התעלמות מגרשים
          const variationsWithoutApostrophes = hebrewVariations.map(v =>
            createApostropheIgnoringRegex(v).source
          );
          const variationsPattern = variationsWithoutApostrophes.join('|');
          // console.log(`📝 Regex pattern for "${word}": ${variationsPattern}`);
          return new RegExp(variationsPattern, 'i');
        });

        // תנאי שכל המילים (או הווריאציות שלהן) צריכות להופיע בכותרת העברית
        const heAllWordsCondition = {
          $and: wordVariationsRegexes.map(regex => ({ 'title.he': regex }))
        };

        // תנאי שכל המילים צריכות להופיע בכותרת האנגלית (עם התעלמות מגרשים)
        const enAllWordsCondition = {
          $and: queryWords.map(word => ({ 'title.en': createApostropheIgnoringRegex(word) }))
        };

        searchConditions.push(heAllWordsCondition, enAllWordsCondition);
      }
    });

    // console.log('searchConditions :>> ');
    // console.dir(searchConditions, { depth: null, colors: true });

    // שינוי מ-findOne ל-find כדי לקבל מספר תוצאות
    const products = await Product.find({
      status: 'show',
      ...(req.user?.isCashier ? {} : { isWarehouseProduct: { $ne: true } }),
      ...(permittedBarcodes ? { barcode: { $in: [...permittedBarcodes] } } : {}),
      $or: searchConditions
    })
      .populate({ path: "prices.priceList" })
      .lean()
      .limit(20); // מגביל ל-20 תוצאות למניעת עומס

    if (!products || products.length === 0) {
      return res.status(404).json({
        message: {
          he: `לא נמצא מוצר עבור "${transcript}"`,
          en: `No product found for "${transcript}"`
        }
      });
    }

    // אם יש רק תוצאה אחת - החזר אותה ישירות
    if (products.length === 1) {
      // console.log(`Found single product: "${products[0].title.he}"`);
      return res.json({
        product: sanitizeStoreProductForRequest(products[0], req),
        quantity,
      });
    }

    // דירוג התוצאות לפי רלוונטיות וסדר מילים
    const queryWords = query.trim().split(/\s+/).filter(word => word.length > 1);
    const rankedProducts = rankProductsByRelevance(products, query, queryWords, variations);

    const bestProduct = rankedProducts[0].product;
    // console.log(`Found best product from ${products.length} results: "${bestProduct.title.he}" (score: ${rankedProducts[0].score})`);

    return res.json({
      product: sanitizeStoreProductForRequest(bestProduct, req),
      quantity,
    });

  } catch (err) {
    console.error('voice-search error:', err);
    return res.status(500).json({
      message: {
        he: 'התרחשה שגיאה, נסו שוב',
        en: 'An error occurred, please try again'
      }
    });
  }
};

const getAllProducts = async (req, res) => {
  const title = normalizeQueryValue(req.query.title);
  const category = normalizeQueryValue(req.query.category);
  const price = normalizeQueryValue(req.query.price);
  const pageRaw = normalizeQueryValue(req.query.page);
  const limitRaw = normalizeQueryValue(req.query.limit);

  // console.log('req.query: ', req.query);

  let queryObject = {};
  let sortObject = {};
  if (title) {
    const titleQueries = languageCodes.map((lang) => ({
      [`title.${lang}`]: { $regex: `${title}`, $options: "i" },
    }));
    // חיפוש גם לפי שם מוצר וגם לפי ברקוד
    queryObject.$or = [
      ...titleQueries,
      { barcode: { $regex: `${title}`, $options: "i" } },
    ];
  }

  if (price === "low") {
    sortObject = {
      "prices.0.price": 1,
    };
  } else if (price === "high") {
    sortObject = {
      "prices.0.price": -1,
    };
  } else if (price === "published") {
    queryObject.status = "show";
  } else if (price === "unPublished") {
    queryObject.status = "hide";
  } else if (price === "status-selling") {
    // מוצרים עם מלאי
    queryObject.$expr = {
      $gt: [
        { $ifNull: ["$stock", 0] },
        0
      ]
    };
  } else if (price === "status-out-of-stock") {
    // מוצרים ללא מלאי
    queryObject.$expr = {
      $lte: [
        { $ifNull: ["$stock", 0] },
        0
      ]
    };
  } else if (price === "date-added-asc") {
    sortObject.createdAt = 1;
  } else if (price === "date-added-desc") {
    sortObject.createdAt = -1;
  } else if (price === "date-updated-asc") {
    sortObject.updatedAt = 1;
  } else if (price === "date-updated-desc") {
    sortObject.updatedAt = -1;
  } else {
    sortObject = { _id: -1 };
  }

  // console.log('sortObject', sortObject);

  if (category) {
    let categoryId;

    // בדיקה האם הקטגוריה היא ObjectId חוקי
    if (mongoose.Types.ObjectId.isValid(category) && category.length === 24) {
      categoryId = category; // חיפוש לפי ObjectId
    } else {
      // חיפוש לפי slug של הקטגוריה
      const foundCategory = await Category.findOne({ slug: category });
      if (foundCategory) {
        categoryId = foundCategory._id;
      } else {
        // אם לא מצאנו קטגוריה, מחזירים תוצאה ריקה
        return res.send({
          products: [],
          totalDoc: 0,
          limits: Number(limit),
          pages: Number(page),
        });
      }
    }

    queryObject.categories = categoryId;
  }

  const pages = pageRaw ? Number(pageRaw) : undefined;
  const limits = limitRaw ? Number(limitRaw) : undefined;

  const shouldPaginate =
    Number.isFinite(pages) &&
    Number.isFinite(limits) &&
    pages >= 1 &&
    limits >= 1;

  let query = Product.find(queryObject)
    .populate({ path: "categories", select: "_id name slug" })
    .populate({ path: "prices.priceList" })
    .sort(sortObject);

  if (shouldPaginate) {
    const skip = (pages - 1) * limits;
    query = query.skip(skip).limit(limits);
  }

  try {
    const totalDoc = await Product.countDocuments(queryObject);
    const products = await query;

    res.send({
      products,
      totalDoc,
      limits: shouldPaginate ? limits : totalDoc,
      pages: shouldPaginate ? pages : 1,
    });
  } catch (err) {
    console.log('getAllProducts error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getProductBySlug = async (req, res) => {
  // console.log("slug", req.params.slug);
  try {
    const permittedBarcodes = await getPermittedBarcodeSet(req.user?._id);
    const queryObject = {
      slug: req.params.slug,
      isWarehouseProduct: { $ne: true }
    };

    if (permittedBarcodes) {
      queryObject.barcode = { $in: [...permittedBarcodes] };
    }

    const product = await Product.findOne(queryObject)
      .populate({ path: "categories", select: "name _id slug" })
      .populate({ path: "prices.priceList" });
    res.send(sanitizeStoreProductForRequest(product, req));
  } catch (err) {
    console.log('getProductBySlug error: ', err);
    res.status(500).send({
      message: `Slug problem, ${err.message}`,
    });
  }
};

const getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;

    if (!barcode) {
      return res.status(400).send({
        message: {
          "he": "לא נמצא ברקוד",
          "en": "Barcode not found"
        }
      });
    }

    const product = await Product.findOne({
      barcode: barcode,
    })
      .populate({ path: "categories", select: "_id name" })
      .populate({ path: "prices.priceList" });

    if (!product) {
      return res.status(404).send({
        message: "Product not found",
      });
    }

    res.send(product);
  } catch (err) {
    console.log('getProductByBarcode error: ', err);
    res.status(500).send({
      message: `Barcode problem, ${err.message}`,
    });
  }
};

/**
 * הוספת כמות למלאי לפי ברקוד (לקליטת סחורה)
 * Body: { quantity } או { addQuantity }
 */
const addStockByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    let addQty = req.body.quantity != null ? Number(req.body.quantity) : Number(req.body.addQuantity);
    if (Number.isFinite(addQty)) addQty = roundQuantity(addQty);

    if (!barcode) {
      return res.status(400).send({
        message: { he: "חסר ברקוד", en: "Barcode is required" },
      });
    }
    if (!Number.isFinite(addQty) || addQty < 1e-6) {
      return res.status(400).send({
        message: { he: "כמות לא תקינה", en: "Valid quantity is required" },
      });
    }

    const product = await Product.findOne({ barcode });
    if (!product) {
      return res.status(404).send({
        message: { he: "מוצר לא נמצא", en: "Product not found" },
      });
    }

    const prevStock = product.stock ?? 0;
    product.stock = prevStock + addQty;
    product.lastStockUpdate = new Date();
    product.hasSentStockAlert = false;
    await product.save();

    res.send({
      product: product.toObject ? product.toObject() : product,
      previousStock: prevStock,
      added: addQty,
      newStock: product.stock,
    });
  } catch (err) {
    console.log("addStockByBarcode error:", err);
    res.status(500).send({
      message: { he: "שגיאה בעדכון מלאי", en: err.message },
    });
  }
};

/**
 * הורדת כמות מהמלאי לפי ברקוד (ליקוט – מה שנלקח יורד מהמלאי)
 * Body: { quantity }
 */
const deductStockByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    let deductQty = Number(req.body.quantity);
    if (Number.isFinite(deductQty)) deductQty = roundQuantity(deductQty);

    if (!barcode) {
      return res.status(400).send({
        message: { he: "חסר ברקוד", en: "Barcode is required" },
      });
    }
    if (!Number.isFinite(deductQty) || deductQty < 1e-6) {
      return res.status(400).send({
        message: { he: "כמות לא תקינה", en: "Valid quantity is required" },
      });
    }

    const product = await Product.findOne({ barcode });
    if (!product) {
      return res.status(404).send({
        message: { he: "מוצר לא נמצא", en: "Product not found" },
      });
    }

    const prevStock = product.stock ?? 0;
    product.stock = Math.max(0, prevStock - deductQty);
    product.lastStockUpdate = new Date();
    product.hasSentStockAlert = false;
    await product.save();

    res.send({
      product: product.toObject ? product.toObject() : product,
      previousStock: prevStock,
      deducted: deductQty,
      newStock: product.stock,
    });
  } catch (err) {
    console.log("deductStockByBarcode error:", err);
    res.status(500).send({
      message: { he: "שגיאה בהורדת מלאי", en: err.message },
    });
  }
};

const getProductById = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
    })
      .populate({ path: "categories", select: "_id name" })
      .populate({ path: "prices.priceList" });

    res.send(product);
  } catch (err) {
    console.log('getProductById error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const updateProduct = async (req, res) => {
  try {
    console.log('updateProduct req.body: ', req.body);
    const product = await Product.findById(req.params.id);

    if (product) {
      // עדכון השדות – רק אם נשלחו (לא undefined)
      if (req.body.title !== undefined) {
        product.title = { ...product.title, ...req.body.title };
      }
      if (req.body.description !== undefined) {
        product.description = { ...product.description, ...req.body.description };
      }
      if (req.body.productId !== undefined) product.productId = req.body.productId;
      if (req.body.barcode !== undefined) product.barcode = req.body.barcode;
      if (req.body.itemNumber !== undefined) product.itemNumber = req.body.itemNumber;
      if (req.body.slug !== undefined) product.slug = req.body.slug;
      if (req.body.categories !== undefined) product.categories = req.body.categories;
      if (req.body.image !== undefined) product.image = req.body.image;

      // עדכון מלאי - אם השתנה, מעדכן את תאריך העדכון ומאפס את התראת המלאי
      if (req.body.stock !== undefined) {
        const stockChanged = product.stock !== req.body.stock;
        product.stock = req.body.stock;
        if (stockChanged) {
          product.lastStockUpdate = new Date();
          product.hasSentStockAlert = false; // איפוס התראת המלאי בעת עדכון מלאי
        }
      }
      if (req.body.expiryDate !== undefined) product.expiryDate = req.body.expiryDate;

      if (req.body.manageStock !== undefined) product.manageStock = req.body.manageStock;
      if (req.body.minStockThreshold !== undefined) product.minStockThreshold = req.body.minStockThreshold;
      if (req.body.sales !== undefined) product.sales = req.body.sales;
      if (req.body.tag !== undefined) product.tag = req.body.tag;
      if (req.body.prices !== undefined) product.prices = req.body.prices;
      if (req.body.kashrut !== undefined) product.kashrut = req.body.kashrut;
      if (req.body.supplier !== undefined) product.supplier = req.body.supplier;
      if (req.body.isWarehouseProduct !== undefined) product.isWarehouseProduct = req.body.isWarehouseProduct;
      if (req.body.isComplementaryProduct !== undefined) {
        product.isComplementaryProduct = Boolean(req.body.isComplementaryProduct);
      }
      if (req.body.soldByWeight !== undefined) {
        product.soldByWeight = Boolean(req.body.soldByWeight);
      }
      if (req.body.isVatFree !== undefined) product.isVatFree = req.body.isVatFree;
      if (req.body.sortCode !== undefined) product.sortCode = req.body.sortCode;
      if (req.body.weight !== undefined) product.weight = req.body.weight;
      if (req.body.weightUnit !== undefined) product.weightUnit = req.body.weightUnit;
      if (req.body.managementNotes !== undefined) product.managementNotes = req.body.managementNotes;
      if (req.body.status !== undefined) product.status = req.body.status;

      await product.save();
      res.send({ data: product, message: "Product updated successfully!" });
    } else {
      res.status(404).send({
        message: "Product Not Found!",
      });
    }
  } catch (err) {
    console.log('updateProduct error: ', err);
    res.status(404).send(err.message);
  }
};

const updateProductPrice = async (req, res) => {
  try {
    const { id, priceListId } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).send({
        message: {
          en: "Product Not Found!",
          he: "המוצר לא נמצא!",
        },
      });
    }

    // בדיקה שהמחירון קיים
    const priceList = await PriceList.findById(priceListId);
    if (!priceList) {
      return res.status(404).send({
        message: {
          en: "Price List Not Found!",
          he: "המחירון לא נמצא!",
        },
      });
    }

    // בדיקה שהמחיר נשלח בבקשה
    if (req.body.price === undefined) {
      return res.status(400).send({
        message: {
          en: "Please enter a price!",
          he: "נא להזין מחיר!",
        },
      });
    }

    // חיפוש מחיר קיים למחירון זה
    const priceIndex = product.prices.findIndex(
      (p) => p.priceList.toString() === priceListId
    );

    if (priceIndex !== -1) {
      // עדכון רק את המחיר הרגיל, ללא שינוי בשדות האחרים
      product.prices[priceIndex].price = req.body.price;
    } else {
      // יצירת מחיר חדש למחירון זה - רק עם המחיר הרגיל
      product.prices.push({
        priceList: priceListId,
        price: req.body.price,
      });
    }

    await product.save();
    res.send({
      data: product, message: {
        en: "Product price updated successfully!",
        he: "המחיר עודכן בהצלחה!",
      }
    });
  } catch (err) {
    console.log('updateProductPrice error: ', err);
    res.status(404).send(err.message);
  }
};

const updateManyProducts = async (req, res) => {
  try {
    const updatedData = {};
    for (const key of Object.keys(req.body)) {
      if (
        req.body[key] !== "[]" &&
        Object.entries(req.body[key]).length > 0 &&
        req.body[key] !== req.body.ids
      ) {
        // console.log('req.body[key]', typeof req.body[key]);
        updatedData[key] = req.body[key];
      }
    }

    // console.log("updated data", updatedData);

    // אם יש עדכון מלאי, מוסיפים גם עדכון תאריך ואיפוס התראת מלאי
    if (updatedData.stock !== undefined && updatedData.stock !== null) {
      updatedData.lastStockUpdate = new Date();
      updatedData.hasSentStockAlert = false; // איפוס התראת המלאי בעת עדכון מלאי
    }

    await Product.updateMany(
      { _id: { $in: req.body.ids } },
      {
        $set: updatedData,
      },
      {
        multi: true,
      }
    );
    res.send({
      message: "Products update successfully!",
    });
  } catch (err) {
    console.log('updateManyProducts error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const updateStatus = async (req, res) => {
  try {
    const newStatus = req.body.status;
    console.log('newStatus', newStatus);

    await Product.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: newStatus,
        },
      }
    );

    res.status(200).send({
      message: `Product ${newStatus} Successfully!`,
    });
  } catch (err) {
    console.log('updateStatus error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const deleteProduct = async (req, res) => {
  try {
    await Product.deleteOne({ _id: req.params.id });
    res.status(200).send({
      message: "Product Deleted Successfully!",
    });
  } catch (err) {
    console.log('deleteProduct error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getShowingStoreProducts = async (req, res) => {
  try {
    let queryObject = {};
    const permittedBarcodes = await getPermittedBarcodeSet(req.user?._id);

    // הוספת תנאי לסינון מוצרים שהם לא מוצרי מחסן בלבד
    queryObject.isWarehouseProduct = { $ne: true };

    const { category, title, slug, sku } = req.query;

    queryObject.status = "show";

    // חיפוש לפי קטגוריה
    if (category) {
      let categoryIds = [];

      // בדיקה האם הקטגוריה היא ObjectId חוקי
      if (mongoose.Types.ObjectId.isValid(category) && category.length === 24) {
        categoryIds.push(category); // חיפוש לפי ObjectId
      } else {
        // חיפוש לפי slug של הקטגוריה - גם מקורי וגם encoded
        const encodedCategory = encodeURIComponent(category).toLowerCase();

        const categoryQueries = [
          { slug: category },
          { slug: encodedCategory }
        ];

        const foundCategories = await Category.find({
          $or: categoryQueries
        });

        if (foundCategories.length > 0) {
          const parentIds = foundCategories.map(cat => cat._id);
          const childCategories = await Category.find({
            parentId: { $in: parentIds.map(String) }
          }).lean();
          categoryIds = [...parentIds, ...childCategories.map(cat => cat._id)];
        } else {
          // אם לא מצאנו קטגוריה לפי הslug, להחזיר מוצרים ריקים
          return res.send({
            products: [],
            popularProducts: [],
            relatedProducts: [],
            discountedProducts: [],
            recentProducts: [],
            productsWithOffers: [],
          });
        }
      }

      // שימוש בקטגוריות שנמצאו כדי להוסיף אותן לשאילתת החיפוש
      queryObject.categories = {
        $in: categoryIds,
      };
    }

    if (title) {
      const encodedTitle = encodeURIComponent(title).toLowerCase();

      // יצירת queries עם title מקורי
      const titleQueries = languageCodes.map((lang) => ({
        [`title.${lang}`]: { $regex: `${title}`, $options: "i" },
      }));

      // יצירת queries עם title encoded
      const encodedTitleQueries = languageCodes.map((lang) => ({
        [`title.${lang}`]: { $regex: `${encodedTitle}`, $options: "i" },
      }));

      // שילוב שני המערכים
      queryObject.$or = [...titleQueries, ...encodedTitleQueries];
    }

    if (slug) {
      const encodedSlug = encodeURIComponent(slug).toLowerCase();

      const slugQueries = [
        { slug: slug },
        { slug: encodedSlug }
      ];

      // אם כבר יש $or (מחיפוש title), נשתמש ב-$and
      if (queryObject.$or && title) {
        queryObject.$and = [
          { $or: queryObject.$or },
          { $or: slugQueries }
        ];
        delete queryObject.$or;
      } else {
        // אם אין title, פשוט נשתמש ב-$or עבור slug
        queryObject.$or = slugQueries;
      }
    }

    if (sku) {
      queryObject.sku = sku;
    }

    queryObject = applyPermittedBarcodesToQuery(queryObject, permittedBarcodes);

    let products = [];
    let popularProducts = [];
    let discountedProducts = [];
    let recentProducts = [];
    let productsWithOffers = [];
    let relatedProducts = [];
    let allPermittedProductsForFallback = [];

    if (slug) {
      products = await Product.find(queryObject)
        .populate({ path: "categories", select: "name _id slug" })
        .populate({ path: "prices.priceList" })
        .sort({ _id: -1 })
        .limit(100);
      relatedProducts = await Product.find({
        categories: { $in: products[0]?.categories || [] },
        isWarehouseProduct: { $ne: true },
        _id: { $ne: products[0]?._id },
        ...(permittedBarcodes ? { barcode: { $in: [...permittedBarcodes] } } : {})
      })
        .populate({ path: "categories", select: "_id name slug" })
        .populate({ path: "prices.priceList" });
    } else if (sku) {
      products = await Product.find({
        barcode: sku,
        isWarehouseProduct: { $ne: true },
        ...(permittedBarcodes ? { barcode: { $in: [...permittedBarcodes] } } : {})
      })
        .populate({ path: "categories" })
        .populate({ path: "prices.priceList" });
    } else if (title || category) {
      products = await Product.find(queryObject)
        .populate({ path: "categories", select: "name _id slug" })
        .populate({ path: "prices.priceList" })
        .sort({ _id: -1 })
        .limit(100);
    } else {
      if (permittedBarcodes) {
        allPermittedProductsForFallback = await Product.find({
          status: "show",
          isWarehouseProduct: { $ne: true },
          barcode: { $in: [...permittedBarcodes] },
        })
          .populate({ path: "categories", select: "name _id slug" })
          .populate({ path: "prices.priceList" })
          .lean();
      }

      // קודם כל נביא מוצרים עם barcode
      const barcodeQuery = { ...queryObject, barcode: { $exists: true, $ne: null, $ne: "" } };
      let productsWithBarcode = await Product.find(barcodeQuery)
        .populate({ path: "categories", select: "name _id slug" })
        .populate({ path: "prices.priceList" })
        .lean(); // משתמשים ב-lean() כדי לקבל אובייקטים רגילים למיון

      // מיון מוצרים עם barcode לפי המספר שמופיע בברקוד (מהקטן לגדול)
      productsWithBarcode = productsWithBarcode
        .map(product => {
          // חילוץ המספר מהברקוד
          const barcodeNumber = parseInt(product.barcode) || 0;
          return { ...product, barcodeNumber };
        })
        .sort((a, b) => a.barcodeNumber - b.barcodeNumber)
        .map(({ barcodeNumber, ...product }) => product); // הסרת השדה הזמני

      const barcodeCount = productsWithBarcode.length;
      const targetLimit = 20;

      if (permittedBarcodes) {
        // כשיש הגבלת ברקודים, מציגים רק מוצרים שהורשו במפורש
        // לא משלימים ממוצרים ללא ברקוד
        popularProducts = productsWithBarcode.slice(0, targetLimit);
      } else if (barcodeCount < targetLimit) {
        // אם אין 20 מוצרים עם barcode, נשלים לפי sales
        const remainingCount = targetLimit - barcodeCount;

        // שאילתה למוצרים ללא barcode (או עם barcode ריק)
        const noBarcodeQuery = { ...queryObject };
        // הוספת תנאי barcode - אם יש $or קיים, נשתמש ב-$and
        if (noBarcodeQuery.$or) {
          noBarcodeQuery.$and = [
            { $or: noBarcodeQuery.$or },
            {
              $or: [
                { barcode: { $exists: false } },
                { barcode: null },
                { barcode: "" }
              ]
            }
          ];
          delete noBarcodeQuery.$or;
        } else {
          noBarcodeQuery.$or = [
            { barcode: { $exists: false } },
            { barcode: null },
            { barcode: "" }
          ];
        }

        // נביא מוצרים לפי sales שלא כבר יש להם barcode
        const productsBySales = await Product.find(noBarcodeQuery)
          .populate({ path: "categories", select: "name _id slug" })
          .populate({ path: "prices.priceList" })
          .sort({ sales: -1 })
          .limit(remainingCount)
          .lean();

        // שילוב התוצאות: קודם מוצרים עם barcode, אחר כך לפי sales
        popularProducts = [...productsWithBarcode, ...productsBySales];
      } else {
        // אם יש 20 או יותר מוצרים עם barcode, נקח רק את הראשונים
        popularProducts = productsWithBarcode.slice(0, targetLimit);
      }

      // חיפוש קטגוריית מבצעים לפי slug
      // ניתן למצוא קטגוריה עם slug "offers" או "מבצעים"
      const offersCategory = await Category.findOne({ slug: { $in: ["offers", "מבצעים"] } });

      if (offersCategory) {
        discountedProducts = await Product.find({
          isWarehouseProduct: { $ne: true },
          status: "show",
          categories: { $in: [offersCategory._id] },
          ...(permittedBarcodes ? { barcode: { $in: [...permittedBarcodes] } } : {})
        })
          .populate({ path: "categories", select: "name _id slug" })
          .populate({ path: "prices.priceList" })
          .sort({ _id: -1 })
          .limit(20);
      } else {
        // אם לא נמצאה קטגוריית מבצעים, מחזירים מוצרים עם מחיר מבצע
        discountedProducts = await Product.find({
          isWarehouseProduct: { $ne: true },
          status: "show",
          "prices.salePrice": { $exists: true, $ne: null, $gt: 0 },
          ...(permittedBarcodes ? { barcode: { $in: [...permittedBarcodes] } } : {})
        })
          .populate({ path: "categories", select: "name _id slug" })
          .populate({ path: "prices.priceList" })
          .sort({ _id: -1 })
          .limit(20);
      }

      const offers = await Offer.find().populate({
        path: "products",
        populate: { path: "prices.priceList" }
      });

      productsWithOffers = offers
        .flatMap((offer) => (Array.isArray(offer.products) ? offer.products : []))
        .filter((p) => {
          if (!p || !p._id) return false;
          if (p.isWarehouseProduct === true) return false;
          if (!permittedBarcodes) return true;
          return permittedBarcodes.has(String(p.barcode || "").trim());
        });

      // סינון כפילויות (מוצרים null אחרי populate — לא לקרוא _id על undefined)
      productsWithOffers = productsWithOffers.filter(
        (product, index, self) =>
          product &&
          product._id &&
          index ===
            self.findIndex(
              (p) =>
                p &&
                p._id &&
                String(p._id) === String(product._id)
            )
      );

      // מוצרים אחרונים שנוספו למערכת (דף הבית — לא מבצעים)
      const recentBaseQuery = {
        status: "show",
        isWarehouseProduct: { $ne: true },
        ...(permittedBarcodes ? { barcode: { $in: [...permittedBarcodes] } } : {}),
      };
      recentProducts = await Product.find(recentBaseQuery)
        .populate({ path: "categories", select: "name _id slug" })
        .populate({ path: "prices.priceList" })
        .sort({ createdAt: -1 })
        .limit(STORE_RECENT_PRODUCTS_LIMIT);
    }

    // באנדל דף הבית (בלי slug/sku) — אם לא נכנסנו ל-else למעלה, recentProducts נשאר ריק.
    // ממלאים כאן כדי ש־recentProducts תמיד יוחזר לחנות ליד הקרוסלה.
    if (!slug && !sku && (!recentProducts || recentProducts.length === 0)) {
      const rq = {
        status: "show",
        isWarehouseProduct: { $ne: true },
        ...(permittedBarcodes ? { barcode: { $in: [...permittedBarcodes] } } : {}),
      };
      recentProducts = await Product.find(rq)
        .populate({ path: "categories", select: "name _id slug" })
        .populate({ path: "prices.priceList" })
        .sort({ createdAt: -1 })
        .limit(STORE_RECENT_PRODUCTS_LIMIT);
    }

    // Guard סופי: לקוח מוגבל תמיד יקבל אך ורק מוצרים מורשים
    if (permittedBarcodes) {
      const isPermitted = (product) => permittedBarcodes.has(String(product?.barcode || "").trim());
      products = products.filter(isPermitted);
      popularProducts = popularProducts.filter(isPermitted);
      relatedProducts = relatedProducts.filter(isPermitted);
      discountedProducts = discountedProducts.filter(isPermitted);
      recentProducts = recentProducts.filter(isPermitted);
      productsWithOffers = productsWithOffers.filter(isPermitted);

      // אם נשארו פחות מ-20 פופולריים, נשלים מתוך רשימת המורשים בלבד
      if (!slug && !sku && !title && !category && popularProducts.length < 20) {
        const existingIds = new Set(popularProducts.map((p) => String(p?._id)));
        const additions = allPermittedProductsForFallback.filter((p) => !existingIds.has(String(p?._id)));
        popularProducts = [...popularProducts, ...additions].slice(0, 20);
      }
    }

    // 'hide' מיון המוצרים לפי כותרת בעברית והסרת מוצרים שבסטטוס
    products = products.filter((p) => p && p.status == "show").sort(compareStoreProductTitleHe);
    popularProducts = popularProducts.filter((p) => p && p.status == "show");
    // .sort(compareStoreProductTitleHe);
    relatedProducts = relatedProducts.filter((p) => p && p.status == "show").sort(compareStoreProductTitleHe);
    discountedProducts = discountedProducts.filter((p) => p && p.status == "show").sort(compareStoreProductTitleHe);
    recentProducts = recentProducts.filter((p) => p && p.status == "show")
      .sort((a, b) => {
        const ts = (doc) => {
          if (doc?.createdAt) return new Date(doc.createdAt).getTime();
          if (doc?._id?.getTimestamp) return doc._id.getTimestamp().getTime();
          return 0;
        };
        return ts(b) - ts(a);
      });
    productsWithOffers = productsWithOffers
      .filter((p) => p && p.status == "show")
      .sort(compareStoreProductTitleHe);

    // console.log(popularProducts.map(p => p.title.he.split('').reverse().join('')))

    const mapP = (p) => sanitizeStoreProductForRequest(p, req);
    const mapList = (arr) => (Array.isArray(arr) ? arr.map(mapP).filter(Boolean) : []);
    res.send({
      products: mapList(products),
      popularProducts: mapList(popularProducts),
      relatedProducts: mapList(relatedProducts),
      discountedProducts: mapList(discountedProducts),
      recentProducts: mapList(recentProducts),
      productsWithOffers: mapList(productsWithOffers),
    });
  } catch (err) {
    console.log('getShowingStoreProducts error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const deleteManyProducts = async (req, res) => {
  try {
    const cname = req.cname;
    // console.log("deleteMany", cname, req.body.ids);

    await Product.deleteMany({ _id: req.body.ids });

    res.send({
      message: `Products Delete Successfully!`,
    });
  } catch (err) {
    console.log('deleteManyProducts error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

/**
 * הורדת כל תמונות המוצרים כקובץ ZIP
 * GET /export/images-zip
 */
const downloadProductImagesZip = async (req, res) => {
  try {
    const products = await Product.find({}).select("title itemNumber image").lean();

    const imageEntries = [];
    for (const product of products) {
      const images = Array.isArray(product.image)
        ? product.image
        : product.image
        ? [product.image]
        : [];

      const productName =
        (product.title && typeof product.title === "object"
          ? product.title.he
          : product.title) ||
        product.itemNumber ||
        String(product._id);

      const safeName = productName.replace(/[\\/:*?"<>|]/g, "_").trim();

      images.forEach((url, idx) => {
        if (url && typeof url === "string" && url.trim()) {
          const cleanUrl = url.trim().split("?")[0];
          const ext = cleanUrl.split(".").pop().toLowerCase() || "jpg";
          const filename =
            images.length > 1
              ? `${safeName}_${idx + 1}.${ext}`
              : `${safeName}.${ext}`;
          imageEntries.push({ url: url.trim(), filename });
        }
      });
    }

    if (!imageEntries.length) {
      return res.status(404).json({ message: "No images found" });
    }

    const zip = new JSZip();
    const folder = zip.folder("product-images");

    // הורדת כל תמונות מ-S3 בצד השרת (ללא בעיית CORS) והוספה ל-ZIP
    const batchSize = 30;
    for (let i = 0; i < imageEntries.length; i += batchSize) {
      const batch = imageEntries.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async ({ url, filename }) => {
          try {
            const response = await axios.get(url, {
              responseType: "arraybuffer",
              timeout: 8000,
            });
            folder.file(filename, Buffer.from(response.data));
          } catch (err) {
            console.warn(`Failed to fetch image: ${url} — ${err.message}`);
          }
        })
      );
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="product-images.zip"`);
    res.setHeader("Content-Length", zipBuffer.length);
    res.send(zipBuffer);
  } catch (err) {
    console.error("downloadProductImagesZip error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message });
    }
  }
};

module.exports = {
  addProduct,
  createProductFromApp,
  addAllProducts,
  getAllProducts,
  getShowingProducts,
  exportProductsImportCsv,
  getFacebookFeedCSV,
  findProductByTranscript,
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
  downloadProductImagesZip,
};
