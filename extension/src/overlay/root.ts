import type { CourseContext } from "../course-context.ts";
import { captureTextAnchor, type TextAnchor } from "../anchors/text.ts";
import { renderTextHighlight } from "../anchors/recover.ts";
import { capturePinAnchor, renderPin, type PinAnchor } from "../anchors/pin.ts";
import { captureDisplayScreenshot } from "../screenshot-flow.ts";

export const OVERLAY_HOST_ID = "moodle-course-review-overlay";
export const overlayStyles = `:host{--review-navy:#16324f;--review-teal:#087f78;--review-pale:#edf7f6;--review-line:#c8d9dc;all:initial;position:fixed!important;inset:auto!important;z-index:2147483647!important;isolation:isolate;display:block!important;color:#152a38;font:14px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:min(560px,calc(100vw - 36px));background:#fff;border:1px solid var(--review-line);border-radius:12px;box-shadow:0 10px 32px #16324f33;overflow:hidden}.toolbar{display:flex;align-items:center;gap:8px;padding:8px;background:var(--review-navy);color:#fff}.identity{min-width:0;padding:0 6px;flex:1}.course,.page{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.course{font-weight:700}.page{font-size:12px;color:#d7e8ec}button,select,textarea{font:inherit}button{appearance:none;border:1px solid #ffffff66;border-radius:7px;background:#fff;color:var(--review-navy);font-weight:650;padding:7px 9px;cursor:pointer}button:hover{background:var(--review-pale)}button:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #f5b642;outline-offset:2px}.icon{padding:7px 10px}.status{display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:#f5b642}.connected .dot{background:#42d3b4}.signed-out .dot,.offline .dot{background:#ff8d85}.panel,[data-unresolved]{padding:10px;background:#fff;border-top:1px solid var(--review-line)}.panel[hidden],[data-unresolved][hidden]{display:none}[data-unresolved] h2{margin:0;font-size:14px}[data-unresolved] ul{display:grid;gap:6px;margin:6px 0 0;padding:0;list-style:none}[data-unresolved] li{display:flex;align-items:center;justify-content:space-between;gap:8px}.backdrop{position:fixed;inset:0;background:#0b1f3380;display:grid;place-items:center;z-index:2147483647}.dialog{width:min(420px,calc(100vw - 32px));background:#fff;border-radius:12px;padding:18px;box-shadow:0 16px 44px #0005}.dialog h2{margin:0 0 10px;color:var(--review-navy);font-size:18px}.dialog textarea{box-sizing:border-box;width:100%;min-height:110px;border:1px solid var(--review-line);border-radius:7px;padding:8px}.field{display:grid;gap:4px;margin-top:9px}.preview{padding:8px;border-radius:7px;background:var(--review-pale);font-size:12px}.error{color:#a51d24}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.primary{background:var(--review-teal);color:#fff;border-color:var(--review-teal)}`;

export type ConnectionStatus = "connecting" | "connected" | "pending" | "signed-out" | "offline";
const statusLabels: Record<ConnectionStatus, string> = { connecting: "Connecting", connected: "Connected", pending: "Account pending", "signed-out": "Signed out", offline: "Offline" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function createOverlayMarkup(input: { courseTitle: string; pageTitle: string; status: ConnectionStatus }): string {
  return `<section class="shell"><div class="toolbar" role="toolbar" aria-label="Course review tools"><div class="identity"><span class="course"><span class="label">Course:</span> ${escapeHtml(input.courseTitle)}</span><span class="page"><span class="label">Page:</span> ${escapeHtml(input.pageTitle)}</span></div><span class="status ${input.status}" role="status"><span class="label">Connection:</span> <span class="dot" aria-hidden="true"></span>${statusLabels[input.status]}</span><button type="button" data-action="highlight">Highlight text</button><button type="button" data-action="pin">Add pin</button><button class="icon" type="button" data-action="panel" aria-expanded="false" aria-label="Open review panel">☰</button></div><div class="panel" hidden>No comments on this page yet.</div></section>`;
}

export function handleDialogKey(input: { key: string; shiftKey: boolean; activeIndex: number; focusableCount: number }): { focusIndex: number; close: boolean } {
  if (input.key === "Escape") return { focusIndex: input.activeIndex, close: true };
  if (input.key !== "Tab" || input.focusableCount < 1) return { focusIndex: input.activeIndex, close: false };
  const delta = input.shiftKey ? -1 : 1;
  return { focusIndex: (input.activeIndex + delta + input.focusableCount) % input.focusableCount, close: false };
}

export type CommentAnchor = ({ anchor_type: "text_highlight" } & TextAnchor) | ({ anchor_type: "visual_pin" } & PinAnchor);
export type UnresolvedAnchor = { id: string; label: string; quote?: string };
export type ReviewOverlayOptions = { submit?: (input: { body: string; category: string; anchor: CommentAnchor; screenshot: boolean; embeddedFrameUnavailable: boolean; contextSnapshot: CourseContext }) => Promise<{ id?: string; screenshot_available?: boolean } | void>; uploadScreenshot?: (commentId: string, dataUrl: string) => Promise<void>; cancelScreenshot?: (commentId: string) => Promise<void>; captureScreenshot?: () => Promise<string>; onFrameFallback?: () => void; onTakeToContext?: (id: string) => void };
export type ReviewOverlay = { update(context: CourseContext, status: ConnectionStatus): void; showFrameFallback(): void; hideFrameFallback(): void; setUnresolvedAnchors(anchors: UnresolvedAnchor[]): void; destroy(): void };

export function mountReviewOverlay(document: Document, context: CourseContext, status: ConnectionStatus = "connecting", options: ReviewOverlayOptions = {}): ReviewOverlay {
  const existing = document.getElementById(OVERLAY_HOST_ID) as HTMLElement | null;
  if (existing?.shadowRoot) return createController(existing, existing.shadowRoot, context, status, options);
  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  host.setAttribute("data-moodle-review-ui", "true");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;isolation:isolate;display:block";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = overlayStyles;
  shadow.append(style);
  return createController(host, shadow, context, status, options);
}

function createController(host: HTMLElement, shadow: ShadowRoot, initial: CourseContext, initialStatus: ConnectionStatus, options: ReviewOverlayOptions): ReviewOverlay {
  const ownerDocument = host.ownerDocument;
  let context = initial;
  let status = initialStatus;
  let returnFocus: HTMLElement | null = null;
  let previewCleanup: (() => void) | undefined;
  let pinListener: ((event: PointerEvent) => void) | undefined;
  let fallbackPin = false;
  let composerContext: CourseContext | undefined;
  let pendingScreenshotId: string | undefined;
  const cancelPin = (event: KeyboardEvent) => { if (event.key === "Escape" && pinListener) { ownerDocument.removeEventListener("pointerdown", pinListener, true); ownerDocument.removeEventListener("keydown", cancelPin, true); pinListener = undefined; fallbackPin = false; shadow.querySelector<HTMLElement>(".panel")!.hidden = true; returnFocus?.focus(); } };
  const mount = () => {
    const style = shadow.querySelector("style");
    shadow.innerHTML = "";
    if (style) shadow.append(style);
    const wrapper = ownerDocument.createElement("div");
    wrapper.innerHTML = createOverlayMarkup({ courseTitle: context.title, pageTitle: context.pageTitle, status });
    shadow.append(...Array.from(wrapper.childNodes));
    bind();
  };
  const updateLabels = () => {
    const course = shadow.querySelector<HTMLElement>(".course");
    const page = shadow.querySelector<HTMLElement>(".page");
    const statusNode = shadow.querySelector<HTMLElement>(".status");
    if (course) course.textContent = `Course: ${context.title}${context.identityConfidence === "unconfirmed" ? " (unconfirmed course)" : ""}`;
    if (page) page.textContent = `Page: ${context.pageTitle}`;
    if (statusNode) {
      statusNode.className = `status ${status}`;
      const dot = ownerDocument.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");
      statusNode.replaceChildren("Connection: ", dot, statusLabels[status]);
    }
  };
  const cleanupPreview = () => { previewCleanup?.(); previewCleanup = undefined; };
  const closeDialog = () => { if (pendingScreenshotId) void options.cancelScreenshot?.(pendingScreenshotId).catch(() => undefined); pendingScreenshotId = undefined; shadow.querySelector(".backdrop")?.remove(); composerContext = undefined; cleanupPreview(); fallbackPin = false; returnFocus?.focus(); };
  const openDialog = (trigger: HTMLElement, label: string, anchor: CommentAnchor) => {
    const contextSnapshot = { ...context };
    composerContext = contextSnapshot;
    returnFocus = trigger;
    const backdrop = ownerDocument.createElement("div");
    backdrop.className = "backdrop";
    const preview = anchor.anchor_type === "text_highlight" ? `“${anchor.selected_quote}”` : `Pin: ${anchor.css_selector}`;
    backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title"><h2 id="review-dialog-title">${escapeHtml(label)}</h2><div class="preview">${escapeHtml(preview)}</div><label class="field">Comment<textarea data-initial-focus required></textarea></label><label class="field">Category (optional)<select><option value="general">General</option><option value="language_grammar">Language / grammar</option><option value="learning_design_content_flow">Learning design / content flow</option><option value="accessibility">Accessibility</option><option value="technical_link_media_interaction">Technical / link / media / interaction</option><option value="assessment">Assessment</option></select></label><label class="field"><span><input type="checkbox" data-screenshot> Include a screenshot of the visible viewport</span><small>Only captured when you save this comment.</small></label><div class="error" role="alert" hidden></div><div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-save>Save comment</button></div></div>`;
    backdrop.addEventListener("keydown", (event) => {
      const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>("textarea,select,input,button"));
      const activeIndex = Math.max(0, focusable.indexOf(shadow.activeElement as HTMLElement));
      const outcome = handleDialogKey({ key: event.key, shiftKey: event.shiftKey, activeIndex, focusableCount: focusable.length });
      if (event.key === "Tab" || outcome.close) event.preventDefault();
      if (outcome.close) closeDialog(); else if (event.key === "Tab") focusable[outcome.focusIndex]?.focus();
    });
    backdrop.querySelector("[data-cancel]")?.addEventListener("click", closeDialog);
    backdrop.querySelector("[data-save]")?.addEventListener("click", async () => {
      const textarea = backdrop.querySelector<HTMLTextAreaElement>("textarea")!; const error = backdrop.querySelector<HTMLElement>(".error")!;
      if (anchor.anchor_type === "text_highlight" && !anchor.selected_quote) { error.textContent = "Select text on the page before saving."; error.hidden = false; returnFocus?.focus(); return; }
      if (!textarea.value.trim()) { error.textContent = "Enter a comment before saving."; error.hidden = false; textarea.focus(); return; }
      const save = backdrop.querySelector<HTMLButtonElement>("[data-save]")!; save.disabled = true; error.hidden = true;
      try {
        const wantsScreenshot = backdrop.querySelector<HTMLInputElement>("[data-screenshot]")!.checked;
        const saved = await options.submit?.({ body: textarea.value.trim(), category: backdrop.querySelector<HTMLSelectElement>("select")!.value, anchor, screenshot: wantsScreenshot, embeddedFrameUnavailable: fallbackPin, contextSnapshot });
        fallbackPin = false;
        if (!wantsScreenshot) { closeDialog(); return; }
        const commentId = saved && typeof saved.id === "string" ? saved.id : undefined;
        if (!commentId) throw new Error("Comment saved, but screenshot upload is unavailable.");
        const dialog = backdrop.querySelector<HTMLElement>(".dialog")!;
        if (saved?.screenshot_available === false) {
          dialog.innerHTML = `<h2>Comment saved</h2><p role="status">The comment was saved, but screenshot upload is unavailable.</p><div class="actions"><button type="button" data-cancel>Done</button></div>`;
          dialog.querySelector("[data-cancel]")?.addEventListener("click", closeDialog);
          return;
        }
        pendingScreenshotId = commentId;
        dialog.innerHTML = `<h2>Comment saved</h2><p>Your comment is saved. To add a screenshot, choose the current tab in the browser prompt.</p><div class="error" role="alert" hidden></div><div class="actions"><button type="button" data-cancel>Done</button><button type="button" class="primary" data-capture>Capture screenshot now</button></div>`;
        dialog.querySelector("[data-cancel]")?.addEventListener("click", closeDialog);
        dialog.querySelector("[data-capture]")?.addEventListener("click", async () => {
          const capture = dialog.querySelector<HTMLButtonElement>("[data-capture]")!; const captureError = dialog.querySelector<HTMLElement>(".error")!;
          capture.disabled = true; captureError.hidden = true;
          try { const dataUrl = await (options.captureScreenshot ?? captureDisplayScreenshot)(); if (!options.uploadScreenshot) throw new Error("Screenshot upload is unavailable."); await options.uploadScreenshot(commentId, dataUrl); pendingScreenshotId = undefined; closeDialog(); }
          catch (caught) { captureError.textContent = caught instanceof Error ? caught.message : "Screenshot capture was cancelled."; captureError.hidden = false; capture.disabled = false; }
        });
      }
      catch (caught) { error.textContent = caught instanceof Error ? caught.message : "Could not save comment."; error.hidden = false; save.disabled = false; }
    });
    shadow.append(backdrop);
    backdrop.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  };
  const bind = () => {
    shadow.querySelector<HTMLElement>('[data-action="highlight"]')?.addEventListener("click", (event) => {
      const selection = ownerDocument.defaultView?.getSelection();
      if (!selection?.rangeCount) { openDialog(event.currentTarget as HTMLElement, "Comment on highlighted text", { anchor_type: "text_highlight", selected_quote: "", prefix: "", suffix: "" }); return; }
      const range = selection.getRangeAt(0); const anchor = captureTextAnchor(range, ownerDocument);
      if (!anchor) { openDialog(event.currentTarget as HTMLElement, "Comment on highlighted text", { anchor_type: "text_highlight", selected_quote: "", prefix: "", suffix: "" }); return; }
      previewCleanup = renderTextHighlight(ownerDocument, range.cloneRange()); openDialog(event.currentTarget as HTMLElement, "Comment on highlighted text", { anchor_type: "text_highlight", ...anchor });
    });
    shadow.querySelector<HTMLElement>('[data-action="pin"]')?.addEventListener("click", (event) => {
      if (pinListener) { ownerDocument.removeEventListener("pointerdown", pinListener, true); ownerDocument.removeEventListener("keydown", cancelPin, true); }
      returnFocus = event.currentTarget as HTMLElement; shadow.querySelector<HTMLElement>(".panel")!.hidden = false; shadow.querySelector<HTMLElement>(".panel")!.textContent = "Select a point on the page. Press Escape to cancel.";
      pinListener = (pointer) => { const element = ownerDocument.elementFromPoint(pointer.clientX, pointer.clientY) as HTMLElement | null; const anchor = element && capturePinAnchor(element, pointer.clientX, pointer.clientY); if (!anchor) return; pointer.preventDefault(); ownerDocument.removeEventListener("pointerdown", pinListener!, true); ownerDocument.removeEventListener("keydown", cancelPin, true); pinListener = undefined; previewCleanup = renderPin(ownerDocument, anchor); openDialog(returnFocus!, "Add a page pin", { anchor_type: "visual_pin", ...anchor }); };
      ownerDocument.addEventListener("pointerdown", pinListener, true);
      ownerDocument.addEventListener("keydown", cancelPin, true);
    });
    shadow.querySelector<HTMLElement>('[data-action="panel"]')?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLElement;
      const panel = shadow.querySelector<HTMLElement>(".panel")!;
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      button.setAttribute("aria-label", panel.hidden ? "Open review panel" : "Close review panel");
    });
  };
  mount();
  updateLabels();
  return {
    update(next, nextStatus) {
      context = next; status = nextStatus; updateLabels();
      const dialog = shadow.querySelector<HTMLElement>(".dialog");
      if (dialog && composerContext && (composerContext.page_url !== next.page_url || composerContext.course_url !== next.course_url) && !dialog.querySelector("[data-context-warning]")) {
        const warning = ownerDocument.createElement("p"); warning.dataset.contextWarning = "true"; warning.className = "error"; warning.textContent = "The page changed. This comment will stay attached to the page where you opened it."; dialog.querySelector(".preview")?.after(warning);
      }
    },
    showFrameFallback() {
      const panel = shadow.querySelector<HTMLElement>(".panel")!; panel.hidden = false;
      panel.innerHTML = `<strong>embedded content—frame access unavailable</strong><p>Place a pin on the embedded content instead.</p><button type="button" data-parent-pin>Place parent-page pin</button>`;
      panel.querySelector<HTMLElement>("[data-parent-pin]")?.addEventListener("click", () => { fallbackPin = true; options.onFrameFallback?.(); shadow.querySelector<HTMLElement>('[data-action="pin"]')?.click(); });
    },
    hideFrameFallback() { const panel = shadow.querySelector<HTMLElement>(".panel"); if (panel?.querySelector("[data-parent-pin]")) { panel.hidden = true; panel.replaceChildren("No comments on this page yet."); } },
    setUnresolvedAnchors(anchors) {
      let region = shadow.querySelector<HTMLElement>("[data-unresolved]");
      if (!region) {
        region = ownerDocument.createElement("section");
        region.dataset.unresolved = "true";
        region.setAttribute("aria-labelledby", "unresolved-anchor-heading");
        shadow.querySelector(".shell")?.append(region);
      }
      region.hidden = anchors.length === 0;
      if (!anchors.length) { region.replaceChildren(); return; }
      const heading = ownerDocument.createElement("h2"); heading.id = "unresolved-anchor-heading"; heading.textContent = "Unresolved comment anchors";
      const list = ownerDocument.createElement("ul");
      for (const anchor of anchors) {
        const item = ownerDocument.createElement("li");
        const label = ownerDocument.createElement("span"); label.textContent = anchor.quote ? `${anchor.label}: “${anchor.quote}”` : anchor.label;
        const button = ownerDocument.createElement("button"); button.type = "button"; button.dataset.commentId = anchor.id; button.textContent = "Take me to context";
        button.addEventListener("click", () => options.onTakeToContext?.(anchor.id)); item.append(label, button); list.append(item);
      }
      region.replaceChildren(heading, list);
    },
    destroy() { if (pinListener) ownerDocument.removeEventListener("pointerdown", pinListener, true); ownerDocument.removeEventListener("keydown", cancelPin, true); cleanupPreview(); host.remove(); },
  };
}
