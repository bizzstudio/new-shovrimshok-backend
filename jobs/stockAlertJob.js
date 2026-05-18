// jobs/stockAlertJob.js
const cron = require('node-cron');
const Product = require('../models/Product');
const { sendEmailSilent } = require('../lib/email-sender/sender');
const { stockAlertBody } = require('../lib/email-sender/templates/stock-alert');

/**
 * Job שבודק כל 10 דקות מוצרים עם מלאי נמוך
 * ושולח אימייל למנהלים על מוצרים שצריכים התראה
 */
const checkLowStockProducts = async () => {
    try {
        console.log('🔍 Starting stock alert check...');

        // חיפוש מוצרים עם מלאי נמוך או שווה ל-minStockThreshold
        // ו-hasSentStockAlert = false
        const lowStockProducts = await Product.find({
            manageStock: true,
            minStockThreshold: { $ne: null, $exists: true },
            $expr: {
                $lte: [
                    { $ifNull: ['$stock', 0] },
                    '$minStockThreshold'
                ]
            },
            hasSentStockAlert: false
        })
            .populate({ path: 'categories', select: '_id name' })
            .populate({ path: 'prices.priceList', select: 'name' })
            .lean();

        if (!lowStockProducts || lowStockProducts.length === 0) {
            console.log('✅ No products with low stock found');
            return;
        }

        console.log(`⚠️ Found ${lowStockProducts.length} products with low stock`);

        // הכנת רשימת נמענים מנהלים
        const adminEmails = process.env.ADMINS_EMAILS
            ? process.env.ADMINS_EMAILS.split(',').map(email => email.trim()).filter(email => email)
            : [process.env.EMAIL_USER];

        if (!adminEmails || adminEmails.length === 0) {
            console.error('❌ No admin emails configured');
            return;
        }

        // הכנת נתוני האימייל
        const emailData = {
            products: lowStockProducts,
            totalProducts: lowStockProducts.length
        };

        // יצירת אובייקט האימייל
        const emailBody = {
            from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
            to: adminEmails.join(','),
            subject: `⚠️ התראת מלאי נמוך - ${lowStockProducts.length} מוצרים`,
            html: stockAlertBody(emailData)
        };

        // שליחת האימייל
        await sendEmailSilent(emailBody);
        console.log(`✅ Stock alert email sent successfully for ${lowStockProducts.length} products`);

        // עדכון hasSentStockAlert ל-true לכל המוצרים שנשלח עליהם אימייל
        const productIds = lowStockProducts.map(p => p._id);
        await Product.updateMany(
            { _id: { $in: productIds } },
            { $set: { hasSentStockAlert: true } }
        );

        console.log(`✅ Updated hasSentStockAlert for ${productIds.length} products`);

    } catch (error) {
        console.error('❌ Error in stock alert job:', error);
    }
};

// הפעלת ה-job כל שעה
const startStockAlertJob = () => {
    // הרצה ראשונית מיידית (אופציונלי - ניתן להסיר אם לא רוצים)
    checkLowStockProducts();

    cron.schedule('0 * * * *', () => {
        console.log('⏰ Running scheduled stock alert check...');
        checkLowStockProducts();
    });

    console.log('✅ Stock alert job scheduled to run every hour');
};

module.exports = {
    checkLowStockProducts,
    startStockAlertJob
};