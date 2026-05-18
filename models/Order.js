// models/Order.js
const mongoose = require("mongoose");
// const AutoIncrement = require("mongoose-sequence")(mongoose); // הסר שורה זו

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
  Regional_Council_name: String
}, { _id: false, strict: false }); // Allows additional fields

// Schema למסמכים חשבונאיים (Rivhit)
const RivhitDocSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["rivhit"], default: "rivhit" },

    // Rivhit identifiers
    document_type: mongoose.Schema.Types.Mixed, // Number or String
    document_number: mongoose.Schema.Types.Mixed,
    document_identity: String,
    confirmation_number: mongoose.Schema.Types.Mixed, // מספר הקצאה ממס הכנסה (confirmation_number)

    // Link / reference
    url: String,
    reference: String, // מזהה פנימי שלנו
    notes: String,

    issuedAt: { type: Date, default: Date.now },
    raw: { type: Object, select: false }, // אופציונלי לשמירת תשובת API
  }, { _id: false });

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    mainCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MainCustomer",
      required: true,
    },
    invoice: {
      type: Number,
      required: false,
    },
    cart: [{}],
    user_info: {
      name: {
        type: String,
        required: false,
      },
      lastName: {
        type: String,
        required: false,
      },
      email: {
        type: String,
        required: false,
      },
      contact: {
        type: String,
        required: false,
      },
      address: {
        city: {
          type: CitySchema,
          required: false,
        },
        street: {
          type: String,
          required: false,
        },
        houseNumber: {
          type: String,
          required: false,
        },
        apartmentNumber: {
          type: String,
          required: false,
        },
        floor: {
          type: String,
          required: false,
        },
        entryCode: {
          type: String,
          required: false,
        },
        postalCode: {
          type: String,
          required: false,
        }
      },
      country: {
        type: String,
        required: false,
      },
      zipCode: {
        type: String,
        required: false,
      },
      priceList: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PriceList",
        required: false,
      },
    },
    subTotal: {
      type: Number,
      required: true,
    },
    shippingCost: {
      type: Number,
      required: true,
    },
    discount: {
      type: Number,
      required: true,
      default: 0,
    },
    offerDiscount: {
      type: Number,
      required: false,
      default: 0,
    },
    total: {
      type: Number,
      required: true,
    },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: false,
    },
    shippingOption: {
      type: String,
      required: false,
    },
    paymentMethod: {
      type: String,
      required: true,
      default: "card",
    },
    cardInfo: {
      type: Object,
      required: false,
    },
    status: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Status",
      required: true,
    },
    // היסטוריית שינויים בסטטוס
    statusHistory: [
      {
        from: { type: String, required: false }, // שם הסטטוס הקודם
        to: { type: String, required: false },   // שם הסטטוס החדש
        changedAt: { type: Date, default: Date.now }, // זמן השינוי
        changedBy: { type: String, required: false }, // פונקציה שביצעה את השינוי
      },
    ],
    customer_note: {
      type: String,
      required: false,
    },
    actualMelaket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Status", // נניח שהמלקט הוא חלק מהסכמה Status
      required: false,
    },
    resFromLion: {
      type: Object,
      required: false,
    },
    // Customer satisfaction between 1-3
    customerSatisfaction: {
      type: Number,
      required: false,
      min: 1,
      max: 3,
    },
    // Bonus - If customer satisfaction is 1, the order total is multiplied by 0.04
    bonus: {
      type: Number,
      required: false,
    },
    // האם השליח צריך ליצור קשר או להניח ליד הדלת - שדה בוליאני
    callOnArrival: {
      type: Boolean,
    },
    // רשימת מבצעים שנוצלו בהזמנה (למעקב אחר oncePerCustomer)
    usedOfferIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
    }],

    paymentProvider: {
      type: String,
      enum: ["cardcom", "icredit"],
      default: "icredit",
    },

    // שדות Cardcom מפורטים
    cardcom: {
      lowProfileId: { type: String },
      webhookToken: { type: String, select: false }, // טוקן ייחודי לאימות webhook
      transactionId: { type: String },
      approvalNumber: { type: String },
      documentUrl: { type: String },
      documentNum: { type: String },
      documentType: { type: String },
      lastWebhookAt: { type: Date },

      // היסטוריית זיכויים
      refunds: [{
        amount: { type: Number, required: true },
        reason: { type: String, default: "" },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        refundTransactionId: { type: String },
        cancelOnly: { type: Boolean, default: false },
        gatewayResponse: { type: Object },
      }],

      // סטטוס תשלום
      isPaid: { type: Boolean, default: false },
      paidAt: { type: Date },

      // גוף מלא של webhook (לא נשמר בselect רגיל)
      body: { type: Object, select: false },
    },

    icredit: {
      publicSaleToken: { type: String },
      privateSaleToken: { type: String, select: false },
      saleId: { type: String },

      webhookToken: { type: String, select: false },

      transactionAuthNum: { type: String },
      documentUrl: { type: String },
      documentNum: { type: String },
      documentType: { type: String },

      isPaid: { type: Boolean, default: false },
      paidAt: { type: Date },

      body: { type: Object, select: false },
    },

    // גיבוי מסמכים חשבונאיים על ההזמנה
    accountingDocs: {
      invoice: RivhitDocSchema,        // חשבונית מס
      invoiceReceipt: RivhitDocSchema, // חשבונית מס קבלה
      receipt: RivhitDocSchema,        // קבלה
      deliveryNote: RivhitDocSchema,   // תעודת משלוח
      deliveryNoteHyphen: RivhitDocSchema, // תעודת-משלוח (מקף, סוג מסמך נפרד בריווחית)
      creditInvoice: RivhitDocSchema,  // חשבונית מס זיכוי
      returnNote: RivhitDocSchema,     // תעודת החזרה
    },
  },
  {
    timestamps: true,
  }
);

// Hooks לחישוב בונוס
// pre-save
orderSchema.pre("save", async function () {
  // חישוב הבונוס אם המסמך חדש או אחד השדות הרלוונטיים השתנה
  if (
    this.isNew ||
    this.isModified("customerSatisfaction") ||
    this.isModified("total") ||
    this.isModified("shippingCost")
  ) {
    if (this.customerSatisfaction === 1) {
      this.bonus = (this.total - this.shippingCost) * 0.04;
    } else {
      this.bonus = 0;
    }
  }
});

// pre-findOneAndUpdate
orderSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate();

  // אם אחד השדות המשפיעים על הבונוס מתעדכן
  if (
    update.customerSatisfaction !== undefined ||
    update.total !== undefined ||
    update.shippingCost !== undefined
  ) {
    // שולפים את המסמך המקורי
    const docToUpdate = await this.model.findOne(this.getQuery());
    const customerSatisfaction =
      update.customerSatisfaction ?? docToUpdate.customerSatisfaction;
    const total = update.total ?? docToUpdate.total;
    const shippingCost = update.shippingCost ?? docToUpdate.shippingCost;

    if (customerSatisfaction === 1) {
      update.bonus = (total - shippingCost) * 0.04;
    } else {
      update.bonus = 0;
    }
  }
});

// pre-updateOne
orderSchema.pre("updateOne", async function () {
  const update = this.getUpdate();

  if (
    update.customerSatisfaction !== undefined ||
    update.total !== undefined ||
    update.shippingCost !== undefined
  ) {
    // שולפים את המסמך המקורי
    const docToUpdate = await this.model.findOne(this.getQuery());
    const customerSatisfaction =
      update.customerSatisfaction ?? docToUpdate.customerSatisfaction;
    const total = update.total ?? docToUpdate.total;
    const shippingCost = update.shippingCost ?? docToUpdate.shippingCost;

    if (customerSatisfaction === 1) {
      update.bonus = (total - shippingCost) * 0.04;
    } else {
      update.bonus = 0;
    }
  }
});

// 3) יוצרים את המודל
const Order = mongoose.model("Order", orderSchema);

module.exports = Order;