// scripts/importCategories.js
// Script to delete existing categories and import new ones from categories-extracted.json

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { connectDB } = require("../config/db");
const Category = require("../models/Category");

/**
 * Main import function
 */
async function importCategories() {
    try {
        console.log("=".repeat(60));
        console.log("Category Import Script");
        console.log("=".repeat(60));

        // Connect to database
        console.log("\n[1/6] Connecting to database...");
        await connectDB();
        console.log("  ✓ Database connected successfully");

        // Read categories JSON file
        console.log("\n[2/6] Reading categories file...");
        const categoriesPath = path.join(__dirname, "../data/categories-extracted.json");

        if (!fs.existsSync(categoriesPath)) {
            throw new Error(`Categories file not found at: ${categoriesPath}`);
        }

        const categoriesData = JSON.parse(fs.readFileSync(categoriesPath, "utf8"));

        if (!Array.isArray(categoriesData)) {
            throw new Error("Categories file must contain a JSON array");
        }

        console.log(`  ✓ Found ${categoriesData.length} categories in file`);

        // Delete all existing categories first
        console.log("\n[3/6] Deleting existing categories...");
        const deleteResult = await Category.deleteMany({});
        console.log(`  ✓ Deleted ${deleteResult.deletedCount} existing categories`);

        // Create Home category first with specific _id
        console.log("\n[4/6] Creating Home parent category...");
        const homeCategoryObj = {
            _id: new mongoose.Types.ObjectId("62c827b5a427b63741da9175"),
            name: {
                en: "Home",
            },
            description: {
                en: "This is Home Category",
            },
            slug: "home",
            parentName: "Home",
            status: "show",
            id: "Root",
        };

        let homeCategory;
        try {
            homeCategory = new Category(homeCategoryObj);
            await homeCategory.save();
            console.log(`  ✓ Created Home parent category: "${homeCategory.name.en}" (ID: ${homeCategory._id})`);
        } catch (error) {
            if (error.code === 11000) {
                // If already exists, find it
                homeCategory = await Category.findById("62c827b5a427b63741da9175");
                if (homeCategory) {
                    console.log(`  ✓ Home category already exists: "${homeCategory.name.en}" (ID: ${homeCategory._id})`);
                } else {
                    throw error;
                }
            } else {
                console.error("  ✗ Error creating Home category:", error.message);
                throw error;
            }
        }

        const homeCategoryId = homeCategory._id.toString();
        const homeCategoryName = homeCategory.name.en;

        // Process categories and set them as children of Home category
        console.log("\n[5/6] Processing categories...");
        const processedCategories = [];

        for (const cat of categoriesData) {
            // Get slug from file (should already be in English)
            if (!cat.slug) {
                console.warn(`  ⚠ Skipping category without slug: ${cat.name || "Unknown"}`);
                continue;
            }

            // Create category object matching the model with all required fields
            const categoryObj = {
                name: {
                    he: cat.name || "Unknown",
                    en: cat.nameEn || "", // Add English name if available, otherwise empty
                },
                description: {
                    he: cat.description || "",
                    en: cat.descriptionEn || "",
                },
                slug: cat.slug.toLowerCase().trim(),
                parentId: homeCategoryId, // Set all categories as children of Home
                parentName: homeCategoryName, // Set parent name
                icon: cat.icon || "",
                coloredIcon: cat.coloredIcon || "",
                status: "show",
            };

            if (cat.id) {
                categoryObj.id = String(cat.id);
            }

            processedCategories.push({
                original: cat,
                processed: categoryObj,
            });

            console.log(`  ✓ Processed: "${cat.name}" -> slug: "${cat.slug}" (parent: ${homeCategoryName})`);
        }

        // Insert new categories
        console.log("\n[6/6] Inserting new categories...");
        const categoriesToInsert = processedCategories.map((item) => item.processed);

        try {
            const insertResult = await Category.insertMany(categoriesToInsert, { ordered: false });
            console.log(`  ✓ Successfully inserted ${insertResult.length} categories`);
        } catch (error) {
            if (error.code === 11000) {
                console.error("  ✗ Error: Duplicate slug detected. Please check the slugs in categories-extracted.json.");
                throw error;
            }
            throw error;
        }

        // Print summary
        console.log("\n" + "=".repeat(60));
        console.log("Import Summary");
        console.log("=".repeat(60));
        console.log(`Home category created:       ${homeCategory ? "Yes" : "No"}`);
        console.log(`Categories processed:        ${processedCategories.length}`);
        console.log(`Categories deleted:         ${deleteResult.deletedCount}`);
        console.log(`Categories inserted:         ${categoriesToInsert.length}`);
        console.log("=".repeat(60));

        console.log("\nImported Categories:");
        console.log("-".repeat(60));
        processedCategories.forEach((item, index) => {
            console.log(
                `  ${index + 1}. ${item.processed.name.he} (slug: ${item.processed.slug}, ID: ${item.processed.id || "N/A"})`
            );
        });

        console.log("\n✓ Category import completed successfully!");
        console.log("=".repeat(60));

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
importCategories();