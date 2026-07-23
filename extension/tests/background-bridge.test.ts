import assert from "node:assert/strict";
import test from "node:test";

import { authorizeAuthenticateSender, authorizeResolveSender, handleCreateCommentBridge, handleCreateEmbeddedCommentBridge, handleDeleteCommentBridge, handleListPageCommentsBridge, handleResolveCourseBridge, normalizeErrorMessage, validateAuthenticateMessage, validateCancelScreenshotMessage, validateCreateCommentMessage, validateCreateEmbeddedCommentMessage, validateDeleteCommentMessage, validateListPageCommentsMessage, validatePageCommentsResponse, validateResolveCourseMessage, validateUploadScreenshotMessage, validateViewerResponse } from "../src/background-bridge.ts";
import type { EmbeddedAnchorClaim } from "../src/embedded-anchor-capabilities.ts";

const capabilityUuid = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;

test("authenticate accepts only an exact empty envelope", () => {
  assert.deepEqual(validateAuthenticateMessage({ type: "AUTHENTICATE" }), {});
  for (const message of [{ type: "AUTHENTICATE", extra: true }, { type: "AUTHENTICATE", payload: {} }, { type: "AUTHENTICATE", token: "secret" }, null]) {
    assert.throws(() => validateAuthenticateMessage(message), /Invalid AUTHENTICATE/);
  }
});

test("embedded create message accepts only an opaque capability plus composition fields", () => {
  const message = { type: "CREATE_EMBEDDED_COMMENT", capability: "a".repeat(64), body: "Please revise", category: "general", screenshot_requested: true };
  assert.deepEqual(validateCreateEmbeddedCommentMessage(message), { capability: "a".repeat(64), body: "Please revise", category: "general", screenshotRequested: true });
  assert.throws(() => validateCreateEmbeddedCommentMessage({ ...message, page_url: "https://rise.example/forged" }), /Invalid CREATE_EMBEDDED_COMMENT/);
  assert.throws(() => validateCreateEmbeddedCommentMessage({ ...message, capability: "short" }), /Invalid CREATE_EMBEDDED_COMMENT/);
});

test("embedded create requires this extension frame zero on Moodle and uses claimed anchor data", async () => {
  const claim: EmbeddedAnchorClaim = {
    tabId: 7, courseId: capabilityUuid(90), frameId: 12, workerInstanceId: capabilityUuid(91), generation: 3,
    pageUrl: "https://rise.example/lesson/index.html#/one", pageTitle: "One",
    parentActivityUrl: "https://my.uconline.ac.nz/mod/scorm/player.php?a=9", courseUrl: "https://my.uconline.ac.nz/course/view.php?id=896", embeddedLocator: "#/one",
    anchor: { anchor_type: "visual_pin", css_selector: "#card", relative_x: 0.2, relative_y: 0.8 },
    interactionContext: { version: 1, kind: "tabs", container: { block_id: "tabs-1", ordinal: 1, fingerprint: "Constitution types" }, item: { ordinal: 2, count: 2, label: "Unwritten", control_key: "unwritten" } },
    createdAt: 1, expiresAt: 999,
  };
  const message = { type: "CREATE_EMBEDDED_COMMENT", capability: "a".repeat(64), body: "Please revise", category: "general", screenshot_requested: true };
  let created: unknown;
  const dependencies = {
    extensionId: "ours", authorizeMoodle: async () => true, expectedCourseId: () => claim.courseId, claim: async () => claim, current: () => true,
    create: async (payload: unknown, screenshot: boolean) => { created = { payload, screenshot }; return { id: capabilityUuid(8) }; }, restore: async () => undefined,
  };
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, { id: "ours", frameId: 1, url: claim.parentActivityUrl, tab: { id: 7 } }, dependencies), /frame zero/);
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, { id: "other", frameId: 0, url: claim.parentActivityUrl, tab: { id: 7 } }, dependencies), /extension sender/);
  await handleCreateEmbeddedCommentBridge(message, { id: "ours", frameId: 0, url: claim.parentActivityUrl, tab: { id: 7 } }, dependencies);
  assert.deepEqual(created, { payload: {
    course_id: claim.courseId, page_url: claim.pageUrl, page_title: claim.pageTitle,
    parent_activity_url: claim.parentActivityUrl, embedded_locator: claim.embeddedLocator,
    body: "Please revise", category: "general", ...claim.anchor, interaction_context: claim.interactionContext,
  }, screenshot: true });
});

test("stale election consumes the claim permanently instead of restoring it", async () => {
  const claim: EmbeddedAnchorClaim = {
    tabId: 7, courseId: capabilityUuid(90), frameId: 12, workerInstanceId: capabilityUuid(91), generation: 3,
    pageUrl: "https://rise.example/index.html#/one", pageTitle: "One", parentActivityUrl: "https://my.uconline.ac.nz/mod/scorm/player.php?a=9",
    courseUrl: "https://my.uconline.ac.nz/course/view.php?id=896", embeddedLocator: "#/one",
    anchor: { anchor_type: "text_highlight", selected_quote: "words", prefix: "", suffix: "" }, interactionContext: null, createdAt: 1, expiresAt: 999,
  };
  const message = { type: "CREATE_EMBEDDED_COMMENT", capability: "a".repeat(64), body: "Fix", category: "general" };
  let available: EmbeddedAnchorClaim | undefined = claim; let restores = 0; let creates = 0;
  const base = { extensionId: "ours", authorizeMoodle: async () => true, expectedCourseId: () => claim.courseId, claim: async () => { const value = available; available = undefined; return value; }, restore: async () => { restores += 1; available = claim; }, create: async () => { creates += 1; return {}; } };
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, { id: "ours", frameId: 0, url: claim.parentActivityUrl, tab: { id: 7 } }, { ...base, current: () => false }), /worker changed/);
  assert.equal(restores, 0);
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, { id: "ours", frameId: 0, url: claim.parentActivityUrl, tab: { id: 7 } }, { ...base, current: () => true }), /invalid or expired/);
  assert.equal(creates, 0);
});

test("parent-context mismatch consumes the claim permanently", async () => {
  const claim: EmbeddedAnchorClaim = {
    tabId: 7, courseId: capabilityUuid(90), frameId: 12, workerInstanceId: capabilityUuid(91), generation: 3,
    pageUrl: "https://rise.example/index.html#/one", pageTitle: "One", parentActivityUrl: "https://my.uconline.ac.nz/mod/scorm/player.php?a=9",
    courseUrl: "https://my.uconline.ac.nz/course/view.php?id=896", embeddedLocator: "#/one",
    anchor: { anchor_type: "visual_pin", css_selector: "#card", relative_x: 0.2, relative_y: 0.5 }, interactionContext: null, createdAt: 1, expiresAt: 999,
  };
  let available: EmbeddedAnchorClaim | undefined = claim; let restores = 0;
  const dependencies = { extensionId: "ours", authorizeMoodle: async () => true, expectedCourseId: () => claim.courseId, claim: async () => { const value = available; available = undefined; return value; }, current: () => true, restore: async () => { restores += 1; available = claim; }, create: async () => ({}) };
  const message = { type: "CREATE_EMBEDDED_COMMENT", capability: "a".repeat(64), body: "Fix", category: "general" };
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, { id: "ours", frameId: 0, url: "https://other-moodle.example/mod/scorm/player.php", tab: { id: 7 } }, dependencies), /parent context mismatch/);
  assert.equal(restores, 0);
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, { id: "ours", frameId: 0, url: claim.parentActivityUrl, tab: { id: 7 } }, dependencies), /invalid or expired/);
});

test("only an API create failure restores the claim for one successful retry", async () => {
  const claim: EmbeddedAnchorClaim = {
    tabId: 7, courseId: capabilityUuid(90), frameId: 12, workerInstanceId: capabilityUuid(91), generation: 3,
    pageUrl: "https://rise.example/index.html#/one", pageTitle: "One", parentActivityUrl: "https://my.uconline.ac.nz/mod/scorm/player.php?a=9",
    courseUrl: "https://my.uconline.ac.nz/course/view.php?id=896", embeddedLocator: "#/one",
    anchor: { anchor_type: "text_highlight", selected_quote: "words", prefix: "", suffix: "" }, interactionContext: null, createdAt: 1, expiresAt: 999,
  };
  let available: EmbeddedAnchorClaim | undefined = claim; let restores = 0; let attempts = 0;
  const dependencies = { extensionId: "ours", authorizeMoodle: async () => true, expectedCourseId: () => claim.courseId, claim: async () => { const value = available; available = undefined; return value; }, current: () => true, restore: async () => { restores += 1; available = claim; }, create: async () => { attempts += 1; if (attempts === 1) throw new Error("API down"); return { ok: true }; } };
  const message = { type: "CREATE_EMBEDDED_COMMENT", capability: "a".repeat(64), body: "Fix", category: "general" };
  const sender = { id: "ours", frameId: 0, url: claim.parentActivityUrl, tab: { id: 7 } };
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, sender, dependencies), /API down/);
  assert.equal(restores, 1);
  assert.deepEqual(await handleCreateEmbeddedCommentBridge(message, sender, dependencies), { ok: true });
  await assert.rejects(() => handleCreateEmbeddedCommentBridge(message, sender, dependencies), /invalid or expired/);
});

test("authenticate sender must be this extension's trusted configured top frame", async () => {
  const options = { extensionId: "ours", moodlePatterns: ["https://moodle.example.invalid/*"], hasPermission: async () => false };
  assert.equal(await authorizeAuthenticateSender({ id: "ours", url: "https://moodle.example.invalid/course/view.php?id=1", frameId: 0 }, options), true);
  assert.equal(await authorizeAuthenticateSender({ id: "ours", url: "https://moodle.example.invalid/course/view.php?id=1", frameId: 2 }, options), false);
  assert.equal(await authorizeAuthenticateSender({ id: "external", url: "https://moodle.example.invalid/course/view.php?id=1", frameId: 0 }, options), false);
  assert.equal(await authorizeAuthenticateSender({ id: "ours", url: "https://evil.example/course", frameId: 0 }, options), false);
});

test("resolve schema accepts only bounded normalized course fields", () => {
  assert.deepEqual(validateResolveCourseMessage({ type: "RESOLVE_COURSE", payload: { course_url: "https://learn.example/course/view.php?id=7", title: "Law", moodle_course_id: 7 } }), { course_url: "https://learn.example/course/view.php?id=7", title: "Law", moodle_course_id: 7 });
  for (const message of [
    { type: "RESOLVE_COURSE", payload: { course_url: "javascript:alert(1)", title: "Law" } },
    { type: "RESOLVE_COURSE", payload: { course_url: "https://learn.example/", title: "Law", extra: true } },
    { type: "RESOLVE_COURSE", payload: { course_url: "https://learn.example/", title: "x".repeat(201) } },
    { type: "RESOLVE_COURSE", payload: { course_url: "https://learn.example/", title: "Law", moodle_course_id: "7" } },
  ]) assert.throws(() => validateResolveCourseMessage(message), /Invalid RESOLVE_COURSE/);
});

test("resolve sender must be this extension on static or granted optional origins", async () => {
  const options = { extensionId: "ours", moodlePatterns: ["https://moodle.example.invalid/*"], optionalPatterns: ["https://rise.example.invalid/*"], hasPermission: async (pattern: string) => pattern.includes("rise") };
  assert.equal(await authorizeResolveSender({ id: "ours", url: "https://moodle.example.invalid/course/view.php?id=1" }, options), true);
  assert.equal(await authorizeResolveSender({ id: "ours", url: "https://rise.example.invalid/course" }, options), true);
  assert.equal(await authorizeResolveSender({ id: "external", url: "https://moodle.example.invalid/course" }, options), false);
  assert.equal(await authorizeResolveSender({ id: "ours", url: "https://evil.example/course" }, options), false);
});

test("rejected resolve messages never reach API or token-backed resolution", async () => {
  let resolutions = 0;
  await assert.rejects(() => handleResolveCourseBridge(
    { type: "RESOLVE_COURSE", payload: { course_url: "https://learn.example/", title: "Law", extra: "danger" } },
    { id: "ours", url: "https://learn.example/course" },
    { authorize: async () => true, resolve: async () => { resolutions += 1; } },
  ), /Invalid/);
  await assert.rejects(() => handleResolveCourseBridge(
    { type: "RESOLVE_COURSE", payload: { course_url: "https://learn.example/", title: "Law" } },
    { id: "external", url: "https://learn.example/course" },
    { authorize: async () => false, resolve: async () => { resolutions += 1; } },
  ), /Unauthorized/);
  assert.equal(resolutions, 0);
});

test("bridge rejects a payload whose course origin differs from the authorized sender before resolution", async () => {
  let authorizations = 0;
  let resolutions = 0;
  await assert.rejects(() => handleResolveCourseBridge(
    { type: "RESOLVE_COURSE", payload: { course_url: "https://other.example/course/view.php?id=7", title: "Law" } },
    { id: "ours", url: "https://learn.example/mod/page/view.php?id=9" },
    { authorize: async () => { authorizations += 1; return true; }, resolve: async () => { resolutions += 1; } },
  ), /origin/);
  assert.equal(authorizations, 0);
  assert.equal(resolutions, 0);
});

test("unknown rejection values have safe useful response messages", () => {
  assert.equal(normalizeErrorMessage("network down"), "network down");
  assert.equal(normalizeErrorMessage({ reason: "secret" }), "Unexpected background error");
});

test("create comment bridge accepts only normalized context and anchor fields", () => {
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://learn.example/mod/page/view.php?id=9", page_title: "Week 2", body: "Needs clarification", category: "general", anchor_type: "text_highlight", selected_quote: "this phrase", prefix: "before ", suffix: " after", css_selector: "#intro" };
  assert.deepEqual(validateCreateCommentMessage({ type: "CREATE_COMMENT", payload }), { payload });
  assert.deepEqual(validateCreateCommentMessage({ type: "CREATE_COMMENT", payload, screenshot_requested: true }), { payload, screenshotRequested: true });
  assert.throws(() => validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: { ...payload, token: "secret" } }), /Invalid CREATE_COMMENT/);
  assert.throws(() => validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: { ...payload, page_url: "javascript:bad" } }), /Invalid CREATE_COMMENT/);
  assert.throws(() => validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: { ...payload, parent_activity_url: "https://learn.example/mod/scorm/player.php", embedded_locator: "#/lesson" } }), /Invalid CREATE_COMMENT/);
});

test("cancel screenshot messages have an exact UUID envelope", () => {
  const message = { type: "CANCEL_SCREENSHOT", comment_id: "123e4567-e89b-12d3-a456-426614174000" };
  assert.deepEqual(validateCancelScreenshotMessage(message), { comment_id: message.comment_id });
  assert.throws(() => validateCancelScreenshotMessage({ ...message, extra: true }), /Invalid CANCEL_SCREENSHOT/);
});

test("create comment preserves an embedded activity hash route", () => {
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://rise.example/activity#/lesson/2", page_title: "Lesson 2", body: "Review this", category: "general", anchor_type: "text_highlight", selected_quote: "phrase", prefix: "", suffix: "", css_selector: "#copy" };
  assert.equal(validateCreateCommentMessage({ type: "CREATE_COMMENT", payload }).payload.page_url, payload.page_url);
});

test("create comment validation trims bounded common fields and enforces exact text anchor shape", () => {
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://learn.example/mod/page/view.php?id=9", page_title: "  Week 2  ", body: "  Needs clarification  ", category: "  general  ", anchor_type: "text_highlight", selected_quote: "  this phrase  ", prefix: "before ", suffix: " after", css_selector: "  #intro  " };
  const result = validateCreateCommentMessage({ type: "CREATE_COMMENT", payload });
  assert.deepEqual(result.payload, { ...payload, page_title: "Week 2", body: "Needs clarification", category: "general", selected_quote: "this phrase", css_selector: "#intro" });
  const { css_selector: _selector, ...withoutSelector } = payload;
  for (const invalid of [
    withoutSelector,
    { ...payload, selected_quote: "   " },
    { ...payload, prefix: 4 },
    { ...payload, css_selector: "   " },
    { ...payload, css_selector: "x".repeat(4001) },
    { ...payload, css_selector: 4 },
    { ...payload, relative_x: 0.2 },
    { ...payload, body: "x".repeat(10001) },
  ]) assert.throws(() => validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: invalid }), /Invalid CREATE_COMMENT/);
});

test("create comment validation enforces exact finite visual pin shape", () => {
  const base = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://learn.example/mod/page/view.php?id=9", page_title: "Week 2", body: "Pin issue", category: "general", anchor_type: "visual_pin", css_selector: "  #activity  ", relative_x: 0, relative_y: 1 };
  assert.deepEqual(validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: base }).payload, { ...base, css_selector: "#activity" });
  for (const invalid of [
    { ...base, css_selector: "   " },
    { ...base, relative_x: Number.NaN },
    { ...base, relative_y: Number.POSITIVE_INFINITY },
    { ...base, relative_x: -0.01 },
    { ...base, relative_y: 1.01 },
    { ...base, selected_quote: "mixed" },
    { ...base, prefix: "mixed" },
  ]) assert.throws(() => validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: invalid }), /Invalid CREATE_COMMENT/);
});

test("rejected create messages never authorize, access a token, or call the API", async () => {
  let authorizations = 0; let tokenReads = 0; let apiCalls = 0;
  await assert.rejects(() => handleCreateCommentBridge(
    { type: "CREATE_COMMENT", payload: { token: "secret" } },
    { id: "ours", url: "https://learn.example/course" },
    {
      authorize: async () => { authorizations += 1; return true; },
      create: async () => { tokenReads += 1; apiCalls += 1; },
    },
  ), /Invalid CREATE_COMMENT/);
  assert.deepEqual({ authorizations, tokenReads, apiCalls }, { authorizations: 0, tokenReads: 0, apiCalls: 0 });
});

test("upload screenshot messages have an exact UUID and data URL envelope", () => {
  const message = { type: "UPLOAD_SCREENSHOT", comment_id: "123e4567-e89b-12d3-a456-426614174000", data_url: "data:image/png;base64,iVBORw0KGgo=" };
  assert.deepEqual(validateUploadScreenshotMessage(message), { comment_id: message.comment_id, data_url: message.data_url });
  for (const invalid of [{ ...message, comment_id: "arbitrary" }, { ...message, extra: true }, { type: "UPLOAD_SCREENSHOT", data_url: message.data_url }]) assert.throws(() => validateUploadScreenshotMessage(invalid), /Invalid UPLOAD_SCREENSHOT/);
});

test("valid create is denied before API access when cached course identity does not match", async () => {
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://learn.example/mod/page/view.php?id=9", page_title: "Week 2", body: "No", category: "general", anchor_type: "text_highlight", selected_quote: "phrase", prefix: "", suffix: "", css_selector: "#copy" };
  let creates = 0;
  await assert.rejects(() => handleCreateCommentBridge({ type: "CREATE_COMMENT", payload }, { id: "ours", url: payload.page_url }, { authorize: async () => true, contextMatches: () => false, create: async () => { creates += 1; } }), /context mismatch/);
  assert.equal(creates, 0);
});

test("ordinary top-frame create still rejects a cross-origin Rise page", async () => {
  const payload = { course_id: capabilityUuid(90), page_url: "https://rise.example/index.html#/one", page_title: "One", body: "No", category: "general", anchor_type: "visual_pin" as const, css_selector: "#card", relative_x: 0.2, relative_y: 0.5 };
  let creates = 0;
  await assert.rejects(() => handleCreateCommentBridge({ type: "CREATE_COMMENT", payload }, { id: "ours", url: "https://my.uconline.ac.nz/mod/scorm/player.php" }, { authorize: async () => true, contextMatches: () => true, create: async () => { creates += 1; } }), /origin must match/);
  assert.equal(creates, 0);
});

test("LIST_PAGE_COMMENTS accepts only an exact absolute page URL envelope", () => {
  const pageUrl = "https://my.uconline.ac.nz/mod/page/view.php?id=42#topic";
  assert.deepEqual(validateListPageCommentsMessage({ type: "LIST_PAGE_COMMENTS", page_url: pageUrl }), { page_url: pageUrl });
  for (const message of [{ type: "LIST_PAGE_COMMENTS", page_url: "javascript:bad" }, { type: "LIST_PAGE_COMMENTS", page_url: "https://user:pass@example.test/x" }, { type: "LIST_PAGE_COMMENTS", page_url: pageUrl, course_id: "client-controlled" }]) {
    assert.throws(() => validateListPageCommentsMessage(message), /Invalid LIST_PAGE_COMMENTS/);
  }
});

test("LIST_PAGE_COMMENTS derives course from cache and validates API data", async () => {
  const pageUrl = "https://my.uconline.ac.nz/mod/page/view.php?id=42#topic";
  let requested: unknown;
  const result = await handleListPageCommentsBridge({ type: "LIST_PAGE_COMMENTS", page_url: pageUrl }, { id: "ours", url: pageUrl }, {
    authorize: async () => true,
    courseId: () => "00000000-0000-4000-8000-000000000090",
    list: async (courseId, requestedPage) => { requested = { courseId, pageUrl: requestedPage }; return [{ id: "00000000-0000-4000-8000-000000000001", body: "Feedback", category: "general", status: "open", author: { display_name: "beta@example.test", role: "beta_tester" }, page_url: requestedPage, page_title: "Topic", parent_activity_url: null, embedded_locator: null, interaction_context: null, anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#main", dom_selector: null, relative_x: 0.2, relative_y: 0.8, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } }]; },
  });
  assert.deepEqual(requested, { courseId: "00000000-0000-4000-8000-000000000090", pageUrl });
  assert.equal(result.length, 1);
  await assert.rejects(() => handleListPageCommentsBridge({ type: "LIST_PAGE_COMMENTS", page_url: "https://evil.example/x" }, { id: "ours", url: pageUrl }, { authorize: async () => true, courseId: () => "cached", list: async () => [] }), /origin must match/);
});

test("page comment response rejects extra fields and wrong pages", () => {
  const pageUrl = "https://example.test/page";
  const base = { id: "00000000-0000-4000-8000-000000000001", body: "Feedback", category: "general", status: "open", author: { display_name: "beta@example.test", role: "beta_tester" }, page_url: pageUrl, page_title: "Page", parent_activity_url: null, embedded_locator: null, interaction_context: null, anchor_type: "text_highlight", selected_quote: "words", prefix: "before", suffix: "after", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  assert.equal(validatePageCommentsResponse([base], pageUrl).length, 1);
  const { interaction_context: _missingOnOldServer, ...legacy } = base;
  assert.deepEqual(validatePageCommentsResponse([legacy], pageUrl)[0]?.interaction_context, null);
  assert.throws(() => validatePageCommentsResponse([{ ...base, secret: true }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, page_url: "https://example.test/other" }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: undefined }], pageUrl), /Invalid page comments response/);
  assert.equal(validatePageCommentsResponse([{ ...base, parent_activity_url: "https://moodle.example/mod/scorm/player.php?a=9", embedded_locator: "#/lessons/one" }], pageUrl).length, 1);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: "http://moodle.example/x", embedded_locator: "#/lessons/one" }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: "https://user:pass@moodle.example/x", embedded_locator: "#/lessons/one" }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: "HTTPS://moodle.example/x", embedded_locator: "#/lessons/one" }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: "https://moodle.example:99999/x", embedded_locator: "#/lessons/one" }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: "https://moodle.example:443/x", embedded_locator: "#/lessons/one" }], pageUrl), /Invalid page comments response/);
  assert.equal(validatePageCommentsResponse([{ ...base, parent_activity_url: "https://moodle.example:8443/x", embedded_locator: "#/lessons/one" }], pageUrl).length, 1);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: "https://moodle.example/x", embedded_locator: "#/lesson one" }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, parent_activity_url: null, embedded_locator: "#/lessons/one" }], pageUrl), /Invalid page comments response/);
});

test("viewer and delete messages use exact trusted envelopes", async () => {
  const courseId = "00000000-0000-4000-8000-000000000090";
  const commentId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(validateDeleteCommentMessage({ type: "DELETE_COMMENT_THREAD", comment_id: commentId }), { comment_id: commentId });
  assert.throws(() => validateDeleteCommentMessage({ type: "DELETE_COMMENT_THREAD", comment_id: commentId, course_id: courseId }), /Invalid/);
  assert.deepEqual(validateViewerResponse({ course_id: courseId, user: { id: commentId, display_name: null, email: "reviewer@example.test", role: "ld_dcd" } }, courseId).user.role, "ld_dcd");
  let deleted = "";
  await handleDeleteCommentBridge({ type: "DELETE_COMMENT_THREAD", comment_id: commentId }, { id: "ours", url: "https://learn.example/page" }, { authorize: async () => true, courseId: () => courseId, remove: async (id, trustedCourse) => { deleted = `${id}:${trustedCourse}`; } });
  assert.equal(deleted, `${commentId}:${courseId}`);
  await assert.rejects(() => handleDeleteCommentBridge({ type: "DELETE_COMMENT_THREAD", comment_id: commentId }, { id: "ours", url: "https://learn.example/page" }, { authorize: async () => true, courseId: () => undefined, remove: async () => undefined }), /context unavailable/);
});
