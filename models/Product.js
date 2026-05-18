// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // מזהה פנימי של המוצר
    productId: {
      type: String,
      required: false,
    },

    // מק"ט / SKU — חייב להיות ייחודי בקולקציה (אינדקס unique קיים ב-DB)
    sku: {
      type: String,
      required: false,
    },

    // ברקוד
    barcode: {
      type: String,
      required: false,
    },

    // מספר פריט פנימי (לא מוצג בחנות)
    itemNumber: {
      type: String,
      required: false,
    },

    // כותרת
    title: {
      type: Object,
      required: true,
    },

    // תיאור
    description: {
      type: Object,
      required: false,
    },

    // כתובת ייחודית
    slug: {
      type: String,
      required: true,
      unique: true,
    },

    // קטגוריות בהם המוצר מופיע
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: true,
      },
    ],

    // תמונות וסרטונים
    image: [String],

    // מלאי
    stock: {
      type: Number,
      required: false,
      default: 0,
    },

    // תאריך תפוגה
    expiryDate: {
      type: Date,
      required: false,
    },

    // תאריך עדכון מלאי אחרון
    lastStockUpdate: {
      type: Date,
      required: false,
    },

    // ניהול מלאי
    manageStock: {
      type: Boolean,
      default: false,
    },

    // מינימום מלאי להתראה
    minStockThreshold: {
      type: Number,
      required: false,
      default: null,
    },

    // האם כבר נשלחה התראת מלאי
    hasSentStockAlert: {
      type: Boolean,
      default: false,
    },

    // כמות מכירות
    sales: {
      type: Number,
      required: false,
    },

    // תגיות
    tag: [String],

    // מחירים (לפי מחירון)
    prices: [
      {
        priceList: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "PriceList",
          required: true,
        },
        price: {
          type: Number,
          required: true,
        },
        salePrice: {
          type: Number,
          required: false,
        },
        warehousePrice: {
          type: Number,
          required: false,
        },

        // מגבלת רכישה פר מחירון
        purchaseLimit: {
          type: Number,
          required: false,
          default: null,
        },
      },
    ],

    // כשרויות
    kashrut: [String],

    // ספק
    supplier: {
      type: String,
      required: false,
    },

    // מוצר מחסן בלבד
    isWarehouseProduct: {
      type: Boolean,
      default: false,
    },

    // מוצר משלים (למשל מכסה לקופסה) — בחנות: הודעה בעת הוספה ממקטע "מוצרים קשורים"
    isComplementaryProduct: {
      type: Boolean,
      default: false,
    },

    // מכירה לפי משקל (פירות/ירקות): המחיר לק״ג, מלאי וכמות בעגלה בק״ג (כולל עשרוני)
    soldByWeight: {
      type: Boolean,
      default: false,
    },

    // ללא מע"מ
    isVatFree: {
      type: Boolean,
      required: true,
      default: true,
    },

    // קוד מיון
    sortCode: {
      type: String,
      required: false,
    },

    // משקל
    weight: {
      type: Number,
      required: false,
    },

    // יחידת משקל
    weightUnit: {
      type: String,
      required: false,
      enum: ["", "גרם", "קילו", "ליטר", "מ״ל", "יחידה", "מ״ק", "ק״ג", "מ״ג"],
    },

    // הערות לניהול
    managementNotes: {
      type: String,
      required: false,
    },

    // סטטוס
    status: {
      type: String,
      default: "show",
      enum: ["show", "hide"],
    },

    // מקור ייבוא חיצוני
    source: {
      site:       { type: String, required: false },
      externalId: { type: String, required: false },
      url:        { type: String, required: false },
    },

    // מפתח ייחודי יציב לזיהוי חוצה-הרצות (לדוגמה: "shtibay:product:1118240")
    sourceKey: {
      type:     String,
      required: false,
      unique:   true,
      index:    true,
      sparse:   true,
    },

    // נתונים נוספים ממקור חיצוני שאינם חלק מהסכמה הראשית
    extraData: { type: mongoose.Schema.Types.Mixed, required: false },

    // המוצר המקורי כפי שהגיע מהמקור
    rawData: { type: mongoose.Schema.Types.Mixed, required: false },

    // מידע על סנכרון וייבוא
    sync: { type: mongoose.Schema.Types.Mixed, required: false },
  },
  {
    timestamps: true,
  }
);

const Product = mongoose.model("Product", productSchema);
module.exports = Product;
