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
const storedHighlight = { id: "00000000-0000-4000-8000-000000000001", body: "Clarify this", category: "general", status: "open", author_user_id: "00000000-0000-4000-8000-000000000002", author_role: "beta_tester", author_email: "beta@example.test", page_url: context.page_url, page_title: "Week 2", anchor_type: "text_highlight" as const, selected_quote: "important phrase", prefix: "An ", suffix: " here", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [{ id: "00000000-0000-4000-8000-000000000003", body: "LD reply", author_user_id: "00000000-0000-4000-8000-000000000004", author_role: "ld_dcd", author_email: "ld@example.test" }], status_history: [] };

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

test("stored highlight has a mounted keyboard button that opens its thread and cleans up", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = "<p>An important phrase here</p>";
  const overlay = mountReviewOverlay(document, context, "connected");
  overlay.setPageComments([storedHighlight]);
  const marker = document.querySelector<HTMLButtonElement>("[data-moodle-review-stored-highlight]")!;
  assert.ok(marker); assert.equal(marker.type, "button"); assert.match(marker.getAttribute("aria-label")!, /Clarify this/);
  marker.click();
  assert.match(document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!.textContent!, /LD reply/);
  overlay.destroy(); assert.equal(document.querySelector("[data-moodle-review-stored-highlight]"), null);
});

test("take to context retries a late text anchor and reports an accessible failure with its quote", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected");
  overlay.setPageComments([storedHighlight]);
  assert.equal(document.querySelector("[data-moodle-review-stored-highlight]"), null);
  document.body.insertAdjacentHTML("afterbegin", "<p>An important phrase here</p>");
  assert.equal(overlay.takeToContext(storedHighlight.id), true);
  assert.ok(document.querySelector("[data-moodle-review-stored-highlight]"));
  document.querySelector("p")!.remove(); overlay.setPageComments([storedHighlight]);
  assert.equal(overlay.takeToContext(storedHighlight.id), false);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  assert.match(shadow.querySelector('[data-recovery-status]')!.textContent!, /original content could not be found/);
  assert.match(shadow.querySelector("blockquote")!.textContent!, /important phrase/);
});

test("saves against the composer snapshot before offering a separate retryable screenshot action", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  window.document.body.innerHTML = "<p>selected phrase</p>";
  const text = window.document.querySelector("p")!.firstChild!; const range = window.document.createRange(); range.selectNodeContents(text); window.getSelection()!.addRange(range);
  const calls: string[] = []; let submitted: any;
  const overlay = mountReviewOverlay(document, context, "connected", {
    submit: async (input) => { calls.push("create"); submitted = input; return { id: "123e4567-e89b-12d3-a456-426614174001" }; },
    captureScreenshot: async () => { calls.push("media"); return "data:image/png;base64,aA=="; },
    uploadScreenshot: async () => { calls.push("upload"); },
  });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="highlight"]')!.click();
  (shadow.querySelector("textarea") as HTMLTextAreaElement).value = "Keep original";
  (shadow.querySelector("[data-screenshot]") as HTMLInputElement).checked = true;
  overlay.update({ ...context, page_url: "https://learn.example/mod/page/view.php?id=9", pageTitle: "Week 9" }, "connected");
  assert.match(shadow.textContent!, /will stay attached/);
  shadow.querySelector<HTMLElement>("[data-save]")!.click(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["create"]); assert.equal(submitted.contextSnapshot.page_url, context.page_url);
  assert.match(shadow.textContent!, /Capture screenshot now/);
  shadow.querySelector<HTMLElement>("[data-capture]")!.click(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["create", "media", "upload"]);
});
