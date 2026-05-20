// scripts/replaceShapiraText.js
// מחליף "האחים שפירא" -> "שוברים שוק" בכל מסמכי ה-Setting במונגו.
// שימוש:
//   node scripts/replaceShapiraText.js              # dry-run (לא כותב)
//   node scripts/replaceShapiraText.js --apply      # מבצע בפועל
//
// אפשר להוסיף --collection=Setting לכוון לקולקציה אחרת
// (כברירת מחדל סורק רק Setting; שם מאוחסן עמוד "אודות" ושאר תוכן ה-CMS).

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { connectDB } = require("../config/db");
const Setting = require("../models/Setting");

// רשימת החלפות לפי סדר. הראשון לתפוס את שני הביטויים יחד; השאר לכיסוי שאריות.
const REPLACEMENTS = [
  { from: "האחים שפירא י.ת.ר", to: "שוברים שוק" },
  { from: "האחים שפירא", to: "שוברים שוק" },
  { from: "י.ת.ר", to: "" },
];
// טריגרים שמסמנים שצריך לעבד את המחרוזת בכלל (אם אף אחד לא נמצא — דילוג מהיר)
const TRIGGERS = ["האחים שפירא", "י.ת.ר"];

const APPLY = process.argv.includes("--apply");

// נתיבים שמדלגים עליהם (case-insensitive). מדלג על כל מה שקשור למייל.
const SKIP_PATH_PATTERNS = [/email/i, /mail/i];

function isSkippedPath(path) {
  return SKIP_PATH_PATTERNS.some((re) => re.test(path));
}

function applyReplacements(str) {
  let out = str;
  for (const { from, to } of REPLACEMENTS) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
    }
  }
  // ניקוי רווחים כפולים שעלולים להישאר אחרי הסרת "י.ת.ר"
  out = out.replace(/ {2,}/g, " ").replace(/ ,/g, ",").trim();
  return out;
}

function replaceInValue(value, path, hits, skipped) {
  if (typeof value === "string") {
    if (TRIGGERS.some((t) => value.includes(t))) {
      if (isSkippedPath(path)) {
        skipped.push({ path, value });
        return value;
      }
      const next = applyReplacements(value);
      if (next !== value) {
        hits.push({ path, before: value, after: next });
        return next;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => replaceInValue(item, `${path}[${i}]`, hits, skipped));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = replaceInValue(value[k], path ? `${path}.${k}` : k, hits, skipped);
    }
    return out;
  }
  return value;
}

async function run() {
  console.log("=".repeat(60));
  console.log(`Replacements in Setting collection:`);
  for (const { from, to } of REPLACEMENTS) {
    console.log(`  "${from}" -> "${to}"`);
  }
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);
  console.log("=".repeat(60));

  await connectDB();

  const docs = await Setting.find({}).lean(false);
  console.log(`Found ${docs.length} Setting document(s).`);

  let totalHits = 0;
  let totalSkipped = 0;
  let touchedDocs = 0;

  for (const doc of docs) {
    const hits = [];
    const skipped = [];
    const nextSetting = replaceInValue(doc.setting, "", hits, skipped);

    if (hits.length === 0 && skipped.length === 0) {
      console.log(`  - [${doc.name}] no matches`);
      continue;
    }

    if (hits.length > 0) {
      touchedDocs += 1;
      totalHits += hits.length;
      console.log(`\n  • [${doc.name}] ${hits.length} match(es) to replace:`);
      for (const h of hits) {
        console.log(`      path: ${h.path}`);
        console.log(`      before: ${JSON.stringify(h.before)}`);
        console.log(`      after : ${JSON.stringify(h.after)}`);
      }
    }

    if (skipped.length > 0) {
      totalSkipped += skipped.length;
      console.log(`\n  • [${doc.name}] ${skipped.length} match(es) SKIPPED (email-related path):`);
      for (const s of skipped) {
        console.log(`      path: ${s.path}`);
        console.log(`      value: ${JSON.stringify(s.value)}`);
      }
    }

    if (APPLY && hits.length > 0) {
      doc.setting = nextSetting;
      doc.markModified("setting");
      await doc.save();
      console.log(`      ✓ saved`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Summary: ${totalHits} replacement(s) across ${touchedDocs} document(s). ${totalSkipped} skipped (email paths).`);
  console.log(APPLY ? "Changes were SAVED." : "Dry-run only. Re-run with --apply to persist.");
  console.log("=".repeat(60));

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Script failed:", err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
