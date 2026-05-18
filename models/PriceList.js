// models/PriceList.js
const mongoose = require("mongoose");

const priceListSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
        },
        isDefault: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

const PriceList = mongoose.model("PriceList", priceListSchema);
module.exports = PriceList;