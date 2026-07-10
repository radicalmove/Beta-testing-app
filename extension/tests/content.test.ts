import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { bootstrapContentScript, createLifecycleController, isConfiguredFrame } from "../src/content.ts";

test("content activates on configured Moodle patterns", () => {
  assert.equal(isConfiguredFrame("https://moodle.example.invalid/course/view.php?id=1", ["https://moodle.example.invalid/*"], []), true);
  assert.equal(isConfiguredFrame("https://unrelated.example/course/view.php?id=1", ["https://moodle.example.invalid/*"], []), false);
});

test("lifecycle teardown restores history and permits a clean restart without duplicate listeners", () => {
  const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" });
  const originalPush = window.history.pushState;
  let refreshes = 0;
  const first = createLifecycleController(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, () => { refreshes += 1; }, 0);
  assert.notEqual(window.history.pushState, originalPush);
  first.teardown();
  assert.equal(window.history.pushState, originalPush);
  const second = createLifecycleController(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, () => { refreshes += 1; }, 0);
  window.dispatchEvent(new window.Event("popstate"));
  second.flush();
  assert.equal(refreshes, 1);
  second.teardown();
});

test("Chrome wildcard host patterns match the root host and subdomains", () => {
  const patterns = ["https://*.example.com/*"];
  assert.equal(isConfiguredFrame("https://example.com/course", patterns, []), true);
  assert.equal(isConfiguredFrame("https://learn.example.com/course", patterns, []), true);
  assert.equal(isConfiguredFrame("https://notexample.com/course", patterns, []), false);
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

test("real content-script startup does not require chrome.permissions", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalChrome = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  const originalMoodle = (globalThis as typeof globalThis & { __MOODLE_PATTERNS__?: string[] }).__MOODLE_PATTERNS__;
  const originalOptional = (globalThis as typeof globalThis & { __OPTIONAL_FRAME_PATTERNS__?: string[] }).__OPTIONAL_FRAME_PATTERNS__;
  const markers = new Set<string>();
  let bootstraps = 0;
  try {
    Object.assign(globalThis, {
      window: { location: { href: "https://moodle.example.invalid/course/view.php?id=1" } },
      document: {
        documentElement: {
          hasAttribute: (name: string) => markers.has(name),
          setAttribute: (name: string) => { markers.add(name); },
          dispatchEvent: () => { bootstraps += 1; },
        },
      },
      chrome: { runtime: {} },
      __MOODLE_PATTERNS__: ["https://moodle.example.invalid/*"],
      __OPTIONAL_FRAME_PATTERNS__: ["https://rise.example.invalid/*"],
    });
    await import(`../src/content.ts?startup=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(bootstraps, 1);
  } finally {
    Object.assign(globalThis, {
      window: originalWindow,
      document: originalDocument,
      chrome: originalChrome,
      __MOODLE_PATTERNS__: originalMoodle,
      __OPTIONAL_FRAME_PATTERNS__: originalOptional,
    });
  }
});
