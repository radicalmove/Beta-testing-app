import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadBuildConfig } from "../src/build-config.ts";

test("generated manifest keeps optional hosts out of static injection", () => {
  execFileSync(process.execPath, ["./node_modules/vite/bin/vite.js", "build"], { stdio: "pipe" });
  const manifest = JSON.parse(readFileSync(new URL("../dist/manifest.json", import.meta.url), "utf8"));
  const expected = loadBuildConfig(process.env);

  assert.deepEqual(manifest.content_scripts[0].matches, expected.moodlePatterns);
  assert.deepEqual(manifest.optional_host_permissions, expected.optionalPatterns);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.content_scripts[0].match_about_blank, true);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback, true);
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.deepEqual(manifest.permissions.sort(), ["identity", "scripting", "storage", "webNavigation"]);
});
