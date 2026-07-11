import { createPublicKey } from "node:crypto";
import { validateServiceOrigin } from "./api.ts";

export const EXAMPLE_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4Un68oQyXoqvVudBuIXKFaUgPz0LoJBuGzn+vLgy3eShy+LDcZQJLouFJF2cZiPq0ygrB9+84IiZAnMoKnYyEQv7+drzZZwwPRFsBYZ6KJXlC3/+YSQtcO7gexivwPVqMBWKnAEj1Qa4lWnjL1dccCeYkslAPr4comwguyfM3jxZMpokqVfElkTlaObxYKmOgs3K2ncpKTSQ3Ej+Xjmdi7np6f0SUXgWwElYcit4GOGDXmc05naCz1WPZ9iZsj6w1eWf7LuodmLh1lPkHDeajsrI+SIQ3m2krfGIu8kUzpV/cx0vk3/z+ozf2WbiD5A691Bs1lp/6OxMUu3L0HFX4QIDAQAB";

type Environment = Record<string, string | undefined>;

type VersionDocument = { version?: unknown; packages?: Record<string, { version?: unknown }> };

export function loadExtensionVersion(packageJson: VersionDocument, lockJson: VersionDocument): { version: string } {
  const version = packageJson.version;
  const lockVersion = lockJson.version;
  const rootLockVersion = lockJson.packages?.[""]?.version;
  if (typeof version !== "string" || version === "0.0.0" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error("Extension version must contain three canonical numeric Chromium components");
  }
  if (version.split(".").some((component) => Number(component) > 65535)) {
    throw new Error("Extension version components must be between 0 and 65535");
  }
  if (lockVersion !== version || rootLockVersion !== version) {
    throw new Error("Extension package and lock version mismatch");
  }
  return { version };
}

export function loadBuildCommit(buildMode: "development" | "production", value: string | undefined): string {
  if (buildMode === "development") return "0000000000000000000000000000000000000000";
  if (!value || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("BUILD_COMMIT must be a full 40-character lowercase hexadecimal commit");
  }
  return value;
}

const split = (value: string | undefined, fallback: string[]) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? fallback;

function validateProductionPublicKey(publicKey: string): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) {
    throw new Error("Production build contains an invalid extension public key");
  }
  try {
    const decoded = Buffer.from(publicKey, "base64");
    if (decoded.toString("base64") !== publicKey) throw new Error("key is not canonical base64");
    const key = createPublicKey({ key: decoded, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "rsa") throw new Error("key is not RSA");
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("RSA key is smaller than 2048 bits");
    const canonicalDer = key.export({ format: "der", type: "spki" });
    if (!decoded.equals(canonicalDer)) throw new Error("key contains data outside the SPKI DER object");
  } catch (error) {
    throw new Error("Production extension public key must be a valid RSA SPKI key of at least 2048 bits", { cause: error });
  }
}

function validateProductionMatchPattern(pattern: string): void {
  const match = /^https:\/\/([^/]+)\//.exec(pattern);
  const host = match?.[1];
  const concreteHost = host?.startsWith("*.") ? host.slice(2) : host;
  const labels = concreteHost?.split(".") ?? [];
  const validDnsHost = Boolean(concreteHost)
    && concreteHost!.length <= 253
    && labels.length >= 2
    && labels.every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
  if (!match || !validDnsHost) {
    throw new Error(`Production match pattern must use HTTPS with a concrete host: ${pattern}`);
  }
}

export function validateMatchPattern(pattern: string): void {
  const match = /^(\*|http|https|file|ftp):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match || pattern === "<all_urls>") throw new Error(`Invalid Chrome match pattern: ${pattern}`);
  const host = match[2];
  if (host !== "*" && !/^(?:\*\.)?[a-z0-9.-]+$/i.test(host)) throw new Error(`Invalid Chrome match pattern: ${pattern}`);
}

export function loadBuildConfig(env: Environment) {
  const buildMode = env.BUILD_MODE ?? "development";
  if (buildMode !== "development" && buildMode !== "production") {
    throw new Error("BUILD_MODE must be either development or production");
  }
  const moodlePatterns = split(env.MOODLE_HOST_PATTERNS, ["https://moodle.example.invalid/*"]);
  const optionalPatterns = split(env.OPTIONAL_FRAME_PATTERNS, ["https://rise.example.invalid/*", "https://scorm.example.invalid/*"]);
  [...moodlePatterns, ...optionalPatterns].forEach(validateMatchPattern);
  const serviceOrigin = validateServiceOrigin(env.REVIEW_SERVICE_ORIGIN ?? "https://review.example.invalid").origin;
  const publicKey = env.EXTENSION_PUBLIC_KEY ?? EXAMPLE_PUBLIC_KEY;
  if (buildMode === "production") {
    if (!serviceOrigin.startsWith("https://")) throw new Error("Production review service origin must use HTTPS");
    [...moodlePatterns, ...optionalPatterns].forEach(validateProductionMatchPattern);
    if ([serviceOrigin, ...moodlePatterns, ...optionalPatterns].some((value) => value.includes("example.invalid"))) {
      throw new Error("Production build contains placeholder origins");
    }
    if (publicKey === EXAMPLE_PUBLIC_KEY) throw new Error("Production build contains the placeholder public key");
    validateProductionPublicKey(publicKey);
  }
  const buildCommit = loadBuildCommit(buildMode, env.BUILD_COMMIT);
  return { buildMode, moodlePatterns, optionalPatterns, serviceOrigin, publicKey, buildCommit };
}
