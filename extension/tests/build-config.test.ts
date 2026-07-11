import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { loadBuildConfig } from "../src/build-config.ts";

const execFileAsync = promisify(execFile);

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    BUILD_MODE: "production",
    REVIEW_SERVICE_ORIGIN: "https://review.example.org",
    MOODLE_HOST_PATTERNS: "https://moodle.example.org/*",
    OPTIONAL_FRAME_PATTERNS: "https://*.content.example.org/*",
    EXTENSION_PUBLIC_KEY: publicKey.toString("base64"),
    ...overrides,
  };
}

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

test("build mode is an explicit development or production enum", () => {
  assert.equal(loadBuildConfig({}).buildMode, "development");
  assert.equal(loadBuildConfig({ BUILD_MODE: "development" }).buildMode, "development");
  assert.equal(loadBuildConfig(productionEnv()).buildMode, "production");
  assert.throws(() => loadBuildConfig({ BUILD_MODE: "prodution" }), /build_mode/i);
  assert.throws(() => loadBuildConfig({ BUILD_MODE: "" }), /build_mode/i);
});

test("production requires an HTTPS service origin while development permits localhost HTTP", () => {
  assert.throws(() => loadBuildConfig(productionEnv({ REVIEW_SERVICE_ORIGIN: "http://review.example.org" })), /https/i);
  assert.equal(loadBuildConfig({ REVIEW_SERVICE_ORIGIN: "http://localhost:8000" }).serviceOrigin, "http://localhost:8000");
});

test("production requires HTTPS match patterns with concrete approved hosts", () => {
  for (const pattern of [
    "http://moodle.example.org/*",
    "*://moodle.example.org/*",
    "https://*/*",
    "*://*/*",
    "https://./*",
    "https://foo..example.org/*",
    "https://-bad.example.org/*",
    "https://*../*",
    "https://*.com/*",
  ]) {
    assert.throws(() => loadBuildConfig(productionEnv({ MOODLE_HOST_PATTERNS: pattern })), /production.*match pattern|https.*host/i);
  }
  assert.deepEqual(loadBuildConfig(productionEnv()).optionalPatterns, ["https://*.content.example.org/*"]);
});

test("production extension key must be a valid RSA SPKI public key of at least 2048 bits", () => {
  const valid = productionEnv();
  assert.equal(loadBuildConfig(valid).publicKey, valid.EXTENSION_PUBLIC_KEY);

  const { publicKey: weakRsa } = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const { publicKey: ec } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  assert.throws(() => loadBuildConfig(productionEnv({ EXTENSION_PUBLIC_KEY: weakRsa.toString("base64") })), /2048|public key/i);
  assert.throws(() => loadBuildConfig(productionEnv({ EXTENSION_PUBLIC_KEY: ec.toString("base64") })), /rsa|public key/i);
  assert.throws(() => loadBuildConfig(productionEnv({ EXTENSION_PUBLIC_KEY: Buffer.alloc(300).toString("base64") })), /public key/i);
  assert.throws(() => loadBuildConfig(productionEnv({ EXTENSION_PUBLIC_KEY: `${valid.EXTENSION_PUBLIC_KEY}A` })), /public key/i);
  assert.throws(() => loadBuildConfig(productionEnv({ EXTENSION_PUBLIC_KEY: `${valid.EXTENSION_PUBLIC_KEY}AAAA` })), /public key/i);
});

test("production background bundle uses the configured service origin", async () => {
  const env = productionEnv({ REVIEW_SERVICE_ORIGIN: "https://fld-mini.tail4ccaba.ts.net" });
  await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
  await execFileAsync("npm", ["run", "build"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env },
  });
  const background = await readFile(new URL("../dist/background.js", import.meta.url), "utf8");
  assert.match(background, /fld-mini\.tail4ccaba\.ts\.net/);
  assert.doesNotMatch(background, /review\.example\.invalid/);
  assert.doesNotMatch(background, /storage\.local\.get\(["']serviceOrigin["']/);
});
