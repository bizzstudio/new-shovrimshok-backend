// scripts/moveCitiesToNorth.js
// מעביר יעדי משלוח (ערים) מ"כל הארץ" לאזור "צפון"

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { connectDB } = require("../config/db");
const Region = require("../models/Region");
const Delivery = require("../models/Delivery");

const CITIES_TO_MOVE = [
  "בית שאן",
  "קרית אתא",
  "נווה אור",
  "מגדל העמק",
  "עפולה",
  "גשר",
  "שלוחות",
  "שדה נחום",
  "חיפה",
  "טבריה",
  "צפת",
  "יבנאל",
  "רכסים",
];

async function moveCitiesToNorth() {
  try {
    console.log("=".repeat(60));
    console.log("Move cities from כל הארץ to צפון");
    console.log("=".repeat(60));

    await connectDB();

    const allCountry = await Region.findOne({ name: "כל הארץ" });
    if (!allCountry) {
      console.error("  ✗ Region 'כל הארץ' not found.");
      process.exit(1);
    }
    console.log("  ✓ Found region כל הארץ:", allCountry._id);

    let north = await Region.findOne({ name: "צפון" });
    if (!north) {
      north = await Region.create({ name: "צפון", order: 1 });
      console.log("  ✓ Created region צפון:", north._id);
    } else {
      console.log("  ✓ Found region צפון:", north._id);
    }

    const result = await Delivery.updateMany(
      {
        region: allCountry._id,
        "city.city_name_he": { $in: CITIES_TO_MOVE },
      },
      { $set: { region: north._id } }
    );

    console.log("  ✓ Moved", result.modifiedCount, "deliveries to צפון");
    console.log("=".repeat(60));
    process.exit(0);
  } catch (err) {
    console.error("  ✗ Error:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

moveCitiesToNorth();
