const SERVICE = "http://127.0.0.1:32187";
const POLL_ALARM = "euyfc-fulltime-poll";
const MAX_PAGES = 50;
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

async function pageSnapshot(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const text = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return {
        bodyHtml: document.body?.innerHTML || "",
        title: document.title || "",
        text,
        signature: `${location.href}|${text.length}|${hash >>> 0}`
      };
    }
  });
  return result || {};
}

async function clickNextPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = element => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      };
      const disabled = element => element.disabled
        || element.getAttribute("aria-disabled") === "true"
        || /\bdisabled\b/i.test(element.className || "")
        || Boolean(element.closest("[aria-disabled='true'], .disabled, .k-disabled"));
      const candidates = [...document.querySelectorAll("a, button")].map(element => {
        const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const aria = element.getAttribute("aria-label") || "";
        const title = element.getAttribute("title") || "";
        const rel = element.getAttribute("rel") || "";
        const classes = `${element.className || ""} ${element.parentElement?.className || ""}`;
        const inPager = Boolean(element.closest(".pagination, .pager, .pagination-container, .k-pager-wrap, [class*='pagination'], [class*='pager']"));
        const nextText = /^(?:next|next page|load more)$/i.test(text) || (inPager && /^(?:>|›|»|→)$/.test(text));
        const nextLabel = /\bnext\b/i.test(`${aria} ${title} ${rel}`) || (inPager && /\bnext\b/i.test(classes));
        if ((!nextText && !nextLabel) || !visible(element) || disabled(element)) return null;
        let score = 0;
        if (/\bnext\b/i.test(rel)) score += 100;
        if (/\bnext\b/i.test(`${aria} ${title}`)) score += 80;
        if (inPager) score += 50;
        if (nextText) score += 20;
        return { element, score, label: aria || title || text || "Next" };
      }).filter(Boolean).sort((left, right) => right.score - left.score);
      if (!candidates.length) return { clicked: false };
      const chosen = candidates[0];
      chosen.element.scrollIntoView({ block: "center" });
      chosen.element.click();
      return { clicked: true, label: chosen.label };
    }
  });
  return result || { clicked: false };
}

async function waitForPageChange(tabId, previousSignature, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await delay(500);
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status !== "complete") continue;
      const snapshot = await pageSnapshot(tabId);
      if (snapshot.signature && snapshot.signature !== previousSignature) return snapshot;
    } catch {
      // A normal navigation briefly makes the page unavailable to scripting.
    }
  }
  throw new Error("Full-Time's next-page button did not load another page within 45 seconds. No app data was changed.");
}

async function captureAllPages(url, label) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    await delay(1500);
    const pages = [];
    const seen = new Set();
    let snapshot = await pageSnapshot(tab.id);
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const combined = `${snapshot.title || ""}\n${snapshot.text || ""}`;
      if (/attention required|you have been blocked|you have been prevented|prevented from accessing this page/i.test(combined)) {
        throw new Error(`FA Full-Time blocked the ${label} page in normal Chrome. Open that page yourself and follow any instructions shown. No app data was changed.`);
      }
      if (!snapshot.bodyHtml) throw new Error(`Chrome could not read the Full-Time ${label} page.`);
      if (seen.has(snapshot.signature)) throw new Error(`Full-Time repeated the same ${label} page while paging. No app data was changed.`);
      seen.add(snapshot.signature);
      pages.push(snapshot.bodyHtml);
      await setBadge(String(Math.min(pageNumber, 99)), "#f5c400", `Reading Full-Time ${label} page ${pageNumber}`);

      const next = await clickNextPage(tab.id);
      if (!next.clicked) {
        return {
          html: `<html><body>${pages.map((body, index) => `<section data-fulltime-page="${index + 1}">${body}</section>`).join("\n")}</body></html>`,
          pageCount: pages.length
        };
      }
      if (pageNumber === MAX_PAGES) throw new Error(`Full-Time has more than ${MAX_PAGES} ${label} pages. The safety limit stopped the sync before any app data changed.`);
      snapshot = await waitForPageChange(tab.id, snapshot.signature);
      await delay(750);
    }
    throw new Error(`Chrome could not finish paging through Full-Time ${label}. No app data was changed.`);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function deliverCapture(job) {
  await setBadge("…", "#f5c400", "EUYFC Full-Time sync is reading every page");
  let payload;
  try {
    const results = await captureAllPages(job.resultsUrl, "results");
    const fixtures = await captureAllPages(job.fixturesUrl, "fixtures");
    payload = {
      id: job.id,
      resultsHtml: results.html,
      fixturesHtml: fixtures.html,
      resultsPageCount: results.pageCount,
      fixturesPageCount: fixtures.pageCount
    };
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
  await setBadge("OK", "#218739", `Captured ${payload.resultsPageCount} results and ${payload.fixturesPageCount} fixtures pages`);
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
