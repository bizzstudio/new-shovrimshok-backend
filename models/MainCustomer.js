// models/MainCustomer.js
const mongoose = require("mongoose");

const mainCustomerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
    },
    phone: {
      type: String,
    },

    // סוג הלקוח
    customerType: {
      type: String,
      enum: ['casual', 'regular', 'business', 'institutional'],
      default: 'casual',
    },

    // מספר ח.פ
    companyNumber: {
      type: String,
    },

    // סוג מוסד ללקוח מוסדי
    institutionType: {
      type: String,
    },

    // מחירון לקוח
    priceList: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PriceList",
    },

    // סוג תשלום
    paymentTerms: {
      type: String,
      enum: ['current', '+15', '+30', '+45', '+60', '+90', 'noDueDate'],
      default: 'current',
    },

    // מערך תתי-לקוחות
    subCustomers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
      }
    ],

    // מספר לקוח בריווחית (Rivhit customer_id)
    externalCustomerId: {
      type: Number,
      index: true,
    },
    permittedBarcodes: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  {
    timestamps: true,
  }
);

const MainCustomer = mongoose.model("MainCustomer", mainCustomerSchema);

module.exports = MainCustomer;
