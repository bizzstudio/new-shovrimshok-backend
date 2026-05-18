// services/subCustomerAlertService.js
// בדיקת סכום הזמנות של תת-לקוח ביחס להתראה המוגדרת

const Customer = require("../models/Customer");
const MainCustomer = require("../models/MainCustomer");
const Order = require("../models/Order");
const { sendEmailSilent } = require("../lib/email-sender/sender");

/**
 * בדיקה אם תת-לקוח הגיע לסכום ההתראה בתקופה הנוכחית.
 * אם כן – יוצרת התראה במערכת ושולחת מייל ללקוח הראשי.
 * @param {String|ObjectId} subCustomerId - מזהה תת-הלקוח
 * @param {Number} newOrderTotal - סכום ההזמנה החדשה שזה עתה נוצרה
 */
const checkSubCustomerAlert = async (subCustomerId, newOrderTotal = 0) => {
    try {
        console.log(`[subCustomerAlert] בדיקה עבור תת-לקוח: ${subCustomerId}, סכום הזמנה: ${newOrderTotal}`);

        const customer = await Customer.findById(subCustomerId).lean();
        if (!customer) {
            console.log(`[subCustomerAlert] תת-לקוח לא נמצא: ${subCustomerId}`);
            return;
        }

        const { alertAmount, alertPeriod, mainCustomer: mainCustomerId } = customer;
        console.log(`[subCustomerAlert] נתוני לקוח – alertAmount: ${alertAmount}, alertPeriod: ${alertPeriod}, mainCustomer: ${mainCustomerId}`);

        // אם לא הוגדרה התראה – אין מה לבדוק
        if (!alertAmount || alertAmount <= 0 || !alertPeriod) {
            console.log(`[subCustomerAlert] אין התראה מוגדרת לתת-לקוח זה – דילוג`);
            return;
        }

        // חישוב תחילת התקופה הנוכחית
        const now = new Date();
        let periodStart;

        if (alertPeriod === "weekly") {
            // תחילת השבוע הנוכחי (ראשון)
            const day = now.getDay(); // 0=ראשון
            periodStart = new Date(now);
            periodStart.setDate(now.getDate() - day);
            periodStart.setHours(0, 0, 0, 0);
        } else {
            // תחילת החודש הנוכחי
            periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        }

        // סכום כל ההזמנות של תת-הלקוח בתקופה הנוכחית
        const orders = await Order.find({
            user: subCustomerId,
            createdAt: { $gte: periodStart },
        }).select("total").lean();

        const periodTotal = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
        const totalBeforeNewOrder = periodTotal - newOrderTotal;

        console.log(`[subCustomerAlert] סכום תקופה: ${periodTotal.toFixed(2)}, לפני הזמנה: ${totalBeforeNewOrder.toFixed(2)}, סף: ${alertAmount}`);

        // כדי לא לשלוח כפל התראות, בודקים שהסכום לפני ההזמנה החדשה היה מתחת לסף
        if (totalBeforeNewOrder >= alertAmount) {
            console.log(`[subCustomerAlert] הסף כבר נחצה לפני הזמנה זו – לא שולח שוב`);
            return;
        }
        if (periodTotal < alertAmount) {
            console.log(`[subCustomerAlert] הסכום (${periodTotal.toFixed(2)}) עדיין מתחת לסף (${alertAmount}) – לא שולח`);
            return;
        }

        // נתוני ההתראה
        const periodLabel = alertPeriod === "weekly" ? "שבועי" : "חודשי";
        const customerName = [customer.name, customer.lastName].filter(Boolean).join(" ");

        // שליפת הלקוח הראשי (שם + מייל)
        let mainCustomerName = "";
        let mainCustomerEmail = "";
        if (mainCustomerId) {
            const mainCust = await MainCustomer.findById(mainCustomerId).select("name email").lean();
            if (mainCust) {
                mainCustomerName = mainCust.name || "";
                mainCustomerEmail = mainCust.email || "";
            }
        }

        const message = `התת-לקוח "${customerName}" הגיע לסכום ה${periodLabel} של ${alertAmount.toLocaleString("he-IL")} ₪ (סה"כ ${periodTotal.toFixed(2)} ₪)${mainCustomerName ? ` – לקוח ראשי: ${mainCustomerName}` : ""}`;

        console.log(`[subCustomerAlert] ✅ הסף נחצה! שולח מייל ל: ${mainCustomerEmail}`);

        // שליחת מייל ללקוח הראשי
        if (mainCustomerEmail) {
            const emailHtml = `
                <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #333; border-bottom: 2px solid #4f46e5; padding-bottom: 10px;">⚠️ התראת סכום הזמנות</h2>
                    <p style="font-size: 16px; color: #444;">שלום <strong>${mainCustomerName}</strong>,</p>
                    <p style="font-size: 15px; color: #444;">
                        תת-הלקוח <strong>${customerName}</strong> הגיע לסכום ה<strong>${periodLabel}</strong> שהוגדר.
                    </p>
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">תת-לקוח</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${customerName}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">סכום שנצבר ב${periodLabel}</td>
                            <td style="padding: 10px; border: 1px solid #ddd; color: #e53e3e; font-weight: bold;">${periodTotal.toFixed(2)} ₪</td>
                        </tr>
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">סכום ההתראה</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${alertAmount.toLocaleString("he-IL")} ₪</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">תקופה</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${periodLabel}</td>
                        </tr>
                    </table>
                    <p style="font-size: 13px; color: #888; margin-top: 20px;">הודעה זו נשלחה אוטומטית ממערכת ניהול ההזמנות.</p>
                </div>
            `;

            sendEmailSilent({
                from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
                to: mainCustomerEmail,
                subject: `⚠️ התראה: ${customerName} הגיע לסכום ה${periodLabel} של ${alertAmount.toLocaleString("he-IL")} ₪`,
                html: emailHtml,
            }).catch((emailErr) => {
                console.error("[subCustomerAlert] שגיאה בשליחת מייל ללקוח הראשי:", emailErr.message);
            });
        }

        console.log(`[subCustomerAlert] התראה נוצרה עבור ${customerName}: ${periodTotal.toFixed(2)} / ${alertAmount} ₪ (${periodLabel})`);
    } catch (err) {
        console.error("[subCustomerAlert] שגיאה בבדיקת התראת תת-לקוח:", err.message);
    }
};

module.exports = { checkSubCustomerAlert };
