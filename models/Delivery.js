const mongoose = require('mongoose');

const DaySchema = new mongoose.Schema({
  value: {
    type: String,
    required: true,
    enum: [1, 2, 3, 4, 5, 6, 7],
  },
  name: {
    type: String,
    required: true,
    enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  }
}, { _id: false });

const CitySchema = new mongoose.Schema({
  _id: {
    type: Number,
    required: false,
  },
  city_code: {
    type: Number,
    required: false,
  },
  city_name_he: {
    type: String,
    required: true,
  },
  city_name_en: {
    type: String,
    required: false,
  },
  region_code: {
    type: Number,
    required: false,
  },
  region_name: {
    type: String,
    required: false,
  },
  PIBA_bureau_code: {
    type: Number,
    required: false,
  },
  PIBA_bureau_name: {
    type: String,
    required: false,
  },
  Regional_Council_code: {
    type: Number,
    required: false,
  },
  Regional_Council_name: {
    type: String,
    required: false,
  }
}, { _id: false, strict: false }); // Allows additional fields

CitySchema.pre('save', function(next) {
  // לקצץ רווחים מיותרים בכל השדות הרלוונטיים
  this.city_name_he = this.city_name_he.trim();
  if (this.city_name_en) this.city_name_en = this.city_name_en.trim();
  if (this.region_name) this.region_name = this.region_name.trim();
  if (this.PIBA_bureau_name) this.PIBA_bureau_name = this.PIBA_bureau_name.trim();
  if (this.Regional_Council_name) this.Regional_Council_name = this.Regional_Council_name.trim();
  if (typeof next === 'function') next();
});

// סכמה ליעדי משלוח שהאדמין מגדיר. כל יעד חייב להיות משויך לאזור (region).
const DeliverySchema = new mongoose.Schema({
  city: {
    type: CitySchema,
    required: true,
  },
  region: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Region',
    required: false, // אופציונלי לצורך תאימות לאחור – מיגרציה תשייך קיימים ל"כל הארץ"
  },
  price: {
    type: Number,
    required: false,
    min: 0,
    default: 0,
  },
  days: {
    type: [DaySchema],
    default: [],
  }
}, { timestamps: true });

const Delivery = mongoose.model('Delivery', DeliverySchema);
module.exports = Delivery;