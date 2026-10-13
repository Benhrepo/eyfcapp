#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDesktopConfig, applyDesktopEnvironment } from "./lib/desktop-config.mjs";
import { buildSyncPreview, FIXTURES_URL, RESULTS_URL, runSync } from "./fulltime-sync.mjs";

const config = await loadDesktopConfig();
applyDesktopEnvironment(config);
let running = null;
let captureJob = null;
const PENDING_PREVIEW_PATH = path.join(config.automationDirectory, ".pending-desktop-preview.json");
let pendingPreview = null;
const PREVIEW_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

async function loadPendingPreview() {
  try {
    const value = JSON.parse(await readFile(PENDING_PREVIEW_PATH, "utf8"));
    if (value?.id && value?.capture && value?.preview && Date.now() <= Date.parse(value.expiresAt)) pendingPreview = value;
    else await unlink(PENDING_PREVIEW_PATH).catch(() => {});
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`Could not load the pending preview: ${error.message}`);
  }
}

async function savePendingPreview() {
  const temporary = `${PENDING_PREVIEW_PATH}.tmp`;
  await writeFile(temporary, `${JSON.stringify(pendingPreview)}\n`, { encoding: "utf8", mode: 0o600 });
  await unlink(PENDING_PREVIEW_PATH).catch(error => { if (error?.code !== "ENOENT") throw error; });
  await rename(temporary, PENDING_PREVIEW_PATH);
}

await loadPendingPreview();

function headers(origin = "") {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token",
    "Access-Control-Allow-Private-Network": "true",
    "Vary": "Origin"
  };
}

function send(response, status, payload, origin = "") {
  response.writeHead(status, headers(origin));
  if (status === 204) {
    response.end();
    return;
  }
  response.end(`${JSON.stringify(payload)}\n`);
}

function tokenMatches(provided) {
  const expectedBuffer = Buffer.from(config.syncToken);
  const providedBuffer = Buffer.from(typeof provided === "string" ? provided : "");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function readJsonBody(request, limit = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Captured Full-Time pages exceeded the 50 MB safety limit.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function waitForChromeCapture() {
  if (captureJob) throw new Error("A Chrome capture request is already waiting.");
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      if (captureJob?.id === id) captureJob = null;
      reject(new Error("The EUYFC Chrome extension did not answer within ten minutes. Confirm it is installed, reloaded, its sync key is saved, and normal Chrome is open. No app data was changed."));
    }, 600_000);
    captureJob = {
      id,
      createdAt: new Date().toISOString(),
      resolve(value) {
        clearTimeout(timeout);
        captureJob = null;
        resolve(value);
      },
      reject(error) {
        clearTimeout(timeout);
        captureJob = null;
        reject(error);
      }
    };
  });
}

const syncOptions = loadHtml => ({
  source: "FA Full-Time Windows Chrome Extension",
  schedule: "Windows PC every Sunday at 18:00 Europe/London",
  pushSource: "fulltime-desktop-extension",
  loadHtml
});

async function runChromeExtensionSync(loadHtml = waitForChromeCapture) {
  return runSync(syncOptions(loadHtml));
}

async function createPreview() {
  const capture = await waitForChromeCapture();
  const preview = await buildSyncPreview(capture);
  const createdAt = new Date();
  pendingPreview = {
    id: randomUUID(),
    capture,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PREVIEW_LIFETIME_MS).toISOString(),
    preview
  };
  await savePendingPreview();
  return {
    status: "preview",
    previewId: pendingPreview.id,
    createdAt: pendingPreview.createdAt,
    expiresAt: pendingPreview.expiresAt,
    preview: pendingPreview.preview
  };
}

async function applyPreview(previewId) {
  if (!pendingPreview || previewId !== pendingPreview.id) {
    throw new Error("That scrape preview is no longer available. Build a fresh preview before applying changes.");
  }
  if (Date.now() > Date.parse(pendingPreview.expiresAt)) {
    pendingPreview = null;
    await unlink(PENDING_PREVIEW_PATH).catch(() => {});
    throw new Error("That scrape preview expired after seven days. Build a fresh preview before applying changes.");
  }
  if (pendingPreview.preview?.safeToApply === false) {
    throw new Error("This report contains an unrecognised Full-Time row and cannot be applied. Build a clean preview first.");
  }
  const capture = pendingPreview.capture;
  const refreshed = await buildSyncPreview(capture);
  if (!pendingPreview.preview?.approvalSignature || refreshed.approvalSignature !== pendingPreview.preview.approvalSignature) {
    pendingPreview = null;
    await unlink(PENDING_PREVIEW_PATH).catch(() => {});
    throw new Error("The app data changed after this report was built. Nothing was applied; build and approve a fresh preview.");
  }
  const status = await runChromeExtensionSync(async () => capture);
  pendingPreview = null;
  await unlink(PENDING_PREVIEW_PATH).catch(() => {});
  return status;
}

const server = createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  if (request.method === "OPTIONS") {
    send(response, 204, {}, origin);
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, {
      status: "ready",
      running: Boolean(running),
      captureWaiting: Boolean(captureJob),
      previewWaiting: Boolean(pendingPreview),
      service: "EUYFC Windows Full-Time helper"
    }, origin);
    return;
  }
  if (!tokenMatches(request.headers["x-sync-token"])) {
    send(response, 401, { status: "unauthorised", message: "The Windows bot sync key is missing or incorrect." }, origin);
    return;
  }
  if (request.method === "GET" && request.url === "/capture-request") {
    send(response, 200, captureJob ? {
      status: "capture",
      id: captureJob.id,
      createdAt: captureJob.createdAt,
      resultsUrl: process.env.FULLTIME_RESULTS_URL || RESULTS_URL,
      fixturesUrl: process.env.FULLTIME_FIXTURES_URL || FIXTURES_URL
    } : { status: "idle" }, origin);
    return;
  }
  if (request.method === "GET" && request.url === "/pending-preview") {
    if (pendingPreview && Date.now() > Date.parse(pendingPreview.expiresAt)) {
      pendingPreview = null;
      await unlink(PENDING_PREVIEW_PATH).catch(() => {});
    }
    send(response, 200, pendingPreview ? {
      status: "pending",
      previewId: pendingPreview.id,
      createdAt: pendingPreview.createdAt,
      expiresAt: pendingPreview.expiresAt,
      preview: pendingPreview.preview
    } : { status: "none", message: "There is no pending Full-Time report on this PC." }, origin);
    return;
  }
  if (request.method === "POST" && request.url === "/captured-pages") {
    try {
      const payload = await readJsonBody(request);
      if (!captureJob || payload.id !== captureJob.id) {
        send(response, 409, { status: "stale", message: "This Chrome capture request is no longer active." }, origin);
        return;
      }
      if (payload.error) {
        captureJob.reject(new Error(String(payload.error)));
      } else if (typeof payload.resultsHtml !== "string" || typeof payload.fixturesHtml !== "string") {
        captureJob.reject(new Error("The Chrome extension did not return both Full-Time pages. No app data was changed."));
      } else {
        captureJob.resolve({
          resultsHtml: payload.resultsHtml,
          fixturesHtml: payload.fixturesHtml,
          resultsPageCount: Math.max(1, Number(payload.resultsPageCount) || 1),
          fixturesPageCount: Math.max(1, Number(payload.fixturesPageCount) || 1)
        });
      }
      send(response, 202, { status: "accepted" }, origin);
    } catch (error) {
      send(response, 400, { status: "invalid", message: error.message }, origin);
    }
    return;
  }
  if (request.method !== "POST" || !["/sync", "/preview", "/apply-preview"].includes(request.url)) {
    send(response, 404, { status: "not-found", message: "Unknown desktop sync endpoint." }, origin);
    return;
  }
  if (running) {
    send(response, 409, { status: "busy", message: "The Windows Full-Time bot is already running." }, origin);
    return;
  }
  try {
    if (request.url === "/apply-preview") {
      const payload = await readJsonBody(request, 1024 * 1024);
      running = applyPreview(String(payload.previewId || ""));
    } else if (request.url === "/preview") {
      running = createPreview();
    } else {
      running = runChromeExtensionSync();
    }
    const result = await running;
    if (request.url === "/preview") send(response, 200, result, origin);
    else send(response, 200, { status: result, message: result?.message || "Windows Chrome sync completed." }, origin);
  } catch (error) {
    const status = /preview.*(?:available|expired)|data changed|cannot be applied/i.test(error.message) ? 409 : 502;
    send(response, status, { status: "failed", message: error.message }, origin);
  } finally {
    running = null;
    captureJob = null;
  }
});

server.on("error", error => {
  console.error(`Desktop sync service failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(config.servicePort, "127.0.0.1", () => {
  console.log(`EUYFC Windows sync service is ready at http://127.0.0.1:${config.servicePort}`);
});
