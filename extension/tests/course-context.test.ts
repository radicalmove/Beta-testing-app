import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";
import { readFileSync } from "node:fs";

import { canonicalCourseUrlFromDocument, courseTitleFromDocument, detectCourseContext, explicitActivityIdFromDocument, explicitCourseIdFromDocument, normalizePageUrl } from "../src/course-context.ts";

function ucOnlineFixture(name: string, url: string): Document {
  const window = new Window({ url });
  window.document.documentElement.innerHTML = readFileSync(new URL(`fixtures/uco/${name}.html`, import.meta.url), "utf8");
  return window.document as unknown as Document;
}

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

test("unconfirmed title-only identity is page-bound and cannot merge same-title courses", () => {
  const week1 = detectCourseContext({ url: "https://learn.example/mod/page/view.php?id=10", title: "Criminal Law", pageTitle: "Week 1" });
  const week2 = detectCourseContext({ url: "https://learn.example/mod/quiz/view.php?id=20", title: "Criminal Law", pageTitle: "Week 2" });
  assert.notEqual(week1.course_url, week2.course_url);
  assert.notEqual(week1.temporaryIdentity, week2.temporaryIdentity);
  assert.equal(week1.identityConfidence, "unconfirmed");
});

test("same-title courses use breadcrumb course URLs as distinct stable boundaries across pages", () => {
  const oneA = detectCourseContext({ url: "https://learn.example/mod/page/view.php?id=10", title: "Law", canonicalCourseUrl: "/course/view.php?id=71" });
  const oneB = detectCourseContext({ url: "https://learn.example/mod/quiz/view.php?id=11", title: "Law", canonicalCourseUrl: "/course/view.php?id=71" });
  const two = detectCourseContext({ url: "https://learn.example/mod/page/view.php?id=12", title: "Law", canonicalCourseUrl: "/course/view.php?id=72" });
  assert.equal(oneA.course_url, oneB.course_url);
  assert.notEqual(oneA.course_url, two.course_url);
  assert.equal(oneA.identityConfidence, "confirmed");
});

test("uses an explicit canonical course link as the stable boundary", () => {
  const context = detectCourseContext({
    url: "https://learn.example/mod/page/view.php?id=10",
    title: "Criminal Law",
    canonicalCourseUrl: "https://learn.example/course/view.php?id=77&utm_source=x",
  });
  assert.equal(context.course_url, "https://learn.example/course/view.php?id=77");
  assert.equal(context.moodle_course_id, 77);
});

test("DOM course id extraction skips invalid candidates", () => {
  const window = new Window();
  window.document.body.dataset.courseid = "javascript:alert(1)";
  window.document.head.innerHTML = '<meta name="moodle-course-id" content="42">';
  assert.equal(explicitCourseIdFromDocument(window.document as unknown as Document), "42");
  window.document.head.innerHTML = '<meta name="moodle-course-id" content="nope">';
  window.document.body.className = "format-topics course-91";
  assert.equal(explicitCourseIdFromDocument(window.document as unknown as Document), "91");
});

test("DOM extraction prefers breadcrumb course title and supports course boundary attributes", () => {
  const window = new Window({ url: "https://learn.example/mod/page/view.php?id=9" });
  window.document.body.innerHTML = `<h1>Week 4 activity</h1><nav class="breadcrumb"><a href="/course/view.php?id=82">Criminal Law</a></nav><main data-courseurl="/course/view.php?id=82"></main>`;
  const document = window.document as unknown as Document;
  assert.equal(courseTitleFromDocument(document), "Criminal Law");
  assert.equal(canonicalCourseUrlFromDocument(document), "/course/view.php?id=82");
});

test("DOM course URL extraction follows trust priority rather than DOM order", () => {
  const window = new Window({ url: "https://learn.example/mod/page/view.php?id=9" });
  window.document.body.innerHTML = `<a href="/course/view.php?id=11">Unrelated course</a><nav class="breadcrumb"><a href="/course/view.php?id=82">Criminal Law</a></nav><main data-course-url="/course/view.php?id=91"></main>`;
  assert.equal(canonicalCourseUrlFromDocument(window.document as unknown as Document), "/course/view.php?id=91");

  window.document.querySelector("[data-course-url]")?.remove();
  assert.equal(canonicalCourseUrlFromDocument(window.document as unknown as Document), "/course/view.php?id=82");
});

test("DOM course URL extraction ignores random course links", () => {
  const window = new Window({ url: "https://learn.example/mod/page/view.php?id=9" });
  window.document.body.innerHTML = `<main><a href="/course/view.php?id=999">Visit another course</a></main>`;
  assert.equal(canonicalCourseUrlFromDocument(window.document as unknown as Document), undefined);
});

test("canonical link is accepted only for the current course page", () => {
  const current = new Window({ url: "https://learn.example/course/view.php?id=82" });
  current.document.head.innerHTML = `<link rel="canonical" href="https://learn.example/course/view.php?id=82">`;
  assert.equal(canonicalCourseUrlFromDocument(current.document as unknown as Document), "https://learn.example/course/view.php?id=82");

  const lesson = new Window({ url: "https://learn.example/mod/page/view.php?id=9" });
  lesson.document.head.innerHTML = `<link rel="canonical" href="https://learn.example/course/view.php?id=999">`;
  assert.equal(canonicalCourseUrlFromDocument(lesson.document as unknown as Document), undefined);
});

test("UC Online course, section, and page routes keep Moodle identifiers in their proper roles", () => {
  const course = detectCourseContext({ url: "https://my.uconline.ac.nz/course/view.php?id=896", title: "CRJU150" });
  const sectionDocument = ucOnlineFixture("section", "https://my.uconline.ac.nz/course/section.php?id=9972");
  const pageDocument = ucOnlineFixture("page", "https://my.uconline.ac.nz/mod/page/view.php?id=118172");
  const section = detectCourseContext({
    url: sectionDocument.location.href,
    title: courseTitleFromDocument(sectionDocument),
    explicitCourseId: explicitCourseIdFromDocument(sectionDocument),
    canonicalCourseUrl: canonicalCourseUrlFromDocument(sectionDocument),
  });
  const page = detectCourseContext({
    url: pageDocument.location.href,
    title: courseTitleFromDocument(pageDocument),
    explicitCourseId: explicitCourseIdFromDocument(pageDocument),
    canonicalCourseUrl: canonicalCourseUrlFromDocument(pageDocument),
  });

  assert.equal(course.moodle_course_id, 896);
  assert.equal(section.moodle_course_id, 896);
  assert.equal(page.moodle_course_id, 896);
  assert.equal(section.page_url, "https://my.uconline.ac.nz/course/section.php?id=9972");
  assert.equal(page.page_url, "https://my.uconline.ac.nz/mod/page/view.php?id=118172");
  assert.notEqual(section.page_url, page.page_url);
  assert.notEqual(section.moodle_course_id, 9972);
  assert.notEqual(page.moodle_course_id, 118172);
});

test("UC Online queryless SCORM player uses its cmid as stable navigable page identity", () => {
  const document = ucOnlineFixture("scorm-player", "https://my.uconline.ac.nz/mod/scorm/player.php");
  const activityId = explicitActivityIdFromDocument(document);
  const first = detectCourseContext({
    url: document.location.href,
    title: courseTitleFromDocument(document),
    pageTitle: document.title,
    explicitCourseId: explicitCourseIdFromDocument(document),
    explicitActivityId: activityId,
    canonicalCourseUrl: canonicalCourseUrlFromDocument(document),
  });
  const second = detectCourseContext({
    url: "https://my.uconline.ac.nz/mod/scorm/player.php#embedded-content",
    title: courseTitleFromDocument(document),
    pageTitle: document.title,
    explicitCourseId: explicitCourseIdFromDocument(document),
    explicitActivityId: activityId,
  });
  const otherPackage = detectCourseContext({
    url: "https://my.uconline.ac.nz/mod/scorm/player.php",
    title: "Other package",
    explicitCourseId: "896",
    explicitActivityId: "146309",
  });

  assert.equal(activityId, "146308");
  assert.equal(first.moodle_course_id, 896);
  assert.notEqual(first.moodle_course_id, 146308);
  assert.equal(first.page_url, "https://my.uconline.ac.nz/mod/scorm/view.php?id=146308");
  assert.equal(second.page_url, first.page_url);
  assert.notEqual(otherPackage.page_url, first.page_url);
  assert.equal(first.pageTitle, "Legal Method interactive activity");
  assert.equal(first.title, "CRJU150 – Legal Method – MAIN COPY");
});

test("UC Online activity extraction never mistakes Moodle context ids for cmids", () => {
  const document = ucOnlineFixture("scorm-context-only", "https://my.uconline.ac.nz/mod/scorm/player.php");
  assert.equal(explicitActivityIdFromDocument(document), undefined);
  assert.equal(explicitCourseIdFromDocument(document), "896");
});

test("SCORM activity extraction accepts an explicit Moodle body dataset cmid", () => {
  const window = new Window({ url: "https://my.uconline.ac.nz/mod/scorm/player.php" });
  window.document.body.dataset.cmid = "146310";
  window.document.body.dataset.contextid = "165233";
  assert.equal(explicitActivityIdFromDocument(window.document as unknown as Document), "146310");
});
