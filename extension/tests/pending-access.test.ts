import assert from "node:assert/strict";
import test from "node:test";

import { PendingAccessStore } from "../src/pending-access.ts";

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
