// scripts/importShtibayData.js
// Stable idempotent import of converted Shtibay categories and products into MongoDB.
// Safe to run multiple times — uses upsert on sourceKey, never creates duplicates.
//
// Usage:
//   node scripts/importShtibayData.js [--confirm] [categoriesFile] [productsFile]
//
// Without --confirm the script runs in dry-run mode (reads + validates, no writes).
//
// Defaults:
//   categoriesFile : data/converted_categories.json
//   productsFile   : data/converted_products.json

"use strict";

require("dotenv").config({ quiet: true });
const fs   = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectDB } = require("../config/db");

const Category = require("../models/Category");
const Product  = require("../models/Product");
const PriceList = require("../models/PriceList");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const CONFIRM  = args.includes("--confirm");
const fileArgs = args.filter((a) => !a.startsWith("--"));

const CAT_FILE  = fileArgs[0]
  ? path.resolve(fileArgs[0])
  : path.resolve(__dirname, "../data/converted_categories.json");

const PROD_FILE = fileArgs[1]
  ? path.resolve(fileArgs[1])
  : path.resolve(__dirname, "../data/converted_products.json");

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const stats = {
  categories: { created: 0, updated: 0, skipped: 0, errors: 0 },
  products:   { created: 0, updated: 0, skipped: 0, errors: 0 },
  warnings: [],
};

function warn(msg) {
  stats.warnings.push(msg);
  console.warn("  ⚠ ", msg);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Shtibay Import ===");
  console.log(`Mode       : ${CONFIRM ? "LIVE (writes enabled)" : "DRY RUN (no writes)"}`);
  console.log(`DB URI     : ${process.env.MONGO_URI}`);
  console.log(`Categories : ${CAT_FILE}`);
  console.log(`Products   : ${PROD_FILE}`);
  console.log("");

  // Read input files
  if (!fs.existsSync(CAT_FILE)) {
    console.error(`Categories file not found: ${CAT_FILE}`);
    process.exit(1);
  }
  if (!fs.existsSync(PROD_FILE)) {
    console.error(`Products file not found: ${PROD_FILE}`);
    process.exit(1);
  }

  const categories = JSON.parse(fs.readFileSync(CAT_FILE, "utf8"));
  const products   = JSON.parse(fs.readFileSync(PROD_FILE, "utf8"));

  console.log(`Loaded ${categories.length} categories, ${products.length} products`);

  await connectDB();

  // -------------------------------------------------------------------------
  // Resolve default PriceList
  // -------------------------------------------------------------------------

  let defaultPriceList = await PriceList.findOne({ isDefault: true });
  if (!defaultPriceList) {
    defaultPriceList = await PriceList.findOne();
  }
  if (!defaultPriceList) {
    console.error("No PriceList found in the database. Create at least one before importing products.");
    process.exit(1);
  }
  console.log(`Using PriceList: "${defaultPriceList.name}" (${defaultPriceList._id})\n`);

  // -------------------------------------------------------------------------
  // Resolve "Home" category — Shtibay root categories become its children
  // -------------------------------------------------------------------------

  const homeCategory =
    await Category.findOne({ "name.he": "Home" }) ||
    await Category.findOne({ slug: "home" });

  if (!homeCategory) {
    console.error(
      'Home category not found in the database.\n' +
      'Looked for: name.he === "Home"  OR  slug === "home".\n' +
      'Create the Home category first, then re-run the import.'
    );
    await mongoose.connection.close();
    process.exit(1);
  }

  const homeId   = homeCategory._id.toString();
  const homeName = homeCategory.name?.he || "Home";
  console.log(`Home category: "${homeName}" (${homeId})\n`);

  // -------------------------------------------------------------------------
  // STEP 1 — Import categories (root-first)
  // -------------------------------------------------------------------------

  console.log("--- Importing categories ---");

  // Sort by path depth so parents always exist before children
  const sorted = [...categories].sort(
    (a, b) =>
      a.source.path.split("/").length - b.source.path.split("/").length
  );

  // categoryDbMap: source.path → real MongoDB _id (as string)
  const categoryDbMap = new Map();

  for (const cat of sorted) {
    if (!cat.sourceKey) {
      warn(`Category missing sourceKey, skipping: ${JSON.stringify(cat.name)}`);
      stats.categories.skipped++;
      continue;
    }

    // Derive parent info
    const segments   = cat.source.path.split("/");
    const parentPath = segments.slice(0, -1).join("/");

    let parentId, parentName;
    if (segments.length === 1) {
      // Root-level shtibay category → attach under Home so admin shows it
      parentId   = homeId;
      parentName = homeName;
    } else {
      // Deeper category → parent already in categoryDbMap
      parentId   = categoryDbMap.get(parentPath)?.toString() ?? null;
      parentName = sorted.find((c) => c.source.path === parentPath)?.name?.he ?? null;
    }

    const payload = {
      name:       cat.name,
      description: cat.description || {},
      slug:       cat.slug,
      parentId,
      parentName,
      status:     cat.status || "show",
      sortOrder:  cat.sortOrder ?? 0,
      source:     cat.source,
      sourceKey:  cat.sourceKey,
    };

    try {
      if (CONFIRM) {
        const result = await Category.findOneAndUpdate(
          { sourceKey: cat.sourceKey },
          { $set: payload },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        categoryDbMap.set(cat.source.path, result._id);

        if (result.createdAt && result.updatedAt &&
            result.createdAt.getTime() === result.updatedAt.getTime()) {
          stats.categories.created++;
        } else {
          stats.categories.updated++;
        }
      } else {
        // Dry run: simulate by checking existence
        const existing = await Category.findOne({ sourceKey: cat.sourceKey });
        if (existing) {
          categoryDbMap.set(cat.source.path, existing._id);
          stats.categories.updated++;
        } else {
          // Use a placeholder id for dry-run category map
          categoryDbMap.set(cat.source.path, new mongoose.Types.ObjectId());
          stats.categories.created++;
        }
      }
    } catch (err) {
      warn(`Category error [${cat.sourceKey}]: ${err.message}`);
      stats.categories.errors++;
    }
  }

  console.log(
    `  created: ${stats.categories.created}  updated: ${stats.categories.updated}  ` +
    `skipped: ${stats.categories.skipped}  errors: ${stats.categories.errors}\n`
  );

  // -------------------------------------------------------------------------
  // STEP 2 — Import products
  // -------------------------------------------------------------------------

  console.log("--- Importing products ---");

  for (const prod of products) {
    // Determine match filter
    let filter = null;
    if (prod.sourceKey && prod.source?.externalId) {
      filter = { sourceKey: prod.sourceKey };
    } else if (prod.itemNumber) {
      filter = { itemNumber: prod.itemNumber };
    } else {
      warn(`Product has no sourceKey or itemNumber, skipping: ${prod.title?.he || "(unnamed)"}`);
      stats.products.skipped++;
      continue;
    }

    // Resolve leaf category from categoryDbMap
    const catPathArr = prod.extraData?.categoryPath;
    const catPath    = Array.isArray(catPathArr)
      ? catPathArr.map((s) => String(s).trim()).filter(Boolean).join("/")
      : "";
    const categoryId = catPath ? (categoryDbMap.get(catPath) ?? null) : null;
    if (!categoryId) {
      warn(`Product [${prod.sourceKey}] category not found in map: "${catPath}"`);
    }

    // Resolve priceList placeholder
    const prices = (prod.prices || []).map((p) => ({
      ...p,
      priceList: p.priceList === "__DEFAULT_PRICE_LIST__"
        ? defaultPriceList._id
        : p.priceList,
    }));

    // Build $set payload — everything except _id
    // createdAt is not included in $set so it is never overwritten
    const payload = {
      productId:           prod.productId,
      sku:                 prod.sku,   // stable, never null — fallback chain in converter
      barcode:             prod.barcode,
      itemNumber:          prod.itemNumber,
      title:               prod.title,
      description:         prod.description,
      slug:                prod.slug,
      categories:          categoryId ? [categoryId] : [],
      image:               prod.image || [],
      stock:               prod.stock ?? 0,
      expiryDate:          prod.expiryDate ?? null,
      lastStockUpdate:     prod.lastStockUpdate ?? null,
      manageStock:         prod.manageStock ?? false,
      minStockThreshold:   prod.minStockThreshold ?? null,
      hasSentStockAlert:   prod.hasSentStockAlert ?? false,
      sales:               prod.sales ?? 0,
      tag:                 prod.tag || [],
      prices,
      kashrut:             prod.kashrut || [],
      supplier:            prod.supplier ?? null,
      isWarehouseProduct:  prod.isWarehouseProduct ?? false,
      isComplementaryProduct: prod.isComplementaryProduct ?? false,
      soldByWeight:        prod.soldByWeight ?? false,
      isVatFree:           prod.isVatFree ?? false,
      sortCode:            prod.sortCode ?? "",
      weight:              prod.weight ?? null,
      weightUnit:          prod.weightUnit ?? "",
      managementNotes:     prod.managementNotes ?? "",
      status:              prod.status || "show",
      source:              prod.source,
      sourceKey:           prod.sourceKey,
      extraData:           prod.extraData,
      rawData:             prod.rawData,
      sync:                prod.sync,
    };

    try {
      if (CONFIRM) {
        const result = await Product.findOneAndUpdate(
          filter,
          { $set: payload },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (result.createdAt && result.updatedAt &&
            result.createdAt.getTime() === result.updatedAt.getTime()) {
          stats.products.created++;
        } else {
          stats.products.updated++;
        }
      } else {
        const existing = await Product.findOne(filter);
        if (existing) stats.products.updated++;
        else          stats.products.created++;
      }
    } catch (err) {
      warn(`Product error [${prod.sourceKey || prod.itemNumber}]: ${err.message}`);
      stats.products.errors++;
    }
  }

  console.log(
    `  created: ${stats.products.created}  updated: ${stats.products.updated}  ` +
    `skipped: ${stats.products.skipped}  errors: ${stats.products.errors}\n`
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  console.log("=== Summary ===");
  console.log(`Categories — created: ${stats.categories.created}, updated: ${stats.categories.updated}, errors: ${stats.categories.errors}`);
  console.log(`Products   — created: ${stats.products.created}, updated: ${stats.products.updated}, errors: ${stats.products.errors}`);

  if (stats.warnings.length > 0) {
    console.log(`\nWarnings (${stats.warnings.length}):`);
    stats.warnings.forEach((w) => console.log("  •", w));
  }

  if (!CONFIRM) {
    console.log("\nDry run complete — no data was written. Add --confirm to execute.");
  }

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  mongoose.connection.close();
  process.exit(1);
});
