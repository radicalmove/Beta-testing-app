import assert from "node:assert/strict";
import test from "node:test";

import { detectCourseContext, normalizePageUrl } from "../src/course-context.ts";

test("extracts a numeric Moodle course id from supported query parameters", () => {
  for (const url of [
    "https://learn.example/course/view.php?id=42",
    "https://learn.example/mod/page/view.php?course=42&id=900",
  ]) {
    assert.equal(detectCourseContext({ url, title: "Law" }).moodle_course_id, 42);
  }
});

test("prefers explicit Moodle DOM/config course id over URL parameters", () => {
  const context = detectCourseContext({
    url: "https://learn.example/course/view.php?id=42",
    title: "Law",
    explicitCourseId: "77",
  });
  assert.equal(context.moodle_course_id, 77);
});

test("does not guess a course id from unrelated numeric paths or activity ids", () => {
  assert.equal(detectCourseContext({ url: "https://learn.example/mod/page/view.php?id=900", title: "Page" }).moodle_course_id, undefined);
  assert.equal(detectCourseContext({ url: "https://learn.example/users/1234/profile", title: "Profile" }).moodle_course_id, undefined);
});

test("uses the page title and normalizes HTTP page identity", () => {
  const context = detectCourseContext({
    url: "HTTPS://Learn.Example/course/view.php?id=42&utm_source=email&sesskey=secret#section-2",
    title: "  Criminal Law: Week 2  ",
  });
  assert.equal(context.title, "Criminal Law: Week 2");
  assert.equal(context.course_url, "https://learn.example/course/view.php?id=42");
  assert.equal(normalizePageUrl("https://learn.example/mod/page/view.php?id=9&section=2&fbclid=x"), "https://learn.example/mod/page/view.php?id=9&section=2");
});

test("rejects non-HTTP contexts and creates stable temporary identity without a numeric course id", () => {
  assert.throws(() => detectCourseContext({ url: "javascript:alert(1)", title: "Bad" }), /HTTP/);
  const first = detectCourseContext({ url: "https://learn.example/local/catalogue?category=law", title: "Law" });
  const second = detectCourseContext({ url: "https://learn.example/local/catalogue?category=law#top", title: "Law" });
  assert.equal(first.moodle_course_id, undefined);
  assert.match(first.temporaryIdentity!, /^temporary:/);
  assert.equal(first.temporaryIdentity, second.temporaryIdentity);
});
