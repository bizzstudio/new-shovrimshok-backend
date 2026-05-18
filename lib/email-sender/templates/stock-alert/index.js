// lib/email-sender/templates/stock-alert/index.js
const dayjs = require('dayjs');

const stockAlertBody = (option) => {
    const {
        products = [],
        totalProducts = 0
    } = option;

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('he-IL', {
            style: 'currency',
            currency: 'ILS',
            minimumFractionDigits: 2
        }).format(amount || 0);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'לא עודכן';
        return dayjs(dateStr).format('DD/MM/YYYY HH:mm');
    };

    return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>התראת מלאי נמוך - ${process.env.COMPANY_NAME}</title>
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
            color: #f21e27;
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 20px;
            text-align: center;
        }
        .alert-box {
            background-color: #fff8f8;
            border: 2px solid #f21e27;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        .alert-box p {
            margin: 0;
            color: #f21e27;
            font-weight: bold;
            font-size: 18px;
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
        .products-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .products-table thead {
            background-color: #3961ce;
            color: white;
        }
        .products-table th {
            padding: 12px 8px;
            text-align: right;
            border: 1px solid #e0e6f5;
            font-weight: 600;
        }
        .products-table td {
            padding: 10px 8px;
            border: 1px solid #e0e6f5;
            word-wrap: break-word;
        }
        .products-table tbody tr:nth-child(even) {
            background-color: #f8f9ff;
        }
        .stock-low {
            color: #f21e27;
            font-weight: bold;
        }
        .stock-warning {
            color: #ff9800;
            font-weight: bold;
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
            .products-table {
                font-size: 12px;
            }
            .products-table th,
            .products-table td {
                padding: 6px 4px;
            }
        }
    </style>
</head>
<body dir="rtl">
    <div class="container">
        <img src="https://bizzstudio.s3.eu-north-1.amazonaws.com/seo/0be843fd-06da-4093-91af-deb883535717_logo.png" alt="${process.env.COMPANY_NAME}" class="hero">
        
        <div class="content">
            <div class="alert-box">
                <p>
                    ⚠️ התראת מלאי, נמצאו <strong>${totalProducts}</strong> מוצרים עם מלאי נמוך
                </p>
            </div>

            ${products.length > 0 ? `
            <div class="info-box">
                <h3>📦 פירוט המוצרים</h3>
                <table class="products-table">
                    <thead>
                        <tr>
                            <th style="width: 10%;">מק"ט</th>
                            <th style="width: 35%;">שם המוצר</th>
                            <th style="width: 12%; text-align: center;">מלאי נוכחי</th>
                            <th style="width: 12%; text-align: center;">סף התראה</th>
                            <th style="width: 15%; text-align: center;">מחיר</th>
                            <th style="width: 16%; text-align: center;">עדכון אחרון</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${products.map((product) => {
        const currentStock = product.stock || 0;
        const threshold = product.minStockThreshold || 0;
        const stockClass = currentStock === 0 ? 'stock-low' : 'stock-warning';
        const stockText = currentStock === 0 ? 'אזל המלאי' : currentStock;

        const productTitle = product.title?.he || product.title?.en || 'ללא שם';
        const barcode = product.barcode || product.productId || 'ללא מק"ט';
        const price = product.prices && product.prices.length > 0
            ? formatCurrency(product.prices[0].price)
            : 'לא הוגדר';
        const lastUpdate = formatDate(product.lastStockUpdate);

        return `
                        <tr>
                            <td style="font-weight: bold;">${barcode}</td>
                            <td>${productTitle}</td>
                            <td style="text-align: center; font-weight: bold;" class="${stockClass}">${stockText}</td>
                            <td style="text-align: center;">${threshold}</td>
                            <td style="text-align: center;">${price}</td>
                            <td style="text-align: center; font-size: 12px;">${lastUpdate}</td>
                        </tr>
                        `;
    }).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}

            <div class="summary-box">
                <h3>📊 סיכום</h3>
                <p style="margin: 5px 0; color: #3961ce; font-size: 16px;">
                    <strong>סה"כ ${totalProducts} מוצרים דורשים תשומת לב</strong>
                </p>
                <p style="margin: 10px 0; color: #666; font-size: 14px;">
                    אנא בדקו את המלאי והזמינו מוצרים נוספים במידת הצורך
                </p>
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

module.exports = { stockAlertBody };