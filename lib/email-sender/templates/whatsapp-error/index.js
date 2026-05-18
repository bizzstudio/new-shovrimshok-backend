const dayjs = require('dayjs');

const whatsappErrorEmailBody = (option) => {
  const { failedMessages, timestamp, serverInfo } = option;

  // יצירת HTML table עבור כל הודעה שנכשלה
  const messagesTableRows = failedMessages.map((msg, index) => `
    <tr>
      <td style="padding: 12px; border: 1px solid #e0e6f5; background-color: ${index % 2 === 0 ? '#f8f9ff' : '#ffffff'}; font-size: 14px; text-align: center;">${index + 1}</td>
      <td style="padding: 12px; border: 1px solid #e0e6f5; background-color: ${index % 2 === 0 ? '#f8f9ff' : '#ffffff'}; font-size: 14px; font-weight: bold; color: #f21e27;">${msg.orderInvoice || 'לא זמין'}</td>
      <td style="padding: 12px; border: 1px solid #e0e6f5; background-color: ${index % 2 === 0 ? '#f8f9ff' : '#ffffff'}; font-size: 14px; direction: ltr; text-align: left;">${msg.userPhone || 'לא זמין'}</td>
      <td style="padding: 12px; border: 1px solid #e0e6f5; background-color: ${index % 2 === 0 ? '#f8f9ff' : '#ffffff'}; font-size: 14px;">
        <span style="padding: 4px 8px; border-radius: 4px; background-color: ${msg.messageType === 'survey' ? '#fff8f8' : msg.messageType === 'order-ready' ? '#f8f9ff' : '#f8f9ff'}; color: ${msg.messageType === 'survey' ? '#f21e27' : msg.messageType === 'order-ready' ? '#3961ce' : '#3961ce'}; font-size: 12px; font-weight: 500;">
          ${msg.messageType === 'survey' ? 'הודעת סקר שביעות רצון' : msg.messageType === 'order-ready' ? 'הודעת הזמנה מוכנה' : msg.messageType || 'לא ידוע'}
        </span>
      </td>
      <td style="padding: 12px; border: 1px solid #e0e6f5; background-color: ${index % 2 === 0 ? '#f8f9ff' : '#ffffff'}; font-size: 13px; direction: ltr; font-family: monospace; color: #f21e27; max-width: 300px; word-break: break-word;">${msg.errorMessage || 'לא זמין'}</td>
      <td style="padding: 12px; border: 1px solid #e0e6f5; background-color: ${index % 2 === 0 ? '#f8f9ff' : '#ffffff'}; font-size: 12px; color: #666; direction: ltr; font-family: monospace; text-align: left;">${new Date(msg.timestamp).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>שגיאה בשליחת הודעות WhatsApp - ${process.env.COMPANY_NAME}</title>
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
            max-width: 900px;
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
        .error-box {
            background-color: #fff8f8;
            border: 2px solid #f21e27;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
        }
        .summary-box {
            background-color: #f8f9ff;
            border: 2px solid #3961ce;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
        }
        .summary-box h3 {
            color: #3961ce;
            margin-top: 0;
            margin-bottom: 15px;
        }
        .summary-grid {
            display: flex;
            justify-content: space-around;
            flex-wrap: wrap;
            gap: 15px;
            margin-top: 15px;
        }
        .summary-item {
            background-color: white;
            padding: 15px;
            border-radius: 6px;
            border: 1px solid #e0e6f5;
            min-width: 120px;
            text-align: center;
        }
        .summary-item .number {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .summary-item .label {
            font-size: 12px;
            color: #666;
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
            margin-top: 0;
            margin-bottom: 15px;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 15px;
        }
        .info-item {
            background-color: white;
            padding: 12px;
            border-radius: 6px;
            border-right: 4px solid #3961ce;
        }
        .info-label {
            font-weight: bold;
            color: #3961ce;
            font-size: 14px;
            margin-bottom: 4px;
        }
        .info-value {
            color: #666;
            font-size: 13px;
            font-family: monospace;
        }
        .warning-box {
            background-color: #fff8f8;
            border-right: 4px solid #f21e27;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
        }
        .warning-box h3 {
            color: #f21e27;
            margin-top: 0;
            margin-bottom: 15px;
        }
        .messages-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .messages-table thead {
            background-color: #3961ce;
            color: white;
        }
        .messages-table th {
            padding: 15px 12px;
            border: 1px solid #e0e6f5;
            font-size: 14px;
            text-align: center;
            font-weight: 600;
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
            .info-grid {
                grid-template-columns: 1fr;
            }
            .messages-table {
                font-size: 11px;
            }
            .messages-table th,
            .messages-table td {
                padding: 8px 6px;
            }
        }
    </style>
</head>
<body dir="rtl">
    <div class="container">
        <img src="https://bizzstudio.s3.eu-north-1.amazonaws.com/seo/0be843fd-06da-4093-91af-deb883535717_logo.png" alt="${process.env.COMPANY_NAME}" class="hero">
        
        <div class="content">
            <h1 class="title">🚨 התרחשה שגיאה בשליחת הודעות WhatsApp</h1>
            
            <div class="error-box">
                <p style="color: #f21e27; font-size: 16px; margin: 0;">
                    זוהו <strong>${failedMessages.length}</strong> הודעות ש<strong>נכשלו בשליחה</strong> מהשרת WhatsApp של ${process.env.COMPANY_NAME}.
                </p>
            </div>

            <div class="summary-box">
                <h3>📊 סיכום השגיאות:</h3>
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="number" style="color: #f21e27;">${failedMessages.length}</div>
                        <div class="label">הודעות שנכשלו</div>
                    </div>
                    <div class="summary-item">
                        <div class="number" style="color: #3961ce;">${[...new Set(failedMessages.map(m => m.messageType))].length}</div>
                        <div class="label">סוגי הודעות</div>
                    </div>
                    <div class="summary-item">
                        <div class="number" style="color: #3961ce;">${[...new Set(failedMessages.map(m => m.userPhone))].length}</div>
                        <div class="label">לקוחות מושפעים</div>
                    </div>
                </div>
            </div>

            <div class="info-box">
                <h3>🖥️ פרטי השרת:</h3>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">זמן השגיאה:</div>
                        <div class="info-value">${new Date(timestamp).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'full', timeStyle: 'medium' })}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">סביבת העבודה:</div>
                        <div class="info-value">${serverInfo?.environment || 'לא זמין'}</div>
                    </div>
                </div>
            </div>

            <div class="warning-box">
                <h3>⚠️ פעולות נדרשות:</h3>
                <ul style="color: #f21e27; font-size: 14px; line-height: 1.8; margin: 0; padding-right: 20px;">
                    <li>בדוק את מצב חיבור השרת WhatsApp</li>
                    <li>וודא שהשירות פועל כראוי</li>
                    <li>שקול לשלוח מחדש את ההודעות שנכשלו</li>
                    <li>בדוק את לוגים המפורטים בשרת</li>
                </ul>
            </div>

            <div class="info-box">
                <h3>📋 פירוט הודעות שנכשלו:</h3>
                <div style="overflow-x: auto;">
                    <table class="messages-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>מספר הזמנה</th>
                                <th>טלפון לקוח</th>
                                <th>סוג הודעה</th>
                                <th>שגיאה</th>
                                <th>זמן</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${messagesTableRows}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="info-box">
                <h3>🛠️ פעולות מומלצות:</h3>
                <ol style="color: #333; font-size: 14px; line-height: 1.8; margin: 0; padding-right: 20px;">
                    <li><strong>בדיקה מיידית:</strong> התחבר לממשק ניהול WhatsApp ובדוק את סטטוס החיבור</li>
                    <li><strong>בדיקת לוגים:</strong> עיין בלוגים של השרת לפרטים נוספים על השגיאות</li>
                    <li><strong>שליחה מחדש:</strong> שקול לשלוח מחדש את ההודעות שנכשלו ללקוחות המושפעים</li>
                    <li><strong>בדיקת תקשורת:</strong> וודא שהחיבור לשרת WhatsApp יציב</li>
                    <li><strong>עדכון לקוחות:</strong> במידת הצורך, עדכן את הלקוחות בערוצים אחרים</li>
                </ol>
            </div>
        </div>
        
        <div class="footer">
            <div>הודעה אוטומטית ממערכת ניטור השגיאות של ${process.env.COMPANY_NAME}</div>
            <div class="copyright">&copy; ${dayjs().year()} כל הזכויות שמורות</div>
        </div>
    </div>
</body>
</html>
`;
};

module.exports = { whatsappErrorEmailBody };
