import assert from "node:assert/strict";
import test from "node:test";

import { authorizeResolveSender, handleCreateCommentBridge, handleResolveCourseBridge, normalizeErrorMessage, validateCancelScreenshotMessage, validateCreateCommentMessage, validateResolveCourseMessage, validateUploadScreenshotMessage } from "../src/background-bridge.ts";

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
