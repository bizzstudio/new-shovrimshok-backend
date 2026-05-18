// services/orderServices.js
const Order = require("../models/Order");
const Status = require("../models/Status");
const Coupon = require("../models/Coupon");
const Offer = require("../models/Offer");
const logStatusChange = require("../utils/logStatusChange");
const { handleProductQuantity } = require("../lib/stock-controller/others");
const { sendOrderNotificationEmail } = require("../lib/email-sender/sender");
const Customer = require("../models/Customer");
const { checkSubCustomerAlert } = require("./subCustomerAlertService");

/**
 * יצירת הזמנה בהקפה
 * @param {Object} orderData - נתוני ההזמנה
 * @param {Object} customer - הלקוח (עם mainCustomer מאוכלס)
 * @returns {Object} - ההזמנה שנוצרה
 */
const createCreditOrder = async (orderData, customer) => {
    // וידוא ש-mainCustomer מאוכלס
    let populatedCustomer = customer;
    if (!customer.mainCustomer || !customer.mainCustomer.customerType) {
        populatedCustomer = await Customer.findById(customer._id).populate('mainCustomer');
    }

    // בדיקת creditLimit
    if (
        !populatedCustomer
        || !populatedCustomer.mainCustomer
        || populatedCustomer.mainCustomer.customerType === 'casual'
        || !populatedCustomer.creditLimit
        || populatedCustomer.creditLimit <= 0
    ) {
        throw new Error("אינך זכאי להזמנה בהקפה. אם הבעיה נמשכת, נא לפנות לתמיכה.");
    }

    // חישוב סכום ההזמנות שלא שולמו
    const totalUnpaidAmount = await getCustomerUnpaidBalance(populatedCustomer);
    const newOrderTotal = parseFloat(orderData.total || 0);
    const totalAfterNewOrder = totalUnpaidAmount + newOrderTotal;

    // בדיקה אם עוברים את ה-creditLimit
    if (totalAfterNewOrder > populatedCustomer.creditLimit) {
        throw new Error(`סכום ההזמנות שלא שולמו (${totalUnpaidAmount.toFixed(2)} ש"ח) יחד עם ההזמנה החדשה (${newOrderTotal.toFixed(2)} ש"ח) עוברים את מסגרת האשראי (${populatedCustomer.creditLimit} ש"ח)`);
    }

    // שליפת סטטוס Processing
    const processingStatus = await Status.findOne({ name: "Processing" });
    if (!processingStatus) {
        throw new Error("סטטוס Processing לא נמצא");
    }

    // יצירת ההזמנה
    const newOrder = new Order({
        ...orderData,
        paymentMethod: "credit",
        cardcom: {
            isPaid: false,
            paidAt: null,
        },
        status: processingStatus._id,
    });

    const order = await newOrder.save();
    console.log("Credit order saved successfully:", order._id);

    // הדפסת שינוי סטטוס ההזמנה
    logStatusChange({
        from: 'No Status',
        to: 'Processing',
        functionName: 'createCreditOrder',
        order: order,
    });

    // הורדת מלאי מהמוצרים שבהזמנה
    try {
        console.log('Starting to decrease product quantities for credit order:', order.invoice);
        await handleProductQuantity(order.cart);
        console.log('Successfully decreased product quantities for credit order:', order.invoice);
    } catch (stockError) {
        console.error('Error decreasing product quantities for credit order', order.invoice, ':', stockError.message);
        // ממשיכים הלאה גם אם יש שגיאה במלאי
    }

    // אם יש קופון שמקושר להזמנה
    if (order.coupon) {
        const coupon = await Coupon.findById(order.coupon);
        if (coupon) {
            if (coupon.discountType.type === "percentage") {
                coupon.timesIsUsed += 1;
            } else if (coupon.discountType.type === "fixed") {
                coupon.timesIsUsed += 1;
                coupon.isUsed = true; // סימון קופון כמשומש אם הוא מסוג "fixed"
            }
            await coupon.save();
        }
    }

    // סימון מבצעים שנוצלו (רק מבצעים עם oncePerCustomer: true)
    try {
        if (
            populatedCustomer
            && order.usedOfferIds
            && Array.isArray(order.usedOfferIds)
            && order.usedOfferIds.length > 0
        ) {
            // שליפת המבצעים שנוצלו כדי לבדוק אם הם oncePerCustomer
            const usedOffers = await Offer.find({
                _id: { $in: order.usedOfferIds },
                oncePerCustomer: true
            });

            if (usedOffers.length > 0) {
                // הוספת המבצעים לרשימת המבצעים שנוצלו של הלקוח
                const offerIdsToAdd = usedOffers
                    .map(offer => offer._id.toString())
                    .filter(offerId => !populatedCustomer.redeemedOffers.some(id => id.toString() === offerId));

                if (offerIdsToAdd.length > 0) {
                    populatedCustomer.redeemedOffers.push(...offerIdsToAdd);
                    await populatedCustomer.save();
                    console.log(`Marked ${offerIdsToAdd.length} offers as redeemed for customer ${populatedCustomer.email}`);
                }
            }
        }
    } catch (offerRedemptionError) {
        console.error('Error marking offers as redeemed:', offerRedemptionError);
        // ממשיכים הלאה גם אם יש שגיאה בעדכון המבצעים
    }

    // שליחת הודעת אימייל על הזמנה חדשה (ללקוח ולמנהלים)
    try {
        await sendOrderNotificationEmail(order, order.user_info);
    } catch (emailError) {
        console.error('Error sending order notification email:', emailError);
    }

    // בדיקת התראת סכום תקופתי לתת-לקוח
    try {
        await checkSubCustomerAlert(order.user, parseFloat(order.total || 0));
    } catch (alertError) {
        console.error('Error checking sub-customer alert:', alertError);
    }

    return order;
};

/**
 * חישוב יתרת הלקוח - סכום ההזמנות שלא שולמו בהקפה
 * @param {String|Object} customerIdOrCustomer - מזהה הלקוח (ObjectId) או אובייקט הלקוח
 * @returns {Number} - הסכום הכולל של ההזמנות שלא שולמו
 */
const getCustomerUnpaidBalance = async (customerIdOrCustomer) => {
    // קבלת מזהה הלקוח
    const customerId = typeof customerIdOrCustomer === 'object' && customerIdOrCustomer._id
        ? customerIdOrCustomer._id
        : customerIdOrCustomer;

    // חישוב סכום ההזמנות שלא שולמו (הקפה)
    const unpaidOrders = await Order.find({
        user: customerId,
        paymentMethod: "credit",
        "cardcom.isPaid": { $ne: true } // לא שולמו
    });

    const totalUnpaidAmount = unpaidOrders.reduce((sum, order) => sum + parseFloat(order.total || 0), 0);

    return totalUnpaidAmount;
};

module.exports = {
    getCustomerUnpaidBalance,
    createCreditOrder,
};