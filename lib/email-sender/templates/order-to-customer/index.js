const dayjs = require('dayjs');

const customerInvoiceEmailBody = (option) => {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>חשבונית - ${process.env.COMPANY_NAME}</title>
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
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 30px;
            text-align: center;
            text-transform: uppercase;
        }
        .info-box {
            background-color: #f8f9ff;
            border: 2px solid #3961ce;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
        }
        .info-table {
            width: 100%;
            border-collapse: collapse;
        }
        .info-table td {
            padding: 10px;
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
            margin: 20px 0;
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
        }
        .items-table tbody tr:nth-child(even) {
            background-color: #f8f9ff;
        }
        .summary-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .summary-table thead {
            background-color: #3961ce;
            color: white;
        }
        .summary-table th {
            padding: 12px 8px;
            text-align: right;
            border: 1px solid #e0e6f5;
            font-weight: 600;
            text-transform: uppercase;
        }
        .summary-table td {
            padding: 12px 8px;
            border: 1px solid #e0e6f5;
            text-align: right;
        }
        .summary-table td:last-child {
            color: #f21e27;
            font-weight: bold;
            font-size: 16px;
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
                font-size: 20px;
            }
            .items-table, .summary-table {
                font-size: 12px;
            }
            .items-table th,
            .items-table td,
            .summary-table th,
            .summary-table td {
                padding: 6px 4px;
            }
        }
    </style>
</head>
<body dir="rtl">
    <div class="container">
        <img src="https://bizzstudio.s3.eu-north-1.amazonaws.com/seo/0be843fd-06da-4093-91af-deb883535717_logo.png" alt="${process.env.COMPANY_NAME}" class="hero">
        
        <div class="content">
            <h1 class="title">חשבונית</h1>
            
            <div class="info-box">
                <table class="info-table">
                    <tr>
                        <td>
                            <p style="margin: 0;">סטטוס: ${option.status}</p>
                            <p style="margin: 5px 0 0 0;">מספר עוסק: ${option.vat_number}</p>
                        </td>
                        <td style="text-align: left;">
                            <p style="margin: 0; font-size: 16px; text-transform: uppercase; font-weight: bold; color: #3961ce;">${option.company_name || ""}</p>
                            <p style="margin: 5px 0;">${option.company_address || ""}</p>
                            <p style="margin: 5px 0;">${option.company_phone || ""}</p>
                            <p style="margin: 5px 0;">${option.company_email || ""}</p>
                            <p style="margin: 5px 0;">${option.company_website || ""}</p>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="info-box">
                <table class="info-table">
                    <tr>
                        <td>תאריך:</td>
                        <td>${option.date}</td>
                    </tr>
                    <tr>
                        <td>חשבון:</td>
                        <td style="font-weight: bold; color: #f21e27;">#${option.invoice}</td>
                    </tr>
                    <tr>
                        <td>שיטה:</td>
                        <td style="font-weight: bold;">${option.method}</td>
                    </tr>
                    <tr>
                        <td>לקוח:</td>
                        <td>
                            ${option.name || ""}
                            <p style="margin: 5px 0;">${option.email || ""}</p>
                            <p style="margin: 5px 0;">${option.phone || ""}</p>
                            ${option.address || ""}
                        </td>
                    </tr>
                </table>
            </div>

            <div class="info-box">
                <h3 style="color: #3961ce; margin-top: 0; margin-bottom: 15px; border-bottom: 2px solid #3961ce; padding-bottom: 10px;">פירוט המוצרים</h3>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th style="width: 40%;">שם</th>
                            <th style="width: 20%; text-align: center;">כמות</th>
                            <th style="width: 20%; text-align: right;">מחיר</th>
                            <th style="width: 20%; text-align: right;">סה"כ מחיר</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${option.cart.map((item) => {
        return `
                        <tr>
                            <td>${item.title.substring(0, 15)}</td>
                            <td style="text-align: center;">${item.quantity}</td>
                            <td style="text-align: right;">${option.currency}${item.finalPriceAtPurchase.perUnit.toFixed(2)}</td>
                            <td style="text-align: right; font-weight: bold;">${option.currency}${item.finalPriceAtPurchase.total.toFixed(2)}</td>
                        </tr>`;
    }).join("")}
                    </tbody>
                </table>
            </div>

            <div class="info-box">
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>סכום ביניים</th>
                            <th>מע"מ</th>
                            <th>משלוח</th>
                            <th>הנחה</th>
                            <th>סה"כ</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>${option.currency}${option.subTotal.toFixed(2)}</td>
                            <td>${option.currency}${option.vat.toFixed(2)}</td>
                            <td>${option.currency}${option.shipping.toFixed(2)}</td>
                            <td>${option.currency}${option.discount.toFixed(2)}</td>
                            <td>${option.currency}${option.total.toFixed(2)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="footer">
            <div>הודעה אוטומטית ממערכת ${process.env.COMPANY_NAME}</div>
            <div class="copyright">&copy; ${dayjs().year()} כל הזכויות שמורות</div>
        </div>
    </div>
</body>
</html>`;
};

module.exports = customerInvoiceEmailBody;
