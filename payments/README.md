# מערכת תשלומים מודולרית

## החלפת ספק תשלום
```env
PAYMENT_GATEWAY=icredit  # או cardcom
```

## מבנה
```
payments/
├── paymentFactory.js           # בוחר ספק לפי env
├── paymentShared.js            # פונקציות משותפות
└── providers/
    ├── cardcomProvider.js      # Cardcom
    └── icreditProvider.js      # iCredit
```

## איך זה עובד

### 1. Checkout
```js
const { createCheckout } = require("../services/orderPaymentService");
const { paymentUrl } = await createCheckout({ ... });
```

### 2. Webhook
- Cardcom: `POST /api/payments/cardcom/webhook/:orderId?token=xxx`
- iCredit: `POST /api/payments/icredit/ipn/:orderId?token=xxx`

### 3. Finalize
אוטומטי - מטופל ב-`orderFinalizeService.js`

## הגדרות נדרשות

### Cardcom
```env
CARDCOM_TERMINAL_NUMBER=...
CARDCOM_API_NAME=...
CARDCOM_API_PASSWORD=...
```

### iCredit
```env
ICREDIT_ENV=prod  # או test
ICREDIT_PAYMENT_PAGE_TOKEN=...
ICREDIT_PAYMENT_PAGE_TOKEN_TEST=...
```

## אבטחה
- ✅ Token ייחודי לכל הזמנה
- ✅ אימות מול הספק (לא סומכים על req.body)
- ✅ Atomic updates (לא משלמים פעמיים)
- ✅ Idempotent (webhook יכול להגיע כמה פעמים)

## Logs
חפש `[Cardcom]` או `[iCredit]` בלוגים
