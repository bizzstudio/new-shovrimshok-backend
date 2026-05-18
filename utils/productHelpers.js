// utils/productHelpers.js

/**
 * המרת מחרוזת מופרדת בפסיקים למערך
 * @param {string} value - המחרוזת להמרה
 * @returns {Array} מערך של ערכים
 */
const parseCommaSeparatedString = (value) => {
    if (!value || typeof value !== 'string') {
        return value;
    }

    // פיצול לפי פסיק והסרת רווחים מיותרים
    return value
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);
};

/**
 * ניסיון לפרסר ערך שעשוי להיות JSON string או מחרוזת מופרדת בפסיקים
 * @param {*} value - הערך לפרסר
 * @returns {*} הערך המפורסר או המקורי
 */
const tryParseJSON = (value) => {
    if (typeof value !== 'string') {
        return value;
    }

    // אם זה מחרוזת ריקה או רק רווחים - להחזיר undefined
    if (!value.trim()) {
        return undefined;
    }

    // ניסיון לפרסר כ-JSON
    try {
        const parsed = JSON.parse(value);
        return parsed;
    } catch (e) {
        // אם הפרסור נכשל, להחזיר את הערך המקורי
        return value;
    }
};

/**
 * עיבוד שדות רב-לשוניים באופן דינאמי
 * מחפש שדות בפורמט fieldName_langCode (לדוגמה: title_he, description_en)
 * ומארגן אותם לאובייקטים רב-לשוניים
 * @param {Object} data - אובייקט עם שדות רב-לשוניים
 * @returns {Object} אובייקט מעובד עם שדות רב-לשוניים מאורגנים
 */
const processMultilingualFields = (data) => {
    const processedData = {};
    const multilingualFields = {}; // אובייקט לאחסון שדות רב-לשוניים

    // רשימת שדות שצריכים להיות מערכים
    const arrayFields = ['categories', 'tags', 'images'];

    // מעבר על כל השדות בנתונים
    for (const [key, value] of Object.entries(data)) {
        // נסיון לפרסר את הערך אם זה JSON string
        let parsedValue = tryParseJSON(value);

        // אם זה שדה שצריך להיות מערך והוא עדיין string - להמיר ממחרוזת מופרדת בפסיקים
        if (arrayFields.includes(key) && typeof parsedValue === 'string') {
            parsedValue = parseCommaSeparatedString(parsedValue);
        }

        // בדיקה האם זה שדה רב-לשוני (מסתיים ב-_LANG)
        // לדוגמה: title_he, description_en, title_ru
        const match = key.match(/^(.+)_([a-z]{2})$/i);

        if (match) {
            const fieldName = match[1]; // לדוגמה: title, description
            const lang = match[2]; // לדוגמה: he, en, ru

            // אתחול האובייקט של השדה אם לא קיים
            if (!multilingualFields[fieldName]) {
                multilingualFields[fieldName] = {};
            }

            // הוספת השפה לשדה
            multilingualFields[fieldName][lang] = parsedValue;
        } else {
            // שדה רגיל - מעתיק את הערך המפורסר
            processedData[key] = parsedValue;
        }
    }

    // מיזוג השדות הרב-לשוניים לתוך הנתונים המעובדים
    return { ...processedData, ...multilingualFields };
};

/**
 * יצירת מזהה מוצר ייחודי עבור הודעות שגיאה
 * @param {Object} product - אובייקט המוצר
 * @param {number} index - אינדקס המוצר במערך
 * @returns {string} מזהה המוצר
 */
const getProductIdentifier = (product, index) => {
    return product.title?.he ||
        product.title?.en ||
        product.title_he ||
        product.title_en ||
        product.barcode ||
        `מוצר ${index}`;
};

/**
 * יצירת slug מטקסט עברי
 * @param {string} text - הטקסט ליצירת ה-slug
 * @param {string} fallback - ערך חלופי אם הטקסט ריק
 * @returns {string} slug מעובד
 */
const createSlugFromHebrew = (text, fallback = '') => {
    if (!text) return fallback;

    // המרה לאותיות קטנות והסרת רווחים מיותרים
    let slug = text.toString().trim().toLowerCase();

    // החלפת רווחים במקף
    slug = slug.replace(/\s+/g, '-');

    // הסרת תווים מיוחדים (להשאיר רק אותיות עברית, אנגלית, מספרים, מקפים)
    slug = slug.replace(/[^\u0590-\u05FF\w\-]+/g, '');

    // הסרת מקפים כפולים
    slug = slug.replace(/\-\-+/g, '-');

    // הסרת מקפים מתחילת וסוף המחרוזת
    slug = slug.replace(/^-+/, '').replace(/-+$/, '');

    return slug || fallback;
};

/**
 * יצירת slug ייחודי למוצר
 * @param {Object} product - אובייקט המוצר
 * @returns {string} slug
 */
const generateProductSlug = (product) => {
    if (product.slug) {
        return product.slug;
    }

    const hebrewTitle = product.title?.he || product.title?.en || '';
    const barcode = product.barcode || '';
    const slug = createSlugFromHebrew(hebrewTitle, barcode);

    // אם עדיין אין slug, יצירת slug אקראי
    if (!slug) {
        return `product-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    return slug;
};

module.exports = {
    parseCommaSeparatedString,
    tryParseJSON,
    createSlugFromHebrew,
    processMultilingualFields,
    getProductIdentifier,
    generateProductSlug
};
