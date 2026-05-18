// lib/email-sender/templates/otp-email/index.js
const dayjs = require('dayjs');

const generateOtpEmailHtml = (code, systemName) => {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>קוד אימות - ${process.env.COMPANY_NAME}</title>
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
            text-align: center;
        }
        .otp-box {
            background-color: #ffffff;
            border: 2px solid #3961ce;
            border-radius: 8px;
            padding: 25px;
            text-align: center;
            margin: 30px 0;
        }
        .otp-code {
            font-size: 36px;
            font-weight: 700;
            color: #f21e27;
            letter-spacing: 8px;
            font-family: 'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace;
            user-select: all;
            cursor: pointer;
            margin-bottom: 10px;
        }
        .otp-label {
            font-size: 14px;
            color: #3961ce;
            font-weight: 600;
            margin-top: 8px;
        }
        .warning {
            background-color: #f8f9ff;
            border-right: 4px solid #3961ce;
            padding: 15px;
            margin: 25px 0;
            border-radius: 4px;
            color: #333;
            font-size: 14px;
            line-height: 1.6;
            text-align: center;
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
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .description {
                font-size: 12px;
                line-height: 1.5;
                margin-bottom: 20px;
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .otp-box {
                padding: 15px;
                margin: 20px 0;
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .otp-code {
                font-size: 28px;
                letter-spacing: 4px;
            }
            .otp-label {
                font-size: 12px;
            }
            .warning {
                padding: 12px;
                margin: 20px 0;
                font-size: 11px;
                line-height: 1.4;
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .footer {
                padding: 12px 15px;
                font-size: 10px;
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .copyright {
                font-size: 10px;
            }
        }
    </style>
</head>
<body dir="rtl">
    <div class="container">
        <img src="https://bizzstudio.s3.eu-north-1.amazonaws.com/seo/0be843fd-06da-4093-91af-deb883535717_logo.png" alt=${process.env.COMPANY_NAME} class="hero">
        
        <div class="content">
            <h1 class="title">אמת את ההתחברות שלך</h1>
            
            <p class="description">
                קיבלנו בקשה להתחברות ל${systemName}.<br>
                השתמש בקוד הבא כדי להשלים את התהליך:
            </p>
            
            <div class="otp-box">
                <div class="otp-code" onclick="navigator.clipboard.writeText('${code}')" title="לחץ להעתקה">
                    ${code}
                </div>
                <div class="otp-label">קוד האימות שלך</div>
            </div>
            
            <div class="warning">
                אם לא ביקשת קוד זה, אנא התעלם מההודעה.<br>
                הקוד יישאר פעיל למשך 5 דקות.
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

module.exports = { generateOtpEmailHtml };