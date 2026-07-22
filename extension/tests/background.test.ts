import assert from "node:assert/strict";
import test from "node:test";

import { EmbeddedAnchorCapabilities, issueEmbeddedAnchorFromWorker, type EmbeddedAnchorStorage } from "../src/embedded-anchor-capabilities.ts";
import type { PageComment } from "../src/background-bridge.ts";
import { EmbeddedCommentNavigation, handleCommentNavigationMessage, type EmbeddedNavigationStorage } from "../src/embedded-comment-navigation.ts";
import { packageRootFromScormUrl, ScormLaunchCache } from "../src/scorm-launch.ts";

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
    current: () => ({ courseId: id(3), topUrl, ...worker }),
    navigateParent: async (_tabId, url) => { topUrl = url; },
    activateCover: async () => { commands.push("cover"); },
    applyLocator: async () => { commands.push("locator"); },
    projectionContains: () => projected,
    takeToContext: async (_tabId, commentId) => { commands.push("context"); opened.push(commentId); },
  });
  await navigation.prepare(7, embeddedComment);
  assert.equal((await navigation.advance(7)).state, "parent-loading");
  assert.equal(topUrl, context.parent_activity_url);
  worker = { workerInstanceId: id(8), generation: 5, pageUrl: worker.pageUrl };
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  assert.deepEqual(commands, ["cover"]);
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  assert.deepEqual(commands, ["cover", "locator"]);
  worker.pageUrl = event.page_url;
  assert.equal((await navigation.advance(7)).state, "projection-waiting");
  projected = true;
  assert.equal((await navigation.advance(7)).state, "complete");
  assert.deepEqual(opened, [id(21)]);
  assert.equal((await storage.get("commentNavigation:7"))["commentNavigation:7"], undefined);
  now += 1;
  navigation.cancel(7);
});

test("a different SCORM retries an unconfirmed cover but never reactivates it after confirmation", async () => {
  const storage = new NavigationStorage(); let topUrl = "https://moodle.example/mod/scorm/player.php?cm=99"; let workerInstanceId = id(2); let coverAttempts = 0; const locators: string[] = [];
  const navigation = new EmbeddedCommentNavigation(storage, {
    current: () => ({ courseId: id(3), topUrl, workerInstanceId, generation: 4, pageUrl: "https://rise.example/index.html#moodle-review-page=Loading" }),
    navigateParent: async (_tabId, url) => { topUrl = url; },
    activateCover: async () => { coverAttempts += 1; if (coverAttempts === 1) throw new Error("COVER_NOT_READY"); },
    applyLocator: async (_tabId, locator) => { locators.push(locator); }, projectionContains: () => false, takeToContext: async () => undefined,
  });
  await navigation.prepare(7, embeddedComment);
  assert.equal((await navigation.advance(7)).state, "parent-loading");
  await assert.rejects(() => navigation.advance(7), /COVER_NOT_READY/);
  workerInstanceId = id(9);
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  workerInstanceId = id(10);
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  assert.equal(coverAttempts, 2);
  assert.deepEqual(locators, [embeddedComment.embeddedLocator]);
  navigation.cancel(7);
});

test("embedded navigation retries after worker replacement and timeout until expiry", async () => {
  const storage = new NavigationStorage(); let now = 2_000; let attempts = 0;
  let worker = { workerInstanceId: id(2), generation: 4, pageUrl: event.page_url };
  const navigation = new EmbeddedCommentNavigation(storage, {
    now: () => now,
    current: () => ({ courseId: id(3), topUrl: context.parent_activity_url, ...worker }), navigateParent: async () => undefined,
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
    current: () => ({ courseId: id(3), topUrl: context.parent_activity_url, ...worker }), navigateParent: async () => undefined,
    applyLocator: async () => { applied.push(worker.workerInstanceId); }, projectionContains: () => false, takeToContext: async () => undefined,
  });
  await navigation.prepare(7, embeddedComment);
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  worker = { workerInstanceId: id(9), generation: 5, pageUrl: worker.pageUrl };
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  assert.deepEqual(applied, [id(2), id(9)]);
  navigation.cancel(7);
});

test("a slow SCORM app receives its locator again until the target identity loads", async () => {
  const storage = new NavigationStorage(); let nextTimer = 1; const timers = new Map<number, () => void>(); const applied: string[] = [];
  let pageUrl = "https://rise.example/index.html#moodle-review-page=Loading";
  const navigation = new EmbeddedCommentNavigation(storage, {
    setTimeout: (callback) => { const token = nextTimer++; timers.set(token, callback); return token; },
    clearTimeout: (token) => { timers.delete(token as number); },
    current: () => ({ courseId: id(3), topUrl: context.parent_activity_url, workerInstanceId: id(2), generation: 4, pageUrl }),
    navigateParent: async () => undefined, applyLocator: async (_tabId, locator) => { applied.push(locator); },
    projectionContains: () => true, takeToContext: async () => undefined,
  });
  await navigation.prepare(7, embeddedComment);
  assert.equal((await navigation.advance(7)).state, "identity-waiting");
  assert.deepEqual(applied, [embeddedComment.embeddedLocator]);

  const retry = [...timers.values()][0]!; timers.clear(); retry(); await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(applied, [embeddedComment.embeddedLocator, embeddedComment.embeddedLocator]);
  pageUrl = embeddedComment.pageUrl;
  const ready = [...timers.values()][0]!; timers.clear(); ready(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await storage.get("commentNavigation:7"))["commentNavigation:7"], undefined);
});

test("navigation requires exact comment identity and legacy comments never guess an activity", async () => {
  const storage = new NavigationStorage(); let pageUrl = event.page_url; let projected = true; const opened: string[] = [];
  const navigation = new EmbeddedCommentNavigation(storage, {
    current: () => ({ courseId: id(3), topUrl: context.parent_activity_url, workerInstanceId: id(2), generation: 4, pageUrl }),
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
    current: () => ({ courseId: id(3), topUrl: context.parent_activity_url, workerInstanceId: id(2), generation: 4, pageUrl: event.page_url }),
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

test("a stored navigation cannot cross a trusted course rebind", async () => {
  const storage = new NavigationStorage(); let boundCourse = id(3); let navigations = 0;
  const navigation = new EmbeddedCommentNavigation(storage, {
    current: () => ({ courseId: boundCourse, topUrl: context.course_url }), navigateParent: async () => { navigations += 1; },
    applyLocator: async () => undefined, projectionContains: () => false, takeToContext: async () => undefined,
  });
  await navigation.prepare(7, embeddedComment); boundCourse = id(44);
  await assert.rejects(() => navigation.advance(7), /course context changed/);
  assert.equal(navigations, 0);
  assert.equal((await storage.get("commentNavigation:7"))["commentNavigation:7"], undefined);
});

test("transient navigation failures retry automatically and stop on completion or expiry", async () => {
  const storage = new NavigationStorage(); let now = 5_000; let attempts = 0; let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const navigation = new EmbeddedCommentNavigation(storage, {
    now: () => now,
    setTimeout: (callback) => { const token = nextTimer++; timers.set(token, callback); return token; },
    clearTimeout: (token) => { timers.delete(token as number); },
    current: () => ({ courseId: id(3), topUrl: context.parent_activity_url, workerInstanceId: id(2), generation: 4, pageUrl: event.page_url }),
    navigateParent: async () => undefined, applyLocator: async () => undefined, projectionContains: () => true,
    takeToContext: async () => { attempts += 1; if (attempts === 1) throw new Error("SCORM command timed out"); },
  }, 1_000);
  await navigation.prepare(7, embeddedComment);
  await assert.rejects(() => navigation.advance(7), /timed out/);
  assert.equal(timers.size, 1);
  const retry = [...timers.values()][0]; timers.clear(); retry(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 2); assert.equal(timers.size, 0);

  await navigation.prepare(7, embeddedComment); attempts = 0;
  await assert.rejects(() => navigation.advance(7), /timed out/); assert.equal(timers.size, 1);
  now += 1_001; const expiredRetry = [...timers.values()][0]; timers.clear(); expiredRetry(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 1); assert.equal(timers.size, 0);
});

test("comment navigation boundary accepts only exact frame-zero configured Moodle messages and current course", async () => {
  const storage = new NavigationStorage(); const calls: string[] = [];
  const navigation = new EmbeddedCommentNavigation(storage, {
    current: () => ({ courseId: id(3), topUrl: context.parent_activity_url, workerInstanceId: id(2), generation: 4, pageUrl: event.page_url }),
    navigateParent: async () => undefined, applyLocator: async () => undefined, projectionContains: () => true, takeToContext: async () => undefined,
  });
  const comment: PageComment = { id: id(21), body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: event.page_url, page_title: "Embedded activity · Introduction", parent_activity_url: context.parent_activity_url, embedded_locator: "#/lessons/one", anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#card", dom_selector: null, relative_x: .2, relative_y: .7, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  const dependencies = {
    extensionId: "extension", authorizeMoodle: async (candidate: { url?: string }) => candidate.url?.startsWith("https://my.uconline.ac.nz/") === true,
    courseId: () => id(3), listCourseComments: async () => { calls.push("list"); return [comment]; }, storage, navigation,
  };
  const message = { type: "PREPARE_COMMENT_NAVIGATION", comment_id: id(21), page_url: event.page_url };
  const trusted = { id: "extension", tab: { id: 7 }, frameId: 0, url: context.parent_activity_url };
  await assert.rejects(() => handleCommentNavigationMessage(message, { ...trusted, id: "other" }, dependencies), /Unauthorized/);
  await assert.rejects(() => handleCommentNavigationMessage(message, { ...trusted, frameId: 2 }, dependencies), /Unauthorized/);
  await assert.rejects(() => handleCommentNavigationMessage(message, { ...trusted, url: "https://evil.example/course" }, dependencies), /Unauthorized/);
  await assert.rejects(() => handleCommentNavigationMessage(message, trusted, { ...dependencies, courseId: () => id(55) }), /course context changed/);
  assert.equal((await handleCommentNavigationMessage(message, trusted, dependencies) as { state: string }).state, "complete");
  assert.equal(calls.length, 2, "unauthorized senders are rejected before course API access");
});

test("consume navigation requires an exact envelope and removes expired top-page records", async () => {
  const storage = new NavigationStorage(); let now = 10_000;
  const dependencies = {
    extensionId: "extension", authorizeMoodle: async () => true, courseId: () => id(3), listCourseComments: async () => [], storage,
    navigation: new EmbeddedCommentNavigation(storage, { current: () => ({ courseId: id(3), topUrl: context.course_url }), navigateParent: async () => undefined, applyLocator: async () => undefined, projectionContains: () => false, takeToContext: async () => undefined }),
    now: () => now,
  };
  const trusted = { id: "extension", tab: { id: 7 }, frameId: 0, url: "https://my.uconline.ac.nz/course/view.php?id=896" };
  await assert.rejects(() => handleCommentNavigationMessage({ type: "CONSUME_COMMENT_NAVIGATION", extra: true }, trusted, dependencies), /Invalid/);
  await storage.set({ "commentNavigation:7": { comment_id: id(21), course_id: id(3), page_url: trusted.url, created_at: now - 300_001 } });
  assert.deepEqual(await handleCommentNavigationMessage({ type: "CONSUME_COMMENT_NAVIGATION" }, trusted, dependencies), {});
  assert.equal((await storage.get("commentNavigation:7"))["commentNavigation:7"], undefined);
});

test("raw SCORM and metadata pair errors never become top-level destinations", async () => {
  const storage = new NavigationStorage(); let parentNavigations = 0;
  const rawUrl = "https://my.uconline.ac.nz/pluginfile.php/165226/mod_scorm/content/27/scormcontent/index.html";
  const base: PageComment = { id: id(21), body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: rawUrl, page_title: "Embedded", parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#card", dom_selector: null, relative_x: .2, relative_y: .7, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  let listed = base;
  const navigation = new EmbeddedCommentNavigation(storage, { current: () => ({ courseId: id(3), topUrl: context.parent_activity_url }), navigateParent: async () => { parentNavigations += 1; }, applyLocator: async () => undefined, projectionContains: () => false, takeToContext: async () => undefined });
  const dependencies = { extensionId: "extension", authorizeMoodle: async () => true, courseId: () => id(3), listCourseComments: async () => [listed], storage, navigation };
  const trusted = { id: "extension", tab: { id: 7 }, frameId: 0, url: context.parent_activity_url };
  const message = { type: "PREPARE_COMMENT_NAVIGATION", comment_id: base.id, page_url: rawUrl };
  await assert.rejects(() => handleCommentNavigationMessage(message, trusted, dependencies), /Moodle activity location is missing/);
  const completePlayer = "https://my.uconline.ac.nz/mod/scorm/player.php?mode=normal&scoid=15621&cm=146308&currentorg=rise";
  const recoveredLegacy = { ...dependencies, recoverScormParent: async () => completePlayer };
  assert.equal((await handleCommentNavigationMessage(message, trusted, recoveredLegacy) as { state: string }).state, "parent-loading");
  const legacyRecord = (await storage.get("commentNavigation:7"))["commentNavigation:7"] as { embeddedLocator: string };
  assert.equal(legacyRecord.embeddedLocator, "/pluginfile.php/165226/mod_scorm/content/27/scormcontent/index.html");
  navigation.cancel(7);
  listed = { ...base, parent_activity_url: "https://my.uconline.ac.nz/mod/scorm/player.php", embedded_locator: "#/lesson" };
  const recovered = { ...dependencies, recoverScormParent: async () => completePlayer };
  assert.equal((await handleCommentNavigationMessage(message, trusted, recovered) as { state: string }).state, "parent-loading");
  assert.equal(parentNavigations, 2);
  navigation.cancel(7);
  listed = { ...base, page_url: "https://my.uconline.ac.nz/mod/page/view.php?id=1", parent_activity_url: context.parent_activity_url };
  await assert.rejects(() => handleCommentNavigationMessage({ ...message, page_url: listed.page_url }, trusted, dependencies), /metadata/);
  listed = { ...base, page_url: "https://my.uconline.ac.nz/mod/page/view.php?id=1", embedded_locator: "#/lesson" };
  await assert.rejects(() => handleCommentNavigationMessage({ ...message, page_url: listed.page_url }, trusted, dependencies), /metadata/);
  assert.equal(parentNavigations, 2);
});

test("embedded parent navigation requires the exact Moodle SCORM player path", async () => {
  const storage = new NavigationStorage();
  const base: PageComment = { id: id(21), body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: event.page_url, page_title: "Embedded", parent_activity_url: "https://my.uconline.ac.nz/mod/page/view.php?id=9", embedded_locator: "#/lesson", anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#card", dom_selector: null, relative_x: .2, relative_y: .7, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  const navigation = new EmbeddedCommentNavigation(storage, { current: () => ({ topUrl: context.parent_activity_url }), navigateParent: async () => undefined, applyLocator: async () => undefined, projectionContains: () => false, takeToContext: async () => undefined });
  const dependencies = { extensionId: "extension", authorizeMoodle: async () => true, courseId: () => id(3), listCourseComments: async () => [base], storage, navigation };
  await assert.rejects(() => handleCommentNavigationMessage({ type: "PREPARE_COMMENT_NAVIGATION", comment_id: base.id, page_url: base.page_url }, { id: "extension", tab: { id: 7 }, frameId: 0, url: context.parent_activity_url }, dependencies), /Invalid embedded parent/);
});

test("SCORM launch recovery survives a background cache reconstruction and preserves navigation checks", async () => {
  const storage = new NavigationStorage(); const rawUrl = "https://my.uconline.ac.nz/pluginfile.php/165226/mod_scorm/content/27/scormcontent/index.html#/lesson";
  const complete = "https://my.uconline.ac.nz/mod/scorm/player.php?mode=normal&scoid=15621&cm=146308&currentorg=rise";
  const beforeRestart = new ScormLaunchCache(storage, () => 1_000);
  await beforeRestart.put({ courseId: id(3), configuredOrigin: "https://my.uconline.ac.nz", cmid: 146308, packageRoot: packageRootFromScormUrl(rawUrl), playerUrl: complete });
  const afterRestart = new ScormLaunchCache(storage, () => 2_000);
  const listed: PageComment = { id: id(21), body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" }, page_url: rawUrl, page_title: "Embedded", parent_activity_url: "https://my.uconline.ac.nz/mod/scorm/player.php", embedded_locator: "#/lesson", anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#card", dom_selector: null, relative_x: .2, relative_y: .7, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false } };
  let destination = "";
  const navigation = new EmbeddedCommentNavigation(storage, { current: () => ({ courseId: id(3), topUrl: listed.parent_activity_url! }), navigateParent: async (_tabId, url) => { destination = url; }, applyLocator: async () => undefined, projectionContains: () => false, takeToContext: async () => undefined });
  const trusted = { id: "extension", tab: { id: 7 }, frameId: 0, url: "https://my.uconline.ac.nz/mod/scorm/player.php" };
  const result = await handleCommentNavigationMessage({ type: "PREPARE_COMMENT_NAVIGATION", comment_id: listed.id, page_url: rawUrl }, trusted, {
    extensionId: "extension", authorizeMoodle: async () => true, courseId: () => id(3), listCourseComments: async () => [listed], storage, navigation,
    recoverScormParent: (_courseId, pageUrl) => afterRestart.get({ courseId: id(3), configuredOrigin: "https://my.uconline.ac.nz", packageUrl: pageUrl, cmid: 146308 }),
  }) as { state: string };
  assert.equal(result.state, "parent-loading"); assert.equal(destination, complete); navigation.cancel(7);
});
