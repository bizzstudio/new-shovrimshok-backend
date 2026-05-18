// scripts/importProducts.js
// One-time script to import products from WordPress JSON format to MongoDB

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { connectDB } = require("../config/db");
const Product = require("../models/Product");
const Category = require("../models/Category");
const PriceList = require("../models/PriceList");

// Statistics tracking
const stats = {
    total: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    categoriesCreated: 0,
    categoriesFound: 0,
};

// Cache for categories and price lists to avoid repeated DB queries
const categoryCache = new Map();
const priceListCache = new Map();

// Mapping from original slugs to new slugs (from categories-extracted.json)
const slugMapping = new Map();

/**
 * Convert string to Object format with Hebrew key
 */
function stringToObject(str) {
    if (!str || str.trim() === "") {
        return undefined;
    }
    return { he: str.trim() };
}

/**
 * Find category by slug (do not create new ones)
 * Uses slug mapping to convert original slugs to new slugs
 */
async function findCategory(categoryData) {
    const originalSlug = categoryData.slug.toLowerCase().trim();

    // First, try to find the new slug using the mapping
    let newSlug = slugMapping.get(originalSlug);

    // If no mapping found, try to decode URL-encoded slug and check again
    if (!newSlug) {
        try {
            const decodedSlug = decodeURIComponent(originalSlug).toLowerCase().trim();
            newSlug = slugMapping.get(decodedSlug);
        } catch (e) {
            // If decoding fails, ignore
        }
    }

    // If still no mapping found, try the original slug as-is (for categories that didn't change)
    if (!newSlug) {
        newSlug = originalSlug;
    }

    // Check cache first
    if (categoryCache.has(newSlug)) {
        stats.categoriesFound++;
        return categoryCache.get(newSlug);
    }

    // Try to find existing category by new slug
    let category = await Category.findOne({ slug: newSlug });

    // If not found, try with decoded slug
    if (!category && originalSlug !== newSlug) {
        try {
            const decodedSlug = decodeURIComponent(originalSlug).toLowerCase().trim();
            category = await Category.findOne({ slug: decodedSlug });
            if (category) {
                newSlug = decodedSlug;
            }
        } catch (e) {
            // If decoding fails, ignore
        }
    }

    // If still not found, try the original slug directly
    if (!category && originalSlug !== newSlug) {
        category = await Category.findOne({ slug: originalSlug });
        if (category) {
            newSlug = originalSlug;
        }
    }

    if (!category) {
        // Category not found - return null to indicate it should use Home category
        return null;
    }

    stats.categoriesFound++;

    // Cache the result (cache both original and new slug)
    categoryCache.set(newSlug, category._id);
    categoryCache.set(originalSlug, category._id);
    return category._id;
}

/**
 * Get or create default price list
 */
async function getDefaultPriceList() {
    const defaultName = "Default";

    // Check cache
    if (priceListCache.has(defaultName)) {
        return priceListCache.get(defaultName);
    }

    let priceList = await PriceList.findOne({ name: defaultName });

    if (!priceList) {
        priceList = new PriceList({ name: defaultName });
        await priceList.save();
        console.log(`  ✓ Created default price list: ${defaultName}`);
    }

    priceListCache.set(defaultName, priceList._id);
    return priceList._id;
}

/**
 * Get Home category ID
 */
async function getHomeCategoryId() {
    const homeCategoryId = "62c827b5a427b63741da9175";

    // Check cache
    if (categoryCache.has("home")) {
        return categoryCache.get("home");
    }

    const homeCategory = await Category.findById(homeCategoryId);
    if (!homeCategory) {
        throw new Error("Home category not found. Please run importCategories.js first.");
    }

    categoryCache.set("home", homeCategory._id);
    return homeCategory._id;
}

/**
 * Find unique slug by appending number if needed
 * Also checks usedSlugs set to avoid duplicates in current import session
 */
async function findUniqueSlug(originalSlug, usedSlugs = null) {
    let slug = originalSlug;
    let counter = 2;

    // Check if slug already exists in DB
    let existing = await Product.findOne({ slug });

    // Also check if used in current session
    const isUsed = usedSlugs && usedSlugs.has(slug.toLowerCase());

    if (!existing && !isUsed) {
        return slug;
    }

    // If exists, try with number suffix
    while (existing || (usedSlugs && usedSlugs.has(slug.toLowerCase()))) {
        slug = `${originalSlug}${counter}`;
        existing = await Product.findOne({ slug });
        counter++;
    }

    return slug;
}

/**
 * Extract kashrut from meta_data
 */
function extractKashrut(metaData) {
    if (!metaData || !Array.isArray(metaData)) {
        return [];
    }

    const kashrutMeta = metaData.find((meta) => meta.key === "kashrut");
    if (!kashrutMeta || !kashrutMeta.value) {
        return [];
    }

    const value = kashrutMeta.value.trim();
    if (value === "") {
        return [];
    }

    // Split by comma if multiple values
    return value.split(",").map((k) => k.trim()).filter((k) => k !== "");
}

/**
 * Convert WordPress product to MongoDB product format
 */
async function convertWordPressProduct(wpProduct) {
    try {
        // Keep slug exactly as is (no decoding) - don't check uniqueness here
        // We'll handle uniqueness when inserting to DB
        const slug = wpProduct.slug;

        // Convert title and description
        const title = stringToObject(wpProduct.name);
        if (!title) {
            console.log(`  ⚠ Skipping product (no name): slug: ${slug}`);
            stats.skipped++;
            return null;
        }

        const description = stringToObject(wpProduct.description || wpProduct.short_description);

        // Process categories - only use existing categories
        const categoryIds = [];
        if (wpProduct.categories && Array.isArray(wpProduct.categories)) {
            for (const cat of wpProduct.categories) {
                try {
                    const catId = await findCategory(cat);
                    if (catId) {
                        categoryIds.push(catId);
                    } else {
                        // Category not found - will add to Home at the end
                        console.log(`  ⚠ Category not found (will use Home): ${cat.name} (slug: ${cat.slug})`);
                    }
                } catch (error) {
                    console.error(`  ✗ Error processing category ${cat.name}:`, error.message);
                }
            }
        }

        // If no valid categories found, add to Home category
        if (categoryIds.length === 0) {
            const homeCategoryId = await getHomeCategoryId();
            categoryIds.push(homeCategoryId);
            console.log(`  ⚠ No valid categories found, adding to Home category: ${wpProduct.name} (slug: ${slug})`);
        }

        // Validate that we have at least one category
        if (categoryIds.length === 0) {
            console.log(`  ⚠ Skipping product (no categories): ${wpProduct.name} (slug: ${slug})`);
            stats.skipped++;
            return null;
        }

        // Process images
        const images = [];
        if (wpProduct.images && Array.isArray(wpProduct.images)) {
            wpProduct.images.forEach((img) => {
                if (img.src) {
                    images.push(img.src);
                }
            });
        }

        // Process stock
        const manageStock = wpProduct.manage_stock === true;
        let stock = 0;
        let lastStockUpdate = undefined;
        if (manageStock && wpProduct.stock_quantity !== null && wpProduct.stock_quantity !== undefined) {
            stock = Number(wpProduct.stock_quantity) || 0;
            if (stock > 0) {
                lastStockUpdate = new Date();
            }
        }

        // Process prices
        const defaultPriceListId = await getDefaultPriceList();
        const prices = [];

        // Get price value (can be 0, but must be a valid number)
        const priceStr = wpProduct.price || wpProduct.regular_price;
        let price = 1; // Default price if invalid

        if (priceStr !== null && priceStr !== undefined && priceStr !== "") {
            const parsedPrice = parseFloat(priceStr);
            if (!isNaN(parsedPrice)) {
                price = parsedPrice;
            } else {
                console.log(`  ⚠ Invalid price, using default 1: ${wpProduct.name} (slug: ${slug})`);
            }
        } else {
            console.log(`  ⚠ No price found, using default 1: ${wpProduct.name} (slug: ${slug})`);
        }

        const salePrice = wpProduct.sale_price && wpProduct.sale_price !== ""
            ? parseFloat(wpProduct.sale_price)
            : undefined;

        prices.push({
            priceList: defaultPriceListId,
            price: price,
            salePrice: salePrice && !isNaN(salePrice) ? salePrice : undefined,
        });

        // Extract kashrut
        const kashrut = extractKashrut(wpProduct.meta_data);

        // Process tags
        const tags = [];
        if (wpProduct.tags && Array.isArray(wpProduct.tags)) {
            wpProduct.tags.forEach((tag) => {
                if (tag.name) {
                    tags.push(tag.name);
                } else if (typeof tag === "string") {
                    tags.push(tag);
                }
            });
        }

        // Map status
        const status = wpProduct.status === "publish" ? "show" : "hide";

        // Map VAT status (taxable = false for isVatFree, meaning VAT is included)
        const isVatFree = wpProduct.tax_status !== "taxable";

        // Build product object
        const productData = {
            productId: String(wpProduct.id),
            barcode: wpProduct.sku || undefined,
            title: title,
            description: description,
            slug: slug,
            categories: categoryIds,
            image: images,
            stock: stock,
            lastStockUpdate: lastStockUpdate,
            manageStock: manageStock,
            minStockThreshold: wpProduct.low_stock_amount ? Number(wpProduct.low_stock_amount) : undefined,
            sales: wpProduct.total_sales ? Number(wpProduct.total_sales) : undefined,
            tag: tags,
            prices: prices,
            kashrut: kashrut,
            supplier: undefined, // Not available in WordPress data
            isWarehouseProduct: false, // Default value
            isVatFree: isVatFree,
            status: status,
        };

        return productData;
    } catch (error) {
        console.error(`  ✗ Error converting product ${wpProduct.name || wpProduct.id}:`, error.message);
        stats.errors++;
        return null;
    }
}

/**
 * Main import function
 */
async function importProducts() {
    try {
        console.log("=".repeat(60));
        console.log("Starting Product Import Script");
        console.log("=".repeat(60));

        // Connect to database
        console.log("\n[1/5] Connecting to database...");
        await connectDB();
        console.log("  ✓ Database connected successfully");

        // Sync indexes to match current schema
        console.log("\n[1.5/5] Syncing Product indexes...");
        try {
            await Product.syncIndexes();
            console.log("  ✓ Product indexes synced");
        } catch (syncError) {
            console.warn("  ⚠ Warning: Could not sync indexes:", syncError.message);
        }

        // Check existing products
        const existingProductsCount = await Product.countDocuments();
        console.log(`  ℹ Existing products in DB: ${existingProductsCount}`);
        if (existingProductsCount > 0) {
            console.log("  ⚠ Note: There are existing products. They will be skipped if duplicates.");
        }

        // Load category slug mapping
        console.log("\n[2/6] Loading category slug mapping...");
        const categoriesPath = path.join(__dirname, "../data/categories-extracted.json");
        if (fs.existsSync(categoriesPath)) {
            const categoriesData = JSON.parse(fs.readFileSync(categoriesPath, "utf8"));
            for (const cat of categoriesData) {
                if (cat.slug) {
                    const slug = cat.slug.toLowerCase().trim();
                    // Map the slug to itself (this is what's saved in DB)
                    slugMapping.set(slug, slug);

                    // Also try to decode URL-encoded slugs and map them
                    try {
                        const decodedSlug = decodeURIComponent(slug).toLowerCase().trim();
                        if (decodedSlug !== slug) {
                            slugMapping.set(decodedSlug, slug);
                        }
                    } catch (e) {
                        // If decoding fails, ignore
                    }

                    // Also map slugDecoded if it exists
                    if (cat.slugDecoded) {
                        const slugDecoded = cat.slugDecoded.toLowerCase().trim();
                        slugMapping.set(slugDecoded, slug);
                    }
                }
            }
            console.log(`  ✓ Loaded ${slugMapping.size} slug mappings`);
        } else {
            console.log(`  ⚠ Categories mapping file not found, will use slugs as-is`);
        }

        // Read products JSON file
        console.log("\n[3/6] Reading products file...");
        const productsPath = path.join(__dirname, "../data/products.json");

        if (!fs.existsSync(productsPath)) {
            throw new Error(`Products file not found at: ${productsPath}`);
        }

        const productsData = JSON.parse(fs.readFileSync(productsPath, "utf8"));

        if (!Array.isArray(productsData)) {
            throw new Error("Products file must contain a JSON array");
        }

        stats.total = productsData.length;
        console.log(`  ✓ Found ${stats.total} products in file`);

        // Process products in batches to avoid memory issues
        console.log("\n[4/6] Processing and importing products...");
        const batchSize = 50;
        let processed = 0;
        const usedSlugs = new Set(); // Track slugs used in current import session

        for (let i = 0; i < productsData.length; i += batchSize) {
            const batch = productsData.slice(i, i + batchSize);
            const productsToInsert = [];

            for (const wpProduct of batch) {
                processed++;
                const productData = await convertWordPressProduct(wpProduct);

                if (productData) {
                    // Find unique slug (check both DB and usedSlugs)
                    const originalSlug = productData.slug;
                    const finalSlug = await findUniqueSlug(originalSlug, usedSlugs);

                    if (finalSlug !== originalSlug) {
                        console.log(`  ⚠ Product slug changed: ${originalSlug} → ${finalSlug} (product: ${productData.title?.he})`);
                    }

                    productData.slug = finalSlug;
                    usedSlugs.add(finalSlug.toLowerCase());
                    productsToInsert.push(productData);
                } else {
                    console.log(`  ⚠ Product conversion returned null: ${wpProduct.name || wpProduct.slug}`);
                }

                // Progress indicator
                if (processed % 100 === 0) {
                    console.log(`  Progress: ${processed}/${stats.total} products processed`);
                }
            }

            // Insert products one by one to handle duplicates properly
            if (productsToInsert.length > 0) {
                let batchImported = 0;
                let batchSkipped = 0;

                for (const productData of productsToInsert) {
                    try {
                        await Product.create(productData);
                        batchImported++;
                    } catch (error) {
                        // Handle duplicate key errors
                        if (error.code === 11000) {
                            // Log duplicate details to understand what field is causing the issue
                            console.log("  ✗ DUPLICATE DETAILS:", {
                                keyPattern: error.keyPattern,
                                keyValue: error.keyValue,
                                message: error.message,
                                product: productData.title?.he || productData.slug,
                            });

                            // Only try to fix slug if the duplicate is actually on slug
                            const isSlugDup = !!error.keyPattern?.slug;

                            if (!isSlugDup) {
                                console.error(`  ✗ Duplicate is NOT on slug field. Fix indexes or schema. Field: ${JSON.stringify(error.keyPattern)}, Value: ${JSON.stringify(error.keyValue)}`);
                                batchSkipped++;
                                continue;
                            }

                            // If duplicate is on slug, try to find unique slug and insert again
                            const originalSlug = productData.slug;
                            const uniqueSlug = await findUniqueSlug(originalSlug, usedSlugs);

                            if (uniqueSlug !== originalSlug) {
                                productData.slug = uniqueSlug;
                                usedSlugs.add(uniqueSlug.toLowerCase());
                                try {
                                    await Product.create(productData);
                                    batchImported++;
                                    console.log(`  ⚠ Product slug changed on retry: ${originalSlug} → ${uniqueSlug}`);
                                } catch (retryError) {
                                    console.log(`  ⚠ Skipping duplicate product after slug change: ${productData.title?.he || originalSlug}`);
                                    if (retryError.code === 11000) {
                                        console.log("  ✗ DUPLICATE DETAILS (retry):", {
                                            keyPattern: retryError.keyPattern,
                                            keyValue: retryError.keyValue,
                                        });
                                    }
                                    batchSkipped++;
                                }
                            } else {
                                console.log(`  ⚠ Skipping duplicate product (could not find unique slug): ${productData.title?.he || originalSlug}`);
                                batchSkipped++;
                            }
                        } else {
                            console.error(`  ✗ Error inserting product ${productData.title?.he || productData.slug}:`, error.message);
                            batchSkipped++;
                        }
                    }
                }

                stats.imported += batchImported;
                stats.skipped += batchSkipped;

                if (batchImported > 0) {
                    console.log(`  ✓ Inserted ${batchImported} products, skipped ${batchSkipped} (${processed}/${stats.total} processed)`);
                } else if (batchSkipped > 0) {
                    console.log(`  ⚠ Skipped ${batchSkipped} products in batch (${processed}/${stats.total} processed)`);
                }
            }
        }

        // Print summary
        console.log("\n[5/6] Import Summary");
        console.log("=".repeat(60));
        console.log(`Total products in file:     ${stats.total}`);
        console.log(`Successfully imported:       ${stats.imported}`);
        console.log(`Skipped (duplicates/missing): ${stats.skipped}`);
        console.log(`Errors:                     ${stats.errors}`);
        console.log(`Categories created:          ${stats.categoriesCreated}`);
        console.log(`Categories found (existing): ${stats.categoriesFound}`);
        console.log("=".repeat(60));

        console.log("\n✓ Import process completed!");

        // Close database connection
        await mongoose.connection.close();
        console.log("✓ Database connection closed");

        process.exit(0);
    } catch (error) {
        console.error("\n✗ Fatal error during import:", error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

// Run the import
importProducts();

