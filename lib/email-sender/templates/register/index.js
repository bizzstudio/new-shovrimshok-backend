const dayjs = require('dayjs');

const customerRegisterBody = (option) => {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>אימות חשבון - ${process.env.COMPANY_NAME}</title>
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
        .button {
            display: inline-block;
            padding: 12px 24px;
            margin: 20px 0;
            border-radius: 4px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            background-color: #3961ce;
            color: #ffffff;
            border: 2px solid #3961ce;
            text-align: center;
        }
        .button-container {
            text-align: center;
            margin: 30px 0;
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
            text-align: right;
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
            .button {
                display: block;
                width: 100%;
            }
        }
    </style>
</head>
<body dir="rtl">
    <div class="container">
        <img src="https://bizzstudio.s3.eu-north-1.amazonaws.com/seo/0be843fd-06da-4093-91af-deb883535717_logo.png" alt="${process.env.COMPANY_NAME}" class="hero">
        
        <div class="content">
            <h1 class="title">שלום ${option.name}${option.lastname ? " " + option.lastname : ''}</h1>
            
            <p class="description">
                אנא אמת את כתובת האימייל שלך כדי להשלים את ההרשמה ולהתחבר לחשבון המשתמש שלך ב${process.env.COMPANY_NAME}.
            </p>
            
            <p class="description">
                הלינק יפוג בעוד <strong style="color: #f21e27;">15 דקות</strong>.
            </p>
            
            <div class="button-container">
                <a href="${process.env.STORE_URL}/user/email-verification/${option.token}" class="button">אמת חשבון</a>
            </div>
            
            <div class="warning">
                אם לא ביצעת את הבקשה הזו, אנא פנה אלינו מיד ל-${process.env.EMAIL_USER}
            </div>
            
            <p style="text-align: center; margin-top: 40px; color: #333;">
                בברכה,<br/>
                <strong style="color: #3961ce;">צוות ${process.env.COMPANY_NAME}</strong>
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

module.exports = { customerRegisterBody };
