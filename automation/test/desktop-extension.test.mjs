import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Chrome extension has the required Full-Time and local-helper permissions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../chrome-extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.includes("https://fulltime.thefa.com/*"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:32187/*"));
  assert.equal(manifest.background.service_worker, "background.js");
});
