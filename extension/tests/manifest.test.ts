import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("generated manifest keeps optional hosts out of static injection", () => {
  execFileSync(process.execPath, ["./node_modules/vite/bin/vite.js", "build"], { stdio: "pipe" });
  const manifest = JSON.parse(readFileSync(new URL("../dist/manifest.json", import.meta.url), "utf8"));

  assert.deepEqual(manifest.content_scripts[0].matches, ["https://moodle.example.invalid/*"]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://rise.example.invalid/*",
    "https://scorm.example.invalid/*",
  ]);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.content_scripts[0].match_about_blank, true);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback, true);
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.deepEqual(manifest.permissions.sort(), ["identity", "scripting", "storage", "webNavigation"]);
});
