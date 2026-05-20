// scripts/findShapiraEverywhere.js
// סורק את כל הקולקציות במונגו ומאתר מסמכים שמכילים "האחים שפירא".
// קריאה בלבד — לא משנה דבר.

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { connectDB } = require("../config/db");

const NEEDLE = "האחים שפירא";

function findPaths(value, basePath, hits) {
  if (typeof value === "string") {
    if (value.includes(NEEDLE)) {
      hits.push({ path: basePath, snippet: value.slice(0, 200) });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findPaths(v, `${basePath}[${i}]`, hits));
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      findPaths(value[k], basePath ? `${basePath}.${k}` : k, hits);
    }
  }
}

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  console.log(`Scanning ${collections.length} collection(s) for "${NEEDLE}"...\n`);

  let totalDocs = 0;
  for (const c of collections) {
    const coll = db.collection(c.name);
    const count = await coll.countDocuments({});
    const cursor = coll.find({});
    let collMatches = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const hits = [];
      findPaths(doc, "", hits);
      if (hits.length > 0) {
        collMatches += 1;
        totalDocs += 1;
        console.log(`  • [${c.name}] _id=${doc._id} (${hits.length} field(s)):`);
        for (const h of hits) {
          console.log(`      ${h.path}: ${JSON.stringify(h.snippet)}`);
        }
      }
    }
    if (collMatches === 0) {
      console.log(`  - [${c.name}] (${count} docs): no match`);
    }
  }

  console.log(`\nTotal documents containing the needle: ${totalDocs}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Scan failed:", err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
