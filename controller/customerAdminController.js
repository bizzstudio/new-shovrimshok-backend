// controller/customerAdminController.js
const bcrypt = require("bcryptjs");
const Customer = require("../models/Customer");
const MainCustomer = require("../models/MainCustomer");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { getCustomerUnpaidBalance } = require("../services/orderServices");

// יצירת לקוח ראשי חדש עם תתי-לקוחות
const createCustomerByAdmin = async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            customerType,
            companyNumber,
            priceList,
            paymentTerms,
            institutionType,
            externalCustomerId,
            subCustomers, // מערך של תתי-לקוחות
        } = req.body;

        // בדיקת שדות חובה של MainCustomer
        if (!name || !email) {
            return res.status(400).send({
                message: {
                    en: "Name and email are required",
                    he: "שם ואימייל הם שדות חובה",
                },
            });
        }

        // בדיקה שיש לפחות תת-לקוח אחד
        if (!subCustomers || !Array.isArray(subCustomers) || subCustomers.length === 0) {
            return res.status(400).send({
                message: {
                    en: "At least one sub-customer is required",
                    he: "נדרש לפחות תת-לקוח אחד",
                },
            });
        }

        // וולידציה של כל תתי-הלקוחות לפני יצירה
        for (let i = 0; i < subCustomers.length; i++) {
            const subCustomerData = subCustomers[i];

            // בדיקה שיש שם ואימייל לכל תת-לקוח
            if (!subCustomerData.name || !subCustomerData.email) {
                return res.status(400).send({
                    message: {
                        en: `Sub-customer ${i + 1} must have name and email`,
                        he: `תת-לקוח ${i} חייב שם ואימייל`,
                    },
                });
            }
        }

        // בדיקת customerType
        const validCustomerTypes = ['casual', 'regular', 'business', 'institutional'];
        const finalCustomerType = customerType && validCustomerTypes.includes(customerType)
            ? customerType
            : 'casual';

        // יצירת MainCustomer
        const newMainCustomer = new MainCustomer({
            name,
            email: email.toLowerCase(),
            phone: phone || "",
            customerType: finalCustomerType,
            companyNumber: companyNumber || "",
            priceList: priceList || null,
            institutionType: institutionType || undefined,
            paymentTerms: paymentTerms && ['current', '+15', '+30', '+45', '+60', '+90', 'noDueDate'].includes(paymentTerms)
                ? paymentTerms
                : 'current',
            subCustomers: [], // נעדכן אחרי יצירת התתי-לקוחות
        });

        if (externalCustomerId !== undefined && externalCustomerId !== null && externalCustomerId !== "") {
            newMainCustomer.externalCustomerId = Number(externalCustomerId);
        }

        await newMainCustomer.save();

        // יצירת תתי-לקוחות
        const createdSubCustomers = [];
        for (const subCustomerData of subCustomers) {
            const newSubCustomer = new Customer({
                name: subCustomerData.name,
                lastName: subCustomerData.lastName || "",
                email: subCustomerData.email.toLowerCase(),
                phone: subCustomerData.phone || "",
                address: subCustomerData.address || {},
                image: subCustomerData.image || "",
                weeklyDeliveryDay: parseWeeklyDeliveryDay(subCustomerData.weeklyDeliveryDay),
                creditLimit: subCustomerData.creditLimit !== undefined ? subCustomerData.creditLimit : 0,
                alertAmount: subCustomerData.alertAmount != null && subCustomerData.alertAmount !== "" ? Number(subCustomerData.alertAmount) : null,
                alertPeriod: ["weekly", "monthly"].includes(subCustomerData.alertPeriod) ? subCustomerData.alertPeriod : null,
                isRegistered: true,
                password: subCustomerData.password ? bcrypt.hashSync(subCustomerData.password, 10) : undefined,
                mainCustomer: newMainCustomer._id,
            });

            if (subCustomerData.externalCustomerId !== undefined && subCustomerData.externalCustomerId !== null && subCustomerData.externalCustomerId !== "") {
                newSubCustomer.accounting = {
                    provider: "rivhit",
                    externalCustomerId: Number(subCustomerData.externalCustomerId),
                };
            }

            await newSubCustomer.save();
            createdSubCustomers.push(newSubCustomer._id);
        }

        // עדכון MainCustomer עם מערך תתי-הלקוחות
        newMainCustomer.subCustomers = createdSubCustomers;
        await newMainCustomer.save();

        // החזרת הלקוח הראשי עם כל תתי-הלקוחות
        const populatedMainCustomer = await MainCustomer.findById(newMainCustomer._id).populate('subCustomers');

        res.status(201).send({
            message: {
                en: "Main customer with sub-customers created successfully",
                he: "לקוח ראשי עם תתי-לקוחות נוצר בהצלחה",
            },
            mainCustomer: populatedMainCustomer,
        });
    } catch (err) {
        console.log('createCustomerByAdmin error: ', err);
        res.status(500).send({
            message: {
                en: "An error occurred while creating the customer",
                he: "אירעה שגיאה בעת יצירת הלקוח",
            },
        });
    }
};

// עדכון לקוח ראשי עם תתי-לקוחות
const updateCustomerByAdmin = async (req, res) => {
    try {
        const mainCustomerId = req.params.id;
        const {
            name,
            email,
            phone,
            customerType,
            companyNumber,
            priceList,
            paymentTerms,
            institutionType,
            externalCustomerId,
            subCustomers, // מערך של תתי-לקוחות (קיימים + חדשים)
        } = req.body;

        // שליפת MainCustomer
        const mainCustomer = await MainCustomer.findById(mainCustomerId).populate('subCustomers');
        if (!mainCustomer) {
            return res.status(404).send({
                message: {
                    en: "Main customer not found",
                    he: "לקוח ראשי לא נמצא",
                },
            });
        }

        // עדכון שדות MainCustomer
        if (name !== undefined) mainCustomer.name = name;
        if (email !== undefined) mainCustomer.email = email.toLowerCase();
        if (phone !== undefined) mainCustomer.phone = phone;

        if (customerType !== undefined) {
            const validCustomerTypes = ['casual', 'regular', 'business', 'institutional'];
            if (validCustomerTypes.includes(customerType)) {
                mainCustomer.customerType = customerType;
            }
        }

        if (companyNumber !== undefined) mainCustomer.companyNumber = companyNumber;
        if (priceList !== undefined) mainCustomer.priceList = priceList;
        if (institutionType !== undefined) mainCustomer.institutionType = institutionType;

        if (paymentTerms !== undefined) {
            const validPaymentTerms = ['current', '+15', '+30', '+45', '+60', '+90', 'noDueDate'];
            if (validPaymentTerms.includes(paymentTerms)) {
                mainCustomer.paymentTerms = paymentTerms;
            }
        }

        if (externalCustomerId !== undefined) {
            mainCustomer.externalCustomerId = (externalCustomerId === null || externalCustomerId === "") ? undefined : Number(externalCustomerId);
        }

        await mainCustomer.save();

        // עדכון/יצירת תתי-לקוחות
        if (subCustomers && Array.isArray(subCustomers)) {
            const updatedSubCustomerIds = [];

            for (const subCustomerData of subCustomers) {
                if (subCustomerData._id) {
                    // עדכון תת-לקוח קיים
                    const existingCustomer = await Customer.findById(subCustomerData._id);
                    if (existingCustomer && String(existingCustomer.mainCustomer) === String(mainCustomerId)) {
                        // עדכון שדות Customer
                        if (subCustomerData.name !== undefined) existingCustomer.name = subCustomerData.name;
                        if (subCustomerData.lastName !== undefined) existingCustomer.lastName = subCustomerData.lastName;
                        if (subCustomerData.email !== undefined) existingCustomer.email = subCustomerData.email.toLowerCase();
                        if (subCustomerData.phone !== undefined) existingCustomer.phone = subCustomerData.phone;
                        if (subCustomerData.address !== undefined) existingCustomer.address = mergeAddress(existingCustomer.address, subCustomerData.address);
                        if (subCustomerData.image !== undefined) existingCustomer.image = subCustomerData.image;
                        if (subCustomerData.weeklyDeliveryDay !== undefined) {
                            existingCustomer.weeklyDeliveryDay = parseWeeklyDeliveryDay(subCustomerData.weeklyDeliveryDay);
                        }
                        if (subCustomerData.creditLimit !== undefined) {
                            existingCustomer.creditLimit = subCustomerData.creditLimit;
                        }
                        if (subCustomerData.alertAmount !== undefined) {
                            existingCustomer.alertAmount = subCustomerData.alertAmount != null && subCustomerData.alertAmount !== "" ? Number(subCustomerData.alertAmount) : null;
                        }
                        if (subCustomerData.alertPeriod !== undefined) {
                            existingCustomer.alertPeriod = ["weekly", "monthly"].includes(subCustomerData.alertPeriod) ? subCustomerData.alertPeriod : null;
                        }
                        if (subCustomerData.password) {
                            existingCustomer.password = bcrypt.hashSync(subCustomerData.password, 10);
                        }

                        // עדכון מספר לקוח בריווחית
                        if (subCustomerData.externalCustomerId !== undefined) {
                            existingCustomer.accounting = existingCustomer.accounting || {};
                            existingCustomer.accounting.provider = "rivhit";
                            existingCustomer.accounting.externalCustomerId = subCustomerData.externalCustomerId === null || subCustomerData.externalCustomerId === ""
                                ? undefined
                                : Number(subCustomerData.externalCustomerId);
                        }

                        await existingCustomer.save();
                        updatedSubCustomerIds.push(existingCustomer._id);
                    }
                } else {
                    // יצירת תת-לקוח חדש
                    if (!subCustomerData.name || !subCustomerData.email) {
                        continue; // דלג על תת-לקוחות לא תקינים
                    }

                    const newSubCustomer = new Customer({
                        name: subCustomerData.name,
                        lastName: subCustomerData.lastName || "",
                        email: subCustomerData.email.toLowerCase(),
                        phone: subCustomerData.phone || "",
                        address: subCustomerData.address || {},
                        image: subCustomerData.image || "",
                        weeklyDeliveryDay: parseWeeklyDeliveryDay(subCustomerData.weeklyDeliveryDay),
                        creditLimit: subCustomerData.creditLimit !== undefined ? subCustomerData.creditLimit : 0,
                        alertAmount: subCustomerData.alertAmount != null && subCustomerData.alertAmount !== "" ? Number(subCustomerData.alertAmount) : null,
                        alertPeriod: ["weekly", "monthly"].includes(subCustomerData.alertPeriod) ? subCustomerData.alertPeriod : null,
                        isRegistered: true,
                        password: subCustomerData.password ? bcrypt.hashSync(subCustomerData.password, 10) : undefined,
                        mainCustomer: mainCustomer._id,
                    });

                    if (subCustomerData.externalCustomerId !== undefined && subCustomerData.externalCustomerId !== null && subCustomerData.externalCustomerId !== "") {
                        newSubCustomer.accounting = {
                            provider: "rivhit",
                            externalCustomerId: Number(subCustomerData.externalCustomerId),
                        };
                    }

                    await newSubCustomer.save();
                    updatedSubCustomerIds.push(newSubCustomer._id);
                }
            }

            // עדכון מערך תתי-הלקוחות ב-MainCustomer
            mainCustomer.subCustomers = updatedSubCustomerIds;
            await mainCustomer.save();
        }

        // החזרת הלקוח הראשי המעודכן עם כל תתי-הלקוחות
        const populatedMainCustomer = await MainCustomer.findById(mainCustomer._id).populate('subCustomers');

        res.send({
            message: {
                en: "Main customer and its sub-customers updated successfully",
                he: "הלקוח הראשי ותתי-הלקוחות שלו עודכנו בהצלחה",
            },
            mainCustomer: populatedMainCustomer,
        });
    } catch (err) {
        console.log('updateCustomerByAdmin error: ', err);
        res.status(500).send({
            message: {
                en: "An error occurred while updating the customer",
                he: "אירעה שגיאה בעת עדכון הלקוח",
            },
        });
    }
};

// שליפת כל הלקוחות הראשיים (ללא חישובי יתרות כדי לשמור על ביצועים)
const getAllMainCustomers = async (req, res) => {
    try {
        const mainCustomers = await MainCustomer.find({}).populate('subCustomers');

        // מיון לפי שם (עברית קודם)
        mainCustomers.sort((a, b) => {
            const isANameHebrew = /^[\u0590-\u05FF]+$/.test(a.name);
            const isBNameHebrew = /^[\u0590-\u05FF]+$/.test(b.name);

            if (isANameHebrew && !isBNameHebrew) return -1;
            if (!isANameHebrew && isBNameHebrew) return 1;
            return a.name.localeCompare(b.name);
        });

        // רק מידע בסיסי ללא חישובים כבדים
        const mainCustomersWithBasicInfo = mainCustomers.map((mc) => {
            return {
                ...mc.toObject(),
                summary: {
                    totalSubCustomers: mc.subCustomers.length,
                },
            };
        });

        res.send(mainCustomersWithBasicInfo);
    } catch (err) {
        console.log('getAllMainCustomers error: ', err);
        res.status(500).send({
            message: {
                en: "An error occurred while fetching customers",
                he: "אירעה שגיאה בעת שליפת הלקוחות",
            },
        });
    }
};

// שליפת לקוח ראשי עם כל תתי-הלקוחות וההזמנות שלהם
const getMainCustomer = async (req, res) => {
    try {
        const mainCustomerId = req.params.id;

        // שליפת MainCustomer עם כל תתי-הלקוחות
        const mainCustomer = await MainCustomer.findById(mainCustomerId).populate('subCustomers');

        if (!mainCustomer) {
            return res.status(404).send({
                message: {
                    en: "Customer not found",
                    he: "לקוח לא נמצא",
                },
            });
        }

        // איסוף כל ה-IDs של תתי-הלקוחות
        const subCustomerIds = mainCustomer.subCustomers.map(c => c._id);

        // שליפת כל ההזמנות של כל תתי-הלקוחות
        const allOrders = await Order.find({ user: { $in: subCustomerIds } })
            .select('-cart') // ללא עגלה (כדי לחסוך נפח)
            .populate({ path: "status" })
            .populate({ path: "user", select: "name lastName email phone address" }) // populate של תת-הלקוח
            .populate({ path: "user_info.priceList" })
            .populate({ path: "coupon" })
            .populate({ path: "actualMelaket" })
            .sort({ _id: -1 });

        // חישוב יתרות לכל תת-לקוח
        const subCustomersWithBalance = await Promise.all(
            mainCustomer.subCustomers.map(async (subCustomer) => {
                const unpaidBalance = await getCustomerUnpaidBalance(subCustomer._id);
                const availableCredit = (subCustomer.creditLimit || 0) - unpaidBalance;

                return {
                    ...subCustomer.toObject(),
                    unpaidBalance,
                    availableCredit,
                };
            })
        );

        // חישוב סיכומים כוללים
        const totalUnpaidBalance = subCustomersWithBalance.reduce((sum, sc) => sum + sc.unpaidBalance, 0);
        const totalCreditLimit = subCustomersWithBalance.reduce((sum, sc) => sum + sc.creditLimit, 0);
        const totalAvailableCredit = totalCreditLimit - totalUnpaidBalance;

        res.send({
            ...mainCustomer.toObject(),
            subCustomers: subCustomersWithBalance,
            orders: allOrders,
            summary: {
                totalSubCustomers: subCustomersWithBalance.length,
                totalOrders: allOrders.length,
                totalUnpaidBalance,
                totalCreditLimit,
                totalAvailableCredit,
            },
        });
    } catch (err) {
        console.log('getMainCustomer error: ', err);
        res.status(500).send({
            message: {
                en: "An error occurred while fetching the main customer",
                he: "אירעה שגיאה בעת שליפת הלקוח הראשי",
            },
        });
    }
};

// מחיקת לקוח ראשי (לא מוחק את תתי-הלקוחות)
const deleteMainCustomer = async (req, res) => {
    try {
        const mainCustomerId = req.params.id;

        // מחיקת הלקוח הראשי
        const deletedMainCustomer = await MainCustomer.findByIdAndDelete(mainCustomerId);

        if (!deletedMainCustomer) {
            return res.status(404).send({
                message: {
                    en: "Customer not found",
                    he: "לקוח לא נמצא",
                },
            });
        }

        res.send({
            message: {
                en: "Customer deleted successfully",
                he: "לקוח נמחק בהצלחה",
            },
            deletedMainCustomer,
        });
    } catch (err) {
        console.log('deleteMainCustomer error: ', err);
        res.status(500).send({
            message: {
                en: "An error occurred while deleting the customer",
                he: "אירעה שגיאה בעת מחיקת הלקוח",
            },
        });
    }
};

// 0–6 בלבד, אחרת undefined (מאפשר גם ניקוי השדה)
const parseWeeklyDeliveryDay = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const day = Number(value);
    return Number.isInteger(day) && day >= 0 && day <= 6 ? day : undefined;
};

// מיזוג שדות כתובת (מאפשר עדכון חלקי: city, street, houseNumber וכו')
const mergeAddress = (existing, incoming) => {
    if (!incoming || typeof incoming !== "object") return existing;
    const prev = existing && typeof existing.toObject === "function" ? existing.toObject() : (existing || {});
    return { ...prev, ...incoming };
};

const normalizeHeader = (value) =>
    String(value || "")
        .replace(/\uFEFF/g, "")
        .replace(/\s+/g, "")
        .replace(/["']/g, "")
        .trim()
        .toLowerCase();

const getRowValue = (row, aliases = []) => {
    const keys = Object.keys(row || {});
    const normalizedAliasSet = new Set(aliases.map(normalizeHeader));

    for (const key of keys) {
        if (normalizedAliasSet.has(normalizeHeader(key))) {
            return row[key];
        }
    }

    return undefined;
};

const importPermittedBarcodes = async (req, res) => {
    try {
        const { id } = req.params;
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        const modeRaw = String(req.query?.mode || req.body?.mode || "replace").toLowerCase();
        const importMode = ["replace", "merge"].includes(modeRaw) ? modeRaw : "replace";

        const mainCustomer = await MainCustomer.findById(id);
        if (!mainCustomer) {
            return res.status(404).send({
                message: {
                    he: "לקוח ראשי לא נמצא",
                    en: "Main customer not found",
                },
                summary: { total: 0, succeeded: 0, failed: 0 },
                errors: [],
            });
        }

        if (!rows.length) {
            return res.status(400).send({
                message: {
                    he: "הקובץ ריק או לא תקין",
                    en: "File is empty or invalid",
                },
                summary: { total: 0, succeeded: 0, failed: 0 },
                errors: [],
            });
        }

        const barcodeAliases = ["barcode", "barcod", "ברקוד", "קודמוצר"];
        const validBarcodes = [];
        const errors = [];

        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i] || {};
            const rowNumber = i + 2;
            const barcodeRaw = getRowValue(row, barcodeAliases);
            const barcode = barcodeRaw === undefined || barcodeRaw === null ? "" : String(barcodeRaw).trim();

            if (!barcode) {
                errors.push({
                    index: rowNumber,
                    barcode: "",
                    error: { he: "חסר ברקוד", en: "Missing barcode" },
                });
                continue;
            }

            const product = await Product.findOne({ barcode }).select("_id barcode");
            if (!product) {
                errors.push({
                    index: rowNumber,
                    barcode,
                    error: { he: "לא נמצא מוצר עם ברקוד זה", en: "Product with this barcode was not found" },
                });
                continue;
            }

            validBarcodes.push(barcode);
        }

        const dedupedFileBarcodes = [...new Set(validBarcodes)];
        const existingBarcodes = Array.isArray(mainCustomer.permittedBarcodes)
            ? mainCustomer.permittedBarcodes.map((barcode) => String(barcode || "").trim()).filter(Boolean)
            : [];

        let finalBarcodes = dedupedFileBarcodes;
        if (importMode === "merge") {
            finalBarcodes = [...new Set([...existingBarcodes, ...dedupedFileBarcodes])];
        }

        mainCustomer.permittedBarcodes = finalBarcodes;
        await mainCustomer.save();

        return res.send({
            message: {
                he: `ייבוא הסתיים. נקלטו מהקובץ: ${dedupedFileBarcodes.length}, שגויים: ${errors.length}`,
                en: `Import completed. Parsed from file: ${dedupedFileBarcodes.length}, Failed: ${errors.length}`,
            },
            summary: {
                total: rows.length,
                succeeded: dedupedFileBarcodes.length,
                failed: errors.length,
            },
            errors,
            mode: importMode,
            permittedBarcodesCount: finalBarcodes.length,
        });
    } catch (err) {
        console.log("importPermittedBarcodes error: ", err);
        return res.status(500).send({
            message: {
                he: "שגיאה בייבוא ברקודים מורשים",
                en: "Permitted barcode import failed",
            },
            summary: { total: 0, succeeded: 0, failed: 0 },
            errors: [],
        });
    }
};

const getPermittedProducts = async (req, res) => {
    try {
        const { id } = req.params;
        const mainCustomer = await MainCustomer.findById(id).select("permittedBarcodes");
        if (!mainCustomer) {
            return res.status(404).send({
                message: { he: "לקוח ראשי לא נמצא", en: "Main customer not found" },
            });
        }

        const permittedBarcodes = Array.isArray(mainCustomer.permittedBarcodes)
            ? mainCustomer.permittedBarcodes.map((barcode) => String(barcode || "").trim()).filter(Boolean)
            : [];

        if (!permittedBarcodes.length) {
            return res.send({
                hasRestrictions: false,
                permittedCount: 0,
                permittedProducts: [],
            });
        }

        const products = await Product.find({ barcode: { $in: permittedBarcodes } })
            .select("_id title barcode image status")
            .lean();

        const productsByBarcode = new Map(products.map((product) => [String(product.barcode || "").trim(), product]));
        const orderedProducts = permittedBarcodes
            .map((barcode) => productsByBarcode.get(barcode))
            .filter(Boolean);

        return res.send({
            hasRestrictions: true,
            permittedCount: permittedBarcodes.length,
            permittedProducts: orderedProducts,
        });
    } catch (err) {
        console.log("getPermittedProducts error: ", err);
        return res.status(500).send({
            message: { he: "שגיאה בשליפת המוצרים המורשים", en: "Failed to fetch permitted products" },
        });
    }
};

const addPermittedProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { productId, barcode } = req.body || {};

        const mainCustomer = await MainCustomer.findById(id);
        if (!mainCustomer) {
            return res.status(404).send({
                message: { he: "לקוח ראשי לא נמצא", en: "Main customer not found" },
            });
        }

        let product = null;
        if (productId) {
            product = await Product.findById(productId).select("_id title barcode image status").lean();
        } else if (barcode) {
            product = await Product.findOne({ barcode: String(barcode).trim() }).select("_id title barcode image status").lean();
        }

        if (!product || !product.barcode) {
            return res.status(404).send({
                message: { he: "מוצר לא נמצא", en: "Product not found" },
            });
        }

        const normalizedBarcode = String(product.barcode).trim();
        const existing = Array.isArray(mainCustomer.permittedBarcodes)
            ? mainCustomer.permittedBarcodes.map((value) => String(value || "").trim())
            : [];

        if (!existing.includes(normalizedBarcode)) {
            existing.push(normalizedBarcode);
            mainCustomer.permittedBarcodes = existing;
            await mainCustomer.save();
        }

        return res.send({
            message: { he: "המוצר נוסף לרשימת המורשים", en: "Product added to permitted list" },
            permittedCount: existing.length,
            product,
        });
    } catch (err) {
        console.log("addPermittedProduct error: ", err);
        return res.status(500).send({
            message: { he: "שגיאה בהוספת מוצר מורשה", en: "Failed to add permitted product" },
        });
    }
};

const removePermittedProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { productId, barcode } = req.body || {};

        const mainCustomer = await MainCustomer.findById(id);
        if (!mainCustomer) {
            return res.status(404).send({
                message: { he: "לקוח ראשי לא נמצא", en: "Main customer not found" },
            });
        }

        let barcodeToRemove = "";
        if (barcode) {
            barcodeToRemove = String(barcode).trim();
        } else if (productId) {
            const product = await Product.findById(productId).select("barcode").lean();
            barcodeToRemove = String(product?.barcode || "").trim();
        }

        if (!barcodeToRemove) {
            return res.status(400).send({
                message: { he: "חסר ברקוד להסרה", en: "Missing barcode to remove" },
            });
        }

        const existing = Array.isArray(mainCustomer.permittedBarcodes)
            ? mainCustomer.permittedBarcodes.map((value) => String(value || "").trim()).filter(Boolean)
            : [];

        const updated = existing.filter((value) => value !== barcodeToRemove);
        mainCustomer.permittedBarcodes = updated;
        await mainCustomer.save();

        return res.send({
            message: { he: "המוצר הוסר מרשימת המורשים", en: "Product removed from permitted list" },
            permittedCount: updated.length,
            removedBarcode: barcodeToRemove,
        });
    } catch (err) {
        console.log("removePermittedProduct error: ", err);
        return res.status(500).send({
            message: { he: "שגיאה בהסרת מוצר מורשה", en: "Failed to remove permitted product" },
        });
    }
};

module.exports = {
    createCustomerByAdmin,
    updateCustomerByAdmin,
    getAllMainCustomers,
    getMainCustomer,
    deleteMainCustomer,
    importPermittedBarcodes,
    getPermittedProducts,
    addPermittedProduct,
    removePermittedProduct,
};
