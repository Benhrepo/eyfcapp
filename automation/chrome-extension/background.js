const SERVICE = "http://127.0.0.1:32187";
const POLL_ALARM = "euyfc-fulltime-poll";
let busy = false;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function setBadge(text, color, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (title) await chrome.action.setTitle({ title });
}

async function syncKey() {
  const saved = await chrome.storage.local.get("syncKey");
  return typeof saved.syncKey === "string" ? saved.syncKey.trim() : "";
}

async function authenticatedFetch(path, options = {}) {
  const token = await syncKey();
  if (!token) throw new Error("Open the EUYFC extension options and save the private sync key.");
  return fetch(`${SERVICE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), "X-Sync-Token": token }
  });
}

async function waitForTab(tabId, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await delay(500);
  }
  throw new Error("A Full-Time page did not finish loading within two minutes.");
}

async function capturePage(url, label) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    await delay(1500);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ html: document.documentElement.outerHTML, title: document.title })
    });
    const combined = `${result?.title || ""}\n${result?.html || ""}`;
    if (/attention required|you have been blocked|you have been prevented|prevented from accessing this page/i.test(combined)) {
      throw new Error(`FA Full-Time blocked the ${label} page in normal Chrome. Open that page yourself and follow any instructions shown. No app data was changed.`);
    }
    if (!result?.html) throw new Error(`Chrome could not read the Full-Time ${label} page.`);
    return result.html;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function deliverCapture(job) {
  await setBadge("…", "#f5c400", "EUYFC Full-Time sync is reading both pages");
  let payload;
  try {
    const resultsHtml = await capturePage(job.resultsUrl, "results");
    const fixturesHtml = await capturePage(job.fixturesUrl, "fixtures");
    payload = { id: job.id, resultsHtml, fixturesHtml };
  } catch (error) {
    payload = { id: job.id, error: error.message };
  }
  const response = await authenticatedFetch("/captured-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`The Windows helper rejected the captured pages (HTTP ${response.status}).`);
  if (payload.error) throw new Error(payload.error);
  await setBadge("OK", "#218739", "EUYFC Full-Time pages captured successfully");
}

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const token = await syncKey();
    if (!token) {
      await setBadge("KEY", "#b42318", "EUYFC sync key required — open extension options");
      return;
    }
    const response = await authenticatedFetch("/capture-request", { cache: "no-store" });
    if (response.status === 401) {
      await setBadge("KEY", "#b42318", "EUYFC sync key is incorrect — open extension options");
      return;
    }
    if (!response.ok) return;
    const job = await response.json();
    if (job.status === "capture") await deliverCapture(job);
  } catch (error) {
    if (!/fetch|network/i.test(error.message || "")) {
      console.error(error);
      await setBadge("!", "#b42318", error.message || "EUYFC Full-Time sync failed");
    }
  } finally {
    busy = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  await chrome.runtime.openOptionsPage();
  await poll();
});
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  await poll();
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLL_ALARM) poll();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
poll();
