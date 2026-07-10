import { validateServiceOrigin } from "./api.ts";

export const EXAMPLE_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4Un68oQyXoqvVudBuIXKFaUgPz0LoJBuGzn+vLgy3eShy+LDcZQJLouFJF2cZiPq0ygrB9+84IiZAnMoKnYyEQv7+drzZZwwPRFsBYZ6KJXlC3/+YSQtcO7gexivwPVqMBWKnAEj1Qa4lWnjL1dccCeYkslAPr4comwguyfM3jxZMpokqVfElkTlaObxYKmOgs3K2ncpKTSQ3Ej+Xjmdi7np6f0SUXgWwElYcit4GOGDXmc05naCz1WPZ9iZsj6w1eWf7LuodmLh1lPkHDeajsrI+SIQ3m2krfGIu8kUzpV/cx0vk3/z+ozf2WbiD5A691Bs1lp/6OxMUu3L0HFX4QIDAQAB";

type Environment = Record<string, string | undefined>;

const split = (value: string | undefined, fallback: string[]) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? fallback;

export function validateMatchPattern(pattern: string): void {
  const match = /^(\*|http|https|file|ftp):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match || pattern === "<all_urls>") throw new Error(`Invalid Chrome match pattern: ${pattern}`);
  const host = match[2];
  if (host !== "*" && !/^(?:\*\.)?[a-z0-9.-]+$/i.test(host)) throw new Error(`Invalid Chrome match pattern: ${pattern}`);
}

export function loadBuildConfig(env: Environment) {
  const moodlePatterns = split(env.MOODLE_HOST_PATTERNS, ["https://moodle.example.invalid/*"]);
  const optionalPatterns = split(env.OPTIONAL_FRAME_PATTERNS, ["https://rise.example.invalid/*", "https://scorm.example.invalid/*"]);
  [...moodlePatterns, ...optionalPatterns].forEach(validateMatchPattern);
  const serviceOrigin = validateServiceOrigin(env.REVIEW_SERVICE_ORIGIN ?? "https://review.example.invalid").origin;
  const publicKey = env.EXTENSION_PUBLIC_KEY ?? EXAMPLE_PUBLIC_KEY;
  if (env.BUILD_MODE === "production") {
    if ([serviceOrigin, ...moodlePatterns, ...optionalPatterns].some((value) => value.includes("example.invalid"))) {
      throw new Error("Production build contains placeholder origins");
    }
    if (publicKey === EXAMPLE_PUBLIC_KEY) throw new Error("Production build contains the placeholder public key");
    if (publicKey.length < 300 || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) {
      throw new Error("Production build contains an invalid extension public key");
    }
  }
  return { moodlePatterns, optionalPatterns, serviceOrigin, publicKey };
}
