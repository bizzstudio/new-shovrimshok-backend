// scripts/fixShtibayTitles.js
// One-time fix: update title.he of imported Shtibay products to use the last
// label of the source breadcrumb (the clean product page name) instead of the
// raw "name" field from the scrape.
//
// Only updates title.he. Does not touch slug, description, price, or anything
// else. Products without a breadcrumb in rawData are skipped (they are the 105
// records that came back empty from the source JSON).
//
// Usage:  node scripts/fixShtibayTitles.js

"use strict";

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { connectDB } = require("../config/db");
const Product = require("../models/Product");

function getBreadcrumbLeafLabel(product) {
  const breadcrumb = product?.rawData?.breadcrumb;
  if (!Array.isArray(breadcrumb) || breadcrumb.length === 0) return null;
  const leaf = breadcrumb[breadcrumb.length - 1];
  const label = leaf?.label;
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  return trimmed || null;
}

async function main() {
  console.log("=== Shtibay title fix ===");
  console.log(`DB URI: ${process.env.MONGO_URI}`);

  await connectDB();

  const products = await Product.find({ "source.site": "shtibay" }).lean();
  console.log(`Found ${products.length} Shtibay products in DB\n`);

  let updated = 0;
  let unchanged = 0;
  let skippedNoBreadcrumb = 0;
  let errors = 0;

  for (const p of products) {
    const newTitle = getBreadcrumbLeafLabel(p);

    if (newTitle === null) {
      skippedNoBreadcrumb++;
      continue;
    }

    const currentTitle = p?.title?.he;
    if (currentTitle === newTitle) {
      unchanged++;
      continue;
    }

    try {
      await Product.updateOne(
        { _id: p._id },
        { $set: { "title.he": newTitle } }
      );
      updated++;
      console.log(`[${p.sku}] "${currentTitle}" -> "${newTitle}"`);
    } catch (err) {
      errors++;
      console.warn(`  ! ${p.sku}: ${err.message}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total Shtibay products    : ${products.length}`);
  console.log(`Updated                   : ${updated}`);
  console.log(`Unchanged (already correct): ${unchanged}`);
  console.log(`Skipped (no breadcrumb)   : ${skippedNoBreadcrumb}`);
  console.log(`Errors                    : ${errors}`);

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  mongoose.connection.close();
  process.exit(1);
});
