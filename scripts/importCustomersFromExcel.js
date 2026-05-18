/**
 * Import customers + main customers from Excel:
 * data/לקוחות לאתר MNM.xlsx
 *
 * DRY RUN:
 *   node scripts/importCustomersFromExcel.js
 *
 * COMMIT (purge then import):
 *   node scripts/importCustomersFromExcel.js --commit
 *
 * Requires:
 *   npm i xlsx mongoose dotenv bcryptjs
 *   and env MONGO_URI=...
 */

require("dotenv").config();

const path = require("path");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");

const MainCustomer = require("../models/MainCustomer");
const Customer = require("../models/Customer");

// ===== Config =====
const EXCEL_PATH = path.join(__dirname, "..", "data", "לקוחות לאתר MNM.xlsx");
const DEFAULT_PRICE_LIST_ID = new mongoose.Types.ObjectId("694416d8a8b6644bf9fb7254");
const DEFAULT_PAYMENT_TERMS = "+15";
const COMMIT = process.argv.includes("--commit");

// " - ראשי" | "- ראשי" | " -ראשי" | "-ראשי"
const MAIN_SUFFIX_RE = /\s*-\s*ראשי\s*$/;

// ===== Helpers =====
function toStr(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return String(v).trim();
    return String(v).trim();
}

function collapseSpaces(s) {
    return toStr(s).replace(/\s+/g, " ").trim();
}

function normalizeHyphens(s) {
    // turn any " - " / "- " / " -" into "-"
    return collapseSpaces(s).replace(/\s*-\s*/g, "-").trim();
}

function normalizeNameForMatch(name) {
    // for matching purposes only:
    // collapse spaces + normalize hyphens spacing
    return normalizeHyphens(name);
}

function toOptionalStr(v) {
    const s = toStr(v);
    return s ? s : undefined;
}

function toNumberOrUndefined(v) {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : undefined;
}

function cleanEmail(v) {
    const s = toStr(v).toLowerCase();
    return s ? s : "";
}

function isMainRow(nameRaw) {
    const name = toStr(nameRaw);
    return MAIN_SUFFIX_RE.test(name);
}

function stripMainSuffix(nameRaw) {
    const name = toStr(nameRaw);
    return name.replace(MAIN_SUFFIX_RE, "").trim();
}

/**
 * Map weird delivery strings to day number:
 * 0=Sunday .. 6=Saturday
 */
function mapWeeklyDeliveryDay(raw) {
    const s = toStr(raw);
    if (!s) return undefined;

    // normalize quotes variants
    const norm = s.replace(/["׳״]/g, "'").trim();

    // Saturday variants (מוצ"ש / מוצא"ש / מוצ"אש / מוצאש) + anything with מוצ
    if (norm.includes("מוצ")) return 6;

    if (norm.includes("ראשון")) return 0;
    if (norm.includes("שני")) return 1;
    if (norm.includes("שלישי")) return 2;
    if (norm.includes("רביעי")) return 3;
    if (norm.includes("חמישי")) return 4;
    if (norm.includes("שישי")) return 5;
    if (norm.includes("שבת")) return 6;

    return undefined;
}

function mapCustomerType(raw) {
    const s = toStr(raw);
    if (s.includes("מוסדי")) return "institutional";
    if (s.includes("עיסקי") || s.includes("עסקי")) return "business";
    if (s.includes("רגיל")) return "regular";
    return "casual";
}

function buildSyntheticEmail(rivhitIdMaybe, nameMaybe) {
    const idPart = toStr(rivhitIdMaybe) || "unknown";
    const safeName = toStr(nameMaybe)
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9\u0590-\u05FF\-_.]/g, "")
        .slice(0, 40);
    const extra = safeName ? `-${safeName}` : "";
    return `no-email+${idPart}${extra}@mnm.local`.toLowerCase();
}

// ===== Excel parsing =====
function readExcelRows() {
    const wb = XLSX.readFile(EXCEL_PATH);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: "",
        raw: false,
    });

    const dataRows = rows.slice(2);

    return dataRows
        .map((r) => r.slice(0, 25))
        .filter((r) => {
            const rivhitId = toStr(r[0]);
            const name = toStr(r[1]);
            return rivhitId || name;
        });
}

// ===== Main import logic =====
async function main() {
    if (!process.env.MONGO_URI) throw new Error("Missing env MONGO_URI");

    const now = new Date();
    const rows = readExcelRows();

    /**
     * ===== Specific edge cases (explicit rules) =====
     */

    // "ראשי" rows that should be treated as SUB customers (not as separate MainCustomer)
    const MAIN_ROWS_THAT_SHOULD_BE_SUB = new Set([
        normalizeNameForMatch("שלוחות אגודת החינוך- ראשי"),
    ]);

    // Special matchers: sub-customer name => which main base it belongs to
    const SPECIAL_SUB_TO_MAIN_MATCHERS = [
        // אור חיים- ראשי: catch spelling variants "אור החיים", "אור החים"
        {
            mainBase: normalizeNameForMatch("אור חיים"),
            match: (nameNorm) => {
                return (
                    nameNorm.startsWith(normalizeNameForMatch("אור החיים")) ||
                    nameNorm.startsWith(normalizeNameForMatch("אור החים")) ||
                    nameNorm.startsWith(normalizeNameForMatch("אור חיים"))
                );
            },
        },

        // מתיישבי שדה נחום- ראשי: subs end with or include "שדה נחום"
        {
            mainBase: normalizeNameForMatch("מתיישבי שדה נחום"),
            match: (nameNorm) => {
                return nameNorm.includes(normalizeNameForMatch("שדה נחום"));
            },
        },

        // שלוחות - חינוך חברתי ועד מקומי: includes "שלוחות חינוך חברתי..." and "שלוחות אגודת החינוך..."
        {
            mainBase: normalizeNameForMatch("שלוחות - חינוך חברתי ועד מקומי"),
            match: (nameNorm) => {
                return (
                    nameNorm.startsWith(normalizeNameForMatch("שלוחות חינוך חברתי")) ||
                    nameNorm.startsWith(normalizeNameForMatch("שלוחות אגודת החינוך"))
                );
            },
        },
    ];

    // 1) Collect explicit mains (normalized)
    // Map: baseNorm -> mainRow
    const explicitMainByBaseNorm = new Map();
    for (const r of rows) {
        const name = toStr(r[1]);
        if (!name) continue;

        if (isMainRow(name)) {
            const nameNorm = normalizeNameForMatch(name);

            // Edge-case: treat as sub, not as explicit main
            if (MAIN_ROWS_THAT_SHOULD_BE_SUB.has(nameNorm)) continue;

            const base = stripMainSuffix(name);             // clean "X"
            const baseNorm = normalizeNameForMatch(base);   // matching key
            if (!explicitMainByBaseNorm.has(baseNorm)) {
                explicitMainByBaseNorm.set(baseNorm, r);
            }
        }
    }

    // Create a sorted list of main bases by length desc, so longest match wins
    const mainBasesSorted = Array.from(explicitMainByBaseNorm.keys()).sort(
        (a, b) => b.length - a.length
    );

    const stats = {
        totalRows: rows.length,
        explicitMains: explicitMainByBaseNorm.size,
        createdMain: 0,
        updatedMain: 0,
        createdCustomer: 0,
        updatedCustomer: 0,
        linked: 0,
        warnings: 0,
        purged: 0,
    };

    await mongoose.connect(process.env.MONGO_URI);

    // PURGE first (only on commit)
    if (COMMIT) {
        const delCustomers = await Customer.deleteMany({});
        const delMains = await MainCustomer.deleteMany({});
        stats.purged = (delCustomers.deletedCount || 0) + (delMains.deletedCount || 0);
        console.log(`🧨 PURGE: deleted Customers=${delCustomers.deletedCount || 0}, MainCustomers=${delMains.deletedCount || 0}`);
    }

    // Cache mains by key
    const mainCache = new Map(); // key -> MainCustomer doc

    async function upsertMainCustomer({
        key,
        name,
        email,
        phone,
        customerType,
        companyNumber,
        institutionType,
        externalCustomerId,
    }) {
        const update = {
            name: collapseSpaces(name), // main name clean (no "-ראשי")
            email,
            phone,
            customerType,
            companyNumber,
            institutionType,
            priceList: DEFAULT_PRICE_LIST_ID,
            paymentTerms: DEFAULT_PAYMENT_TERMS,
        };

        if (externalCustomerId !== undefined) {
            update.externalCustomerId = externalCustomerId;
        }

        if (!COMMIT) {
            const mock = { _id: new mongoose.Types.ObjectId(), ...update, subCustomers: [] };
            mainCache.set(key, mock);
            return mock;
        }

        // After purge this will usually insert, but keep upsert for safety
        const filter = externalCustomerId !== undefined ? { externalCustomerId } : { name: update.name, email };
        const existing = await MainCustomer.findOne(filter).select("_id");
        const doc = await MainCustomer.findOneAndUpdate(
            filter,
            { $set: update, $setOnInsert: { subCustomers: [] } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (existing) stats.updatedMain += 1;
        else stats.createdMain += 1;

        mainCache.set(key, doc);
        return doc;
    }

    async function upsertCustomer({
        mainCustomerId,
        name,
        email,
        phone,
        password,
        address,
        creditLimit,
        weeklyDeliveryDay,
        externalCustomerId,
    }) {
        const update = {
            mainCustomer: mainCustomerId,
            name: toStr(name), // keep EXACT as excel
            email,
            phone,
            password: password ? bcrypt.hashSync(password, 10) : undefined,
            isRegistered: Boolean(password),
            address,
            creditLimit: creditLimit ?? 0,
            weeklyDeliveryDay,
            accounting: {
                provider: "rivhit",
                externalCustomerId: externalCustomerId,
                syncedAt: new Date(),
                lastSyncError: undefined,
            },
        };

        if (!COMMIT) {
            return { _id: new mongoose.Types.ObjectId(), ...update };
        }

        const filter =
            externalCustomerId !== undefined
                ? { "accounting.externalCustomerId": externalCustomerId, mainCustomer: mainCustomerId }
                : { mainCustomer: mainCustomerId, name: update.name, email: update.email };

        const existing = await Customer.findOne(filter).select("_id");
        const doc = await Customer.findOneAndUpdate(
            filter,
            { $set: update },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (existing) stats.updatedCustomer += 1;
        else stats.createdCustomer += 1;

        await MainCustomer.updateOne({ _id: mainCustomerId }, { $addToSet: { subCustomers: doc._id } });
        stats.linked += 1;

        return doc;
    }

    function buildAddressFromRow(r) {
        const city = toOptionalStr(r[4]);
        const street = toOptionalStr(r[5]);
        const houseNumber = toOptionalStr(r[6]);
        const apartmentNumber = toOptionalStr(r[7]);
        const entryCode = toOptionalStr(r[8]);
        const postalCode = toOptionalStr(r[9]);

        const address = {};

        if (city) address.city = { city_name_he: collapseSpaces(city) };
        if (street) address.street = collapseSpaces(street);
        if (houseNumber) address.houseNumber = collapseSpaces(houseNumber);
        if (apartmentNumber) address.apartmentNumber = collapseSpaces(apartmentNumber);
        if (entryCode) address.entryCode = collapseSpaces(entryCode);
        if (postalCode) address.postalCode = collapseSpaces(postalCode);

        return Object.keys(address).length ? address : undefined;
    }

    function pickEmailsPhones(r, { forMain }) {
        const ordersPhone = toOptionalStr(r[11]);
        const ordersEmail = cleanEmail(r[12]);

        const acctPhone = toOptionalStr(r[14]);
        const acctEmail = cleanEmail(r[15]);

        // main -> accounting ; sub -> orders
        let email = forMain ? acctEmail : ordersEmail;
        let phone = forMain ? acctPhone : ordersPhone;

        // fallback
        if (!email) email = forMain ? ordersEmail : acctEmail;
        if (!phone) phone = forMain ? ordersPhone : acctPhone;

        return { email, phone };
    }

    function matchExplicitMainBaseNorm(nonMainNameRaw) {
        const nameNorm = normalizeNameForMatch(nonMainNameRaw);

        // 1) explicit edge-case rules first
        for (const m of SPECIAL_SUB_TO_MAIN_MATCHERS) {
            if (m.match(nameNorm)) return m.mainBase;
        }

        // 2) general rule: startsWith(base) + boundary (space/hyphen) or exact match
        for (const baseNorm of mainBasesSorted) {
            if (nameNorm === baseNorm) return baseNorm;

            if (nameNorm.startsWith(baseNorm)) {
                const next = nameNorm.charAt(baseNorm.length);
                if (next === " " || next === "-") return baseNorm;
            }
        }
        return null;
    }

    async function getOrCreateMainForRow(r) {
        const fullName = toStr(r[1]);
        const rivhitId = toNumberOrUndefined(r[0]);

        const matchedBaseNorm = matchExplicitMainBaseNorm(fullName);

        if (matchedBaseNorm) {
            const mainRow = explicitMainByBaseNorm.get(matchedBaseNorm);

            // If matcher refers to a main that exists as explicit row, we use it.
            // If it's a special base that *must* exist but maybe not in map for some reason,
            // we will create it as standalone from the current row (fallback).
            if (!mainRow) {
                // fallback - create a main with this base name using current row's "main" contact
                const mainKey = `explicit-fallback:${matchedBaseNorm}`;
                if (mainCache.has(mainKey)) return mainCache.get(mainKey);

                const mainNameClean = matchedBaseNorm; // already normalized, but keep as name
                const { email: mainEmailRaw, phone: mainPhone } = pickEmailsPhones(r, { forMain: true });

                let mainEmail = mainEmailRaw;
                if (!mainEmail) {
                    stats.warnings += 1;
                    mainEmail = buildSyntheticEmail(rivhitId, mainNameClean);
                    console.warn(`[WARN] Missing main email for "${mainNameClean}" (explicit fallback). Using synthetic: ${mainEmail}`);
                }

                return upsertMainCustomer({
                    key: mainKey,
                    name: mainNameClean,
                    email: mainEmail,
                    phone: mainPhone,
                    customerType: mapCustomerType(r[17]),
                    companyNumber: toOptionalStr(r[19]),
                    institutionType: toOptionalStr(r[18]),
                    externalCustomerId: undefined, // we don't have a main-row rivhit id here
                });
            }

            const mainNameClean = stripMainSuffix(mainRow[1]);
            const mainKey = `explicit:${matchedBaseNorm}`;

            if (mainCache.has(mainKey)) return mainCache.get(mainKey);

            const { email: mainEmailRaw, phone: mainPhone } = pickEmailsPhones(mainRow, { forMain: true });
            let mainEmail = mainEmailRaw;
            if (!mainEmail) {
                stats.warnings += 1;
                mainEmail = buildSyntheticEmail(toStr(mainRow[0]), mainNameClean);
                console.warn(`[WARN] Missing main email for "${mainNameClean}" (explicit). Using synthetic: ${mainEmail}`);
            }

            return upsertMainCustomer({
                key: mainKey,
                name: mainNameClean,
                email: mainEmail,
                phone: mainPhone,
                customerType: mapCustomerType(mainRow[17]),
                companyNumber: toOptionalStr(mainRow[19]),
                institutionType: toOptionalStr(mainRow[18]),
                externalCustomerId: toNumberOrUndefined(mainRow[0]),
            });
        }

        // Standalone behavior (create main + one sub)
        const mainName = collapseSpaces(fullName);
        const mainKey = `standalone:${normalizeNameForMatch(mainName)}`;

        if (mainCache.has(mainKey)) return mainCache.get(mainKey);

        const { email: mainEmailRaw, phone: mainPhone } = pickEmailsPhones(r, { forMain: true });
        let mainEmail = mainEmailRaw;
        if (!mainEmail) {
            stats.warnings += 1;
            mainEmail = buildSyntheticEmail(rivhitId, mainName);
            console.warn(`[WARN] Missing main email for "${mainName}" (standalone). Using synthetic: ${mainEmail}`);
        }

        return upsertMainCustomer({
            key: mainKey,
            name: mainName,
            email: mainEmail,
            phone: mainPhone,
            customerType: mapCustomerType(r[17]),
            companyNumber: toOptionalStr(r[19]),
            institutionType: toOptionalStr(r[18]),
            externalCustomerId: rivhitId,
        });
    }

    // 1) Create explicit mains first
    for (const [baseNorm, rMain] of explicitMainByBaseNorm.entries()) {
        const mainNameClean = stripMainSuffix(rMain[1]);
        const mainKey = `explicit:${baseNorm}`;
        if (mainCache.has(mainKey)) continue;

        const { email: mainEmailRaw, phone: mainPhone } = pickEmailsPhones(rMain, { forMain: true });
        let mainEmail = mainEmailRaw;
        if (!mainEmail) {
            stats.warnings += 1;
            mainEmail = buildSyntheticEmail(toStr(rMain[0]), mainNameClean);
            console.warn(`[WARN] Missing main email for "${mainNameClean}" (explicit pre-pass). Using synthetic: ${mainEmail}`);
        }

        await upsertMainCustomer({
            key: mainKey,
            name: mainNameClean,
            email: mainEmail,
            phone: mainPhone,
            customerType: mapCustomerType(rMain[17]),
            companyNumber: toOptionalStr(rMain[19]),
            institutionType: toOptionalStr(rMain[18]),
            externalCustomerId: toNumberOrUndefined(rMain[0]),
        });
    }

    // 2) Create customers for every NON-main row
    for (const r of rows) {
        const fullName = toStr(r[1]);
        if (!fullName) continue;

        const nameNorm = normalizeNameForMatch(fullName);

        // Skip main rows that are true mains (create only MainCustomer)
        // BUT allow "main rows that should be sub" to be imported as Customer.
        if (isMainRow(fullName) && !MAIN_ROWS_THAT_SHOULD_BE_SUB.has(nameNorm)) {
            continue;
        }

        const rivhitId = toNumberOrUndefined(r[0]);
        const mainDoc = await getOrCreateMainForRow(r);

        const customerName = toStr(r[1]); // exact trimmed as in excel
        const { email: subEmailRaw, phone: subPhone } = pickEmailsPhones(r, { forMain: false });

        let subEmail = subEmailRaw;
        if (!subEmail) {
            stats.warnings += 1;
            subEmail = buildSyntheticEmail(rivhitId, customerName);
            console.warn(`[WARN] Missing sub email for "${customerName}". Using synthetic: ${subEmail}`);
        }

        const password = toOptionalStr(r[16]);
        const creditLimit = toNumberOrUndefined(r[22]) ?? 0;

        const weeklyDeliveryDay = mapWeeklyDeliveryDay(r[23]);
        if (toStr(r[23]) && weeklyDeliveryDay === undefined) {
            stats.warnings += 1;
            console.warn(`[WARN] Unknown delivery day value: "${toStr(r[23])}" for "${customerName}"`);
        }

        const address = buildAddressFromRow(r);

        await upsertCustomer({
            mainCustomerId: mainDoc._id,
            name: customerName,
            email: subEmail,
            phone: subPhone,
            password,
            address,
            creditLimit,
            weeklyDeliveryDay,
            externalCustomerId: rivhitId,
        });
    }

    await mongoose.disconnect();

    console.log("==== Import summary ====");
    console.log(JSON.stringify(stats, null, 2));
    console.log(COMMIT ? "✅ COMMIT mode: PURGE + IMPORT done" : "🧪 DRY-RUN mode: no DB writes");
}

main().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch (_) { }
    process.exit(1);
});