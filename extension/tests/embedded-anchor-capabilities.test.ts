import assert from "node:assert/strict";
import test from "node:test";

import { EmbeddedAnchorCapabilities, type EmbeddedAnchorStorage } from "../src/embedded-anchor-capabilities.ts";

class MemoryStorage implements EmbeddedAnchorStorage {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(value: Record<string, unknown>) { Object.assign(this.data, structuredClone(value)); }
}

const uuid = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;
const binding = {
  tabId: 7, courseId: uuid(1), frameId: 12, workerInstanceId: uuid(2), generation: 4,
  pageUrl: "https://rise.example/lesson/index.html#/pages/one", pageTitle: "Page one",
  parentActivityUrl: "https://my.uconline.ac.nz/mod/scorm/player.php?a=9",
  courseUrl: "https://my.uconline.ac.nz/course/view.php?id=896",
  embeddedLocator: "#/pages/one",
  anchor: { anchor_type: "visual_pin" as const, css_selector: "#card", relative_x: 0.25, relative_y: 0.75 },
  interactionContext: null,
};

test("issues an opaque capability and stores no reviewer comment body", async () => {
  const storage = new MemoryStorage();
  const capabilities = new EmbeddedAnchorCapabilities(storage, { randomToken: () => "t".repeat(64), now: () => 100 });
  const token = await capabilities.issue(binding);
  assert.equal(token, "t".repeat(64));
  assert.ok(!JSON.stringify(storage.data).includes("reviewer body"));
  assert.ok(!token.includes(binding.pageUrl));
});

test("claim is exact, single-use, and survives a service-worker restart", async () => {
  const storage = new MemoryStorage();
  const token = await new EmbeddedAnchorCapabilities(storage, { randomToken: () => "a".repeat(64), now: () => 100 }).issue(binding);
  const restarted = new EmbeddedAnchorCapabilities(storage, { now: () => 101 });
  assert.equal(await restarted.claim(token, { tabId: 8, courseId: binding.courseId }), undefined);
  assert.equal(await restarted.claim(token, { tabId: 7, courseId: uuid(9) }), undefined);
  assert.deepEqual(await restarted.claim(token, { tabId: 7, courseId: binding.courseId }), { ...binding, createdAt: 100, expiresAt: 300_100 });
  assert.equal(await restarted.claim(token, { tabId: 7, courseId: binding.courseId }), undefined);
});

test("tampered, expired, and malformed capabilities fail closed", async () => {
  const storage = new MemoryStorage();
  const first = new EmbeddedAnchorCapabilities(storage, { randomToken: () => "b".repeat(64), now: () => 100, ttlMs: 10 });
  const token = await first.issue(binding);
  assert.equal(await first.claim(`${token}x`, { tabId: 7, courseId: binding.courseId }), undefined);
  const expired = new EmbeddedAnchorCapabilities(storage, { now: () => 111, ttlMs: 10 });
  assert.equal(await expired.claim(token, { tabId: 7, courseId: binding.courseId }), undefined);
  assert.deepEqual(storage.data, { embeddedAnchorCapabilities: {} });
});

test("stored page, title, parent, locator, and anchor claims are digest-bound", async () => {
  for (const mutate of [
    (claim: any) => { claim.pageUrl = "https://rise.example/forged"; },
    (claim: any) => { claim.pageTitle = "Forged"; },
    (claim: any) => { claim.parentActivityUrl = "https://my.uconline.ac.nz/mod/scorm/player.php?a=10"; },
    (claim: any) => { claim.embeddedLocator = "#/forged"; },
    (claim: any) => { claim.anchor.relative_x = 0.9; },
    (claim: any) => { claim.interactionContext = { version: 1, kind: "process", container: { block_id: "p", ordinal: 1, fingerprint: "Process" }, item: { ordinal: 2, count: 3, label: "Changed", control_key: "Go to slide 2" } }; },
  ]) {
    const storage = new MemoryStorage();
    const capabilities = new EmbeddedAnchorCapabilities(storage, { randomToken: () => "e".repeat(64), now: () => 100 });
    const token = await capabilities.issue(binding);
    mutate((storage.data.embeddedAnchorCapabilities as Record<string, any>)[token]);
    assert.equal(await capabilities.claim(token, { tabId: 7, courseId: binding.courseId }), undefined);
  }
});

test("concurrent claims serialize so exactly one succeeds", async () => {
  const storage = new MemoryStorage();
  const capabilities = new EmbeddedAnchorCapabilities(storage, { randomToken: () => "c".repeat(64), now: () => 100 });
  const token = await capabilities.issue(binding);
  const results = await Promise.all(Array.from({ length: 8 }, () => capabilities.claim(token, { tabId: 7, courseId: binding.courseId })));
  assert.equal(results.filter(Boolean).length, 1);
});

test("failed creation may restore an unexpired claim but success remains consumed", async () => {
  const storage = new MemoryStorage();
  let now = 100;
  const capabilities = new EmbeddedAnchorCapabilities(storage, { randomToken: () => "d".repeat(64), now: () => now, ttlMs: 10 });
  const token = await capabilities.issue(binding);
  const claimed = await capabilities.claim(token, { tabId: 7, courseId: binding.courseId });
  assert.ok(claimed);
  await capabilities.restore(token, claimed!);
  assert.ok(await capabilities.claim(token, { tabId: 7, courseId: binding.courseId }));
  assert.equal(await capabilities.claim(token, { tabId: 7, courseId: binding.courseId }), undefined);
  const token2 = await capabilities.issue(binding);
  const claimed2 = await capabilities.claim(token2, { tabId: 7, courseId: binding.courseId });
  now = 111;
  await capabilities.restore(token2, claimed2!);
  assert.equal(await capabilities.claim(token2, { tabId: 7, courseId: binding.courseId }), undefined);
});

test("parent activity is trusted Moodle context on the same course origin", async () => {
  const capabilities = new EmbeddedAnchorCapabilities(new MemoryStorage());
  await assert.rejects(() => capabilities.issue({ ...binding, parentActivityUrl: "https://evil.example/mod/scorm/player.php?a=9" }), /parent activity/i);
  await assert.rejects(() => capabilities.issue({ ...binding, courseUrl: "https://evil.example/course/view.php?id=896" }), /parent activity/i);
});

test("collection is bounded by oldest issue time", async () => {
  const storage = new MemoryStorage(); let now = 1; let token = 0;
  const capabilities = new EmbeddedAnchorCapabilities(storage, { now: () => now++, maxEntries: 2, randomToken: () => String(++token).padStart(64, "x") });
  const one = await capabilities.issue(binding); const two = await capabilities.issue(binding); const three = await capabilities.issue(binding);
  assert.equal(await capabilities.claim(one, { tabId: 7, courseId: binding.courseId }), undefined);
  assert.ok(await capabilities.claim(two, { tabId: 7, courseId: binding.courseId }));
  assert.ok(await capabilities.claim(three, { tabId: 7, courseId: binding.courseId }));
});

test("restoration also preserves the configured collection bound", async () => {
  const storage = new MemoryStorage(); let now = 1; let tokenNumber = 0;
  const capabilities = new EmbeddedAnchorCapabilities(storage, { now: () => now++, maxEntries: 2, randomToken: () => String(++tokenNumber).padStart(64, "r") });
  const one = await capabilities.issue(binding);
  const claimed = await capabilities.claim(one, { tabId: 7, courseId: binding.courseId });
  const two = await capabilities.issue(binding); const three = await capabilities.issue(binding);
  await capabilities.restore(one, claimed!);
  const stored = storage.data.embeddedAnchorCapabilities as Record<string, unknown>;
  assert.equal(Object.keys(stored).length, 2);
  assert.equal(await capabilities.claim(one, { tabId: 7, courseId: binding.courseId }), undefined);
  assert.ok(await capabilities.claim(two, { tabId: 7, courseId: binding.courseId }));
  assert.ok(await capabilities.claim(three, { tabId: 7, courseId: binding.courseId }));
});
