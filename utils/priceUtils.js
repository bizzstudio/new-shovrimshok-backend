// utils/priceUtils.js
/**
 * אחוז מע״מ — תואם ל־rivhitHelpers (VAT_PERCENTAGE), ברירת מחדל 18.
 * כש־isVatFree === false המחיר בקטלוג נחשב לפני מע״מ ומוכפל בחישובי מחיר ללקוח.
 */
const getCatalogVatPercent = () => {
    const raw = Number(process.env.VAT_PERCENTAGE);
    return Number.isFinite(raw) && raw > 0 ? raw : 18;
};

const getCatalogVatMultiplier = (product) => {
    if (!product || product.isVatFree !== false) return 1;
    return 1 + getCatalogVatPercent() / 100;
};

const roundMoney = (n) => Math.round(Number(n) * 100) / 100;

const buildPricingFromRow = (product, row) => {
    if (!row) {
        return {
            price: 0,
            salePrice: null,
            originalPrice: 0,
            warehousePrice: null,
            purchaseLimit: null,
            priceList: null,
        };
    }
    const mult = getCatalogVatMultiplier(product);
    const list = roundMoney((Number(row.price) || 0) * mult);
    const rawSale = row.salePrice;
    const saleNum =
        rawSale != null && rawSale !== "" && Number.isFinite(Number(rawSale))
            ? Number(rawSale)
            : null;
    const hasSale =
        saleNum != null && saleNum > 0 && saleNum < (Number(row.price) || 0);
    const sale = hasSale ? roundMoney(saleNum * mult) : null;
    return {
        price: list,
        salePrice: sale,
        originalPrice: list,
        warehousePrice:
            row.warehousePrice != null && row.warehousePrice !== ""
                ? roundMoney(Number(row.warehousePrice) * mult)
                : null,
        purchaseLimit: row.purchaseLimit ?? null,
        priceList: row.priceList,
    };
};

/**
 * פונקציה טהורה לחישוב המחיר הנכון ללקוח על סמך המחירון שלו
 * @param {Object} product - אובייקט המוצר עם מערך prices
 * @param {Object} customer - אובייקט הלקוח המחובר (או null)
 * @returns {Object} - { price, salePrice, originalPrice, warehousePrice, purchaseLimit, priceList }
 */
const getUserPrice = (product, customer = null) => {
    // אם אין מוצר או אין מחירים
    if (!product || !product.prices || !Array.isArray(product.prices) || product.prices.length === 0) {
        return {
            price: 0,
            salePrice: null,
            originalPrice: 0,
            warehousePrice: null,
            purchaseLimit: null,
            priceList: null,
        };
    }

    // אם הלקוח מחובר ויש לו מחירון
    // priceList נמצא עכשיו ב-mainCustomer
    let customerPriceList = null;
    if (customer) {
        // תמיכה במבנה החדש (mainCustomer) וגם במבנה הישן (backward compatibility)
        customerPriceList = customer.mainCustomer?.priceList || customer.priceList;
    }

    if (customerPriceList) {
        const customerPriceListId = String(customerPriceList); // המרה למחרוזת להשוואה

        // חיפוש המחיר המתאים למחירון של הלקוח
        // priceList יכול להגיע כאובייקט populated עם _id או כ-ObjectId
        const customerPrice = product.prices.find((p) => {
            if (!p.priceList) {
                return false;
            }

            // אם priceList הוא אובייקט (populated)
            if (typeof p.priceList === "object" && p.priceList._id) {
                return String(p.priceList._id) === customerPriceListId;
            }

            // אם priceList הוא ObjectId (לא populated)
            return String(p.priceList) === customerPriceListId;
        });

        if (customerPrice) {
            return buildPricingFromRow(product, customerPrice);
        }
    }

    // אם אין לקוח מחובר או לא נמצא מחירון מתאים - נחפש מחירון ברירת מחדל
    const defaultPrice = product.prices.find((p) => {
        if (!p.priceList) {
            return false;
        }

        // אם priceList הוא אובייקט (populated)
        if (typeof p.priceList === "object" && p.priceList.isDefault !== undefined) {
            return p.priceList.isDefault === true;
        }

        return false;
    });

    if (defaultPrice) {
        return buildPricingFromRow(product, defaultPrice);
    }

    // אם גם לא נמצא מחירון ברירת מחדל - נחזיר את המחיר הראשון
    const firstPrice = product.prices[0];
    return buildPricingFromRow(product, firstPrice);
};

/**
 * פונקציה לקבלת המחיר הסופי להצגה (אם יש salePrice, מחזיר אותו, אחרת מחזיר price)
 * @param {Object} product - אובייקט המוצר
 * @param {Object} customer - אובייקט הלקוח המחובר (או null)
 * @returns {Number} - המחיר הסופי
 */
const getFinalPrice = (product, customer = null) => {
    const { price, salePrice } = getUserPrice(product, customer);
    return salePrice && salePrice > 0 ? salePrice : price;
};

/**
 * פונקציה לבדיקה אם יש מחיר מבצע
 * @param {Object} product - אובייקט המוצר
 * @param {Object} customer - אובייקט הלקוח המחובר (או null)
 * @returns {Boolean} - true אם יש מחיר מבצע
 */
const hasSalePrice = (product, customer = null) => {
    const { salePrice, price } = getUserPrice(product, customer);
    return salePrice && salePrice > 0 && salePrice < price;
};

module.exports = {
    getUserPrice,
    getFinalPrice,
    hasSalePrice,
};
