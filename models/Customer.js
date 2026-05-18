// models/Customer.js
const mongoose = require("mongoose");

const CitySchema = new mongoose.Schema({
  _id: Number,
  city_code: Number,
  city_name_he: { type: String, required: true },
  city_name_en: String,
  region_code: Number,
  region_name: String,
  PIBA_bureau_code: Number,
  PIBA_bureau_name: String,
  Regional_Council_code: Number,
  Regional_Council_name: String,
}, { _id: false, strict: false }); // Allows additional fields

const customerSchema = new mongoose.Schema(
  {
    // קישור ללקוח ראשי (חובה)
    mainCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MainCustomer",
      required: true,
    },

    name: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
    },
    image: {
      type: String,
    },
    address: {
      city: CitySchema,
      street: String,
      houseNumber: String,
      apartmentNumber: String,
      floor: String,
      entryCode: String,
      postalCode: String,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      // הסרנו unique: true כי אותו אימייל יכול להיות לכמה תתי-לקוחות
    },
    phone: {
      type: String,
    },
    password: {
      type: String,
    },
    inBlackList: { // האם הלקוח לא רוצה לקבל הודעות סקר
      type: Boolean,
      default: false,
    },
    isCashier: {
      type: Boolean,
      default: false,
    },

    // מעקב אחר מבצעי"פעם אחת ללקוח" שנוצלו
    redeemedOffers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Offer",
      }
    ],

    // האם הלקוח רשום לאתר (יש לו סיסמה)
    isRegistered: {
      type: Boolean,
      default: false,
    },

    // מסגרת אשראי
    creditLimit: {
      type: Number,
      default: 0,
      min: 0,
    },

    // התראת סכום הזמנות לתקופה
    alertAmount: {
      type: Number,
      default: null,
      min: 0,
    },
    alertPeriod: {
      type: String,
      enum: ["weekly", "monthly"],
      default: null,
    },

    // יום אספקה שבועי 0=ראשון, 1=שני, ... 6=שבת
    weeklyDeliveryDay: {
      type: Number,
      min: 0,
      max: 6,
    },

    // Accounting provider mapping (Rivhit / future providers)
    accounting: {
      provider: {
        type: String,
        enum: ["rivhit"],
        default: "rivhit",
      },
      externalCustomerId: {
        type: Number, // Rivhit customer_id
        index: true,
      },
      syncedAt: {
        type: Date,
      },
      lastSyncError: {
        type: String,
      },
    },
  },
  {
    timestamps: true,
  }
);

// אינדקס קטן אם תרצה לבדוק מהר האם לקוח ניצל Offer מסוים
customerSchema.index({ _id: 1, redeemedOffers: 1 });

// אינדקס על mainCustomer לשליפה מהירה
customerSchema.index({ mainCustomer: 1 });

// אינדקס על email למרות שלא unique (לצורך חיפוש מהיר בלוגין)
customerSchema.index({ email: 1 });

const Customer = mongoose.model("Customer", customerSchema);

module.exports = Customer;