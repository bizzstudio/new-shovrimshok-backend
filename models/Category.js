// models/Category.js
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: Object,
      required: true,
    },
    description: {
      type: Object,
      required: false,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    parentId: {
      type: String,
      required: false,
    },
    parentName: {
      type: String,
      required: false,
    },
    id: {
      type: String,
      required: false,
    },
    icon: {
      type: String,
      required: false,
    },
    coloredIcon: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      lowercase: true,
      enum: ['show', 'hide'],
      default: 'show',
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    source: {
      site: { type: String, required: false },
      path: { type: String, required: false },
    },
    sourceKey: {
      type:     String,
      required: false,
      unique:   true,
      index:    true,
      sparse:   true,
    },
  },
  {
    timestamps: true,
  }
);

// module.exports = categorySchema;

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;
