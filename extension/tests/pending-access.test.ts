import assert from "node:assert/strict";
import test from "node:test";

import { PendingAccessStore, PendingApprovalManager } from "../src/pending-access.ts";

class MemoryStorage {
  values: Record<string, unknown> = {};
  accessLevels: unknown[] = [];
  async setAccessLevel(value: unknown) { this.accessLevels.push(value); }
  async get(key: string) { return { [key]: this.values[key] }; }
  async set(value: Record<string, unknown>) { Object.assign(this.values, value); }
  async remove(key: string) { delete this.values[key]; }
}

const course = "123e4567-e89b-12d3-a456-426614174000";

test("pending access stays in trusted course-scoped extension storage", async () => {
  const storage = new MemoryStorage();
  const store = new PendingAccessStore(storage);
  await store.save({ courseHandle: course, email: " SME@Example.Test ", reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD" });

  assert.deepEqual(storage.accessLevels, [{ accessLevel: "TRUSTED_CONTEXTS" }]);
  assert.deepEqual(await store.get(course), {
    courseHandle: course,
    email: "sme@example.test",
    reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD",
  });
  assert.equal(JSON.stringify(storage.values).includes("pending-review-access"), true);
});

test("pending access rejects malformed or cross-course records and can be removed", async () => {
  const storage = new MemoryStorage();
  const store = new PendingAccessStore(storage);
  await store.save({ courseHandle: course, email: "sme@example.test", reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD" });
  const key = Object.keys(storage.values)[0]!;
  storage.values[key] = { courseHandle: "00000000-0000-4000-8000-000000000999", email: "sme@example.test", reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD" };
  assert.equal(await store.get(course), undefined);
  assert.equal(storage.values[key], undefined);

  await store.save({ courseHandle: course, email: "sme@example.test", reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD" });
  await store.remove(course);
  assert.equal(await store.get(course), undefined);
});

test("pending access fails closed when trusted storage cannot be established", async () => {
  const storage = new MemoryStorage();
  storage.setAccessLevel = async () => { throw new Error("denied"); };
  const store = new PendingAccessStore(storage);
  await assert.rejects(store.get(course), /trusted storage/i);
  await assert.rejects(store.save({ courseHandle: course, email: "sme@example.test", reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD" }), /trusted storage/i);
});

test("approval checks coalesce and consume hidden access only after successful resume", async () => {
  const storage = new MemoryStorage(); const store = new PendingAccessStore(storage);
  await store.save({ courseHandle: course, email: "sme@example.test", reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD" });
  let resumes = 0; let finish!: (value: any) => void;
  const pending = new Promise<any>((resolve) => { finish = resolve; });
  const connected: any[] = [];
  const manager = new PendingApprovalManager(store, async (record) => { resumes += 1; assert.equal(record.reconnectCredential, "AAAAA-BBBBB-CCCCC-DDDDD"); return pending; }, async (access) => { connected.push(access); });
  const first = manager.check(course); const second = manager.check(course);
  finish({ state: "approved", session: { apiToken: "token", expiresAt: 10 }, deviceCredential: "device" });
  assert.deepEqual(await Promise.all([first, second]), [{ state: "connected" }, { state: "connected" }]);
  assert.equal(resumes, 1); assert.equal(connected.length, 1); assert.equal(await store.get(course), undefined);
});

test("approval check keeps hidden access while membership is pending or temporarily unavailable", async () => {
  for (const outcome of [{ state: "pending" }, new Error("Unable to verify reviewer access")]) {
    const storage = new MemoryStorage(); const store = new PendingAccessStore(storage);
    await store.save({ courseHandle: course, email: "sme@example.test", reconnectCredential: "AAAAA-BBBBB-CCCCC-DDDDD" });
    const manager = new PendingApprovalManager(store, async () => { if (outcome instanceof Error) throw outcome; return outcome as any; }, async () => undefined);
    assert.deepEqual(await manager.check(course), { state: "pending" });
    assert.ok(await store.get(course));
  }
});
