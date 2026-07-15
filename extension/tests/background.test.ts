import assert from "node:assert/strict";
import test from "node:test";

import { EmbeddedAnchorCapabilities, issueEmbeddedAnchorFromWorker, type EmbeddedAnchorStorage } from "../src/embedded-anchor-capabilities.ts";
import { EmbeddedCommentNavigation, type EmbeddedNavigationStorage } from "../src/embedded-comment-navigation.ts";

class Storage implements EmbeddedAnchorStorage {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(value: Record<string, unknown>) { Object.assign(this.data, structuredClone(value)); }
}
const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;
const event = {
  protocol: 1 as const, type: "SCORM_ANCHOR_CAPTURED" as const, request_id: id(1), worker_instance_id: id(2), generation: 4, course_id: id(3),
  page_url: "https://rise.example/index.html#moodle-review-page=Introduction",
  payload: { page_title: "Embedded activity · Introduction", embedded_locator: "#/lessons/one", anchor_type: "visual_pin" as const, css_selector: "#card", relative_x: 0.2, relative_y: 0.7 },
};
const sender = { id: "extension", tab: { id: 7 }, frameId: 12, url: "https://rise.example/index.html#/lessons/one" };
const context = { id: id(3), title: "Course", course_url: "https://my.uconline.ac.nz/course/view.php?id=896", parent_activity_url: "https://my.uconline.ac.nz/mod/scorm/player.php?a=9" };

test("only the current elected worker can issue a pending anchor", async () => {
  const capabilities = new EmbeddedAnchorCapabilities(new Storage(), { randomToken: () => "a".repeat(64) });
  const base = { extensionId: "extension", context, currentOwner: { frameId: 12, workerInstanceId: id(2), generation: 4 } };
  await assert.rejects(() => issueEmbeddedAnchorFromWorker(event, { ...sender, frameId: 11 }, { ...base, capabilities }), /elected worker/);
  await assert.rejects(() => issueEmbeddedAnchorFromWorker({ ...event, worker_instance_id: id(9) }, sender, { ...base, capabilities }), /elected worker/);
  await assert.rejects(() => issueEmbeddedAnchorFromWorker({ ...event, generation: 5 }, sender, { ...base, capabilities }), /elected worker/);
  await assert.rejects(() => issueEmbeddedAnchorFromWorker({ ...event, course_id: id(8) }, sender, { ...base, capabilities }), /course context/);
  const token = await issueEmbeddedAnchorFromWorker(event, sender, { ...base, capabilities });
  assert.equal(token, "a".repeat(64));
});

test("worker issuance binds exact trusted context and rejects a forged embedded origin", async () => {
  const storage = new Storage();
  const capabilities = new EmbeddedAnchorCapabilities(storage, { randomToken: () => "b".repeat(64) });
  const dependencies = { extensionId: "extension", context, currentOwner: { frameId: 12, workerInstanceId: id(2), generation: 4 }, capabilities };
  await assert.rejects(() => issueEmbeddedAnchorFromWorker(event, { ...sender, url: "https://evil.example/index.html" }, dependencies), /page origin/);
  await issueEmbeddedAnchorFromWorker(event, sender, dependencies);
  const claim = await capabilities.claim("b".repeat(64), { tabId: 7, courseId: id(3) });
  assert.deepEqual(claim && {
    tabId: claim.tabId, courseId: claim.courseId, frameId: claim.frameId, workerInstanceId: claim.workerInstanceId, generation: claim.generation,
    pageUrl: claim.pageUrl, pageTitle: claim.pageTitle, parentActivityUrl: claim.parentActivityUrl, embeddedLocator: claim.embeddedLocator, anchor: claim.anchor,
  }, {
    tabId: 7, courseId: id(3), frameId: 12, workerInstanceId: id(2), generation: 4,
    pageUrl: event.page_url, pageTitle: event.payload.page_title, parentActivityUrl: context.parent_activity_url, embeddedLocator: event.payload.embedded_locator,
    anchor: { anchor_type: "visual_pin", css_selector: "#card", relative_x: 0.2, relative_y: 0.7 },
  });
});

class NavigationStorage implements EmbeddedNavigationStorage {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: structuredClone(this.data[key]) }; }
  async set(value: Record<string, unknown>) { Object.assign(this.data, structuredClone(value)); }
  async remove(key: string) { delete this.data[key]; }
}

const embeddedComment = {
  id: id(21), courseId: id(3), pageUrl: event.page_url,
  parentActivityUrl: context.parent_activity_url, embeddedLocator: "#/lessons/one",
};

test("embedded navigation follows the bounded state machine and consumes only the final context acknowledgement", async () => {
  const storage = new NavigationStorage(); let now = 1_000; let topUrl = context.course_url;
  let worker = { workerInstanceId: id(2), generation: 4, pageUrl: "https://rise.example/index.html#moodle-review-page=Loading" };
  const commands: string[] = []; let projected = false; const opened: string[] = [];
  const navigation = new EmbeddedCommentNavigation(storage, {
    now: () => now,
    current: () => ({ topUrl, ...worker }),
    navigateParent: async (_tabId, url) => { topUrl = url; },
    applyLocator: async () => { commands.push("locator"); },
    projectionContains: () => projected,
    takeToContext: async (_tabId, commentId) => { commands.push("context"); opened.push(commentId); },
  });
  await navigation.prepare(7, embeddedComment);
  assert.equal((await navigation.advance(7)).state, "parent-loading");
  assert.equal(topUrl, context.parent_activity_url);
  worker = { workerInstanceId: id(8), generation: 5, pageUrl: worker.pageUrl };
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  assert.deepEqual(commands, ["locator"]);
  worker.pageUrl = event.page_url;
  assert.equal((await navigation.advance(7)).state, "projection-waiting");
  projected = true;
  assert.equal((await navigation.advance(7)).state, "complete");
  assert.deepEqual(opened, [id(21)]);
  assert.equal((await storage.get("commentNavigation:7"))["commentNavigation:7"], undefined);
  now += 1;
});

test("embedded navigation retries after worker replacement and timeout until expiry", async () => {
  const storage = new NavigationStorage(); let now = 2_000; let attempts = 0;
  let worker = { workerInstanceId: id(2), generation: 4, pageUrl: event.page_url };
  const navigation = new EmbeddedCommentNavigation(storage, {
    now: () => now,
    current: () => ({ topUrl: context.parent_activity_url, ...worker }), navigateParent: async () => undefined,
    applyLocator: async () => undefined, projectionContains: () => true,
    takeToContext: async () => { attempts += 1; if (attempts === 1) throw new Error("SCORM command timed out"); },
  }, 300_000);
  await navigation.prepare(7, embeddedComment);
  await assert.rejects(() => navigation.advance(7), /timed out/);
  worker = { workerInstanceId: id(9), generation: 5, pageUrl: event.page_url };
  assert.equal((await navigation.advance(7)).state, "complete");
  assert.equal(attempts, 2);
  await navigation.prepare(7, embeddedComment); now += 300_001;
  await assert.rejects(() => navigation.advance(7), /expired/);
  assert.equal((await storage.get("commentNavigation:7"))["commentNavigation:7"], undefined);
});

test("a worker replaced after locator application receives the locator again", async () => {
  const storage = new NavigationStorage(); let worker = { workerInstanceId: id(2), generation: 4, pageUrl: "https://rise.example/index.html#moodle-review-page=Loading" }; const applied: string[] = [];
  const navigation = new EmbeddedCommentNavigation(storage, {
    current: () => ({ topUrl: context.parent_activity_url, ...worker }), navigateParent: async () => undefined,
    applyLocator: async () => { applied.push(worker.workerInstanceId); }, projectionContains: () => false, takeToContext: async () => undefined,
  });
  await navigation.prepare(7, embeddedComment);
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  worker = { workerInstanceId: id(9), generation: 5, pageUrl: worker.pageUrl };
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  assert.deepEqual(applied, [id(2), id(9)]);
});

test("navigation requires exact comment identity and legacy comments never guess an activity", async () => {
  const storage = new NavigationStorage(); let pageUrl = event.page_url; let projected = true; const opened: string[] = [];
  const navigation = new EmbeddedCommentNavigation(storage, {
    current: () => ({ topUrl: context.parent_activity_url, workerInstanceId: id(2), generation: 4, pageUrl }),
    navigateParent: async () => assert.fail("legacy navigation must not guess"), applyLocator: async () => assert.fail("legacy navigation must not apply a locator"),
    projectionContains: (_tabId, commentId, exactPageUrl) => projected && commentId === id(21) && exactPageUrl === event.page_url,
    takeToContext: async (_tabId, commentId) => { opened.push(commentId); },
  });
  await navigation.prepare(7, { ...embeddedComment, parentActivityUrl: null, embeddedLocator: null });
  assert.equal((await navigation.advance(7)).state, "complete");
  assert.deepEqual(opened, [id(21)]);
  pageUrl = "https://rise.example/index.html#moodle-review-page=Other"; projected = false;
  await navigation.prepare(7, { ...embeddedComment, parentActivityUrl: null, embeddedLocator: null });
  await assert.rejects(() => navigation.advance(7), /Open the original SCORM activity first/);
});

test("overlapping projection and identity signals open an embedded comment only once", async () => {
  const storage = new NavigationStorage(); let releases!: () => void; const gate = new Promise<void>((resolve) => { releases = resolve; }); let openings = 0;
  const navigation = new EmbeddedCommentNavigation(storage, {
    current: () => ({ topUrl: context.parent_activity_url, workerInstanceId: id(2), generation: 4, pageUrl: event.page_url }),
    navigateParent: async () => undefined, applyLocator: async () => undefined, projectionContains: () => true,
    takeToContext: async () => { openings += 1; await gate; },
  });
  await navigation.prepare(7, embeddedComment);
  const first = navigation.advance(7); const second = navigation.advance(7);
  await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(openings, 1);
  releases();
  assert.equal((await first).state, "complete");
  await assert.rejects(() => second, /unavailable/);
  assert.equal(openings, 1);
});
