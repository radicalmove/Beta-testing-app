import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import type { PageComment } from "../src/background-bridge.ts";
import type { CommentRenderer } from "../src/comment-renderer.ts";
import { createScormWorker } from "../src/scorm-worker.ts";
import { validateScormAckFor, type ScormCommand, type ScormEvent } from "../src/scorm-protocol.ts";
import { COMMENT_MARKER_CURSOR } from "../src/ui/comment-cursor.ts";

const workerInstanceId = "223e4567-e89b-42d3-a456-426614174000";
const courseId = "123e4567-e89b-12d3-a456-426614174000";
const requestId = "323e4567-e89b-42d3-a456-426614174000";

function pageIdentity(window: Window) {
  const identity = new URL(window.location.href);
  identity.hash = "moodle-review-page=Lesson%201";
  return { pageUrl: identity.href, pageTitle: "Embedded activity · Lesson 1" };
}

function command<T extends ScormCommand["type"]>(window: Window, type: T, payload: Extract<ScormCommand, { type: T }>["payload"]): Extract<ScormCommand, { type: T }> {
  return {
    protocol: 1,
    type,
    request_id: requestId,
    worker_instance_id: workerInstanceId,
    generation: 4,
    course_id: courseId,
    page_url: pageIdentity(window).pageUrl,
    payload,
  } as Extract<ScormCommand, { type: T }>;
}

function selectText(window: Window, text: Text, start: number, end: number) {
  const range = window.document.createRange();
  range.setStart(text as any, start); range.setEnd(text as any, end);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  window.document.dispatchEvent(new window.Event("selectionchange"));
}

function createHarness(navigate?: (destination: URL, mode: "hash" | "route") => boolean) {
  const window = new Window({ url: "https://rise.example/activity#/lesson/1" });
  window.document.title = "Lesson 1";
  window.document.body.innerHTML = "<main><h1>Lesson 1</h1><p id='copy'>Meaningful Rise lesson content.</p><button id='area'>Area</button></main>";
  const events: ScormEvent[] = [];
  let refresh: (() => void) | undefined;
  let tornDown = false;
  const projections: PageComment[][] = [];
  let rendererDestroyed = 0;
  let takenToContext = "";
  const createRenderer = (_document: Document, _pageUrl: string): CommentRenderer => ({
    setComments: (comments) => { projections.push(comments); },
    setStatusFilter: () => {},
    orderedCommentIds: () => [],
    takeToContext: (commentId) => { takenToContext = commentId; return true; },
    destroy: () => { rendererDestroyed += 1; },
  });
  const worker = createScormWorker({
    window: window as unknown as globalThis.Window & typeof globalThis,
    document: window.document as unknown as Document,
    workerInstanceId,
    generation: 4,
    courseId,
    emit: (event) => { events.push(event); },
    createRenderer,
    navigate,
    createLifecycle: (_window, _document, callback) => { refresh = callback; return { teardown: () => { tornDown = true; }, flush: callback }; },
  });
  return { window, events, projections, worker, refresh: () => refresh?.(), rendererDestroyed: () => rendererDestroyed, tornDown: () => tornDown, takenToContext: () => takenToContext };
}

test("embedded worker mounts no review toolbar host", () => {
  const { window, worker } = createHarness();
  assert.equal(window.document.querySelector("#moodle-course-review-overlay"), null);
  assert.equal(window.document.querySelector("[data-moodle-review-renderer-root]"), null, "the injected test renderer owns no toolbar or host");
  worker.destroy();
});

test("selectionchange caches a valid range and start-selection consumes its stable anchor", () => {
  const { window, events, worker } = createHarness();
  const text = window.document.querySelector("#copy")!.firstChild as unknown as Text;
  selectText(window, text, 0, 10);
  assert.equal(events.at(-1)?.type, "SCORM_SELECTION_CHANGED");
  assert.deepEqual(events.at(-1)?.payload, { has_selection: true });

  const ack = worker.handleCommand(command(window, "SCORM_START_SELECTION", {}));
  assert.equal(ack.ok, true);
  const captured = events.find((event) => event.type === "SCORM_ANCHOR_CAPTURED");
  assert.deepEqual(captured?.payload, {
    page_title: "Embedded activity · Lesson 1",
    embedded_locator: "#/lesson/1",
    anchor_type: "text_highlight",
    selected_quote: "Meaningful",
    prefix: "Lesson 1",
    suffix: " Rise lesson content.Area",
  });
  assert.equal(captured?.page_url, pageIdentity(window).pageUrl);
  assert.deepEqual(events.at(-1)?.payload, { has_selection: false });

  const second = worker.handleCommand({ ...command(window, "SCORM_START_SELECTION", {}), request_id: "423e4567-e89b-42d3-a456-426614174000" });
  assert.equal(second.ok, false, "the cached range is one-use");
  worker.destroy();
});

test("a collapsed selectionchange from clicking the top toolbar preserves the last valid Rise selection", () => {
  const { window, events, worker } = createHarness();
  const text = window.document.querySelector("#copy")!.firstChild as unknown as Text;
  selectText(window, text, 0, 10);
  window.getSelection()!.removeAllRanges();
  window.document.dispatchEvent(new window.Event("selectionchange"));

  const ack = worker.handleCommand(command(window, "SCORM_START_SELECTION", {}));
  assert.equal(ack.ok, true);
  const captured = events.find((event) => event.type === "SCORM_ANCHOR_CAPTURED");
  assert.equal(captured?.type === "SCORM_ANCHOR_CAPTURED" && captured.payload.anchor_type === "text_highlight" ? captured.payload.selected_quote : undefined, "Meaningful");
  worker.destroy();
});

test("a new valid selection replaces the previously cached Rise selection", () => {
  const { window, events, worker } = createHarness();
  const text = window.document.querySelector("#copy")!.firstChild as unknown as Text;
  selectText(window, text, 0, 10);
  selectText(window, text, 11, 15);

  assert.equal(worker.handleCommand(command(window, "SCORM_START_SELECTION", {})).ok, true);
  const captured = events.find((event) => event.type === "SCORM_ANCHOR_CAPTURED");
  assert.equal(captured?.type === "SCORM_ANCHOR_CAPTURED" && captured.payload.anchor_type === "text_highlight" ? captured.payload.selected_quote : undefined, "Rise");
  worker.destroy();
});

test("marker mode changes the cursor, captures one stable pin, and cancel removes the mode", () => {
  const { window, events, worker } = createHarness();
  const area = window.document.querySelector("#area") as unknown as HTMLElement;
  area.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 60, width: 100, height: 40, toJSON: () => ({}) });

  assert.equal(worker.handleCommand(command(window, "SCORM_START_MARKER", {})).ok, true);
  assert.equal(window.document.documentElement.style.cursor, COMMENT_MARKER_CURSOR);
  area.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 30 }) as any);
  const captured = events.find((event) => event.type === "SCORM_ANCHOR_CAPTURED");
  assert.deepEqual(captured?.payload, { page_title: "Embedded activity · Lesson 1", embedded_locator: "#/lesson/1", anchor_type: "visual_pin", css_selector: "#area", relative_x: 0.5, relative_y: 0.25 });
  assert.equal(window.document.documentElement.style.cursor, "");

  worker.handleCommand({ ...command(window, "SCORM_START_MARKER", {}), request_id: "423e4567-e89b-42d3-a456-426614174000" });
  assert.equal(window.document.documentElement.style.cursor, COMMENT_MARKER_CURSOR);
  worker.handleCommand({ ...command(window, "SCORM_CANCEL_MARKER", {}), request_id: "523e4567-e89b-42d3-a456-426614174000" });
  assert.equal(window.document.documentElement.style.cursor, "");
  area.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }) as any);
  assert.equal(events.filter((event) => event.type === "SCORM_ANCHOR_CAPTURED").length, 1);
  worker.destroy();
});

test("navigation clears cached selection and old renderer projection while preserving the existing identity derivation", () => {
  const { window, events, projections, worker, refresh, rendererDestroyed, tornDown } = createHarness();
  selectText(window, window.document.querySelector("#copy")!.firstChild as unknown as Text, 0, 10);
  window.location.hash = "/lesson/2"; window.document.title = "Lesson 2"; window.document.querySelector("h1")!.textContent = "Lesson 2";
  refresh();
  assert.deepEqual(projections.at(-1), []);
  assert.equal(rendererDestroyed(), 1);
  const changed = [...events].reverse().find((event) => event.type === "SCORM_PAGE_IDENTITY_CHANGED");
  const expected = new URL(window.location.href); expected.hash = "moodle-review-page=Lesson%202";
  assert.equal(changed?.page_url, expected.href);
  assert.deepEqual(changed?.payload, { page_title: "Embedded activity · Lesson 2", embedded_locator: "#/lesson/2" });

  const stale = worker.handleCommand({ ...command(window, "SCORM_START_SELECTION", {}), request_id: "423e4567-e89b-42d3-a456-426614174000", page_url: expected.href });
  assert.equal(stale.ok, false);
  worker.destroy();
  assert.equal(tornDown(), true);
});

test("a title mutation clears selection and renderer state even before the visible Rise heading catches up", () => {
  const { window, projections, worker, refresh, rendererDestroyed } = createHarness();
  selectText(window, window.document.querySelector("#copy")!.firstChild as unknown as Text, 0, 10);
  window.document.title = "Lesson 2 loading";
  refresh();
  assert.deepEqual(projections.at(-1), []);
  assert.equal(rendererDestroyed(), 1);
  const attempt = worker.handleCommand({ ...command(window, "SCORM_START_SELECTION", {}), request_id: "423e4567-e89b-42d3-a456-426614174000" });
  assert.equal(attempt.ok, false);
  worker.destroy();
});

test("comment renderer receives whole-course comments while take-to-context remains exact-page", () => {
  const { window, projections, worker, takenToContext } = createHarness();
  const current = pageIdentity(window).pageUrl;
  const other = "https://rise.example/activity#moodle-review-page=Lesson%202";
  const makeComment = (id: string, pageUrl: string): PageComment => ({
    id, body: "Feedback", category: "general", status: "open", author: { display_name: "Reviewer", role: "beta_tester" },
    page_url: pageUrl, page_title: "Embedded activity · Lesson 1", parent_activity_url: null, embedded_locator: null, anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null,
    css_selector: "#area", dom_selector: null, relative_x: 0.5, relative_y: 0.5, replies: [], status_history: [],
    capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: false },
  });
  const currentId = "00000000-0000-4000-8000-000000000001";
  const otherId = "00000000-0000-4000-8000-000000000002";
  const set = { ...command(window, "SCORM_SET_COMMENTS", { comments: [makeComment(otherId, other), makeComment(currentId, current)] }), request_id: "523e4567-e89b-42d3-a456-426614174000" };
  assert.equal(worker.handleCommand(set).ok, true);
  assert.deepEqual(projections.at(-1)?.map(({ id }) => id), [otherId, currentId]);
  assert.equal(worker.handleCommand({ ...command(window, "SCORM_TAKE_TO_CONTEXT", { comment_id: otherId }), request_id: "323e4567-e89b-42d3-a456-426614174000" }).ok, false);
  assert.equal(worker.handleCommand({ ...command(window, "SCORM_TAKE_TO_CONTEXT", { comment_id: currentId }), request_id: "423e4567-e89b-42d3-a456-426614174000" }).ok, true);
  assert.equal(takenToContext(), currentId);
  worker.destroy();
});

test("take-to-context cannot open a comment before its exact worker projection arrives", () => {
  const { window, worker, takenToContext } = createHarness();
  const commentId = "00000000-0000-4000-8000-000000000090";
  const acknowledgement = worker.handleCommand(command(window, "SCORM_TAKE_TO_CONTEXT", { comment_id: commentId }));
  assert.equal(acknowledgement.ok, false);
  assert.equal(acknowledgement.ok ? undefined : acknowledgement.error_code, "COMMENT_NOT_FOUND");
  assert.equal(takenToContext(), "");
  worker.destroy();
});

test("stale-context errors remain correlated to the triggering command after a page identity race", () => {
  const { window, worker } = createHarness();
  const stale = { ...command(window, "SCORM_START_MARKER", {}), page_url: "https://rise.example/activity#moodle-review-page=Earlier" };
  const acknowledgement = worker.handleCommand(stale);
  assert.equal(acknowledgement.ok, false);
  assert.equal(acknowledgement.ok ? undefined : acknowledgement.error_code, "STALE_CONTEXT");
  assert.doesNotThrow(() => validateScormAckFor(stale, acknowledgement));
  worker.destroy();
});

test("apply-locator navigates a validated same-origin route without dropping its query or hash", () => {
  const { window, worker } = createHarness();
  const apply = command(window, "SCORM_APPLY_LOCATOR", { embedded_locator: "/activity/lesson/2?mode=review#/step/3" });
  const acknowledgement = worker.handleCommand(apply);
  assert.equal(acknowledgement.ok, true);
  assert.equal(window.location.href, "https://rise.example/activity/lesson/2?mode=review#/step/3");
  worker.destroy();
});

test("apply-locator retains hash-only Rise navigation on the current document", () => {
  const { window, worker } = createHarness();
  const apply = command(window, "SCORM_APPLY_LOCATOR", { embedded_locator: "#/lesson/4" });
  const acknowledgement = worker.handleCommand(apply);
  assert.equal(acknowledgement.ok, true);
  assert.equal(window.location.href, "https://rise.example/activity#/lesson/4");
  worker.destroy();
});

test("a confirmed Rise cover activation cannot trap the following locator while Start persists", () => {
  let navigations = 0;
  const { window, worker, refresh } = createHarness(() => { navigations += 1; return true; });
  window.document.body.innerHTML = '<main><h1>Course cover</h1><a class="one-page-cover__start-link" aria-label="Start" href="#/lessons/first">Start</a></main>';
  const start = window.document.querySelector(".one-page-cover__start-link") as unknown as HTMLAnchorElement;
  let starts = 0; start.addEventListener("click", (event: Event) => { event.preventDefault(); starts += 1; window.location.hash = "/lessons/first"; window.document.title = "Lesson 1"; window.document.querySelector("h1")!.textContent = "Lesson 1"; });

  const first = worker.handleCommand(command(window, "SCORM_ACTIVATE_COVER", {}));
  assert.equal(first.ok, true);
  assert.equal(starts, 1);
  assert.equal(navigations, 0);

  refresh();
  const second = worker.handleCommand({ ...command(window, "SCORM_APPLY_LOCATOR", { embedded_locator: "#/lessons/saved" }), request_id: "423e4567-e89b-42d3-a456-426614174000" });
  assert.equal(second.ok, true);
  assert.equal(navigations, 1);
  worker.destroy();
});

test("cover activation stays retryable until one exact valid Rise Start link exists", () => {
  const { window, worker } = createHarness();
  for (const markup of [
    "<main><h1>Loading</h1></main>",
    '<a class="one-page-cover__start-link" aria-label="Start" href="#/lessons/one">One</a><a class="one-page-cover__start-link" aria-label="Start" href="#/lessons/two">Two</a>',
    '<a class="one-page-cover__start-link" aria-label="Start" href="javascript:void(0)">Start</a>',
  ]) {
    window.document.body.innerHTML = markup;
    const acknowledgement = worker.handleCommand({ ...command(window, "SCORM_ACTIVATE_COVER", {}), request_id: window.crypto.randomUUID() });
    assert.equal(acknowledgement.ok, false);
    assert.equal(acknowledgement.ok ? undefined : acknowledgement.error_code, "COVER_NOT_READY");
  }
  worker.destroy();
});

test("apply-locator does not acknowledge success when route navigation fails", () => {
  const attempts: Array<{ href: string; mode: string }> = [];
  const { window, worker } = createHarness((destination, mode) => {
    attempts.push({ href: destination.href, mode });
    return false;
  });
  const apply = command(window, "SCORM_APPLY_LOCATOR", { embedded_locator: "/activity/lesson/2?mode=review#/step/3" });
  const acknowledgement = worker.handleCommand(apply);
  assert.equal(acknowledgement.ok, false);
  assert.equal(acknowledgement.ok ? undefined : acknowledgement.error_code, "NAVIGATION_FAILED");
  assert.deepEqual(attempts, [{ href: "https://rise.example/activity/lesson/2?mode=review#/step/3", mode: "route" }]);
  worker.destroy();
});
