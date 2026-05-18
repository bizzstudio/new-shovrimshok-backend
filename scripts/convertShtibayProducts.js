// scripts/convertShtibayProducts.js
// Converts Shtibay external product JSON to the system's Category + Product structure.
// Outputs JSON files only — no DB connection, no schema changes.
//
// Usage:
//   node convertShtibayProducts.js [inputFile] [outCategories] [outProducts]
//
// Defaults:
//   input      : ../data/latest_shtibay.json
//   categories : ../data/converted_categories.json
//   products   : ../data/converted_products.json

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const [, , inputArg, outCatArg, outProdArg] = process.argv;

const INPUT_FILE = inputArg
  ? path.resolve(inputArg)
  : path.resolve(__dirname, "../data/latest_shtibay.json");

const OUT_CATEGORIES = outCatArg
  ? path.resolve(outCatArg)
  : path.resolve(__dirname, "../data/converted_categories.json");

const OUT_PRODUCTS = outProdArg
  ? path.resolve(outProdArg)
  : path.resolve(__dirname, "../data/converted_products.json");

// ---------------------------------------------------------------------------
// Helper — IDs
// ---------------------------------------------------------------------------

function generateObjectId() {
  return crypto.randomBytes(12).toString("hex");
}

// ---------------------------------------------------------------------------
// Helper — clean product title (strip site-suffix like "| שטיבאי")
// ---------------------------------------------------------------------------

function cleanProductTitle(name) {
  if (!name || typeof name !== "string") return name || "";
  // Remove trailing site-suffix: optional space, separator (|｜–—-), optional space, "שטיבאי"
  // Only matches when the suffix is at the very end of the string.
  return name.replace(/\s*[|｜–—-]\s*שטיבאי\s*$/u, "").trim();
}

// ---------------------------------------------------------------------------
// Helper — strip HTML to readable plain text
// ---------------------------------------------------------------------------

function cleanHtmlToText(html) {
  if (!html || typeof html !== "string") return "";

  let text = html;

  // Remove entire dangerous blocks (including their content)
  text = text.replace(/<(script|style|iframe|frame|frameset|form|object|embed|applet|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Convert block-level and line-break tags to newlines before stripping
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|pre)[^>]*>/gi, "\n");

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  // Collapse multiple spaces on a single line, then collapse excess blank lines
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, arr) => line !== "" || (arr[i - 1] !== "" ))
    .join("\n")
    .trim();

  return text;
}

// ---------------------------------------------------------------------------
// Helper — normalize brand (may be string or { name: "..." } object)
// ---------------------------------------------------------------------------

function normalizeBrand(brand) {
  if (!brand) return "";
  if (typeof brand === "string") return brand.trim();
  if (typeof brand === "object" && typeof brand.name === "string") return brand.name.trim();
  return "";
}

// ---------------------------------------------------------------------------
// Helper — slug
// ---------------------------------------------------------------------------

function createSlug(text, usedSlugs) {
  if (!text) return generateObjectId(); // fallback for nameless items

  let base = String(text)
    .trim()
    .replace(/\s+/g, "-")
    // keep any Unicode letter or digit (covers Hebrew, Latin, etc.) plus hyphens
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .toLowerCase()
    .substring(0, 100);

  if (!base) base = generateObjectId();

  if (!usedSlugs) return base;

  // Collision protection
  let slug = base;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${counter++}`;
  }
  usedSlugs.add(slug);
  return slug;
}

// ---------------------------------------------------------------------------
// Helper — price
// ---------------------------------------------------------------------------

function isMissingPrice(value) {
  return value === null || value === undefined || isNaN(Number(value));
}

// Extracts a numeric value from text like "309 ₪" or "₪309.00"
function parsePriceFromText(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/[^\d.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ---------------------------------------------------------------------------
// Helper — images / videos
// ---------------------------------------------------------------------------

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i;
const VIDEO_HOST_RE = /(?:youtube\.com|youtu\.be|vimeo\.com)/i;

function isImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  return IMAGE_EXT_RE.test(url.split("?")[0]);
}

function isVideoUrl(url) {
  if (!url || typeof url !== "string") return false;
  return VIDEO_HOST_RE.test(url);
}

// Returns { imageUrls, videoUrls, warnings }
function buildImages(product) {
  const raw = [];
  if (product.main_image && typeof product.main_image === "string") {
    raw.push(product.main_image);
  }
  if (Array.isArray(product.images)) {
    for (const entry of product.images) {
      const url = typeof entry === "string" ? entry : entry?.url || entry?.src;
      if (url && typeof url === "string") raw.push(url);
    }
  }

  const imageUrls = [];
  const videoUrls = [];
  const warnings = [];

  for (const url of raw) {
    if (isVideoUrl(url)) {
      videoUrls.push(url);
    } else if (isImageUrl(url)) {
      imageUrls.push(url);
    }
    // URLs that are neither image nor video are silently dropped
  }

  if (videoUrls.length > 0) warnings.push("YOUTUBE_MOVED_TO_VIDEOS");

  return { imageUrls, videoUrls, warnings };
}

// ---------------------------------------------------------------------------
// Helper — warnings
// ---------------------------------------------------------------------------

function buildWarnings(product, imageUrls) {
  const warnings = [];

  if (!product.name) warnings.push("MISSING_NAME");

  if (isMissingPrice(product.price)) warnings.push("MISSING_PRICE");

  if (product.visible_price) {
    const parsed = parsePriceFromText(product.visible_price);
    if (parsed !== null && !isMissingPrice(product.price)) {
      if (parsed !== Number(product.price)) warnings.push("PRICE_MISMATCH");
    }
  }

  if (!Array.isArray(product.category_path) || product.category_path.length === 0) {
    warnings.push("MISSING_CATEGORY_PATH");
  }

  if (imageUrls.length === 0) warnings.push("MISSING_IMAGE");

  return warnings;
}

// ---------------------------------------------------------------------------
// Category building
// ---------------------------------------------------------------------------

// Processes one category_path array and ensures every level exists in categoryMap.
// Returns the leaf category doc (or null if path is empty).
function convertCategoryPathToCategories(categoryPath, categoryMap, slugSet) {
  if (!Array.isArray(categoryPath) || categoryPath.length === 0) return null;

  let parentDoc = null;
  let cumulativeKey = "";

  for (let i = 0; i < categoryPath.length; i++) {
    const segment = String(categoryPath[i]).trim();
    if (!segment) continue;

    cumulativeKey = cumulativeKey === "" ? segment : `${cumulativeKey}/${segment}`;

    if (!categoryMap.has(cumulativeKey)) {
      const doc = {
        _id: generateObjectId(),
        name: { he: segment },
        description: {},
        slug: createSlug(segment, slugSet),
        parentId: parentDoc ? parentDoc._id : null,
        parentName: parentDoc ? parentDoc.name.he : null,
        status: "show",
        sortOrder: 0,
        source: {
          site: "shtibay",
          path: cumulativeKey,
        },
        sourceKey: `shtibay:category:${cumulativeKey}`,
      };
      categoryMap.set(cumulativeKey, doc);
    }

    parentDoc = categoryMap.get(cumulativeKey);
  }

  return parentDoc; // leaf
}

// Iterates all products in the source JSON and builds the full category map.
function buildCategoriesFromProducts(sourceJson) {
  const categoryMap = new Map(); // pathKey → category doc
  const slugSet = new Set();

  const topCategories = Array.isArray(sourceJson.categories)
    ? sourceJson.categories
    : [];

  for (const block of topCategories) {
    const products = Array.isArray(block.products) ? block.products : [];
    for (const product of products) {
      convertCategoryPathToCategories(
        product.category_path,
        categoryMap,
        slugSet
      );
    }
  }

  return { categories: Array.from(categoryMap.values()), categoryMap };
}

// ---------------------------------------------------------------------------
// Product conversion
// ---------------------------------------------------------------------------

function convertShtibayProductToSystemProduct(
  product,
  categoryMap,
  productSlugSet
) {
  const { imageUrls, videoUrls, warnings: imageWarnings } = buildImages(product);
  const warnings = [
    ...buildWarnings(product, imageUrls),
    ...imageWarnings,
  ];

  // Resolve leaf category ObjectId
  let leafCategoryId = null;
  if (Array.isArray(product.category_path) && product.category_path.length > 0) {
    const leafKey = product.category_path
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join("/");
    const leafDoc = categoryMap.get(leafKey);
    if (leafDoc) {
      leafCategoryId = leafDoc._id;
    }
  }

  // Price
  const priceValue = isMissingPrice(product.price) ? 0 : Number(product.price);

  // Title — strip site-suffix for display; keep original in rawData
  const cleanTitle = cleanProductTitle(product.name);

  // Description fields
  const descriptionHtml = product.long_description_html || "";
  const descriptionText = product.long_description || product.description || "";
  // Admin-facing plain text: derived from HTML if available, else plain text field
  const descriptionPlain = descriptionHtml
    ? cleanHtmlToText(descriptionHtml)
    : descriptionText;

  // Stock — map availability to stock + manageStock
  const isInStock = product.availability === "InStock";
  const stockValue   = isInStock ? 1 : 0;
  const manageStock  = !isInStock; // OutOfStock → managed (shows as 0); InStock → unmanaged

  // Identifier
  const itemNumber =
    product.item_code != null
      ? String(product.item_code)
      : product.id != null
      ? String(product.id)
      : null;

  // Slug built from clean title (no "| שטיבאי" suffix)
  const slug = createSlug(cleanTitle || product.name, productSlugSet);

  const _id = generateObjectId();

  // SKU — always unique per product.id to avoid collisions from shared item_code values
  const externalId = product.id != null ? String(product.id) : null;
  const sku = `shtibay-${product.id ?? _id}`;

  // Normalised brand — always a string, safe for the supplier schema field
  const brandStr = normalizeBrand(product.brand);

  const converted = {
    // --- Core schema fields (match existing Product model exactly) ---
    _id,
    productId: _id,
    sku,
    barcode: product.sku != null ? String(product.sku) : null,
    itemNumber,  // product.item_code || product.id — kept for reference, not used as unique key
    title: { he: cleanTitle || "" },
    description: { he: descriptionPlain },
    slug,
    categories: leafCategoryId ? [leafCategoryId] : [],
    image: imageUrls,
    stock: stockValue,
    expiryDate: null,
    lastStockUpdate: null,
    manageStock: manageStock,
    minStockThreshold: null,
    hasSentStockAlert: false,
    sales: 0,
    tag: [],
    prices: [
      {
        // Placeholder — must be replaced with a real PriceList ObjectId before DB import
        priceList: "__DEFAULT_PRICE_LIST__",
        price: priceValue,
        salePrice: null,
        warehousePrice: null,
        purchaseLimit: null,
      },
    ],
    kashrut: [],
    supplier: brandStr || null,
    isWarehouseProduct: false,
    isComplementaryProduct: false,
    soldByWeight: false,
    isVatFree: false,
    sortCode: "",
    weight: null,
    weightUnit: "",
    managementNotes: "",
    status: "show",

    // --- Extra fields (not in current schema; added safely as JSON only) ---
    source: {
      site: "shtibay",
      externalId: product.id != null ? String(product.id) : null,
      url: product.url || null,
    },
    sourceKey: `shtibay:product:${product.id ?? ""}`,

    extraData: {
      subtitle: product.subtitle || null,
      brand: brandStr || null,
      originalSku: product.sku != null ? String(product.sku) : null,
      originalItemCode: product.item_code != null ? String(product.item_code) : null,
      visiblePrice: product.visible_price || null,
      originPrice: product.origin_price || null,
      originPriceText: product.visible_origin_price_text || null,
      categoryPath: product.category_path || [],
      breadcrumb: product.breadcrumb || null,
      warranty: product.warranty || null,
      delivery: product.delivery || null,
      shippingOptions: product.shipping_options || null,
      sellingPoints: product.selling_points || null,
      upgrades: product.upgrades || null,
      videos: videoUrls,
      jsonLd: product.json_ld || null,
      descriptionHtml: descriptionHtml,
      descriptionText: descriptionText,
    },

    rawData: product,

    sync: {
      importedFrom: "shtibay",
      warnings,
    },
  };

  return converted;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

function convertShtibayJson(sourceJson) {
  console.log("Building category map...");
  const { categories, categoryMap } = buildCategoriesFromProducts(sourceJson);

  console.log(`  → ${categories.length} categories created`);

  const productSlugSet = new Set();
  const convertedProducts = [];

  const topCategories = Array.isArray(sourceJson.categories)
    ? sourceJson.categories
    : [];

  for (const block of topCategories) {
    const products = Array.isArray(block.products) ? block.products : [];
    for (const product of products) {
      const converted = convertShtibayProductToSystemProduct(
        product,
        categoryMap,
        productSlugSet
      );
      convertedProducts.push(converted);
    }
  }

  // Write outputs
  fs.writeFileSync(OUT_CATEGORIES, JSON.stringify(categories, null, 2), "utf8");
  fs.writeFileSync(OUT_PRODUCTS, JSON.stringify(convertedProducts, null, 2), "utf8");

  // Summary
  const withWarnings = convertedProducts.filter(
    (p) => p.sync.warnings.length > 0
  );

  console.log("\n=== Shtibay Conversion Summary ===");
  console.log(`Categories created    : ${categories.length}`);
  console.log(`Products converted    : ${convertedProducts.length}`);
  console.log(`Products with warnings: ${withWarnings.length}`);

  if (withWarnings.length > 0) {
    console.log("\nWarnings by product:");
    for (const p of withWarnings) {
      const id = p.itemNumber || p.source.externalId || p.slug;
      const name = p.title.he || "(no name)";
      console.log(`  [${id}] ${name}`);
      console.log(`    → ${p.sync.warnings.join(", ")}`);
    }
  }

  // Validation checks
  const skuSeen = new Map(); // sku → first product sourceKey
  let duplicateSkuCount = 0;
  let invalidSupplierCount = 0;
  for (const p of convertedProducts) {
    if (!p.sku || p.sku.trim() === "") {
      console.warn(`  ⚠  Empty sku: ${p.sourceKey}`);
      duplicateSkuCount++; // count as problem
    } else if (skuSeen.has(p.sku)) {
      console.warn(`  ⚠  Duplicate sku "${p.sku}": ${p.sourceKey} collides with ${skuSeen.get(p.sku)}`);
      duplicateSkuCount++;
    } else {
      skuSeen.set(p.sku, p.sourceKey);
    }
    if (p.supplier !== null && typeof p.supplier !== "string") {
      console.warn(`  ⚠  Non-string supplier on ${p.sourceKey}: ${JSON.stringify(p.supplier)}`);
      invalidSupplierCount++;
    }
  }
  console.log(`\nValidation:`);
  console.log(`  Duplicate/empty sku count : ${duplicateSkuCount}`);
  console.log(`  Invalid supplier count    : ${invalidSupplierCount}`);

  console.log(`\nOutput files:`);
  console.log(`  ${OUT_CATEGORIES}`);
  console.log(`  ${OUT_PRODUCTS}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (!fs.existsSync(INPUT_FILE)) {
  console.error(`Input file not found: ${INPUT_FILE}`);
  console.error(
    "Usage: node convertShtibayProducts.js [inputFile] [outCategories] [outProducts]"
  );
  process.exit(1);
}

let sourceJson;
try {
  sourceJson = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
} catch (err) {
  console.error(`Failed to parse input JSON: ${err.message}`);
  process.exit(1);
}

convertShtibayJson(sourceJson);
