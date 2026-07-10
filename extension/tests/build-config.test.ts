import assert from "node:assert/strict";
import test from "node:test";

import { loadBuildConfig } from "../src/build-config.ts";

test("build config validates Chrome match patterns including wildcard root hosts", () => {
  const config = loadBuildConfig({
    MOODLE_HOST_PATTERNS: "https://*.example.com/*",
    OPTIONAL_FRAME_PATTERNS: "https://rise.example.com/*",
  });
  assert.deepEqual(config.moodlePatterns, ["https://*.example.com/*"]);
  assert.throws(() => loadBuildConfig({ MOODLE_HOST_PATTERNS: "https://example.com" }), /match pattern/i);
  assert.throws(() => loadBuildConfig({ MOODLE_HOST_PATTERNS: "<all_urls>" }), /match pattern/i);
});

test("production builds reject placeholder service origins and public keys", () => {
  assert.throws(() => loadBuildConfig({ BUILD_MODE: "production" }), /placeholder/i);
  assert.throws(() => loadBuildConfig({
    BUILD_MODE: "production",
    REVIEW_SERVICE_ORIGIN: "https://review.example.org",
    MOODLE_HOST_PATTERNS: "https://moodle.example.org/*",
    OPTIONAL_FRAME_PATTERNS: "https://rise.example.org/*",
  }), /public key/i);
  assert.throws(() => loadBuildConfig({
    BUILD_MODE: "production",
    REVIEW_SERVICE_ORIGIN: "https://review.example.org",
    MOODLE_HOST_PATTERNS: "https://moodle.example.org/*",
    OPTIONAL_FRAME_PATTERNS: "https://rise.example.org/*",
    EXTENSION_PUBLIC_KEY: "not-a-public-key",
  }), /public key/i);
});
