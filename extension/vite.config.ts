import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { loadBuildConfig } from "./src/build-config.ts";

const { moodlePatterns, optionalPatterns, serviceOrigin, publicKey } = loadBuildConfig(process.env);

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
