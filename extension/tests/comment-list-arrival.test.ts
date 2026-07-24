import assert from "node:assert/strict";
import test from "node:test";

import { clearCommentListArrival, peekCommentListArrival, writeCommentListArrival } from "../src/comment-list-arrival.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const input = {
  course_url: "https://moodle.example/course/view.php?id=7",
  page_url: "https://rise.example/lesson#/tabs/2",
  comment_id: "00000000-0000-4000-8000-000000000001",
  status: "resolved" as const,
};

test("comment-list arrival overwrites, peeks without consuming, and token-clears", () => {
  const storage = new MemoryStorage();
  const first = writeCommentListArrival(storage, input, { now: () => 1_000, token: () => "first-token" })!;
  const second = writeCommentListArrival(storage, { ...input, page_url: "https://rise.example/lesson#/process/3" }, { now: () => 2_000, token: () => "second-token" })!;
  assert.equal(first.token, "first-token");
  assert.equal(second.token, "second-token");
  assert.deepEqual(peekCommentListArrival(storage, () => 2_001), second);
  assert.deepEqual(peekCommentListArrival(storage, () => 2_002), second);
  clearCommentListArrival(storage, first.token);
  assert.deepEqual(peekCommentListArrival(storage, () => 2_003), second);
  clearCommentListArrival(storage, second.token);
  assert.equal(peekCommentListArrival(storage, () => 2_004), undefined);
});

test("comment-list arrival preserves exact URLs and expires after five minutes", () => {
  const storage = new MemoryStorage();
  const saved = writeCommentListArrival(storage, input, { now: () => 10_000, token: () => "exact-token" })!;
  assert.equal(saved.course_url, input.course_url);
  assert.equal(saved.page_url, input.page_url);
  assert.deepEqual(peekCommentListArrival(storage, () => 309_999), saved);
  assert.equal(peekCommentListArrival(storage, () => 310_001), undefined);
  assert.equal(storage.values.size, 0);
});

test("comment-list arrival rejects every malformed record invariant", () => {
  const malformed = [
    {},
    { version: 2, ...input, created_at: 1, token: "token" },
    { version: 1, ...input, course_url: "", created_at: 1, token: "token" },
    { version: 1, ...input, page_url: "", created_at: 1, token: "token" },
    { version: 1, ...input, comment_id: "", created_at: 1, token: "token" },
    { version: 1, ...input, status: "pending", created_at: 1, token: "token" },
    { version: 1, ...input, created_at: Number.POSITIVE_INFINITY, token: "token" },
    { version: 1, ...input, created_at: 1, token: "" },
  ];
  for (const value of malformed) {
    const storage = new MemoryStorage();
    storage.setItem("moodle-review:comment-list-arrival", JSON.stringify(value));
    assert.equal(peekCommentListArrival(storage, () => 2), undefined);
    assert.equal(storage.values.size, 0);
  }
});

test("comment-list arrival tolerates unavailable and throwing storage", () => {
  const throwing = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  assert.equal(writeCommentListArrival(undefined, input), undefined);
  assert.equal(peekCommentListArrival(undefined), undefined);
  assert.doesNotThrow(() => clearCommentListArrival(undefined, "token"));
  assert.equal(writeCommentListArrival(throwing, input), undefined);
  assert.equal(peekCommentListArrival(throwing), undefined);
  assert.doesNotThrow(() => clearCommentListArrival(throwing, "token"));
});

test("comment-list arrival generates non-empty unique default tokens", () => {
  const first = writeCommentListArrival(new MemoryStorage(), input)!;
  const second = writeCommentListArrival(new MemoryStorage(), input)!;
  assert.ok(first.token);
  assert.ok(second.token);
  assert.notEqual(first.token, second.token);
});
