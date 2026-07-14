import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { loadBuildCommit, loadBuildConfig, loadExtensionVersion } from "../src/build-config.ts";

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
    BUILD_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    ...overrides,
  };
}

test("validates canonical Chromium extension versions", () => {
  const lock = (version: string) => ({ version, packages: { "": { version } } });
  assert.equal(loadExtensionVersion({ version: "0.2.0" }, lock("0.2.0")).version, "0.2.0");
  assert.equal(loadExtensionVersion({ version: "65535.0.65535" }, lock("65535.0.65535")).version, "65535.0.65535");
  for (const version of ["0.0.0", "00.2.0", "0.02.0", "0.2.00", "0.2", "0.2.0.1", "+0.2.0", "0.-2.0", "0.two.0", "65536.0.0", "0.65536.0", "0.0.65536"]) {
    assert.throws(() => loadExtensionVersion({ version }, lock(version)), /version/i, version);
  }
});

test("canonical package and lock versions match while the manifest remains a placeholder", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lockJson = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));
  assert.equal(packageJson.version, "0.4.20");
  assert.equal(lockJson.version, packageJson.version);
  assert.equal(lockJson.packages[""].version, packageJson.version);
  assert.equal(manifest.version, "0.0.0");
  assert.equal(loadExtensionVersion(packageJson, lockJson).version, packageJson.version);
  assert.throws(() => loadExtensionVersion(packageJson, { ...lockJson, version: "0.2.0" }), /mismatch/i);
});

test("generated manifest version equals the canonical package version", async () => {
  await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
  await execFileAsync("npm", ["run", "build"], { cwd: new URL("..", import.meta.url) });
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../dist/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, packageJson.version);
});

test("production validates a full build commit and development uses the zero commit", () => {
  assert.equal(loadBuildCommit("development", undefined), "0000000000000000000000000000000000000000");
  assert.equal(loadBuildCommit("production", "0123456789abcdef0123456789abcdef01234567"), "0123456789abcdef0123456789abcdef01234567");
  for (const commit of [undefined, "", "abc1234", "g123456789abcdef0123456789abcdef01234567", "0123456789ABCDEF0123456789ABCDEF01234567", "0123456789abcdef0123456789abcdef012345678"]) {
    assert.throws(() => loadBuildCommit("production", commit), /build_commit/i);
  }
});

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
