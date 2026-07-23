import assert from "node:assert/strict";
import test from "node:test";

import { EmbeddedAnchorCapabilities, type EmbeddedAnchorStorage } from "../src/embedded-anchor-capabilities.ts";

class MemoryStorage implements EmbeddedAnchorStorage {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(value: Record<string, unknown>) { Object.assign(this.data, structuredClone(value)); }
}

function alphabetiseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(alphabetiseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, alphabetiseObjectKeys(child)]),
  );
}

class ChromeLikeStorage extends MemoryStorage {
  override async set(value: Record<string, unknown>) {
    Object.assign(this.data, structuredClone(alphabetiseObjectKeys(value)));
  }
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

async function legacyDigest(value: Omit<typeof binding, "interactionContext">): Promise<string> {
  const anchor = JSON.stringify([value.anchor.anchor_type, value.anchor.css_selector, value.anchor.relative_x, value.anchor.relative_y]);
  const canonical = JSON.stringify([
    value.tabId, value.courseId, value.frameId, value.workerInstanceId, value.generation,
    value.pageUrl, value.pageTitle, value.parentActivityUrl, value.courseUrl, value.embeddedLocator, anchor,
  ]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

test("claims a capability containing a real Rise process interaction context", async () => {
  const storage = new MemoryStorage();
  const processBinding = {
    ...binding,
    interactionContext: {
      version: 1 as const,
      kind: "process" as const,
      container: {
        block_id: "cmq675iis02u407kahhc34z6v",
        ordinal: 1,
        fingerprint: "Carousel",
      },
      item: {
        ordinal: 3,
        count: 5,
        label: "Criminal justice agencies",
        control_key: "Go to slide 3",
      },
    },
  };
  const token = await new EmbeddedAnchorCapabilities(storage, {
    randomToken: () => "p".repeat(64),
    now: () => 100,
  }).issue(processBinding);

  assert.deepEqual(
    await new EmbeddedAnchorCapabilities(storage, { now: () => 101 }).claim(token, {
      tabId: processBinding.tabId,
      courseId: processBinding.courseId,
    }),
    { ...processBinding, createdAt: 100, expiresAt: 300_100 },
  );
});

test("interaction capability digest survives Chrome storage reordering object keys", async () => {
  const storage = new ChromeLikeStorage();
  const processBinding = {
    ...binding,
    interactionContext: {
      version: 1 as const,
      kind: "process" as const,
      container: {
        block_id: "cmq675iis02u407kahhc34z6v",
        ordinal: 1,
        fingerprint: "Carousel",
      },
      item: {
        ordinal: 3,
        count: 5,
        label: "Criminal justice agencies",
        control_key: "Go to slide 3",
      },
    },
  };
  const token = await new EmbeddedAnchorCapabilities(storage, {
    randomToken: () => "r".repeat(64),
    now: () => 100,
  }).issue(processBinding);

  assert.ok(
    await new EmbeddedAnchorCapabilities(storage, { now: () => 101 }).claim(token, {
      tabId: processBinding.tabId,
      courseId: processBinding.courseId,
    }),
  );
});

test("a pre-interaction-context capability survives an extension upgrade", async () => {
  const storage = new MemoryStorage();
  const token = "l".repeat(64);
  const { interactionContext: _newField, ...legacyBinding } = binding;
  storage.data.embeddedAnchorCapabilities = {
    [token]: {
      ...legacyBinding,
      anchorDigest: await legacyDigest(legacyBinding),
      createdAt: 100,
      expiresAt: 300_100,
    },
  };
  const upgraded = new EmbeddedAnchorCapabilities(storage, { now: () => 101 });
  assert.deepEqual(await upgraded.claim(token, { tabId: 7, courseId: binding.courseId }), {
    ...binding,
    createdAt: 100,
    expiresAt: 300_100,
  });
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
