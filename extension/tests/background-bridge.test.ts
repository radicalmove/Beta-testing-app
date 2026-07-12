import assert from "node:assert/strict";
import test from "node:test";

import { authorizeAuthenticateSender, authorizeResolveSender, handleCreateCommentBridge, handleDeleteCommentBridge, handleListPageCommentsBridge, handleResolveCourseBridge, normalizeErrorMessage, validateAuthenticateMessage, validateCancelScreenshotMessage, validateCreateCommentMessage, validateDeleteCommentMessage, validateListPageCommentsMessage, validatePageCommentsResponse, validateResolveCourseMessage, validateUploadScreenshotMessage, validateViewerResponse } from "../src/background-bridge.ts";

test("authenticate accepts only an exact empty envelope", () => {
  assert.deepEqual(validateAuthenticateMessage({ type: "AUTHENTICATE" }), {});
  for (const message of [{ type: "AUTHENTICATE", extra: true }, { type: "AUTHENTICATE", payload: {} }, { type: "AUTHENTICATE", token: "secret" }, null]) {
    assert.throws(() => validateAuthenticateMessage(message), /Invalid AUTHENTICATE/);
  }
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
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://learn.example/mod/page/view.php?id=9", page_title: "Week 2", body: "Needs clarification", category: "general", anchor_type: "text_highlight", selected_quote: "this phrase", prefix: "before ", suffix: " after" };
  assert.deepEqual(validateCreateCommentMessage({ type: "CREATE_COMMENT", payload }), { payload });
  assert.deepEqual(validateCreateCommentMessage({ type: "CREATE_COMMENT", payload, screenshot_requested: true }), { payload, screenshotRequested: true });
  assert.throws(() => validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: { ...payload, token: "secret" } }), /Invalid CREATE_COMMENT/);
  assert.throws(() => validateCreateCommentMessage({ type: "CREATE_COMMENT", payload: { ...payload, page_url: "javascript:bad" } }), /Invalid CREATE_COMMENT/);
});

test("cancel screenshot messages have an exact UUID envelope", () => {
  const message = { type: "CANCEL_SCREENSHOT", comment_id: "123e4567-e89b-12d3-a456-426614174000" };
  assert.deepEqual(validateCancelScreenshotMessage(message), { comment_id: message.comment_id });
  assert.throws(() => validateCancelScreenshotMessage({ ...message, extra: true }), /Invalid CANCEL_SCREENSHOT/);
});

test("create comment preserves an embedded activity hash route", () => {
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://rise.example/activity#/lesson/2", page_title: "Lesson 2", body: "Review this", category: "general", anchor_type: "text_highlight", selected_quote: "phrase", prefix: "", suffix: "" };
  assert.equal(validateCreateCommentMessage({ type: "CREATE_COMMENT", payload }).payload.page_url, payload.page_url);
});

test("create comment validation trims bounded common fields and enforces exact text anchor shape", () => {
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://learn.example/mod/page/view.php?id=9", page_title: "  Week 2  ", body: "  Needs clarification  ", category: "  general  ", anchor_type: "text_highlight", selected_quote: "  this phrase  ", prefix: "before ", suffix: " after" };
  const result = validateCreateCommentMessage({ type: "CREATE_COMMENT", payload });
  assert.deepEqual(result.payload, { ...payload, page_title: "Week 2", body: "Needs clarification", category: "general", selected_quote: "this phrase" });
  for (const invalid of [
    { ...payload, selected_quote: "   " },
    { ...payload, prefix: 4 },
    { ...payload, css_selector: "#mixed" },
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
  const payload = { course_id: "123e4567-e89b-12d3-a456-426614174000", page_url: "https://learn.example/mod/page/view.php?id=9", page_title: "Week 2", body: "No", category: "general", anchor_type: "text_highlight", selected_quote: "phrase", prefix: "", suffix: "" };
  let creates = 0;
  await assert.rejects(() => handleCreateCommentBridge({ type: "CREATE_COMMENT", payload }, { id: "ours", url: payload.page_url }, { authorize: async () => true, contextMatches: () => false, create: async () => { creates += 1; } }), /context mismatch/);
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
    list: async (courseId, requestedPage) => { requested = { courseId, pageUrl: requestedPage }; return [{ id: "00000000-0000-4000-8000-000000000001", body: "Feedback", category: "general", status: "open", author: { display_name: "beta@example.test", role: "beta_tester" }, page_url: requestedPage, page_title: "Topic", anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#main", dom_selector: null, relative_x: 0.2, relative_y: 0.8, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } }]; },
  });
  assert.deepEqual(requested, { courseId: "00000000-0000-4000-8000-000000000090", pageUrl });
  assert.equal(result.length, 1);
  await assert.rejects(() => handleListPageCommentsBridge({ type: "LIST_PAGE_COMMENTS", page_url: "https://evil.example/x" }, { id: "ours", url: pageUrl }, { authorize: async () => true, courseId: () => "cached", list: async () => [] }), /origin must match/);
});

test("page comment response rejects extra fields and wrong pages", () => {
  const pageUrl = "https://example.test/page";
  const base = { id: "00000000-0000-4000-8000-000000000001", body: "Feedback", category: "general", status: "open", author: { display_name: "beta@example.test", role: "beta_tester" }, page_url: pageUrl, page_title: "Page", anchor_type: "text_highlight", selected_quote: "words", prefix: "before", suffix: "after", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };
  assert.equal(validatePageCommentsResponse([base], pageUrl).length, 1);
  assert.throws(() => validatePageCommentsResponse([{ ...base, secret: true }], pageUrl), /Invalid page comments response/);
  assert.throws(() => validatePageCommentsResponse([{ ...base, page_url: "https://example.test/other" }], pageUrl), /Invalid page comments response/);
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
