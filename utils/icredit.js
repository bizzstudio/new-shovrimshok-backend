// utils/icredit.js
const axios = require("axios");

function getIcreditBaseUrl() {
    return process.env.ICREDIT_ENV === "prod"
        ? "https://icredit.rivhit.co.il"
        : "https://testicredit.rivhit.co.il";
}

async function icreditGetUrl(payload) {
    const url = `${getIcreditBaseUrl()}/API/PaymentPageRequest.svc/GetUrl`;

    const res = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        timeout: 15000,
        validateStatus: () => true,
    });

    console.log('iCredit GetUrl response:', res.data);
    // res.data example:
    // iCredit GetUrl response: {
    //     DebugMessage: null,
    //     PrivateSaleToken: '9e24e49e-8eed-447e-9c18-16362914527c',
    //     PublicSaleToken: 'a66a5800-0bab-427b-96da-0fc7ff7374f5',
    //     Status: 0,
    //     URL: 'https://testicredit.rivhit.co.il/payment/PaymentItems.aspx?GroupId=d0606ed0-b961-47f3-be4f-0c694442cb0d&Token=a66a5800-0bab-427b-96da-0fc7ff7374f5'
    //   }

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`iCredit GetUrl HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }

    const data = res.data || {};
    if (data.Status !== 0 || !data.URL) {
        throw new Error(`iCredit GetUrl failed: ${JSON.stringify(data)}`);
    }

    return {
        url: data.URL,
        publicSaleToken: data.PublicSaleToken,
        privateSaleToken: data.PrivateSaleToken,
    };
}

async function icreditVerify({ groupPrivateToken, saleId, totalAmount }) {
    const url = `${getIcreditBaseUrl()}/API/PaymentPageRequest.svc/Verify`;

    const res = await axios.post(url, {
        GroupPrivateToken: groupPrivateToken,
        SaleId: saleId,
        TotalAmount: Number(totalAmount),
    }, {
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        timeout: 15000,
        validateStatus: () => true,
    });

    console.log('iCredit Verify response:', res.data);
    // res.data example:
    // iCredit Verify response: { Status: 'VERIFIED' }

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`iCredit Verify HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }

    return res.data; // { Status: "VERIFIED" | "NOTVERIFIED" }
}

module.exports = { icreditGetUrl, icreditVerify };