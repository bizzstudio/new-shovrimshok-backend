// scripts/listCategories.js
// Script to extract and list all unique categories from products.json

const fs = require("fs");
const path = require("path");

/**
 * Decode URL-encoded slug
 */
function decodeSlug(encodedSlug) {
  try {
    return decodeURIComponent(encodedSlug);
  } catch (error) {
    // If decoding fails, return original
    return encodedSlug;
  }
}

/**
 * Main function to extract categories
 */
async function listCategories() {
  try {
    console.log("=".repeat(60));
    console.log("Category Extraction Script");
    console.log("=".repeat(60));

    // Read products JSON file
    console.log("\n[1/2] Reading products file...");
    const productsPath = path.join(__dirname, "../data/products.json");
    
    if (!fs.existsSync(productsPath)) {
      throw new Error(`Products file not found at: ${productsPath}`);
    }

    const productsData = JSON.parse(fs.readFileSync(productsPath, "utf8"));
    
    if (!Array.isArray(productsData)) {
      throw new Error("Products file must contain a JSON array");
    }

    console.log(`  ✓ Found ${productsData.length} products in file`);

    // Extract unique categories
    console.log("\n[2/2] Extracting unique categories...");
    const categoriesMap = new Map(); // Using slug as unique key
    
    let productsProcessed = 0;
    let totalCategoriesFound = 0;

    for (const product of productsData) {
      productsProcessed++;
      
      if (product.categories && Array.isArray(product.categories)) {
        for (const category of product.categories) {
          totalCategoriesFound++;
          
          // Use slug as unique identifier (lowercase for consistency)
          const slug = category.slug ? category.slug.toLowerCase().trim() : null;
          
          if (!slug) {
            console.warn(`  ⚠ Found category without slug: ${category.name || 'Unknown'} (ID: ${category.id || 'N/A'})`);
            continue;
          }

          // If category doesn't exist in map, add it
          if (!categoriesMap.has(slug)) {
            const decodedSlug = decodeSlug(slug);
            categoriesMap.set(slug, {
              id: category.id || null,
              name: category.name || 'Unknown',
              slug: slug, // Keep original for uniqueness
              slugDecoded: decodedSlug, // Decoded version for display
              count: 1, // Track how many products have this category
            });
          } else {
            // Increment count if already exists
            const existing = categoriesMap.get(slug);
            existing.count++;
          }
        }
      }

      // Progress indicator
      if (productsProcessed % 1000 === 0) {
        console.log(`  Progress: ${productsProcessed}/${productsData.length} products processed`);
      }
    }

    // Convert map to array and sort
    const uniqueCategories = Array.from(categoriesMap.values()).sort((a, b) => {
      // Sort by name (Hebrew will sort correctly)
      return a.name.localeCompare(b.name);
    });

    // Print results
    console.log("\n" + "=".repeat(60));
    console.log("Category Summary");
    console.log("=".repeat(60));
    console.log(`Total products processed:     ${productsProcessed}`);
    console.log(`Total category occurrences:   ${totalCategoriesFound}`);
    console.log(`Unique categories found:      ${uniqueCategories.length}`);
    console.log("=".repeat(60));

    console.log("\nUnique Categories List:");
    console.log("-".repeat(60));
    
    if (uniqueCategories.length === 0) {
      console.log("  No categories found in products file.");
    } else {
      // Print in a formatted table
      console.log("\n" + "ID".padEnd(10) + "Slug (Decoded)".padEnd(40) + "Name".padEnd(30) + "Products");
      console.log("-".repeat(110));
      
      uniqueCategories.forEach((cat, index) => {
        const id = (cat.id || 'N/A').toString().padEnd(10);
        const slug = (cat.slugDecoded || cat.slug).padEnd(40);
        const name = cat.name.padEnd(30);
        const count = cat.count.toString();
        
        console.log(`${id}${slug}${name}${count}`);
      });
    }

    // Also save to JSON file for reference
    const outputPath = path.join(__dirname, "../data/categories-extracted.json");
    fs.writeFileSync(
      outputPath,
      JSON.stringify(uniqueCategories, null, 2),
      "utf8"
    );
    console.log(`\n✓ Categories saved to: ${outputPath}`);

    // Print summary statistics
    console.log("\n" + "=".repeat(60));
    console.log("Category Statistics");
    console.log("=".repeat(60));
    
    const categoriesWithId = uniqueCategories.filter(c => c.id !== null).length;
    const categoriesWithoutId = uniqueCategories.length - categoriesWithId;
    const avgProductsPerCategory = (totalCategoriesFound / uniqueCategories.length).toFixed(2);
    
    console.log(`Categories with ID:          ${categoriesWithId}`);
    console.log(`Categories without ID:        ${categoriesWithoutId}`);
    console.log(`Average products per category: ${avgProductsPerCategory}`);
    
    // Find categories with most products
    const topCategories = uniqueCategories
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    if (topCategories.length > 0) {
      console.log("\nTop 10 Categories by Product Count:");
      console.log("-".repeat(60));
      topCategories.forEach((cat, index) => {
        const displaySlug = cat.slugDecoded || cat.slug;
        console.log(`  ${index + 1}. ${cat.name} (${cat.count} products) - slug: ${displaySlug}`);
      });
    }

    console.log("\n✓ Category extraction completed!");
    console.log("=".repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error("\n✗ Fatal error during extraction:", error);
    process.exit(1);
  }
}

// Run the extraction
listCategories();

