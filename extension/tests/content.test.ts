import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { bootstrapContentScript, createLifecycleController, isConfiguredFrame, startCourseReview } from "../src/content.ts";

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

test("real bootstrap replaces its owned instance and recovers from a stale marker", async () => {
  const markers = new Set<string>();
  const root = {
    hasAttribute: (name: string) => markers.has(name),
    setAttribute: (name: string) => { markers.add(name); },
    removeAttribute: (name: string) => { markers.delete(name); },
  };
  const documentLike = {
    documentElement: root,
  };
  let injections = 0;
  let cleanups = 0;
  const options = {
    url: "https://moodle.example.invalid/course/view.php?id=1",
    document: documentLike,
    moodlePatterns: ["https://moodle.example.invalid/*"],
    optionalFramePatterns: [],
    inject: () => { injections += 1; return () => { cleanups += 1; }; },
  };

  assert.equal(await bootstrapContentScript(options), true);
  assert.equal(await bootstrapContentScript(options), true);
  assert.equal(injections, 2);
  assert.equal(cleanups, 1);
  assert.equal(markers.has("data-moodle-review-extension"), true);

  for (const symbol of Object.getOwnPropertySymbols(root)) delete (root as Record<symbol, unknown>)[symbol];
  assert.equal(await bootstrapContentScript(options), true);
  assert.equal(injections, 3);
  assert.equal(markers.has("data-moodle-review-extension"), true);
});

test("bootstrap wired to the real start entry tears down the old overlay instance", async () => {
  const window = new Window({ url: "https://moodle.example.invalid/course/view.php?id=1" });
  window.document.body.innerHTML = "<h1>Law</h1>";
  let messages = 0;
  const runtime = { sendMessage: (_message: unknown, callback: (response: { ok: boolean }) => void) => { messages += 1; callback({ ok: true }); } };
  const options = {
    url: window.location.href,
    document: window.document as unknown as Document,
    moodlePatterns: ["https://moodle.example.invalid/*"],
    optionalFramePatterns: [] as string[],
    inject: () => startCourseReview(window as unknown as globalThis.Window & typeof globalThis, window.document as unknown as Document, runtime),
  };

  await bootstrapContentScript(options);
  const firstHistoryPatch = window.history.pushState;
  await bootstrapContentScript(options);

  assert.equal(window.document.querySelectorAll("#moodle-course-review-overlay").length, 1);
  assert.notEqual(window.history.pushState, firstHistoryPatch);
  assert.equal(messages, 2);
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
