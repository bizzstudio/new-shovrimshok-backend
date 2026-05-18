/**
 * יצירת PDF ממסמך HTML (כרום headless) — מכבד dir=rtl / direction ב-CSS.
 */
const puppeteer = require("puppeteer");

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
      ],
    });
  }
  return browserPromise;
}

/**
 * @param {string} html מלא כולל <!DOCTYPE html>…
 * @returns {Promise<Buffer>}
 */
async function submissionPdfBufferFromHtml(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });
    return Buffer.from(buf);
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  submissionPdfBufferFromHtml,
};
