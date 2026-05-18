// utils/offerCalculations.js
// פונקציות עזר טהורות לחישוב מבצעים על עגלת קניות
const { getFinalPrice } = require('./priceUtils');

/**
 * חישוב סכום כולל של עגלה (ללא מבצעים)
 * @param {Array} cartItems - פריטי העגלה
 * @param {Boolean} excludeRewards - האם להתעלם ממוצרי פרס בחישוב
 * @param {Object} customer - מידע על הלקוח (למחירון)
 * @returns {Number} - סכום כולל
 */
const calculateCartTotal = (cartItems, excludeRewards = false, customer = null) => {
    return cartItems.reduce((total, item) => {
        // אם צריך להתעלם ממוצרי פרס
        if (excludeRewards && item.isRewardProduct) {
            return total;
        }
        // שימוש במחיר לפי מחירון הלקוח
        const itemPrice = getFinalPrice(item, customer);
        return total + (itemPrice * item.quantity);
    }, 0);
};

/**
 * יצירת מפה של מוצרים לפי _id (לא כולל מוצרי פרס)
 * @param {Array} cartItems - פריטי העגלה
 * @returns {Object} - { productId: quantity }
 */
const createProductCountMap = (cartItems) => {
    const productCount = {};
    cartItems.forEach(item => {
        // לא כוללים מוצרי פרס בספירה
        if (item.isRewardProduct) return;

        // המרת _id ל-string כדי להבטיח השוואה נכונה
        const pid = item._id?.toString?.() ?? String(item._id);
        if (!productCount[pid]) {
            productCount[pid] = 0;
        }
        productCount[pid] += item.quantity;
    });
    return productCount;
};

/**
 * יישום מבצע BUNDLE_PRICE
 * @param {Array} cartItems - פריטי העגלה (ללא מוצרי פרס)
 * @param {Object} offer - המבצע
 * @param {Object} customer - מידע על הלקוח (למחירון)
 * @returns {Object} - { discount, affectedItems: [{itemId, quantityInOffer, unitPriceInOffer}] }
 */
const applyBundlePrice = (cartItems, offer, customer = null) => {
    if (!offer?.products || offer?.products?.length === 0) {
        return { discount: 0, affectedItems: [] };
    }

    // המרת כל ה-IDs ל-strings כדי להבטיח השוואה נכונה
    const offerProductIds = offer.products.map(p => p._id?.toString?.() ?? String(p._id));
    const productCount = createProductCountMap(cartItems);

    // חישוב כמות כללית בעגלה שנכנסת למבצע
    let totalApplicableQuantity = 0;
    offerProductIds.forEach(id => {
        if (productCount[id]) {
            totalApplicableQuantity += productCount[id];
        }
    });

    // כמות הפעמים שהמבצע יכול לחול (מעגל ללמטה)
    const timesOfferCanApply = Math.floor(totalApplicableQuantity / offer.quantity);

    if (timesOfferCanApply === 0) {
        return { discount: 0, affectedItems: [] };
    }

    const offerUnitPrice = offer.price / offer.quantity;
    let remainingQuantityToApply = timesOfferCanApply * offer.quantity;
    const affectedItems = [];
    let totalDiscount = 0;

    // חישוב ההנחה והפריטים המושפעים
    cartItems.forEach(item => {
        if (item.isRewardProduct) return;

        // המרת item._id ל-string להשוואה
        const itemIdStr = item._id?.toString?.() ?? String(item._id);
        if (offerProductIds.includes(itemIdStr) && remainingQuantityToApply > 0) {
            const discountQuantity = Math.min(item.quantity, remainingQuantityToApply);
            remainingQuantityToApply -= discountQuantity;

            // שימוש במחיר לפי מחירון הלקוח
            const itemPrice = getFinalPrice(item, customer);
            const originalPrice = itemPrice * discountQuantity;
            const discountedPrice = discountQuantity * offerUnitPrice;
            const itemDiscount = originalPrice - discountedPrice;

            totalDiscount += itemDiscount;

            affectedItems.push({
                itemId: item.id,
                productId: item._id,
                quantityInOffer: discountQuantity,
                unitPriceInOffer: offerUnitPrice,
                discount: itemDiscount,
                offerId: offer._id
            });
        }
    });

    return {
        discount: totalDiscount,
        affectedItems,
        timesApplied: timesOfferCanApply
    };
};

/**
 * יישום מבצע BUY_X_GET_Y
 * @param {Array} cartItems - פריטי העגלה
 * @param {Object} offer - המבצע
 * @param {Object} customer - מידע על הלקוח (למחירון)
 * @returns {Object} - { discount, rewardItemsToAdd: [{product, quantity, price, offerId, offerName}] }
 */
const applyBuyXGetY = (cartItems, offer, customer = null) => {
    if (!offer?.triggerProduct || !offer?.rewardProduct) {
        return { discount: 0, rewardItemsToAdd: [] };
    }

    // המרת triggerProductId ל-string כדי להבטיח השוואה נכונה
    const triggerProductId = offer.triggerProduct._id?.toString?.() ?? String(offer.triggerProduct._id);
    const productCount = createProductCountMap(cartItems);

    // כמות המוצר הטריגר בעגלה (לא כולל מוצרי פרס)
    const triggerQuantityInCart = productCount[triggerProductId] || 0;

    // כמות הפעמים שהמבצע יכול לחול
    const timesOfferCanApply = Math.floor(triggerQuantityInCart / offer.triggerQuantity);

    if (timesOfferCanApply === 0) {
        return { discount: 0, rewardItemsToAdd: [] };
    }

    // כמות יחידות פרס שהלקוח זכאי להן
    const totalRewardQuantity = timesOfferCanApply * (offer.rewardQuantity || 1);

    // חישוב הנחה - שימוש במחיר לפי מחירון הלקוח
    const rewardUnitPrice = offer.rewardPrice || 0;
    const originalRewardPrice = getFinalPrice(offer.rewardProduct, customer);
    const discountPerUnit = originalRewardPrice - rewardUnitPrice;
    const totalDiscount = totalRewardQuantity * discountPerUnit;

    return {
        discount: totalDiscount,
        rewardItemsToAdd: [{
            product: offer.rewardProduct,
            quantity: totalRewardQuantity,
            price: rewardUnitPrice,
            offerId: offer._id,
            offerName: offer.name || {},
            offerType: 'BUY_X_GET_Y'
        }],
        timesApplied: timesOfferCanApply
    };
};

/**
 * יישום מבצע THRESHOLD_GET_ITEM
 * @param {Object} offer - המבצע
 * @param {Number} currentTotal - סכום העגלה הנוכחי (אחרי מבצעים אחרים)
 * @param {Object} customer - מידע על הלקוח (למחירון)
 * @returns {Object} - { discount, rewardItemsToAdd: [{product, quantity, price, offerId, offerName}] }
 */
const applyThresholdGetItem = (offer, currentTotal, customer = null) => {
    if (!offer?.rewardProduct || !offer?.thresholdAmount) {
        return { discount: 0, rewardItemsToAdd: [] };
    }

    // בדיקה אם עברנו את הסף
    if (currentTotal < offer.thresholdAmount) {
        return { discount: 0, rewardItemsToAdd: [] };
    }

    // המבצע חל פעם אחת בלבד
    const rewardQuantity = offer.rewardQuantity || 1;
    const rewardUnitPrice = offer.rewardPrice || 0;
    // שימוש במחיר לפי מחירון הלקוח
    const originalRewardPrice = getFinalPrice(offer.rewardProduct, customer);
    const discountPerUnit = originalRewardPrice - rewardUnitPrice;
    const totalDiscount = rewardQuantity * discountPerUnit;

    return {
        discount: totalDiscount,
        rewardItemsToAdd: [{
            product: offer.rewardProduct,
            quantity: rewardQuantity,
            price: rewardUnitPrice,
            offerId: offer._id,
            offerName: offer.name || {},
            offerType: 'THRESHOLD_GET_ITEM'
        }],
        timesApplied: 1
    };
};

/**
 * יישום מבצע THRESHOLD_DISCOUNT
 * קנה מעל סכום X וקבל הנחה באחוזים או סכום קבוע
 * @param {Object} offer - המבצע
 * @param {Number} currentTotal - סכום העגלה הנוכחי (אחרי מבצעים אחרים)
 * @returns {Object} - { discount, discountType, discountValue }
 */
const applyThresholdDiscount = (offer, currentTotal) => {
    if (!offer?.thresholdAmount || !offer?.discountType || offer?.discountValue === undefined) {
        return { discount: 0 };
    }

    // בדיקה אם עברנו את הסף
    if (currentTotal < offer.thresholdAmount) {
        return { discount: 0 };
    }

    let discount = 0;

    if (offer.discountType === 'percentage') {
        // הנחה באחוזים מהסכום הכולל
        discount = currentTotal * (offer.discountValue / 100);
    } else if (offer.discountType === 'fixed') {
        // הנחה בסכום קבוע
        discount = offer.discountValue;
    }

    // וידוא שההנחה לא גדולה מהסכום הכולל
    discount = Math.min(discount, currentTotal);

    return {
        discount,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        timesApplied: 1
    };
};

/**
 * מיזוג מוצרי פרס - איחוד של מוצרים זהים מאותו מבצע
 * @param {Array} rewardItems - רשימת מוצרי פרס להוספה
 * @returns {Array} - רשימה ממוזגת
 */
const mergeRewardItems = (rewardItems) => {
    const merged = {};

    rewardItems.forEach(reward => {
        // המרת IDs ל-strings ליצירת מפתח עקבי
        const productIdStr = reward.product._id?.toString?.() ?? String(reward.product._id);
        const offerIdStr = reward.offerId?.toString?.() ?? String(reward.offerId);
        const key = `${productIdStr}_${offerIdStr}`;

        if (!merged[key]) {
            merged[key] = { ...reward };
        } else {
            merged[key].quantity += reward.quantity;
            merged[key].discount = (merged[key].discount || 0) + (reward.discount || 0);
        }
    });

    return Object.values(merged);
};

/**
 * יצירת פריטי עגלה מעודכנים עם מבצעים מיושמים
 * @param {Array} originalCartItems - פריטי עגלה מקוריים
 * @param {Array} bundleResults - תוצאות BUNDLE_PRICE
 * @param {Array} rewardItems - מוצרי פרס להוסיף/לעדכן
 * @param {Object} customer - מידע על הלקוח (למחירון)
 * @returns {Array} - פריטי עגלה מעודכנים שמכילים:
 *  [{discountedPrice, offerTitle, appliedOffers: [{type, name, quantityInOffer, unitPrice}]}]
 */
const createUpdatedCartItems = (originalCartItems, bundleResults, rewardItems, customer = null) => {
    // מפה של הנחות לפי itemId
    const discountMap = {};
    const offerTitleMap = {};

    // עדכון מפה של הנחות לפי itemId
    bundleResults.forEach(result => {
        result.affectedItems.forEach(affected => {
            if (!discountMap[affected.itemId]) {
                discountMap[affected.itemId] = {
                    quantityInOffer: 0,
                    unitPriceInOffer: affected.unitPriceInOffer,
                    offerName: result.offerName || result.offer?.name,
                    offerId: affected.offerId || result.offer?._id
                };
            }
            discountMap[affected.itemId].quantityInOffer += affected.quantityInOffer;
            offerTitleMap[affected.itemId] = result.offerName || result.offer?.name;
        });
    });

    // עדכון פריטים קיימים
    const updatedItems = originalCartItems.map(item => {
        if (item.isRewardProduct) {
            return item; // נעדכן מוצרי פרס בנפרד
        }

        const discount = discountMap[item.id];
        if (discount) {
            const discountQuantity = discount.quantityInOffer;
            const nonDiscountQuantity = item.quantity - discountQuantity;

            // שימוש במחיר לפי מחירון הלקוח
            const itemPrice = getFinalPrice(item, customer);
            const discountedPrice =
                discountQuantity * discount.unitPriceInOffer +
                nonDiscountQuantity * itemPrice;

            const offerName = offerTitleMap[item.id] || {};
            return {
                ...item,
                discountedPrice,
                offerTitle: offerName,
                appliedOffers: [{
                    type: 'BUNDLE_PRICE',
                    name: offerName,
                    offerId: discount.offerId,
                    quantityInOffer: discountQuantity,
                    unitPrice: discount.unitPriceInOffer,
                    regularQuantity: nonDiscountQuantity,
                    regularUnitPrice: itemPrice
                }],
                finalPriceAtPurchase: {
                    total: discountedPrice,
                    perUnit: discountedPrice / item.quantity
                }
            };
        }

        // מוצר ללא מבצע - שימוש במחיר רגיל לפי מחירון הלקוח
        const itemPrice = getFinalPrice(item, customer);
        const totalPrice = itemPrice * item.quantity;

        return {
            ...item,
            discountedPrice: null,
            offerTitle: '',
            appliedOffers: [],
            finalPriceAtPurchase: {
                total: totalPrice,
                perUnit: itemPrice
            }
        };
    });

    // הוספה/עדכון מוצרי פרס
    const rewardItemsMap = {};
    rewardItems.forEach(reward => {
        // המרת IDs ל-strings ליצירת מפתח עקבי
        const productIdStr = reward.product._id?.toString?.() ?? String(reward.product._id);
        const offerIdStr = reward.offerId?.toString?.() ?? String(reward.offerId);
        const key = `${productIdStr}_${offerIdStr}`;
        if (!rewardItemsMap[key]) {
            rewardItemsMap[key] = { ...reward };
        } else {
            rewardItemsMap[key].quantity += reward.quantity;
        }
    });

    // בדיקה אילו מוצרי פרס כבר קיימים בעגלה
    const existingRewardItems = updatedItems.filter(item => item.isRewardProduct);
    const rewardItemsToProcess = Object.values(rewardItemsMap);

    rewardItemsToProcess.forEach(reward => {
        // המרת כל ה-IDs ל-strings להשוואה נכונה
        const rewardProductIdStr = reward.product._id?.toString?.() ?? String(reward.product._id);
        const rewardOfferIdStr = reward.offerId?.toString?.() ?? String(reward.offerId);

        const existingItem = existingRewardItems.find(
            item => {
                const itemIdStr = item._id?.toString?.() ?? String(item._id);
                const itemOfferIdStr = item.rewardOfferId?.toString?.() ?? String(item.rewardOfferId);
                return itemIdStr === rewardProductIdStr && itemOfferIdStr === rewardOfferIdStr;
            }
        );

        if (existingItem) {
            // עדכון כמות של מוצר פרס קיים
            const itemIndex = updatedItems.findIndex(i => i.id === existingItem.id);
            if (itemIndex !== -1) {
                const totalPrice = reward.price * reward.quantity;
                updatedItems[itemIndex] = {
                    ...updatedItems[itemIndex],
                    quantity: reward.quantity,
                    rewardPrice: reward.price,
                    rewardOfferName: reward.offerName,
                    rewardOfferType: reward.offerType,
                    finalPriceAtPurchase: {
                        total: totalPrice,
                        perUnit: reward.price
                    }
                };
            }
        } else {
            // הוספת מוצר פרס חדש (רק אם rewardPrice = 0, כלומר מתנה)
            if (reward.price === 0) {
                // יצירת id ייחודי לכל מבצע (אפילו אם אותו מוצר)
                // המרת IDs ל-strings ליצירת מפתח עקבי
                const productIdStr = reward.product._id?.toString?.() ?? String(reward.product._id);
                const offerIdStr = reward.offerId?.toString?.() ?? String(reward.offerId);
                const rewardItemId = `reward_${productIdStr}_${offerIdStr}`;
                // המרת reward.product ל-plain object (חשוב! אחרת שדות לא יישמרו ב-DB)
                const plainProduct = reward.product.toObject ? reward.product.toObject() : { ...reward.product };
                const totalPrice = reward.price * reward.quantity;
                const newRewardItem = {
                    ...plainProduct,
                    id: rewardItemId,
                    quantity: reward.quantity,
                    isRewardProduct: true,
                    rewardPrice: reward.price,
                    rewardOfferId: reward.offerId,
                    rewardOfferName: reward.offerName,
                    rewardOfferType: reward.offerType,
                    finalPriceAtPurchase: {
                        total: totalPrice,
                        perUnit: reward.price
                    }
                };
                updatedItems.push(newRewardItem);
            } else {
                // אם זה לא מתנה (price > 0), נבדוק אם המוצר קיים בעגלה ונעדכן אותו
                // רק אם המשתמש כבר הוסיף את המוצר הזה לעגלה
                const rewardProductIdStr = reward.product._id?.toString?.() ?? String(reward.product._id);
                const regularItem = updatedItems.find(
                    item => {
                        const itemIdStr = item._id?.toString?.() ?? String(item._id);
                        return itemIdStr === rewardProductIdStr && !item.isRewardProduct;
                    }
                );

                if (regularItem) {
                    const itemIndex = updatedItems.findIndex(i => i.id === regularItem.id);
                    if (itemIndex !== -1) {
                        // חישוב מחיר מעורב: חלק במחיר מבצע, חלק במחיר רגיל
                        const rewardQty = Math.min(reward.quantity, regularItem.quantity);
                        const regularQty = regularItem.quantity - rewardQty;

                        // אם יש כבר discountedPrice (ממבצע BUNDLE_PRICE), נשתמש בו
                        const existingDiscountedPrice = updatedItems[itemIndex].discountedPrice;
                        // שימוש במחיר לפי מחירון הלקוח
                        const itemPrice = getFinalPrice(regularItem, customer);
                        const baseUnitPrice = existingDiscountedPrice ?
                            existingDiscountedPrice / regularItem.quantity :
                            itemPrice;

                        const mixedPrice =
                            rewardQty * reward.price +
                            regularQty * baseUnitPrice;

                        // חישוב regularQuantity ו-regularUnitPrice עבור המבצע החדש
                        // אם יש כבר מבצע קודם, נצטרך לחשב מחדש את הפירוט
                        const existingOffers = updatedItems[itemIndex].appliedOffers || [];
                        let totalQuantityInOffers = existingOffers.reduce((sum, offer) =>
                            sum + (offer.quantityInOffer || 0), 0);

                        // הכמות במחיר רגיל = סך הכל - כל הכמויות במבצעים
                        const finalRegularQuantity = regularItem.quantity - totalQuantityInOffers - rewardQty;

                        updatedItems[itemIndex] = {
                            ...updatedItems[itemIndex],
                            discountedPrice: mixedPrice,
                            offerTitle: reward.offerName || updatedItems[itemIndex].offerTitle,
                            appliedOffers: [
                                ...existingOffers,
                                {
                                    type: reward.offerType,
                                    name: reward.offerName,
                                    offerId: reward.offerId,
                                    quantityInOffer: rewardQty,
                                    unitPrice: reward.price,
                                    regularQuantity: finalRegularQuantity,
                                    regularUnitPrice: baseUnitPrice
                                }
                            ],
                            finalPriceAtPurchase: {
                                total: mixedPrice,
                                perUnit: mixedPrice / regularItem.quantity
                            }
                        };
                    }
                }
                // אם המוצר לא קיים בעגלה ו-price > 0, לא עושים כלום
                // (רק מוצרי מתנה מתווספים אוטומטית)
            }
        }
    });

    return updatedItems;
};

/**
 * האלגוריתם המרכזי - מציאת קומבינציית מבצעים אופטימלית
 * @param {Array} cartItems - פריטי העגלה המקוריים
 * @param {Array} offers - כל המבצעים הזמינים
 * @param {Object} customer - מידע על הלקוח (למחירון)
 * @returns {Object} - { updatedCartItems, totalDiscount, appliedOffers }
 */
const findOptimalOfferCombination = (cartItems, offers = [], customer = null) => {
    if (!Array.isArray(offers) || offers.length === 0 || cartItems.length === 0) {
        return {
            updatedCartItems: cartItems.map(item => {
                // חישוב מחיר סופי גם בלי מבצעים
                const itemPrice = getFinalPrice(item, customer);
                const totalPrice = itemPrice * item.quantity;
                
                return {
                    ...item,
                    discountedPrice: null,
                    offerTitle: '',
                    appliedOffers: [],
                    finalPriceAtPurchase: {
                        total: totalPrice,
                        perUnit: itemPrice
                    }
                };
            }),
            totalDiscount: 0,
            appliedOffers: []
        };
    };

    // הפרדת מבצעים לפי סוג
    const bundleOffers = offers.filter(o => o.type === 'BUNDLE_PRICE');
    const buyXGetYOffers = offers.filter(o => o.type === 'BUY_X_GET_Y');
    const thresholdOffers = offers.filter(o => o.type === 'THRESHOLD_GET_ITEM');
    const thresholdDiscountOffers = offers.filter(o => o.type === 'THRESHOLD_DISCOUNT');

    // פריטי עגלה ללא מוצרי פרס קיימים (נתחיל מחדש)
    const baseCartItems = cartItems.filter(item => !item.isRewardProduct);

    // שלב 1: יישום כל מבצעי BUNDLE_PRICE (כולם יכולים לחול ביחד)
    const bundleResults = bundleOffers.map(offer => ({
        offer,
        offerName: offer.name || {},
        ...applyBundlePrice(baseCartItems, offer, customer)
    })).filter(result => result.discount > 0);

    // שלב 2: יישום כל מבצעי BUY_X_GET_Y
    const buyXGetYResults = buyXGetYOffers.map(offer => ({
        offer,
        offerName: offer.name || {},
        ...applyBuyXGetY(baseCartItems, offer, customer)
    })).filter(result => result.discount > 0);

    // שלב 3: חישוב סכום ביניים (אחרי BUNDLE + BUY_X_GET_Y)
    let allRewardItems = [];
    buyXGetYResults.forEach(result => {
        if (result.rewardItemsToAdd) {
            allRewardItems = allRewardItems.concat(result.rewardItemsToAdd);
        }
    });

    // יצירת עגלה ביניים
    let intermediateCart = createUpdatedCartItems(baseCartItems, bundleResults, allRewardItems, customer);

    // חישוב סכום ביניים
    let intermediateTotal = 0;
    intermediateCart.forEach(item => {
        if (item.isRewardProduct) {
            intermediateTotal += (item.rewardPrice || 0) * item.quantity;
        } else if (item.discountedPrice) {
            intermediateTotal += item.discountedPrice;
        } else {
            // שימוש במחיר לפי מחירון הלקוח
            const itemPrice = getFinalPrice(item, customer);
            intermediateTotal += itemPrice * item.quantity;
        }
    });

    // שלב 4: בדיקת THRESHOLD_GET_ITEM על הסכום הביניים
    // חשוב: רק המבצע עם ה-threshold הגבוה ביותר יכול לחול
    // מיון מבצעים לפי thresholdAmount מהגבוה לנמוך
    const sortedThresholdOffers = [...thresholdOffers].sort((a, b) =>
        (b.thresholdAmount || 0) - (a.thresholdAmount || 0)
    );

    // בדיקה מהגבוה לנמוך - הראשון שעובר את הסף הוא זה שחל
    let thresholdResults = [];
    for (const offer of sortedThresholdOffers) {
        const result = {
            offer,
            offerName: offer.name || {},
            ...applyThresholdGetItem(offer, intermediateTotal, customer)
        };

        // אם המבצע חל, זה המבצע היחיד שחל (הגבוה ביותר שעובר)
        if (result.discount > 0) {
            thresholdResults = [result];
            break; // עצור כאן - לא בודקים מבצעים אחרים
        }
    }

    // שלב 5: איחוד כל מוצרי הפרס
    thresholdResults.forEach(result => {
        if (result.rewardItemsToAdd) {
            allRewardItems = allRewardItems.concat(result.rewardItemsToAdd);
        }
    });

    const mergedRewardItems = mergeRewardItems(allRewardItems);

    // שלב 6: יצירת עגלה סופית
    const finalCart = createUpdatedCartItems(baseCartItems, bundleResults, mergedRewardItems, customer);

    // שלב 7: בדיקת THRESHOLD_DISCOUNT על הסכום הביניים (לפני מבצעי הנחה)
    // מיון מבצעים לפי thresholdAmount מהגבוה לנמוך - רק המבצע הגבוה ביותר שעובר יחול
    const sortedThresholdDiscountOffers = [...thresholdDiscountOffers].sort((a, b) =>
        (b.thresholdAmount || 0) - (a.thresholdAmount || 0)
    );

    let thresholdDiscountResults = [];
    for (const offer of sortedThresholdDiscountOffers) {
        const result = {
            offer,
            offerName: offer.name || {},
            ...applyThresholdDiscount(offer, intermediateTotal)
        };

        // אם המבצע חל, זה המבצע היחיד שחל (הגבוה ביותר שעובר)
        if (result.discount > 0) {
            thresholdDiscountResults = [result];
            break; // עצור כאן - לא בודקים מבצעים אחרים
        }
    }

    // שלב 8: חישוב סכום סופי והנחה כוללת
    const totalDiscount =
        bundleResults.reduce((sum, r) => sum + r.discount, 0) +
        buyXGetYResults.reduce((sum, r) => sum + r.discount, 0) +
        thresholdResults.reduce((sum, r) => sum + r.discount, 0) +
        thresholdDiscountResults.reduce((sum, r) => sum + r.discount, 0);

    const appliedOffers = [
        ...bundleResults.map(r => ({
            type: 'BUNDLE_PRICE',
            name: r.offerName,
            timesApplied: r.timesApplied
        })),
        ...buyXGetYResults.map(r => ({
            type: 'BUY_X_GET_Y',
            name: r.offerName,
            timesApplied: r.timesApplied
        })),
        ...thresholdResults.map(r => ({
            type: 'THRESHOLD_GET_ITEM',
            name: r.offerName,
            timesApplied: r.timesApplied
        })),
        ...thresholdDiscountResults.map(r => ({
            type: 'THRESHOLD_DISCOUNT',
            name: r.offerName,
            timesApplied: r.timesApplied,
            discountType: r.discountType,
            discountValue: r.discountValue,
            discount: r.discount,
            offerId: r.offer?._id
        }))
    ];

    return {
        updatedCartItems: finalCart,
        totalDiscount,
        appliedOffers,
        thresholdDiscount: thresholdDiscountResults.length > 0 ? thresholdDiscountResults[0].discount : 0
    };
};

// Export all functions for Node.js
module.exports = {
    calculateCartTotal,
    createProductCountMap,
    applyBundlePrice,
    applyBuyXGetY,
    applyThresholdGetItem,
    applyThresholdDiscount,
    mergeRewardItems,
    createUpdatedCartItems,
    findOptimalOfferCombination
};