import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapContentScript, isConfiguredFrame } from "../src/content.ts";

test("content activates on configured Moodle patterns", () => {
  assert.equal(isConfiguredFrame("https://moodle.example.invalid/course/view.php?id=1", ["https://moodle.example.invalid/*"], []), true);
  assert.equal(isConfiguredFrame("https://unrelated.example/course/view.php?id=1", ["https://moodle.example.invalid/*"], []), false);
});

test("content activates in an optional frame only when host permission is granted", () => {
  const optional = ["https://rise.example.invalid/*"];
  assert.equal(isConfiguredFrame("https://rise.example.invalid/scorm/index.html", [], optional, () => true), true);
  assert.equal(isConfiguredFrame("https://rise.example.invalid/scorm/index.html", [], optional, () => false), false);
});

test("bootstrap injects only once", async () => {
  const markers = new Set<string>();
  const documentLike = {
    documentElement: {
      hasAttribute: (name: string) => markers.has(name),
      setAttribute: (name: string) => { markers.add(name); },
    },
  };
  let injections = 0;
  const options = {
    url: "https://moodle.example.invalid/course/view.php?id=1",
    document: documentLike,
    moodlePatterns: ["https://moodle.example.invalid/*"],
    optionalFramePatterns: [],
    inject: () => { injections += 1; },
  };

  assert.equal(await bootstrapContentScript(options), true);
  assert.equal(await bootstrapContentScript(options), false);
  assert.equal(injections, 1);
});
