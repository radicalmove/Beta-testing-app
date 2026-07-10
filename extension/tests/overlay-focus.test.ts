import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { createOverlayMarkup, handleDialogKey, mountReviewOverlay, OVERLAY_HOST_ID, overlayStyles } from "../src/overlay/root.ts";

test("overlay markup is a compact accessible toolbar with course and connection state", () => {
  const markup = createOverlayMarkup({ courseTitle: "Criminal Law", pageTitle: "Week 2", status: "connected" });
  assert.match(markup, /role="toolbar"/);
  assert.match(markup, /aria-label="Course review tools"/);
  assert.match(markup, /Highlight text/);
  assert.match(markup, /Add pin/);
  assert.match(markup, /Criminal Law/);
  assert.match(markup, /Week 2/);
  assert.match(markup, /Connected/);
  assert.match(markup, />Course:<\/span>/);
  assert.match(markup, />Page:<\/span>/);
  assert.match(markup, />Connection:<\/span>/);
  assert.match(createOverlayMarkup({ courseTitle: "Law", pageTitle: "Week 2", status: "pending" }), /Account pending/);
});

const context = { course_url: "https://learn.example/course/view.php?id=1", page_url: "https://learn.example/mod/page/view.php?id=2", title: "Law", pageTitle: "Week 2", moodle_course_id: 1 };

test("mounted Shadow DOM traps focus, closes on Escape, and returns focus", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  mountReviewOverlay(document, context);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const trigger = shadow.querySelector<HTMLElement>('[data-action="highlight"]')!;
  trigger.click();
  const textarea = shadow.querySelector<HTMLElement>("textarea")!;
  const cancel = shadow.querySelector<HTMLElement>("[data-cancel]")!;
  const save = shadow.querySelector<HTMLElement>(".primary")!;
  assert.equal(shadow.activeElement, textarea);
  save.focus();
  save.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }) as unknown as Event);
  assert.equal(shadow.activeElement, textarea);
  textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }) as unknown as Event);
  assert.equal(shadow.activeElement, save);
  cancel.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(shadow.querySelector(".dialog"), null);
  assert.equal(shadow.activeElement, trigger);
});

test("mounting twice reuses one host and host selectors cannot reach shadow internals", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  document.head.innerHTML = "<style>body div button{display:none}</style>";
  mountReviewOverlay(document, context);
  mountReviewOverlay(document, context);
  assert.equal(document.querySelectorAll(`#${OVERLAY_HOST_ID}`).length, 1);
  assert.equal(document.querySelector("body div button"), null);
  assert.ok(document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!.querySelector("button"));
});

test("dialog keyboard controller traps focus, closes on Escape, and returns focus", () => {
  assert.deepEqual(handleDialogKey({ key: "Tab", shiftKey: false, activeIndex: 2, focusableCount: 3 }), { focusIndex: 0, close: false });
  assert.deepEqual(handleDialogKey({ key: "Tab", shiftKey: true, activeIndex: 0, focusableCount: 3 }), { focusIndex: 2, close: false });
  assert.deepEqual(handleDialogKey({ key: "Escape", shiftKey: false, activeIndex: 1, focusableCount: 3 }), { focusIndex: 1, close: true });
});

test("overlay uses a unique shadow host and scoped styles", () => {
  assert.equal(OVERLAY_HOST_ID, "moodle-course-review-overlay");
  assert.match(overlayStyles, /:host/);
  assert.match(overlayStyles, /--review-navy/);
  assert.doesNotMatch(overlayStyles, /(?:^|})\s*(?:body|html)\s*\{/);
});
