import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTOMATION_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DESKTOP_CONFIG_PATH = path.join(AUTOMATION_DIRECTORY, ".desktop-sync-config.json");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadDesktopConfig() {
  let raw;
  try {
    raw = await readFile(DESKTOP_CONFIG_PATH, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Desktop configuration is missing. Run install-desktop-sync.ps1 first (${DESKTOP_CONFIG_PATH}).`);
    }
    throw error;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Desktop configuration is not valid JSON: ${error.message}`);
  }
  const syncToken = clean(input.syncToken);
  if (syncToken.length < 32 || syncToken.includes("replace-with")) {
    throw new Error("Desktop syncToken must contain at least 32 characters. Run install-desktop-sync.ps1 again or correct .desktop-sync-config.json.");
  }
  const config = {
    syncToken,
    chromePath: clean(input.chromePath),
    servicePort: Number(input.servicePort) || 32187,
    pageTimeoutMs: Math.max(30, Number(input.pageTimeoutSeconds) || 120) * 1000,
    firebaseDatabaseUrl: clean(input.firebaseDatabaseUrl),
    firebaseAuthToken: clean(input.firebaseAuthToken),
    automationDirectory: AUTOMATION_DIRECTORY
  };
  if (config.servicePort < 1024 || config.servicePort > 65535) {
    throw new Error("Desktop servicePort must be between 1024 and 65535.");
  }
  return config;
}

export function applyDesktopEnvironment(config) {
  if (config.firebaseDatabaseUrl) process.env.FIREBASE_DATABASE_URL = config.firebaseDatabaseUrl;
  if (config.firebaseAuthToken) process.env.FIREBASE_AUTH_TOKEN = config.firebaseAuthToken;
}
