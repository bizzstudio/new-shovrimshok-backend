const dayjs = require('dayjs');

const newApplicationBody = (option) => {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>פנייה חדשה - ${process.env.COMPANY_NAME}</title>
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
            max-width: 600px;
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
        .description {
            color: #333;
            font-size: 16px;
            line-height: 1.8;
            margin-bottom: 30px;
            text-align: right;
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
                margin-bottom: 15px;
            }
            .description {
                font-size: 14px;
                line-height: 1.6;
            }
            .info-box {
                padding: 15px;
            }
        }
    </style>
</head>
<body dir="rtl">
    <div class="container">
        <img src="https://bizzstudio.s3.eu-north-1.amazonaws.com/seo/0be843fd-06da-4093-91af-deb883535717_logo.png" alt="${process.env.COMPANY_NAME}" class="hero">
        
        <div class="content">
            <h1 class="title">התקבלה פנייה חדשה באתר</h1>
            
            <p class="description">
                התקבלה פנייה חדשה מאת <strong>${option.name}</strong> בנושא "<strong>${option.subject}</strong>".
            </p>
            
            <div class="info-box">
                <h3>פרטי הפנייה:</h3>
                <table class="info-table">
                    <tr>
                        <td>שם:</td>
                        <td>${option.name}</td>
                    </tr>
                    <tr>
                        <td>דוא"ל:</td>
                        <td>${option.email}</td>
                    </tr>
                    <tr>
                        <td>נושא:</td>
                        <td>${option.subject}</td>
                    </tr>
                    <tr>
                        <td style="vertical-align: top;">הודעה:</td>
                        <td style="white-space: pre-wrap;">${option.message}</td>
                    </tr>
                </table>
            </div>
            
            <p style="text-align: center; margin-top: 40px; color: #333;">
                בברכה,<br/>
                <strong style="color: #3961ce;">מערכת ${process.env.COMPANY_NAME}</strong>
            </p>
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

module.exports = { newApplicationBody };
