// models/Region.js – אזור משלוח (כל הארץ, צפון וכו'). מכיל יעדים וכללי תמחור לפי סכום אחרי הנחות.
const mongoose = require('mongoose');

const PriceRuleSchema = new mongoose.Schema({
  minOrderTotal: { type: Number, required: true, default: 0 },
  maxOrderTotal: { type: Number, required: false }, // אופציונלי – טווח "עד סכום"
  shippingCost: { type: Number, required: true, default: 0 },
}, { _id: false });

const RegionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 },
  priceRules: {
    type: [PriceRuleSchema],
    default: [],
  },
}, { timestamps: true });

const Region = mongoose.model('Region', RegionSchema);
module.exports = Region;
