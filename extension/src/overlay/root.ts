import type { CourseContext } from "../course-context.ts";
import { captureTextAnchor, type TextAnchor } from "../anchors/text.ts";
import { recoverTextAnchor, renderTextHighlight } from "../anchors/recover.ts";
import { capturePinAnchor, recoverPinAnchor, renderPin, type PinAnchor } from "../anchors/pin.ts";
import { captureDisplayScreenshot } from "../screenshot-capture.ts";
import type { PageComment } from "../background-bridge.ts";

export const OVERLAY_HOST_ID = "moodle-course-review-overlay";
export const overlayStyles = `:host{--review-red:#d73b3d;--review-navy:#000;--review-pale:#f2f2f2;--review-line:#d8d8d8;all:initial;position:fixed!important;inset:auto!important;z-index:2147483647!important;isolation:isolate;display:block!important;color:#000;font:14px/1.4 Poppins,Arial,sans-serif}.shell{box-sizing:border-box;position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(560px,calc(100vw - 32px));background:#fff;border:3px solid var(--review-red);border-radius:8px;box-shadow:0 8px 24px #00000038;overflow:hidden}.toolbar{display:flex;align-items:center;gap:8px;padding:7px 8px;background:#000;color:#fff}.identity{min-width:9rem;padding:0 5px;flex:1}.course,.page{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.course{font-weight:700}.page{font-size:12px;color:#fff}.pilot-version{font-size:12px;font-weight:700;white-space:nowrap}button,select,textarea{box-sizing:border-box;font:inherit}button{appearance:none;min-height:36px;border:1px solid #b9b9b9;border-radius:5px;background:#f2f2f2;color:#000;font-weight:650;padding:7px 9px;cursor:pointer}button:hover{background:#fff}.toolbar button{border-color:var(--review-red);background:var(--review-red);color:#fff}.toolbar button:hover,.primary:hover{background:#b52d30;border-color:#b52d30}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible,[data-build-diagnostic]:focus-visible{outline:3px solid #ffd54f;outline-offset:2px;box-shadow:0 0 0 5px #000}.icon{padding:7px 10px}.status{display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap}.dot{width:8px;height:8px;flex:0 0 8px;border:1px solid #fff;border-radius:50%;background:#ffd54f}.connected .dot{background:#16833b}.signed-out .dot,.offline .dot{background:var(--review-red)}.panel,[data-unresolved],[data-frame-fallback]{padding:10px;background:#fff;border-top:1px solid var(--review-line)}.build-diagnostic{margin:0 0 8px;padding:6px;background:#fff;color:#000;border:1px solid var(--review-line);font-size:12px}.panel[hidden],[data-unresolved][hidden]{display:none}[data-unresolved] h2{margin:0;font-size:14px}[data-unresolved] ul{display:grid;gap:6px;margin:6px 0 0;padding:0;list-style:none}[data-unresolved] li{display:flex;align-items:center;justify-content:space-between;gap:8px}.backdrop{position:fixed;inset:0;background:#0009;display:grid;place-items:center;z-index:2147483647}.dialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;border:1px solid var(--review-line);border-radius:8px;padding:18px;box-shadow:0 8px 28px #0005}.dialog h2{margin:0 0 10px;color:#000;font-size:18px;border-left:4px solid var(--review-red);padding-left:8px}.dialog textarea{width:100%;min-height:110px;border:1px solid #777;border-radius:5px;padding:8px}.field{display:grid;gap:4px;margin-top:9px}.preview{padding:8px;border:1px solid var(--review-line);border-radius:5px;background:var(--review-pale);font-size:12px}.error{color:#a51d24}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.primary{background:var(--review-red);color:#fff;border-color:var(--review-red)}@media(max-width:420px){.shell{right:8px;bottom:8px;width:calc(100vw - 16px);max-width:none}.toolbar{align-items:flex-start;flex-wrap:wrap}.identity{flex-basis:100%}.status{margin-right:auto}.dialog{width:calc(100vw - 16px);max-height:calc(100vh - 16px);padding:12px}.actions{flex-wrap:wrap}.actions button{flex:1 1 auto}}`;

export type ConnectionStatus = "connecting" | "connected" | "pending" | "signed-out" | "offline";
const statusLabels: Record<ConnectionStatus, string> = { connecting: "Connecting", connected: "Connected", pending: "Account awaiting approval", "signed-out": "Signed out", offline: "Service unavailable—retry" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const authActionLabels: Partial<Record<ConnectionStatus, string>> = { "signed-out": "Sign in", pending: "Retry", offline: "Retry" };

function createStateActions(status: ConnectionStatus): string {
  const action = authActionLabels[status];
  const reviewControls = status === "connected" || status === "connecting" ? `<button type="button" data-action="highlight">Highlight text</button><button type="button" data-action="pin">Add pin</button><button class="icon" type="button" data-action="panel" aria-expanded="false" aria-label="Open review panel">☰</button>` : "";
  return `<span data-auth-action>${action ? `<button type="button" data-action="authenticate">${action}</button>` : ""}</span><span data-review-controls>${reviewControls}</span>`;
}

export type BuildDiagnostics = { version: string; buildCommit: string };
const defaultBuildDiagnostics: BuildDiagnostics = { version: "0.0.0", buildCommit: "0000000000000000000000000000000000000000" };

export function createOverlayMarkup(input: { courseTitle: string; pageTitle: string; status: ConnectionStatus } & Partial<BuildDiagnostics>): string {
  const { version, buildCommit } = { ...defaultBuildDiagnostics, ...input };
  return `<section class="shell"><div class="toolbar" role="toolbar" aria-label="Course review tools"><div class="identity"><span class="course"><span class="label">Course:</span> ${escapeHtml(input.courseTitle)}</span><span class="page"><span class="label">Page:</span> ${escapeHtml(input.pageTitle)}</span></div><span class="pilot-version" data-pilot-version aria-label="Pilot version ${escapeHtml(version)}">Pilot v${escapeHtml(version)}</span><span class="status ${input.status}" data-auth-status aria-live="polite" aria-atomic="true"><span class="label">Connection:</span> <span class="dot" aria-hidden="true"></span><span data-status-message>${statusLabels[input.status]}</span></span>${createStateActions(input.status)}</div><div class="panel" hidden><p class="build-diagnostic" data-build-diagnostic tabindex="0">Version ${escapeHtml(version)} · build ${escapeHtml(buildCommit.slice(0, 7))}</p><div data-panel-content>No comments on this page yet.</div></div></section>`;
}

export function handleDialogKey(input: { key: string; shiftKey: boolean; activeIndex: number; focusableCount: number }): { focusIndex: number; close: boolean } {
  if (input.key === "Escape") return { focusIndex: input.activeIndex, close: true };
  if (input.key !== "Tab" || input.focusableCount < 1) return { focusIndex: input.activeIndex, close: false };
  const delta = input.shiftKey ? -1 : 1;
  return { focusIndex: (input.activeIndex + delta + input.focusableCount) % input.focusableCount, close: false };
}

export type CommentAnchor = ({ anchor_type: "text_highlight" } & TextAnchor) | ({ anchor_type: "visual_pin" } & PinAnchor);
export type UnresolvedAnchor = { id: string; label: string; quote?: string };
export type AuthenticationOutcome = { status: ConnectionStatus; message?: string };
export type ReviewOverlayOptions = { onAuthenticate?: () => Promise<AuthenticationOutcome>; submit?: (input: { body: string; category: string; anchor: CommentAnchor; screenshot: boolean; embeddedFrameUnavailable: boolean; contextSnapshot: CourseContext }) => Promise<{ id?: string; screenshot_available?: boolean } | void>; uploadScreenshot?: (commentId: string, dataUrl: string) => Promise<void>; cancelScreenshot?: (commentId: string) => Promise<void>; captureScreenshot?: () => Promise<string>; onFrameFallback?: () => void; onTakeToContext?: (id: string) => void };
export type ReviewOverlay = { update(context: CourseContext, status: ConnectionStatus): void; setPageComments(comments: PageComment[]): void; takeToContext(id: string): boolean; showFrameFallback(): void; hideFrameFallback(): void; setUnresolvedAnchors(anchors: UnresolvedAnchor[]): void; destroy(): void };

export function mountReviewOverlay(document: Document, context: CourseContext, status: ConnectionStatus = "connecting", options: ReviewOverlayOptions = {}, buildDiagnostics: BuildDiagnostics = defaultBuildDiagnostics): ReviewOverlay {
  const existing = document.getElementById(OVERLAY_HOST_ID) as HTMLElement | null;
  if (existing?.shadowRoot) return createController(existing, existing.shadowRoot, context, status, options, buildDiagnostics);
  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  host.setAttribute("data-moodle-review-ui", "true");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;isolation:isolate;display:block;font-family:Poppins,Arial,sans-serif;font-size:14px;line-height:1.4;color:#000";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = overlayStyles;
  shadow.append(style);
  return createController(host, shadow, context, status, options, buildDiagnostics);
}

function createController(host: HTMLElement, shadow: ShadowRoot, initial: CourseContext, initialStatus: ConnectionStatus, options: ReviewOverlayOptions, buildDiagnostics: BuildDiagnostics): ReviewOverlay {
  const ownerDocument = host.ownerDocument;
  let context = initial;
  let status = initialStatus;
  let authenticating = false;
  let stateVersion = 0;
  let returnFocus: HTMLElement | null = null;
  let previewCleanup: (() => void) | undefined;
  let pinListener: ((event: PointerEvent) => void) | undefined;
  let fallbackPin = false;
  let composerContext: CourseContext | undefined;
  let pendingScreenshotId: string | undefined;
  let storedAnchorCleanups: Array<() => void> = [];
  let loadedComments = new Map<string, PageComment>();
  let openThreads = new Map<string, () => void>();
  const repositioners = new Set<() => void>();
  let repositionFrame: number | undefined;
  const repositionAll = () => { repositionFrame = undefined; for (const reposition of repositioners) reposition(); };
  const scheduleReposition = () => { if (repositionFrame === undefined) repositionFrame = ownerDocument.defaultView?.requestAnimationFrame(repositionAll); };
  ownerDocument.defaultView?.addEventListener("resize", scheduleReposition);
  ownerDocument.defaultView?.addEventListener("scroll", scheduleReposition, true);
  const trackReposition = (reposition: () => void, marker: HTMLElement) => { repositioners.add(reposition); reposition(); storedAnchorCleanups.push(() => { repositioners.delete(reposition); marker.remove(); }); };
  const cancelPin = (event: KeyboardEvent) => { if (event.key === "Escape" && pinListener) { ownerDocument.removeEventListener("pointerdown", pinListener, true); ownerDocument.removeEventListener("keydown", cancelPin, true); pinListener = undefined; fallbackPin = false; shadow.querySelector<HTMLElement>(".panel")!.hidden = true; returnFocus?.focus(); } };
  const mount = () => {
    const style = shadow.querySelector("style");
    shadow.innerHTML = "";
    if (style) shadow.append(style);
    const wrapper = ownerDocument.createElement("div");
    wrapper.innerHTML = createOverlayMarkup({ courseTitle: context.title, pageTitle: context.pageTitle, status, ...buildDiagnostics });
    shadow.append(...Array.from(wrapper.childNodes));
    bind();
  };
  const updateLabels = () => {
    const course = shadow.querySelector<HTMLElement>(".course");
    const page = shadow.querySelector<HTMLElement>(".page");
    if (course) course.textContent = `Course: ${context.title}${context.identityConfidence === "unconfirmed" ? " (unconfirmed course)" : ""}`;
    if (page) page.textContent = `Page: ${context.pageTitle}`;
    renderStateControls();
  };
  const renderStateControls = (message = statusLabels[status]) => {
    const toolbar = shadow.querySelector<HTMLElement>(".toolbar");
    if (!toolbar) return;
    const panel = shadow.querySelector<HTMLElement>(".panel");
    const panelOpen = panel?.hidden === false;
    const statusNode = toolbar.querySelector<HTMLElement>("[data-auth-status]");
    if (statusNode) { statusNode.className = `status ${status}`; const messageNode = statusNode.querySelector<HTMLElement>("[data-status-message]"); if (messageNode) messageNode.textContent = message; }
    toolbar.querySelector("[data-auth-action]")?.remove(); toolbar.querySelector("[data-review-controls]")?.remove();
    const wrapper = ownerDocument.createElement("div"); wrapper.innerHTML = createStateActions(status); toolbar.append(...Array.from(wrapper.childNodes));
    bind();
    const panelToggle = toolbar.querySelector<HTMLElement>('[data-action="panel"]');
    if (panelToggle) { panelToggle.setAttribute("aria-expanded", String(panelOpen)); panelToggle.setAttribute("aria-label", panelOpen ? "Close review panel" : "Open review panel"); }
    else if (panel) panel.hidden = true;
  };
  const bindStateControls = () => {
    shadow.querySelector<HTMLButtonElement>('[data-action="authenticate"]')?.addEventListener("click", async (event) => {
      if (authenticating) return;
      authenticating = true;
      const attemptVersion = ++stateVersion;
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = "Signing in…"; button.setAttribute("aria-busy", "true");
      try {
        const outcome = await options.onAuthenticate?.();
        if (attemptVersion !== stateVersion) return;
        status = outcome?.status ?? "signed-out"; authenticating = false; renderStateControls(outcome?.message);
        if (status === "connected") shadow.querySelector<HTMLElement>('[data-action="highlight"]')?.focus();
        else shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus();
      } catch {
        if (attemptVersion !== stateVersion) return;
        status = "signed-out"; authenticating = false; renderStateControls("Sign-in failed—try again"); shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus();
      }
    });
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
    bindStateControls();
    shadow.querySelector<HTMLElement>('[data-action="highlight"]')?.addEventListener("click", (event) => {
      const selection = ownerDocument.defaultView?.getSelection();
      if (!selection?.rangeCount) { openDialog(event.currentTarget as HTMLElement, "Comment on highlighted text", { anchor_type: "text_highlight", selected_quote: "", prefix: "", suffix: "" }); return; }
      const range = selection.getRangeAt(0); const anchor = captureTextAnchor(range, ownerDocument);
      if (!anchor) { openDialog(event.currentTarget as HTMLElement, "Comment on highlighted text", { anchor_type: "text_highlight", selected_quote: "", prefix: "", suffix: "" }); return; }
      previewCleanup = renderTextHighlight(ownerDocument, range.cloneRange()); openDialog(event.currentTarget as HTMLElement, "Comment on highlighted text", { anchor_type: "text_highlight", ...anchor });
    });
    shadow.querySelector<HTMLElement>('[data-action="pin"]')?.addEventListener("click", (event) => {
      if (pinListener) { ownerDocument.removeEventListener("pointerdown", pinListener, true); ownerDocument.removeEventListener("keydown", cancelPin, true); }
      returnFocus = event.currentTarget as HTMLElement; shadow.querySelector<HTMLElement>(".panel")!.hidden = false; shadow.querySelector<HTMLElement>("[data-panel-content]")!.textContent = "Select a point on the page. Press Escape to cancel.";
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
      stateVersion += 1; authenticating = false; context = next; status = nextStatus; updateLabels();
      const dialog = shadow.querySelector<HTMLElement>(".dialog");
      if (dialog && composerContext && (composerContext.page_url !== next.page_url || composerContext.course_url !== next.course_url) && !dialog.querySelector("[data-context-warning]")) {
        const warning = ownerDocument.createElement("p"); warning.dataset.contextWarning = "true"; warning.className = "error"; warning.textContent = "The page changed. This comment will stay attached to the page where you opened it."; dialog.querySelector(".preview")?.after(warning);
      }
    },
    setPageComments(comments) {
      for (const cleanup of storedAnchorCleanups) cleanup(); storedAnchorCleanups = [];
      loadedComments = new Map(comments.map((comment) => [comment.id, comment]));
      openThreads = new Map();
      const unresolved: UnresolvedAnchor[] = [];
      const panel = shadow.querySelector<HTMLElement>(".panel")!;
      const panelContent = panel.querySelector<HTMLElement>("[data-panel-content]")!;
      panelContent.replaceChildren();
      for (const comment of comments) {
        const openThread = () => {
          panel.hidden = false;
          const article = ownerDocument.createElement("article");
          const heading = ownerDocument.createElement("h2"); heading.textContent = `${comment.category.replaceAll("_", " ")} · ${comment.status.replaceAll("_", " ")}`;
          const byline = ownerDocument.createElement("p"); byline.textContent = `${comment.author.display_name} (${comment.author.role.replaceAll("_", " ")})`;
          const body = ownerDocument.createElement("p"); body.textContent = comment.body; article.append(heading, byline, body);
          for (const reply of comment.replies) { const node = ownerDocument.createElement("p"); node.textContent = `${reply.author.display_name} (${reply.author.role.replaceAll("_", " ")}): ${reply.body}`; article.append(node); }
          panelContent.replaceChildren(article);
        };
        openThreads.set(comment.id, openThread);
        if (comment.anchor_type === "text_highlight" && comment.selected_quote) {
          const recovered = recoverTextAnchor(ownerDocument, { selected_quote: comment.selected_quote, prefix: comment.prefix ?? "", suffix: comment.suffix ?? "" });
          if (recovered.status === "resolved") {
            storedAnchorCleanups.push(renderTextHighlight(ownerDocument, recovered.range));
            const marker = ownerDocument.createElement("button"); marker.type = "button"; marker.id = `moodle-review-highlight-${comment.id}`; marker.dataset.moodleReviewStoredHighlight = comment.id; marker.setAttribute("aria-label", `Open feedback: ${comment.body}`); marker.textContent = "Comment"; marker.style.cssText = "position:fixed;z-index:2147483646;border:2px solid white;border-radius:999px;background:#d73b3d;color:white;padding:4px 7px;font:600 12px/1.2 Poppins,Arial,sans-serif;box-shadow:0 2px 8px #0005"; marker.addEventListener("click", openThread);
            const place = () => { const position = recovered.range.getBoundingClientRect(); marker.hidden = position.width === 0 && position.height === 0; marker.style.left = `${Math.max(0, position.left)}px`; marker.style.top = `${Math.max(0, position.bottom + 4)}px`; };
            ownerDocument.documentElement.append(marker); trackReposition(place, marker);
          }
          else unresolved.push({ id: comment.id, label: `${comment.page_title} · ${comment.body}`, quote: comment.selected_quote });
        } else if (comment.anchor_type === "visual_pin" && comment.css_selector && comment.relative_x !== null && comment.relative_y !== null) {
          const anchor = { css_selector: comment.css_selector, relative_x: comment.relative_x, relative_y: comment.relative_y };
          const recovered = recoverPinAnchor(ownerDocument, anchor);
          if (recovered.status === "unresolved") unresolved.push({ id: comment.id, label: `${comment.page_title} · ${comment.body}` });
          else {
            const marker = ownerDocument.createElement("button"); marker.type = "button"; marker.dataset.moodleReviewStoredPin = comment.id; marker.setAttribute("aria-label", `Open feedback: ${comment.body}`); marker.style.cssText = "position:fixed;z-index:2147483646;width:24px;height:24px;border-radius:50%;border:2px solid white;background:#d73b3d;color:white;transform:translate(-50%,-50%)"; marker.textContent = "•"; marker.addEventListener("click", openThread);
            const place = () => { const position = recoverPinAnchor(ownerDocument, anchor); marker.hidden = position.status !== "resolved"; if (position.status === "resolved") { marker.style.left = `${position.x}px`; marker.style.top = `${position.y}px`; } };
            ownerDocument.documentElement.append(marker); trackReposition(place, marker);
          }
        }
        const item = ownerDocument.createElement("button"); item.type = "button"; item.textContent = comment.body; item.addEventListener("click", openThread); panelContent.append(item);
      }
      if (!comments.length) panelContent.replaceChildren("No comments on this page yet.");
      this.setUnresolvedAnchors(unresolved);
    },
    takeToContext(id) {
      const comment = loadedComments.get(id);
      if (!comment) return false;
      let target: HTMLElement | undefined;
      if (comment.anchor_type === "text_highlight" && comment.selected_quote) {
        const recovered = recoverTextAnchor(ownerDocument, { selected_quote: comment.selected_quote, prefix: comment.prefix ?? "", suffix: comment.suffix ?? "" });
        if (recovered.status === "resolved") {
          this.setPageComments([...loadedComments.values()]);
          target = Array.from(ownerDocument.querySelectorAll<HTMLElement>("[data-moodle-review-stored-highlight]")).find((node) => node.dataset.moodleReviewStoredHighlight === id);
        }
      } else if (comment.anchor_type === "visual_pin") {
        this.setPageComments([...loadedComments.values()]);
        target = Array.from(ownerDocument.querySelectorAll<HTMLElement>("[data-moodle-review-stored-pin]")).find((node) => node.dataset.moodleReviewStoredPin === id);
      }
      if (target) { target.scrollIntoView?.({ block: "center" }); target.focus(); openThreads.get(id)?.(); return true; }
      const region = shadow.querySelector<HTMLElement>("[data-unresolved]");
      if (region) { region.querySelectorAll(`[data-recovery-status="${id}"], [data-recovery-quote="${id}"]`).forEach((node) => node.remove()); const status = ownerDocument.createElement("p"); status.dataset.recoveryStatus = id; status.setAttribute("role", "status"); status.textContent = "The original content could not be found on this page"; const quote = ownerDocument.createElement("blockquote"); quote.dataset.recoveryQuote = id; quote.textContent = comment.selected_quote || `${comment.page_title} · ${comment.body}`; region.append(status, quote); }
      return false;
    },
    showFrameFallback() {
      let region = shadow.querySelector<HTMLElement>("[data-frame-fallback]");
      if (!region) { region = ownerDocument.createElement("section"); region.dataset.frameFallback = "true"; region.setAttribute("role", "status"); region.setAttribute("aria-live", "polite"); region.setAttribute("aria-labelledby", "frame-fallback-heading"); shadow.querySelector(".shell")?.append(region); }
      region.hidden = false; region.innerHTML = `<strong id="frame-fallback-heading">embedded content—frame access unavailable</strong><p>Place a pin on the embedded content instead.</p><button type="button" data-parent-pin>Place parent-page pin</button>`;
      region.querySelector<HTMLElement>("[data-parent-pin]")?.addEventListener("click", () => { fallbackPin = true; options.onFrameFallback?.(); shadow.querySelector<HTMLElement>('[data-action="pin"]')?.click(); });
    },
    hideFrameFallback() { const region = shadow.querySelector<HTMLElement>("[data-frame-fallback]"); if (region) region.hidden = true; },
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
        button.addEventListener("click", () => options.onTakeToContext ? options.onTakeToContext(anchor.id) : void this.takeToContext(anchor.id)); item.append(label, button); list.append(item);
      }
      region.replaceChildren(heading, list);
    },
    destroy() { if (pinListener) ownerDocument.removeEventListener("pointerdown", pinListener, true); ownerDocument.removeEventListener("keydown", cancelPin, true); ownerDocument.defaultView?.removeEventListener("resize", scheduleReposition); ownerDocument.defaultView?.removeEventListener("scroll", scheduleReposition, true); if (repositionFrame !== undefined) ownerDocument.defaultView?.cancelAnimationFrame(repositionFrame); cleanupPreview(); for (const cleanup of storedAnchorCleanups) cleanup(); host.remove(); },
  };
}
