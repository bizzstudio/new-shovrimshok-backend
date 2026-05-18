// lib/email-sender/templates/new-order-notification/index.js
const dayjs = require('dayjs');

const newOrderNotificationBody = (option) => {
    const {
        // פרטי ההזמנה
        invoice,
        orderDate,
        total,
        discount,
        shippingCost,
        paymentMethod,
        shippingOption,

        // פרטי הלקוח
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,

        // פרטים נוספים
        orderItems = [],
        totalItems = 0,
        customerNote,
        isBusinessCustomer = false,
        priceList = null // המחירון של הלקוח בעת הקנייה
    } = option;

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('he-IL', {
            style: 'currency',
            currency: 'ILS',
            minimumFractionDigits: 2
        }).format(amount || 0);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleDateString('he-IL');
    };

    const getShippingText = (option) => {
        switch (option) {
            case '1': return 'איסוף עצמי';
            case '2': return isBusinessCustomer ? 'משלוח עד העסק' : 'משלוח עד הבית';
            default: return option || 'לא צויין';
        }
    };

    const getPaymentText = (method) => {
        switch (method) {
            case 'credit': return 'הקפה';
            case 'card': return 'כרטיס אשראי';
            default: return method || 'לא צויין';
        }
    };

    // פונקציה לבניית תיאור המוצר עם שם המבצע (בדיוק כמו ב-cardcomObj)
    const getItemDescription = (item) => {
        let description = 'מוצר';

        if (item.isRewardProduct) {
            // מוצר מתנה - מוסיפים את rewardOfferName
            const title = item.title || item._doc?.title;
            description = title?.he || title || 'מוצר';
            const offerName = item.rewardOfferName?.he || item.rewardOfferName || 'מוצר מתנה';
            description += " (" + offerName + ")";
        } else {
            // מוצר רגיל או עם מבצע
            const title = item.title || item._doc?.title;
            description = title?.he || title || item.ItemDescription || item.Description || 'מוצר';

            // אם יש מבצע - מוסיפים את שם המבצע
            if (item.offerTitle) {
                const offerName = item.offerTitle?.he || item.offerTitle;
                if (offerName) {
                    description += " (" + offerName + ")";
                }
            }
        }

        return description;
    };

    return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>הזמנה חדשה - ${process.env.COMPANY_NAME}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ffffff;
            direction: rtl;
            word-break: break-word;
            overflow-wrap: break-word;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: #ffffff;
            word-break: break-word;
            overflow-wrap: break-word;
        }
        .hero {
            width: 30%;
            height: auto;
            display: block;
            margin: 0 auto;
        }
        .content {
            padding: 40px 30px;
        }
        .title {
            color: #3961ce;
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 20px;
            text-align: center;
        }
        .status-box {
            background-color: #f8f9ff;
            border: 2px solid #3961ce;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        .info-box {
            background-color: #f8f9ff;
            border: 2px solid #3961ce;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
        }
        .info-box h3 {
            color: #3961ce;
            font-size: 18px;
            margin-top: 0;
            margin-bottom: 15px;
            border-bottom: 2px solid #3961ce;
            padding-bottom: 10px;
        }
        .info-table {
            width: 100%;
            border-collapse: collapse;
        }
        .info-table td {
            padding: 10px 0;
            border-bottom: 1px solid #e0e6f5;
        }
        .info-table td:first-child {
            width: 40%;
            font-weight: 600;
            color: #3961ce;
        }
        .info-table tr:last-child td {
            border-bottom: none;
        }
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .items-table thead {
            background-color: #3961ce;
            color: white;
        }
        .items-table th {
            padding: 12px 8px;
            text-align: right;
            border: 1px solid #e0e6f5;
            font-weight: 600;
        }
        .items-table td {
            padding: 10px 8px;
            border: 1px solid #e0e6f5;
            word-wrap: break-word;
        }
        .items-table tbody tr:nth-child(even) {
            background-color: #f8f9ff;
        }
        .summary-box {
            background-color: #f8f9ff;
            border: 2px solid #3961ce;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        .summary-box h3 {
            color: #3961ce;
            margin: 0 0 10px 0;
            font-size: 18px;
        }
        .total-amount {
            color: #f21e27;
            font-size: 24px;
            font-weight: 700;
            margin-top: 10px;
        }
        .note-box {
            background-color: #fff8f8;
            border-right: 4px solid #f21e27;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
        }
        .note-box h3 {
            color: #f21e27;
            margin-top: 0;
            margin-bottom: 10px;
        }
        .footer {
            background-color: #ffffff;
            padding: 20px 30px;
            text-align: center;
            border-top: 1px solid #e0e6f5;
            color: #666;
            font-size: 12px;
        }
        .copyright {
            color: #999;
            font-size: 11px;
            margin-top: 8px;
        }
        @media only screen and (max-width: 640px) {
            .content {
                padding: 20px 15px;
            }
            .title {
                font-size: 18px;
            }
            .items-table {
                font-size: 12px;
            }
            .items-table th,
            .items-table td {
                padding: 6px 4px;
            }
        }
    </style>
</head>
<body dir="rtl">
    <div class="container">
        <img src="https://bizzstudio.s3.eu-north-1.amazonaws.com/seo/0be843fd-06da-4093-91af-deb883535717_logo.png" alt="${process.env.COMPANY_NAME}" class="hero">
        
        <div class="content">
            <h1 class="title">🛒 התקבלה הזמנה חדשה!</h1>
            
            <div class="status-box">
                <p style="margin: 0; color: #3961ce; font-weight: bold; font-size: 18px;">
                    ✅ הזמנה מספר <strong style="color: #f21e27;">#${invoice}</strong> נוצרה בהצלחה עבור <strong>${customerName}</strong>
                    ${isBusinessCustomer ? '<br><small style="color: #666;">לקוח עסקי</small>' : ''}
                </p>
            </div>

            <div class="info-box">
                <h3>📋 פרטי ההזמנה</h3>
                <table class="info-table">
                    <tr>
                        <td>מספר הזמנה:</td>
                        <td style="font-weight: bold; font-size: 18px; color: #f21e27;">#${invoice}</td>
                    </tr>
                    <tr>
                        <td>תאריך הזמנה:</td>
                        <td>${formatDate(orderDate)}</td>
                    </tr>
                    <tr>
                        <td>כמות פריטים:</td>
                        <td>${totalItems} פריטים</td>
                    </tr>
                    <tr>
                        <td>שיטת תשלום:</td>
                        <td>${getPaymentText(paymentMethod)}</td>
                    </tr>
                    ${discount > 0 ? `
                    <tr>
                        <td>הנחה:</td>
                        <td style="color: #f21e27;">-${formatCurrency(discount)}</td>
                    </tr>
                    ` : ''}
                    ${shippingCost > 0 ? `
                    <tr>
                        <td>עלות משלוח:</td>
                        <td>${formatCurrency(shippingCost)}</td>
                    </tr>
                    ` : ''}
                    <tr style="background-color: #fff8f8;">
                        <td style="font-size: 18px; padding-top: 15px;">סה"כ לתשלום:</td>
                        <td style="font-size: 20px; font-weight: bold; color: #f21e27; padding-top: 15px;">${formatCurrency(total)}</td>
                    </tr>
                </table>
            </div>

            <div class="info-box">
                <h3>👤 פרטי הלקוח</h3>
                <table class="info-table">
                    <tr>
                        <td>שם הלקוח:</td>
                        <td style="font-weight: bold;">${customerName}</td>
                    </tr>
                    ${customerEmail ? `
                    <tr>
                        <td>אימייל:</td>
                        <td><a href="mailto:${customerEmail}" style="color: #3961ce;">${customerEmail}</a></td>
                    </tr>
                    ` : ''}
                    ${customerPhone ? `
                    <tr>
                        <td>טלפון:</td>
                        <td><a href="tel:${customerPhone}" style="color: #3961ce;">${customerPhone}</a></td>
                    </tr>
                    ` : ''}
                    ${customerAddress ? `
                    <tr>
                        <td>כתובת:</td>
                        <td>${customerAddress}</td>
                    </tr>
                    ` : ''}
                </table>
            </div>

            <div class="info-box">
                <h3>🚚 פרטי משלוח</h3>
                <table class="info-table">
                    <tr>
                        <td>סוג משלוח:</td>
                        <td style="font-weight: bold;">${getShippingText(shippingOption)}</td>
                    </tr>
                </table>
            </div>

            ${orderItems.length > 0 ? `
            <div class="info-box">
                <h3>📦 פירוט המוצרים</h3>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th style="width: 15%;">קוד מוצר</th>
                            <th style="width: 35%;">תיאור</th>
                            <th style="width: 12%; text-align: center;">כמות</th>
                            <th style="width: 19%; text-align: center;">מחיר</th>
                            <th style="width: 19%; text-align: center;">סה"כ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${orderItems.map((item, index) => {
        const unitPrice = item.finalPriceAtPurchase.perUnit;
        const totalPrice = item.finalPriceAtPurchase.total;
        const description = getItemDescription(item);
        return `
                        <tr>
                            <td style="font-weight: bold;">${item.barcode || item._id?.slice(0, 5) || ''}</td>
                            <td>${description}</td>
                            <td style="text-align: center; font-weight: bold;">${item.quantity || item.Quantity || 1}</td>
                            <td style="text-align: center;">${formatCurrency(unitPrice)}</td>
                            <td style="text-align: center; font-weight: bold;">${formatCurrency(totalPrice)}</td>
                        </tr>
                        `;
    }).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}

            ${customerNote ? `
            <div class="note-box">
                <h3>💬 הערות הלקוח</h3>
                <p style="margin: 0; font-style: italic; background-color: white; padding: 15px; border-radius: 5px; border: 1px solid #e0e6f5;">"${customerNote}"</p>
            </div>
            ` : ''}

            <div class="summary-box">
                <h3>📊 סיכום ההזמנה</h3>
                <p style="margin: 5px 0; color: #3961ce; font-size: 16px;"><strong>סה"כ ${totalItems} פריטים</strong></p>
                <div class="total-amount">💰 סה"כ לתשלום: ${formatCurrency(total)}</div>
            </div>
        </div>
        
        <div class="footer">
            <div>הודעה אוטומטית ממערכת ${process.env.COMPANY_NAME}</div>
            <div class="copyright">&copy; ${dayjs().year()} כל הזכויות שמורות</div>
        </div>
    </div>
</body>
</html>
`;
};

module.exports = { newOrderNotificationBody };
