import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    });
  }
  return browserPromise;
}

function pageKind(url) {
  return url.includes("results.html") ? "results" : "fixtures";
}

async function recognisedRows(page, kind) {
  return page.evaluate(expected => {
    const body = document.body?.innerText || "";
    if (expected === "results") {
      if (document.querySelectorAll(".datetime-col").length) return true;
      return [...document.querySelectorAll("table tr")].some(row => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(row.innerText) && /\d+\s*-\s*\d+/.test(row.innerText));
    }
    return [...document.querySelectorAll("table tr")].some(row => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(row.innerText) && /\bvs\b/i.test(row.innerText));
  }, kind);
}

async function saveFailureScreenshot(page, kind) {
  try {
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({ path: `artifacts/fulltime-${kind}-failure.png`, fullPage: true });
  } catch {
    // The original sync error is more useful than a screenshot failure.
  }
}

export async function fetchFullTimePageInBrowser(url, timeoutMs = 90000) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-GB",
    timezoneId: "Europe/London",
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" }
  });
  const page = await context.newPage();
  const kind = pageKind(url);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    let lastTitle = "";
    let lastText = "";
    while (Date.now() < deadline) {
      lastTitle = await page.title().catch(() => "");
      lastText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      if (await recognisedRows(page, kind)) {
        const html = await page.content();
        if (html.length >= 1000) return html;
      }
      await page.waitForTimeout(2500);
    }
    await saveFailureScreenshot(page, kind);
    const blocked = /attention required|just a moment|one more step|you have been blocked|you have been prevented|security check|enable javascript and cookies/i.test(`${lastTitle}\n${lastText}`);
    if (blocked) {
      throw new Error("FA Full-Time's Cloudflare browser check did not complete on the GitHub runner. No app data was changed.");
    }
    throw new Error(`No recognised Full-Time ${kind} rows appeared in the browser. No app data was changed.`);
  } finally {
    await context.close();
  }
}

export async function closeFullTimeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}
