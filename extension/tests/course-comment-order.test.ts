import assert from "node:assert/strict";
import test from "node:test";

import { projectCourseComments } from "../src/course-comment-order.ts";

type Comment = { id: string; page_url: string; page_title: string; status: string };

const comment = (id: string, page_title: string, page_url = `https://learn.example/page/${id}`): Comment => ({ id, page_url, page_title, status: "open" });

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
