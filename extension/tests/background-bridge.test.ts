import assert from "node:assert/strict";
import test from "node:test";

import { authorizeResolveSender, handleResolveCourseBridge, normalizeErrorMessage, validateResolveCourseMessage } from "../src/background-bridge.ts";

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
