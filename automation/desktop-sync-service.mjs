#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { loadDesktopConfig, applyDesktopEnvironment } from "./lib/desktop-config.mjs";
import { FIXTURES_URL, RESULTS_URL, runSync } from "./fulltime-sync.mjs";

const config = await loadDesktopConfig();
applyDesktopEnvironment(config);
let running = null;
let captureJob = null;

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

async function readJsonBody(request, limit = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Captured Full-Time pages exceeded the 20 MB safety limit.");
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
      reject(new Error("The EUYFC Chrome extension did not answer within three minutes. Confirm it is installed, its sync key is saved, and normal Chrome is open. No app data was changed."));
    }, 180_000);
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

async function runChromeExtensionSync() {
  return runSync({
    source: "FA Full-Time Windows Chrome Extension",
    schedule: "Windows PC every Sunday at 18:00 Europe/London",
    pushSource: "fulltime-desktop-extension",
    loadHtml: waitForChromeCapture
  });
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
        captureJob.resolve({ resultsHtml: payload.resultsHtml, fixturesHtml: payload.fixturesHtml });
      }
      send(response, 202, { status: "accepted" }, origin);
    } catch (error) {
      send(response, 400, { status: "invalid", message: error.message }, origin);
    }
    return;
  }
  if (request.method !== "POST" || request.url !== "/sync") {
    send(response, 404, { status: "not-found", message: "Unknown desktop sync endpoint." }, origin);
    return;
  }
  if (running) {
    send(response, 409, { status: "busy", message: "The Windows Full-Time bot is already running." }, origin);
    return;
  }
  running = runChromeExtensionSync();
  try {
    const status = await running;
    send(response, 200, { status, message: status?.message || "Windows Chrome sync completed." }, origin);
  } catch (error) {
    send(response, 502, { status: "failed", message: error.message }, origin);
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
