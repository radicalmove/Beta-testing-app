import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { buildSync } from "esbuild";
import { loadBuildConfig, loadExtensionVersion } from "./src/build-config.ts";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const lockJson = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8"));
const { version } = loadExtensionVersion(packageJson, lockJson);
const { moodlePatterns, optionalPatterns, serviceOrigin, publicKey, buildCommit } = loadBuildConfig(process.env);

function manifestPlugin(): Plugin {
  return {
    name: "configured-manifest",
    writeBundle() {
      const source = JSON.parse(readFileSync(resolve("public/manifest.json"), "utf8"));
      if (source.version !== "0.0.0") throw new Error("Public manifest version placeholder must remain 0.0.0");
      source.version = version;
      source.key = publicKey;
      source.host_permissions = [...moodlePatterns, `${serviceOrigin.replace(/\/$/, "")}/*`];
      source.optional_host_permissions = optionalPatterns;
      source.content_scripts[0].matches = moodlePatterns;
      writeFileSync(resolve("dist/manifest.json"), `${JSON.stringify(source, null, 2)}\n`);
    },
  };
}

function classicEntryBundlesPlugin(): Plugin {
  return {
    name: "classic-self-contained-extension-entries",
    closeBundle() {
      const define = {
        __MOODLE_PATTERNS__: JSON.stringify(moodlePatterns), __OPTIONAL_FRAME_PATTERNS__: JSON.stringify(optionalPatterns),
        __REVIEW_SERVICE_ORIGIN__: JSON.stringify(serviceOrigin), __EXTENSION_VERSION__: JSON.stringify(version), __BUILD_COMMIT__: JSON.stringify(buildCommit),
      };
      for (const entry of ["background", "content"]) buildSync({ entryPoints: [resolve(`src/${entry}.ts`)], outfile: resolve(`dist/${entry}.js`), bundle: true, format: "iife", platform: "browser", target: "chrome120", define, minify: true });
      rmSync(resolve("dist/chunks"), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  publicDir: false,
  define: {
    __MOODLE_PATTERNS__: JSON.stringify(moodlePatterns),
    __OPTIONAL_FRAME_PATTERNS__: JSON.stringify(optionalPatterns),
    __REVIEW_SERVICE_ORIGIN__: JSON.stringify(serviceOrigin),
    __EXTENSION_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  build: {
    target: "chrome120",
    rollupOptions: {
      input: { background: resolve("src/background.ts"), content: resolve("src/content.ts") },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
  plugins: [manifestPlugin(), classicEntryBundlesPlugin()],
});
