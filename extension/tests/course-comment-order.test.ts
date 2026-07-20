import assert from "node:assert/strict";
import test from "node:test";

import { coursePageJumpLabel, projectCourseComments } from "../src/course-comment-order.ts";

type Comment = { id: string; page_url: string; page_title: string; status: string };

const comment = (id: string, page_title: string, page_url = `https://learn.example/page/${id}`): Comment => ({ id, page_url, page_title, status: "open" });

test("creates normalized Jump-to labels and removes only the leading embedded activity prefix", () => {
  assert.equal(coursePageJumpLabel("  Embedded activity  ·\t 1.1.2   Sources of law  "), "1.1.2 Sources of law");
  assert.equal(coursePageJumpLabel("EMBEDDED ACTIVITY · Resources"), "Resources");
  assert.equal(coursePageJumpLabel("A note about Embedded activity · 1.1.2"), "A note about Embedded activity · 1.1.2");
  assert.equal(coursePageJumpLabel(" \n\t "), "Untitled page");
});

test("orders unnumbered course pages before naturally ordered dotted course pages", () => {
  const input = [
    comment("later", "1.10 Later"),
    comment("intro", "Course information"),
    comment("middle", "1.3.1 Case law"),
    comment("first", "1 Introduction"),
    comment("early", "1.2 Participants"),
  ];

  const projected = projectCourseComments(input);
  assert.deepEqual(projected.groups.map((group) => group.title), [
    "Course information", "1 Introduction", "1.2 Participants", "1.3.1 Case law", "1.10 Later",
  ]);
  assert.deepEqual(projected.groups.flatMap((group) => group.comments.map((entry) => [entry.comment.id, entry.displayIndex])), [
    ["intro", 1], ["first", 2], ["early", 3], ["middle", 4], ["later", 5],
  ]);
});

test("groups identical pages, preserves server order within a page, and uses stable fallback ordering", () => {
  const input = [
    comment("z-first", "Resources", "https://learn.example/page/z"),
    comment("a-first", "Resources", "https://learn.example/page/a"),
    comment("a-second", "Resources", "https://learn.example/page/a"),
  ];

  const projected = projectCourseComments(input);
  assert.deepEqual(projected.groups.map((group) => group.pageUrl), ["https://learn.example/page/a", "https://learn.example/page/z"]);
  assert.deepEqual(projected.groups[0]!.comments.map((entry) => entry.comment.id), ["a-first", "a-second"]);
});

test("sorts unnumbered destinations by their visible Jump-to labels", () => {
  const input = [
    comment("beta", "Beta"),
    comment("aardvark", "Embedded activity · Aardvark"),
  ];

  const projected = projectCourseComments(input);

  assert.deepEqual(projected.groups.map((group) => group.title), ["Embedded activity · Aardvark", "Beta"]);
});

test("orders shuffled Jump-to destinations by visible label while preserving duplicate labels at separate URLs", () => {
  const input = [
    comment("one-two", "Embedded activity · 1.1.2", "https://learn.example/page/1.1.2"),
    comment("support", "Support services"),
    comment("one-one", "Embedded activity · 1.1.1", "https://learn.example/page/1.1.1"),
    comment("institutions", "2 Institutions"),
    comment("course-info", "Course information"),
    comment("intro", "1 Introduction"),
    comment("duplicate-one", "Embedded activity · 2.1.1", "https://learn.example/page/2.1.1-a"),
    comment("duplicate-two", "Embedded activity · 2.1.1", "https://learn.example/page/2.1.1-b"),
  ];

  const projected = projectCourseComments(input);

  assert.deepEqual(projected.groups.map((group) => [group.title, group.pageUrl]), [
    ["Course information", "https://learn.example/page/course-info"],
    ["Support services", "https://learn.example/page/support"],
    ["1 Introduction", "https://learn.example/page/intro"],
    ["Embedded activity · 1.1.1", "https://learn.example/page/1.1.1"],
    ["Embedded activity · 1.1.2", "https://learn.example/page/1.1.2"],
    ["2 Institutions", "https://learn.example/page/institutions"],
    ["Embedded activity · 2.1.1", "https://learn.example/page/2.1.1-a"],
    ["Embedded activity · 2.1.1", "https://learn.example/page/2.1.1-b"],
  ]);
});

test("canonical numbering is assigned before filters so filtered views retain gaps", () => {
  const input = [comment("one", "1 Introduction"), { ...comment("two", "2 Institutions"), status: "resolved" }, comment("three", "3 Courts")];
  const projected = projectCourseComments(input);
  assert.deepEqual(projected.groups.flatMap((group) => group.comments).filter((entry) => entry.comment.status === "open").map((entry) => entry.displayIndex), [1, 3]);
});

test("does not mutate the authoritative input", () => {
  const input = [comment("two", "2 Later"), comment("one", "1 Earlier")];
  const before = input.map((entry) => entry.id);
  projectCourseComments(input);
  assert.deepEqual(input.map((entry) => entry.id), before);
});
