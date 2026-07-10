import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const split = (value: string | undefined, fallback: string[]) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? fallback;
const moodlePatterns = split(process.env.MOODLE_HOST_PATTERNS, ["https://moodle.example.invalid/*"]);
const optionalPatterns = split(process.env.OPTIONAL_FRAME_PATTERNS, ["https://rise.example.invalid/*", "https://scorm.example.invalid/*"]);
const serviceOrigin = process.env.REVIEW_SERVICE_ORIGIN ?? "https://review.example.invalid";
const publicKey = process.env.EXTENSION_PUBLIC_KEY ?? "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4Un68oQyXoqvVudBuIXKFaUgPz0LoJBuGzn+vLgy3eShy+LDcZQJLouFJF2cZiPq0ygrB9+84IiZAnMoKnYyEQv7+drzZZwwPRFsBYZ6KJXlC3/+YSQtcO7gexivwPVqMBWKnAEj1Qa4lWnjL1dccCeYkslAPr4comwguyfM3jxZMpokqVfElkTlaObxYKmOgs3K2ncpKTSQ3Ej+Xjmdi7np6f0SUXgWwElYcit4GOGDXmc05naCz1WPZ9iZsj6w1eWf7LuodmLh1lPkHDeajsrI+SIQ3m2krfGIu8kUzpV/cx0vk3/z+ozf2WbiD5A691Bs1lp/6OxMUu3L0HFX4QIDAQAB";

function manifestPlugin(): Plugin {
  return {
    name: "configured-manifest",
    writeBundle() {
      const source = JSON.parse(readFileSync(resolve("public/manifest.json"), "utf8"));
      source.key = publicKey;
      source.host_permissions = [...moodlePatterns, `${serviceOrigin.replace(/\/$/, "")}/*`];
      source.optional_host_permissions = optionalPatterns;
      source.content_scripts[0].matches = moodlePatterns;
      writeFileSync(resolve("dist/manifest.json"), `${JSON.stringify(source, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  publicDir: false,
  define: {
    __MOODLE_PATTERNS__: JSON.stringify(moodlePatterns),
    __OPTIONAL_FRAME_PATTERNS__: JSON.stringify(optionalPatterns),
  },
  build: {
    target: "chrome120",
    rollupOptions: {
      input: { background: resolve("src/background.ts"), content: resolve("src/content.ts") },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
  plugins: [manifestPlugin()],
});
