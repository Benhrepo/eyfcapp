#!/usr/bin/env node
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDesktopConfig } from "./lib/desktop-config.mjs";

const WINDOWS_BROWSER_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function resolveBrowser(config) {
  for (const candidate of [config.chromePath, ...WINDOWS_BROWSER_PATHS].filter(Boolean)) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("Google Chrome or Microsoft Edge was not found. Install Chrome, or set chromePath in .desktop-sync-config.json.");
}

async function helperReady(config) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.servicePort}/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureHelper(config) {
  if (await helperReady(config)) return;
  const child = spawn(process.execPath, [path.join(config.automationDirectory, "desktop-sync-service.mjs")], {
    cwd: config.automationDirectory,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (await helperReady(config)) return;
  }
  throw new Error("The local Windows sync helper could not be started.");
}

async function openNormalChrome(config) {
  const browserPath = await resolveBrowser(config);
  const child = spawn(browserPath, ["about:blank"], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

export async function requestDesktopSync() {
  const config = await loadDesktopConfig();
  await ensureHelper(config);
  await openNormalChrome(config);
  const previewOnly = !process.argv.includes("--apply-direct");
  const response = await fetch(`http://127.0.0.1:${config.servicePort}${previewOnly ? "/preview" : "/sync"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sync-Token": config.syncToken },
    body: "{}",
    signal: AbortSignal.timeout(660_000)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(payload.message || `Windows sync failed with HTTP ${response.status}`);
  return previewOnly ? payload : payload.status || payload;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  requestDesktopSync()
    .then(result => console.log(`__EUYFC_DESKTOP_SYNC_RESULT__${JSON.stringify(result)}`))
    .catch(error => {
      console.error(`Windows Full-Time bot failed: ${error.message}`);
      console.log(`__EUYFC_DESKTOP_SYNC_RESULT__${JSON.stringify({ status: "failed", message: error.message })}`);
      process.exitCode = 1;
    });
}
