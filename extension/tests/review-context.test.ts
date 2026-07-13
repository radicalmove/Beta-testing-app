import assert from "node:assert/strict";
import test from "node:test";
import { ReviewContextCache, validateContextMessage } from "../src/review-context.ts";

const top = { id: "extension", frameId: 0, tab: { id: 4 }, url: "https://learn.example/mod/scorm/player.php?a=9&cmid=22" };
const frame = { id: "extension", frameId: 3, tab: { id: 4 }, url: "https://rise.example/activity#/lesson/2" };
const context = { id: "123e4567-e89b-12d3-a456-426614174000", title: "Law", course_url: "https://learn.example/course/view.php?id=7", parent_activity_url: top.url };

test("successful top resolution registers the minimum frame review context without a token", () => {
  const cache = new ReviewContextCache(60_000, () => 100); cache.register(top, context);
  assert.deepEqual(cache.obtain(frame), { course_id: context.id, course_title: "Law", parent_activity_url: top.url });
  assert.equal("token" in (cache.obtain(frame) as object), false);
});

test("context denies top frames, cross-tab frames, stale entries, and non-extension senders", () => {
  let now = 100; const cache = new ReviewContextCache(10, () => now); cache.register(top, context);
  assert.equal(cache.obtain(top), undefined);
  assert.equal(cache.obtain({ ...frame, tab: { id: 5 } }), undefined);
  assert.equal(cache.obtain({ ...frame, id: "page" }), undefined);
  now = 111; assert.equal(cache.obtain(frame), undefined);
});

test("registration requires a top frame and overwrites on the next top resolve", () => {
  const cache = new ReviewContextCache();
  assert.equal(cache.register(frame, context), false);
  assert.equal(cache.register(top, context), true);
  cache.register(top, { ...context, id: "223e4567-e89b-12d3-a456-426614174000", title: "Two" });
  assert.equal(cache.obtain(frame)?.course_title, "Two");
});

test("context control messages have strict empty schemas", () => {
  for (const type of ["GET_REVIEW_CONTEXT", "REVIEW_FRAME_READY", "GET_REVIEW_FRAME_STATUS"] as const) assert.deepEqual(validateContextMessage({ type }), { type });
  for (const value of [{ type: "GET_REVIEW_CONTEXT", token: "x" }, { type: "REVIEW_FRAME_READY", frameId: 4 }, null]) assert.throws(() => validateContextMessage(value));
});

test("frame coordination messages have strict typed schemas", () => {
  const capabilities = { contentBearing: true, wrapper: false, visible: true, area: 400000 };
  assert.deepEqual(validateContextMessage({ type: "REGISTER_REVIEW_FRAME", capabilities }), { type: "REGISTER_REVIEW_FRAME", capabilities });
  assert.deepEqual(validateContextMessage({ type: "RENEW_REVIEW_FRAME_LEASE", generation: 4 }), { type: "RENEW_REVIEW_FRAME_LEASE", generation: 4 });
  assert.deepEqual(validateContextMessage({ type: "ACK_REVIEW_FRAME_DORMANT", generation: 5 }), { type: "ACK_REVIEW_FRAME_DORMANT", generation: 5 });
  for (const invalid of [
    { type: "REGISTER_REVIEW_FRAME", capabilities: { ...capabilities, area: -1 } },
    { type: "RENEW_REVIEW_FRAME_LEASE", generation: "4" },
    { type: "ACK_REVIEW_FRAME_DORMANT", generation: 5, frameId: 2 },
  ]) assert.throws(() => validateContextMessage(invalid));
});

test("ready state is tab-scoped and cleared by tab removal", () => {
  const cache = new ReviewContextCache(); cache.register(top, context);
  assert.equal(cache.markReady(frame), true); assert.equal(cache.readyFrameCount(top), 1);
  cache.removeTab(4); assert.equal(cache.readyFrameCount(top), 0);
});

test("ready frame ids are unique, expire independently, and reset with context", () => {
  let now = 100;
  const cache = new ReviewContextCache(10, () => now);
  cache.register(top, context);
  assert.equal(cache.markReady(frame), true);
  assert.equal(cache.markReady(frame), true);
  assert.equal(cache.markReady({ ...frame, frameId: 8 }), true);
  assert.equal(cache.readyFrameCount(top), 2);
  now = 111;
  assert.equal(cache.readyFrameCount(top), 0);
  cache.register(top, context);
  assert.equal(cache.markReady(frame), true);
  cache.register(top, { ...context, title: "Fresh context" });
  assert.equal(cache.readyFrameCount(top), 0);
});

test("ready origins are deduplicated and valid activity slides the session TTL", () => {
  let now = 0; const cache = new ReviewContextCache(10, () => now); cache.register(top, context);
  cache.markReady(frame); cache.markReady({ ...frame, frameId: 8 });
  assert.deepEqual(cache.readyOrigins(top), ["https://rise.example"]);
  now = 9; assert.ok(cache.obtain(frame));
  now = 18; assert.ok(cache.obtain(frame));
});

test("trusted course binding survives a background worker restart", () => {
  const beforeRestart = new ReviewContextCache();
  beforeRestart.register(top, context);
  const stored = beforeRestart.exportTab(4);
  assert.deepEqual(stored, context);

  const afterRestart = new ReviewContextCache();
  assert.equal(afterRestart.restoreTab(4, "extension", stored!), true);
  assert.deepEqual(afterRestart.obtain(frame), { course_id: context.id, course_title: context.title, parent_activity_url: context.parent_activity_url });
});
