// utils/cardcom.js
const { default: axios } = require("axios");

/**
 * אימות הוובהוק מול Cardcom
 * @param {Object} params
 * @param {String} params.TerminalNumber
 * @param {String} params.ApiName
 * @param {String} params.LowProfileId
 * @returns {Object} נתוני התשלום המאומתים
 */
async function getLowProfileResult({ TerminalNumber, ApiName, LowProfileId }) {
    const url = "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult";
    const body = { TerminalNumber, ApiName, LowProfileId };
    
    const res = await axios.post(url, body, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
        validateStatus: () => true, // מאפשר טיפול ידני בשגיאות
    });

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Cardcom GetLpResult failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
    
    return res.data;
}

/**
 * זיכוי/ביטול לפי מזהה עסקה קיים
 * @param {Object} params
 * @param {String|Number} params.transactionId - מזהה עסקה
 * @param {Number} params.amount - סכום לזיכוי
 * @param {Boolean} params.cancelOnly - האם ביטול בלבד (VOID)
 * @returns {Object} תגובת Cardcom
 */
async function refundByTransactionId({ transactionId, amount, cancelOnly = false }) {
    const url = "https://secure.cardcom.solutions/api/v11/Transactions/RefundByTransactionId";
    const payload = {
        ApiName: process.env.CARDCOM_API_NAME,
        ApiPassword: process.env.CARDCOM_API_PASSWORD,
        TransactionId: Number(transactionId),
        PartialSum: Number(Number(amount).toFixed(2)),
        CancelOnly: !!cancelOnly,
        AllowMultipleRefunds: true,
    };

    const res = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 12000,
        validateStatus: () => true,
    });

    console.log(`refundByTransactionId ${transactionId} :>> `, res.data);

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Cardcom refund HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }
    
    const data = res.data || {};
    if (Number(data.ResponseCode) !== 0) {
        const msg = data.Description || "Refund not approved";
        const err = new Error(`Cardcom refund error: ${msg}`);
        err.cardcom = data;
        throw err;
    }

    return data;
}

/**
 * עטיפה ליצירת דף תשלום Cardcom
 * @param {Object} payload - נתוני התשלום
 * @returns {Object} תגובה מ-Cardcom כולל URL ו-LowProfileId
 */
async function createLowProfilePayment(payload) {
    const url = "https://secure.cardcom.solutions/api/v11/LowProfile/Create";
    
    const res = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Cardcom LowProfile/Create failed: ${res.status} ${JSON.stringify(res.data)}`);
    }

    const data = res.data || {};
    if (!data.Url || !data.LowProfileId) {
        throw new Error(`Cardcom returned invalid response: ${JSON.stringify(data)}`);
    }

    return data;
}

module.exports = {
    getLowProfileResult,
    refundByTransactionId,
    createLowProfilePayment,
};
