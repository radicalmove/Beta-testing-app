import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { createOverlayMarkup, handleDialogKey, mountReviewOverlay, OVERLAY_HOST_ID, overlayStyles } from "../src/overlay/root.ts";

test("overlay markup is a compact accessible toolbar with course and connection state", () => {
  const markup = createOverlayMarkup({ courseTitle: "Criminal Law", pageTitle: "Week 2", status: "connected" });
  assert.match(markup, /role="toolbar"/);
  assert.match(markup, /aria-label="Course review tools"/);
  assert.match(markup, /Add comment/);
  assert.match(markup, /Comments \(/); assert.match(markup, /data-comment-count>0/);
  assert.match(markup, /Help and instructions/);
  assert.match(markup, /Criminal Law/);
  assert.match(markup, /Week 2/);
  assert.match(markup, /Connected/);
  assert.doesNotMatch(markup, />Course:<\/span>/);
  assert.doesNotMatch(markup, />Page:<\/span>/);
  assert.match(createOverlayMarkup({ courseTitle: "Law", pageTitle: "Week 2", status: "pending" }), /Waiting for approval/);
});

test("embedded presentation can move absolutely and hide without leaving a duplicate toolbar", () => {
  const window = new Window({ url: "https://rise.example.invalid/lesson" });
  const context = { course_url: "https://moodle.example.invalid/course/view.php?id=1", page_url: window.location.href, title: "Law", pageTitle: "Lesson", identityConfidence: "confirmed" as const };
  const overlay = mountReviewOverlay(window.document as unknown as Document, context, "connected");
  const host = window.document.getElementById(OVERLAY_HOST_ID) as unknown as HTMLElement;
  const shell = host.shadowRoot!.querySelector<HTMLElement>(".shell")!;
  overlay.setPresentationPosition({ left: 120, top: 840 });
  assert.equal(host.style.position, "absolute");
  assert.equal(host.style.left, "120px");
  assert.equal(host.style.top, "840px");
  assert.equal(shell.style.position, "static");
  overlay.setPresentationVisible(false);
  assert.equal(host.style.getPropertyValue("display"), "none");
  overlay.setPresentationVisible(true);
  assert.equal(host.style.getPropertyValue("display"), "block");
  overlay.destroy();
});

const context = { course_url: "https://learn.example/course/view.php?id=1", page_url: "https://learn.example/mod/page/view.php?id=2", title: "Law", pageTitle: "Week 2", moodle_course_id: 1, identityConfidence: "confirmed" as const };
const storedHighlight = { id: "00000000-0000-4000-8000-000000000001", body: "Clarify this", category: "general", status: "open", author: { display_name: "beta@example.test", role: "beta_tester" }, page_url: context.page_url, page_title: "Week 2", parent_activity_url: null, embedded_locator: null, anchor_type: "text_highlight" as const, selected_quote: "important phrase", prefix: "An ", suffix: " here", css_selector: null, dom_selector: null, relative_x: null, relative_y: null, replies: [{ id: "00000000-0000-4000-8000-000000000003", body: "LD reply", author: { display_name: "ld@example.test", role: "ld_dcd" } }], status_history: [], capabilities: { can_reply: true, can_change_status: false, can_share_with_sme: false, can_delete: true } };

test("mounted Shadow DOM traps focus, closes on Escape, and returns focus", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  window.document.body.innerHTML = "<p>Selected words</p>"; const range = window.document.createRange(); range.selectNodeContents(window.document.querySelector("p")!.firstChild!); window.getSelection()!.addRange(range);
  mountReviewOverlay(document, context);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const trigger = shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!;
  trigger.click();
  const textarea = shadow.querySelector<HTMLElement>("textarea")!;
  const cancel = shadow.querySelector<HTMLElement>("[data-cancel]")!;
  const save = shadow.querySelector<HTMLElement>("[data-save]")!;
  assert.equal(shadow.activeElement, textarea);
  assert.equal(save.getAttribute("aria-label"), "Save comment");
  cancel.focus();
  cancel.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }) as unknown as Event);
  assert.equal(shadow.activeElement, textarea);
  textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }) as unknown as Event);
  assert.equal(shadow.activeElement, cancel);
  cancel.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(shadow.querySelector(".dialog"), null);
  assert.equal(shadow.activeElement, trigger);
});

test("initial comment creation uses the shared composer controls", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  window.document.body.innerHTML = "<p>Selected words</p>";
  const range = window.document.createRange(); range.selectNodeContents(window.document.querySelector("p")!.firstChild!); window.getSelection()!.addRange(range);
  mountReviewOverlay(document, context);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!.click();

  const composer = shadow.querySelector<HTMLElement>(".comment-composer")!;
  const row = composer.querySelector<HTMLElement>(".comment-composer-field-row")!;
  const save = row.querySelector<HTMLElement>("[data-save]")!;
  const actions = composer.querySelector<HTMLElement>(".comment-composer-actions")!;
  assert.deepEqual(Array.from(row.children).map((node) => node.tagName), ["TEXTAREA", "BUTTON"]);
  assert.equal(save.getAttribute("aria-label"), "Save comment");
  assert.equal(save.title, "Save comment");
  assert.ok(save.querySelector('[data-review-icon="save"]'));
  assert.equal(row.nextElementSibling?.classList.contains("field"), true);
  assert.equal(composer.lastElementChild, actions);
  assert.deepEqual(Array.from(actions.children).map((node) => node.textContent), ["Cancel"]);
  assert.equal(composer.querySelector("[data-thread-navigation]"), null);
  assert.equal(composer.nextElementSibling?.classList.contains("error"), true);
  const styles = Array.from(shadow.querySelectorAll("style")).map((node) => node.textContent).join("");
  assert.match(styles, /\.comment-composer-field-row\{display:grid;grid-template-columns:minmax\(0,1fr\) 34px;gap:8px/);
  assert.match(styles, /@media\(max-width:420px\)\{\.comment-composer-actions button\{flex:0 0 auto\}/);
});

test("marker placement cancels with Escape and restores Add comment focus", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setCommentList([storedHighlight]);
  const panelContent = shadow.querySelector<HTMLElement>("[data-panel-content]")!;
  const originalComment = panelContent.querySelector<HTMLElement>("[data-comment-item]");
  const trigger = shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!;
  trigger.click();
  assert.ok(shadow.querySelector("[data-marker-instruction]"));
  assert.equal(panelContent.hidden, true);
  assert.equal(panelContent.querySelector("[data-comment-item]"), originalComment);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(shadow.querySelector("[data-marker-instruction]"), null);
  assert.equal(panelContent.hidden, false);
  assert.equal(panelContent.querySelector("[data-comment-item]"), originalComment);
  assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, true);
  assert.equal(shadow.activeElement, trigger);
  overlay.destroy();
});

test("Cancel marker restores an already-open comments panel and its rendered list", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setCommentList([storedHighlight]);
  shadow.querySelector<HTMLElement>('[data-action="panel"]')!.click();
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const panelContent = shadow.querySelector<HTMLElement>("[data-panel-content]")!;
  const originalComment = panelContent.querySelector<HTMLElement>("[data-comment-item]");

  const marker = shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!;
  marker.click();
  const instruction = shadow.querySelector<HTMLElement>("[data-marker-instruction]")!;
  assert.equal(panelContent.hidden, false);
  assert.equal(panelContent.querySelector("[data-comment-item]"), originalComment);
  assert.equal(instruction.nextElementSibling, panelContent);
  marker.click();

  assert.equal(shadow.querySelector("[data-marker-instruction]"), null);
  assert.equal(panelContent.hidden, false);
  assert.equal(panelContent.querySelector("[data-comment-item]"), originalComment);
  assert.equal(panel.hidden, false);
  assert.equal(marker.getAttribute("aria-pressed"), "false");
  overlay.destroy();
});

test("marker placement uses the pointer target when Rise element lookup is unavailable", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<section id="rise-block">Rise content</section>';
  const target = document.querySelector<HTMLElement>("#rise-block")!;
  target.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100, toJSON: () => ({}) });
  Object.defineProperty(document, "elementFromPoint", { value: () => null, configurable: true });
  const overlay = mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!.click();
  target.dispatchEvent(new window.PointerEvent("pointerdown", { clientX: 60, clientY: 50, bubbles: true, composed: true }) as unknown as Event);
  assert.ok(shadow.querySelector(".dialog"));
  assert.equal(shadow.querySelector("[data-marker-instruction]"), null);
  assert.equal(shadow.querySelector<HTMLElement>("[data-panel-content]")!.hidden, false);
  overlay.destroy();
});

test("comment refreshes during marker placement are revealed after cancellation", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const trigger = shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!;
  trigger.click();
  overlay.setCommentList([storedHighlight]);
  const panelContent = shadow.querySelector<HTMLElement>("[data-panel-content]")!;
  assert.equal(panelContent.hidden, true);
  assert.match(panelContent.textContent!, /Clarify this/);

  trigger.click();

  assert.equal(panelContent.hidden, false);
  assert.match(panelContent.textContent!, /Clarify this/);
  assert.equal(shadow.querySelector("[data-marker-instruction]"), null);
  overlay.destroy();
});

test("keyboard area selection starts from the last focused eligible page target", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<button id="page-action">Course action</button>';
  const pageAction = document.querySelector<HTMLElement>("#page-action")!;
  pageAction.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50, toJSON: () => ({}) });
  const overlay = mountReviewOverlay(document, context, "connected");
  pageAction.focus();
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!.click();
  assert.match(shadow.querySelector("[data-marker-instruction]")!.textContent!, /arrow keys/);
  assert.match(pageAction.style.outline, /4px/);
  assert.match(pageAction.style.outline, /#d73b3d/);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  assert.ok(shadow.querySelector(".dialog"));
  assert.equal(pageAction.style.outline, "");
  overlay.destroy();
});

test("area selection announces when no eligible page targets exist", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected");
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!.click();
  assert.equal(shadow.querySelector("[data-marker-instruction]")!.textContent, "No selectable areas found; use Comment on text instead.");
  overlay.destroy();
});

test("updating identity and status preserves an open typed dialog, selection, and focus", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  window.document.body.innerHTML = "<p>Selected words</p>"; const range = window.document.createRange(); range.selectNodeContents(window.document.querySelector("p")!.firstChild!); window.getSelection()!.addRange(range);
  const overlay = mountReviewOverlay(document, context);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const trigger = shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!;
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

test("unresolved anchors stay out of the main overlay", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const requested: string[] = [];
  const overlay = mountReviewOverlay(document, context, "connected", { onTakeToContext: (id) => requested.push(id) });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  overlay.setUnresolvedAnchors([{ id: "c1", label: "Comment one", quote: "missing words" }, { id: "c2", label: "Comment two" }]);
  const region = shadow.querySelector<HTMLElement>("[data-unresolved]")!;
  assert.equal(region.hidden, true);
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

test("page annotations stay below Moodle sticky navigation", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = "<p>An important phrase here</p>";
  const overlay = mountReviewOverlay(document, context, "connected");
  overlay.setPageComments([storedHighlight]);
  const marker = document.querySelector<HTMLElement>("[data-moodle-review-stored-highlight]")!;
  const highlight = document.querySelector<HTMLElement>("[data-moodle-review-highlight]")!;
  assert.equal(marker.style.zIndex, "900");
  assert.equal(highlight.style.zIndex, "899");
  assert.equal(document.getElementById(OVERLAY_HOST_ID)!.style.zIndex, "2147483647");
  overlay.destroy();
});

test("frame fallback does not replace loaded comments when shown and hidden", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = "<p>An important phrase here</p>";
  const overlay = mountReviewOverlay(document, context, "connected");
  overlay.setPageComments([storedHighlight]); overlay.showFrameFallback();
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  assert.match(shadow.querySelector(".panel")!.textContent!, /Clarify this/);
  assert.equal(shadow.querySelector("[data-frame-fallback]"), null);
  overlay.hideFrameFallback();
  assert.match(shadow.querySelector(".panel")!.textContent!, /Clarify this/);
  assert.equal(shadow.querySelector("[data-frame-fallback]"), null);
});

test("stored markers share one overlay scroll and resize scheduler", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  document.body.innerHTML = '<div id="target"></div>';
  const counts = { scroll: 0, resize: 0 }; const original = window.addEventListener.bind(window);
  window.addEventListener = ((type: string, listener: any, options?: any) => { if (type === "scroll" || type === "resize") counts[type] += 1; return original(type, listener, options); }) as any;
  const overlay = mountReviewOverlay(document, context, "connected");
  const pin = { ...storedHighlight, anchor_type: "visual_pin" as const, selected_quote: null, prefix: null, suffix: null, css_selector: "#target", relative_x: 0.2, relative_y: 0.3 };
  overlay.setPageComments([pin, { ...pin, id: "00000000-0000-4000-8000-000000000099" }]);
  assert.deepEqual(counts, { scroll: 1, resize: 1 });
  overlay.destroy();
});

test("take to context retries a late text anchor and reports an accessible failure with its quote", () => {
  const window = new Window(); const document = window.document as unknown as Document;
  const overlay = mountReviewOverlay(document, context, "connected");
  overlay.setPageComments([storedHighlight]);
  assert.equal(document.querySelector("[data-moodle-review-stored-highlight]"), null);
  document.body.insertAdjacentHTML("afterbegin", "<p>An important phrase here</p>");
  let contentScrolls = 0; (document.querySelector("p") as any).scrollIntoView = () => { contentScrolls += 1; };
  assert.equal(overlay.takeToContext(storedHighlight.id), true);
  assert.equal(contentScrolls, 1, "navigation must scroll the underlying course content, not the fixed marker");
  assert.ok(document.querySelector("[data-moodle-review-stored-highlight]"));
  document.querySelector("p")!.remove(); overlay.setPageComments([storedHighlight]);
  assert.equal(overlay.takeToContext(storedHighlight.id), false);
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  assert.match(shadow.querySelector('[data-recovery-status]')!.textContent!, /original content could not be found/);
  assert.match(shadow.querySelector("blockquote")!.textContent!, /important phrase/);
});

test("saves against the composer snapshot and offers an optional file attachment", async () => {
  const window = new Window(); const document = window.document as unknown as Document;
  window.document.body.innerHTML = "<p>selected phrase</p>";
  const text = window.document.querySelector("p")!.firstChild!; const range = window.document.createRange(); range.selectNodeContents(text); window.getSelection()!.addRange(range);
  let submitted: any;
  const overlay = mountReviewOverlay(document, context, "connected", {
    submit: async (input) => { submitted = input; return { id: "123e4567-e89b-12d3-a456-426614174001" }; },
  });
  const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  shadow.querySelector<HTMLElement>('[data-action="add-comment"]')!.click();
  (shadow.querySelector("textarea") as HTMLTextAreaElement).value = "Keep original";
  assert.ok(shadow.querySelector("[data-attachment]")); assert.equal(shadow.querySelector("[data-screenshot]"), null);
  overlay.update({ ...context, page_url: "https://learn.example/mod/page/view.php?id=9", pageTitle: "Week 9" }, "connected");
  assert.match(shadow.textContent!, /will stay attached/);
  shadow.querySelector<HTMLElement>("[data-save]")!.click(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(submitted.contextSnapshot.page_url, context.page_url); assert.equal(submitted.screenshot, false);
  assert.equal(shadow.querySelector("[role=dialog]"), null);
});
