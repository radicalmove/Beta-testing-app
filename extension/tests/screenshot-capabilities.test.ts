import assert from "node:assert/strict";
import test from "node:test";

import { ScreenshotCapabilities, type SessionStorageArea } from "../src/screenshot-capabilities.ts";

class FakeSessionStorage implements SessionStorageArea {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(value: Record<string, unknown>) { Object.assign(this.data, value); }
}

const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;

test("capability survives a worker restart through shared session storage", async () => {
  const storage = new FakeSessionStorage();
  await new ScreenshotCapabilities(storage, { now: () => 100 }).grant(id(1), 7, id(90));
  const restarted = new ScreenshotCapabilities(storage, { now: () => 101 });
  assert.deepEqual(await restarted.claim(id(1), 7, id(90)), { tabId: 7, courseId: id(90), createdAt: 100, expiresAt: 600_100 });
});

test("expired capability is rejected and purged", async () => {
  const storage = new FakeSessionStorage();
  const first = new ScreenshotCapabilities(storage, { now: () => 100, ttlMs: 10 });
  await first.grant(id(1), 7, id(90));
  assert.equal(await new ScreenshotCapabilities(storage, { now: () => 111, ttlMs: 10 }).claim(id(1), 7, id(90)), undefined);
  assert.deepEqual(storage.data, { screenshotCapabilities: {} });
});

test("claim requires exact tab and course and concurrent claims allow only one", async () => {
  const storage = new FakeSessionStorage();
  const capabilities = new ScreenshotCapabilities(storage, { now: () => 100 });
  await capabilities.grant(id(1), 7, id(90));
  assert.equal(await capabilities.claim(id(1), 8, id(90)), undefined);
  assert.equal(await capabilities.claim(id(1), 7, id(91)), undefined);
  const claims = await Promise.all([capabilities.claim(id(1), 7, id(90)), capabilities.claim(id(1), 7, id(90))]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test("failed upload restoration is safe and permits one retry", async () => {
  const storage = new FakeSessionStorage();
  const capabilities = new ScreenshotCapabilities(storage, { now: () => 100 });
  await capabilities.grant(id(1), 7, id(90));
  const claimed = await capabilities.claim(id(1), 7, id(90));
  assert.ok(claimed);
  await capabilities.restore(id(1), claimed!);
  assert.ok(await capabilities.claim(id(1), 7, id(90)));
});

test("cancel is strictly bound and clears matching capability", async () => {
  const storage = new FakeSessionStorage();
  const capabilities = new ScreenshotCapabilities(storage, { now: () => 100 });
  await capabilities.grant(id(1), 7, id(90));
  assert.equal(await capabilities.cancel(id(1), 8, id(90)), false);
  assert.equal(await capabilities.cancel(id(1), 7, id(91)), false);
  assert.equal(await capabilities.cancel(id(1), 7, id(90)), true);
  assert.equal(await capabilities.claim(id(1), 7, id(90)), undefined);
});

test("capability collection is bounded by oldest creation time", async () => {
  const storage = new FakeSessionStorage();
  let now = 100;
  const capabilities = new ScreenshotCapabilities(storage, { now: () => now++, maxEntries: 2 });
  await capabilities.grant(id(1), 7, id(90));
  await capabilities.grant(id(2), 7, id(90));
  await capabilities.grant(id(3), 7, id(90));
  assert.equal(await capabilities.claim(id(1), 7, id(90)), undefined);
  assert.ok(await capabilities.claim(id(2), 7, id(90)));
  assert.ok(await capabilities.claim(id(3), 7, id(90)));
});
