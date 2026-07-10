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

const context = { course_url: "https://learn.example/course/view.php?id=1", page_url: "https://learn.example/mod/page/view.php?id=2", title: "Law", pageTitle: "Week 2", moodle_course_id: 1, identityConfidence: "confirmed" as const };

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

test("updating identity and status preserves an open typed dialog, selection, and focus", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const trigger = shadow.querySelector<HTMLElement>('[data-action="highlight"]')!;
  trigger.click();
  const textarea = shadow.querySelector<HTMLTextAreaElement>("textarea")!;
  textarea.value = "Keep this draft";
  textarea.setSelectionRange(5, 9);
  textarea.focus();
  overlay.update({ ...context, title: "New course", pageTitle: "Week 3" }, "connected");
  assert.equal(shadow.querySelector("textarea"), textarea);
  assert.equal(textarea.value, "Keep this draft");
  assert.deepEqual([textarea.selectionStart, textarea.selectionEnd], [5, 9]);
  assert.equal(shadow.activeElement, textarea);
  assert.match(shadow.querySelector(".course")!.textContent!, /New course/);
  assert.match(shadow.querySelector(".status")!.textContent!, /Connected/);
});

test("mounting twice reuses one host and host selectors cannot reach shadow internals", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  document.head.innerHTML = `<style>body div button{display:none}#${OVERLAY_HOST_ID}{display:none;position:static;z-index:1}</style>`;
  mountReviewOverlay(document, context);
  mountReviewOverlay(document, context);
  assert.equal(document.querySelectorAll(`#${OVERLAY_HOST_ID}`).length, 1);
  assert.equal(document.querySelector("body div button"), null);
  const host = document.getElementById(OVERLAY_HOST_ID)!;
  assert.ok(host.shadowRoot!.querySelector("button"));
  const computed = window.getComputedStyle(host as unknown as Parameters<typeof window.getComputedStyle>[0]);
  assert.equal(computed.display, "block");
  assert.equal(computed.position, "fixed");
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
  assert.match(overlayStyles, /:host\{[^}]*position:fixed[^}]*z-index:2147483647[^}]*isolation:isolate[^}]*display:block/);
  assert.doesNotMatch(overlayStyles, /(?:^|})\s*(?:body|html)\s*\{/);
});

test("unresolved anchors render an accessible compact list with context hooks and hide when empty", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const requested: string[] = [];
  const overlay = mountReviewOverlay(document, context, "connected", { onTakeToContext: (id) => requested.push(id) });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setUnresolvedAnchors([{ id: "c1", label: "Comment one", quote: "missing words" }, { id: "c2", label: "Comment two" }]);
  const region = shadow.querySelector<HTMLElement>("[data-unresolved]")!;
  assert.equal(region.hidden, false);
  assert.match(region.textContent!, /Unresolved comment anchors/);
  assert.match(region.textContent!, /missing words/);
  assert.equal(region.querySelectorAll("li").length, 2);
  (region.querySelector('[data-comment-id="c1"]') as HTMLElement).click();
  assert.deepEqual(requested, ["c1"]);
  overlay.setUnresolvedAnchors([]);
  assert.equal(region.hidden, true);
});
