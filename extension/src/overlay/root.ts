import type { CourseContext } from "../course-context.ts";
import { captureTextAnchor, type TextAnchor } from "../anchors/text.ts";
import { recoverTextAnchor, renderTextHighlight } from "../anchors/recover.ts";
import { capturePinAnchor, recoverPinAnchor, renderPin, type PinAnchor } from "../anchors/pin.ts";
import { captureDisplayScreenshot } from "../screenshot-capture.ts";
import type { PageComment } from "../background-bridge.ts";

export const OVERLAY_HOST_ID = "moodle-course-review-overlay";
export const overlayStyles = `:host{--review-red:#d73b3d;--review-navy:#000;--review-pale:#f2f2f2;--review-line:#d8d8d8;all:initial;position:fixed!important;inset:auto!important;z-index:2147483647!important;isolation:isolate;display:block!important;color:#000;font:14px/1.4 Poppins,Arial,sans-serif}.shell{box-sizing:border-box;position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(560px,calc(100vw - 32px));background:#fff;border:3px solid var(--review-red);border-radius:8px;box-shadow:0 8px 24px #00000038;overflow:hidden}.toolbar{display:flex;align-items:center;gap:8px;padding:7px 8px;background:#000;color:#fff}.identity{min-width:9rem;padding:0 5px;flex:1}.course,.page{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.course{font-weight:700}.page{font-size:12px;color:#fff}.pilot-version{font-size:12px;font-weight:700;white-space:nowrap}button,select,textarea{box-sizing:border-box;font:inherit}button{appearance:none;min-height:36px;border:1px solid #b9b9b9;border-radius:5px;background:#f2f2f2;color:#000;font-weight:650;padding:7px 9px;cursor:pointer}button:hover{background:#fff}.toolbar button{border-color:var(--review-red);background:var(--review-red);color:#fff}.toolbar button:hover,.primary:hover{background:#b52d30;border-color:#b52d30}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible,[data-build-diagnostic]:focus-visible{outline:3px solid #ffd54f;outline-offset:2px;box-shadow:0 0 0 5px #000}.icon{padding:7px 10px}.status{display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap}.dot{width:8px;height:8px;flex:0 0 8px;border:1px solid #fff;border-radius:50%;background:#ffd54f}.connected .dot{background:#16833b}.signed-out .dot,.offline .dot{background:var(--review-red)}.panel,[data-unresolved],[data-frame-fallback]{padding:10px;background:#fff;border-top:1px solid var(--review-line)}.build-diagnostic{margin:0 0 8px;padding:6px;background:#fff;color:#000;border:1px solid var(--review-line);font-size:12px}.panel[hidden],[data-unresolved][hidden]{display:none}[data-unresolved] h2{margin:0;font-size:14px}[data-unresolved] ul{display:grid;gap:6px;margin:6px 0 0;padding:0;list-style:none}[data-unresolved] li{display:flex;align-items:center;justify-content:space-between;gap:8px}.backdrop{position:fixed;inset:0;background:#0009;display:grid;place-items:center;z-index:2147483647}.dialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;border:1px solid var(--review-line);border-radius:8px;padding:18px;box-shadow:0 8px 28px #0005}.dialog h2{margin:0 0 10px;color:#000;font-size:18px;border-left:4px solid var(--review-red);padding-left:8px}.dialog textarea{width:100%;min-height:110px;border:1px solid #777;border-radius:5px;padding:8px}.field{display:grid;gap:4px;margin-top:9px}.preview{padding:8px;border:1px solid var(--review-line);border-radius:5px;background:var(--review-pale);font-size:12px}.error{color:#a51d24}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.primary{background:var(--review-red);color:#fff;border-color:var(--review-red)}@media(max-width:420px){.shell{right:8px;bottom:8px;width:calc(100vw - 16px);max-width:none}.toolbar{align-items:flex-start;flex-wrap:wrap}.identity{flex-basis:100%}.status{margin-right:auto}.dialog{width:calc(100vw - 16px);max-height:calc(100vh - 16px);padding:12px}.actions{flex-wrap:wrap}.actions button{flex:1 1 auto}}`;

export const tealOverlayOverrides = `:host{--review-teal:#28c4c2;--review-teal-dark:#0b6261;--review-pale:#effafa;--review-line:#8ad9d8;color:#102f38;font:16px/1.5 Poppins,Arial,sans-serif}.shell{width:min(600px,calc(100vw - 32px));max-width:600px;border:5px solid var(--review-teal);border-radius:10px}.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;background:var(--review-teal);color:#082f2f;padding:12px}.identity{min-width:0}.course{font-size:16px}.page{font-size:14px}.status{font-size:14px}.toolbar-actions{display:grid;grid-template-columns:minmax(0,1fr) auto 44px;gap:8px;align-items:center}.toolbar-actions button,button{min-height:44px}.toolbar-actions [data-action="add-comment"]{background:#082f2f;border-color:#082f2f;color:#fff}.toolbar-actions [data-action="panel"],.toolbar-actions [data-action="help"]{background:#fff;color:var(--review-teal-dark);border-color:#fff}.panel,[data-unresolved],[data-frame-fallback]{background:var(--review-pale);padding:16px}.panel-title{margin:0 0 12px;font-size:18px}.dialog{border:4px solid var(--review-teal)}.dialog h2{color:var(--review-teal-dark);font-size:20px}.primary{background:var(--review-teal-dark);border-color:var(--review-teal-dark)}input,select{box-sizing:border-box;width:100%;min-height:44px;border:1px solid #527f7f;border-radius:5px;padding:7px;font:inherit}.mode-tabs{display:flex;gap:8px}.mode-tabs [aria-pressed="true"]{background:var(--review-teal-dark);border-color:var(--review-teal-dark);color:#fff}.reconnect-code{display:block;padding:12px;background:var(--review-pale);border:2px dashed var(--review-teal-dark);font:700 16px/1.4 ui-monospace,monospace;letter-spacing:.04em}@media(max-width:600px){.toolbar{grid-template-columns:1fr}.toolbar-actions{grid-template-columns:minmax(0,1fr) auto 44px}.shell{right:8px;bottom:8px;width:calc(100vw - 16px)}}@media(max-width:360px){.toolbar{padding:8px}.toolbar-actions{grid-template-columns:minmax(0,1fr) auto 44px;gap:6px}.comments-wide{display:none}.comments-short{display:inline}}`;

export type ConnectionStatus = "connecting" | "connected" | "pending" | "signed-out" | "offline";
const statusLabels: Record<ConnectionStatus, string> = { connecting: "Connecting", connected: "Connected", pending: "Waiting for approval — you can leave this page open or return later.", "signed-out": "Signed out", offline: "Service unavailable—retry" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const authActionLabels: Partial<Record<ConnectionStatus, string>> = { "signed-out": "Sign in", pending: "Check approval", offline: "Retry" };

function createStateActions(status: ConnectionStatus): string {
  const action = authActionLabels[status];
  const reviewControls = status === "connected" || status === "connecting" ? `<span class="toolbar-actions" data-review-controls><button type="button" data-action="add-comment">Add comment marker</button><button type="button" data-action="panel" aria-expanded="false"><span class="comments-wide">Comments (<span data-comment-count>0</span>)</span><span class="comments-short"><span data-comment-count-short>0</span> comments</span></button><button type="button" data-action="help" aria-label="Help and instructions">?</button></span>` : "";
  return `<span data-auth-action>${action ? `<button type="button" data-action="authenticate">${action}</button>` : ""}</span>${reviewControls}`;
}

export type BuildDiagnostics = { version: string; buildCommit: string };
const defaultBuildDiagnostics: BuildDiagnostics = { version: "0.0.0", buildCommit: "0000000000000000000000000000000000000000" };

export function createOverlayMarkup(input: { courseTitle: string; pageTitle: string; status: ConnectionStatus } & Partial<BuildDiagnostics>): string {
  const { version, buildCommit } = { ...defaultBuildDiagnostics, ...input };
  return `<section class="shell" tabindex="-1"><div class="toolbar" role="toolbar" aria-label="Course review tools"><div class="identity"><span class="course" title="${escapeHtml(input.courseTitle)}">${escapeHtml(input.courseTitle)}</span><span class="viewer" data-viewer hidden></span><span class="status ${input.status}" data-auth-status aria-live="polite" aria-atomic="true"><span class="dot" aria-hidden="true"></span><span data-status-message>${statusLabels[input.status]}</span></span></div>${createStateActions(input.status)}</div><div class="panel" hidden><h2 class="panel-title">${escapeHtml(input.pageTitle)}</h2><div data-panel-content>No comments on this page yet.</div></div><span data-build-info hidden>${escapeHtml(version)}|${escapeHtml(buildCommit.slice(0, 7))}</span></section>`;
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
export type ReviewerAccessInput = { displayName: string; email: string; role: string; code: string };
export type ReviewOverlayOptions = { onAuthenticate?: () => Promise<AuthenticationOutcome>; onCheckApproval?: () => Promise<AuthenticationOutcome>; onAccessSubmit?: (input: ReviewerAccessInput) => Promise<AuthenticationOutcome>; getSavedReviewers?: () => Promise<Array<{ email: string; label: string }>>; onUseSavedReviewer?: (email: string) => Promise<AuthenticationOutcome>; useAccessForm?: () => boolean; submit?: (input: { body: string; category: string; anchor: CommentAnchor; screenshot: boolean; embeddedFrameUnavailable: boolean; contextSnapshot: CourseContext }) => Promise<{ id?: string; screenshot_available?: boolean } | void>; editThread?: (commentId: string, body: string) => Promise<void>; replyThread?: (commentId: string, body: string) => Promise<void>; manageSme?: (commentId: string, userIds?: string[]) => Promise<{ available_recipients: Array<{ id: string; display_name: string }>; selected_user_ids: string[] }>; deleteThread?: (commentId: string) => Promise<void>; uploadScreenshot?: (commentId: string, dataUrl: string) => Promise<void>; cancelScreenshot?: (commentId: string) => Promise<void>; captureScreenshot?: () => Promise<string>; onFrameFallback?: () => void; onTakeToContext?: (id: string) => void };
export type ReviewOverlay = { update(context: CourseContext, status: ConnectionStatus): void; setViewer(viewer?: { display_name: string | null; email: string; role: string }): void; setPageComments(comments: PageComment[]): void; takeToContext(id: string): boolean; showFrameFallback(): void; hideFrameFallback(): void; setUnresolvedAnchors(anchors: UnresolvedAnchor[]): void; destroy(): void };

export function mountReviewOverlay(document: Document, context: CourseContext, status: ConnectionStatus = "connecting", options: ReviewOverlayOptions = {}, buildDiagnostics: BuildDiagnostics = defaultBuildDiagnostics): ReviewOverlay {
  const existing = document.getElementById(OVERLAY_HOST_ID) as HTMLElement | null;
  if (existing?.shadowRoot) return createController(existing, existing.shadowRoot, context, status, options, buildDiagnostics);
  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  host.setAttribute("data-moodle-review-ui", "true");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;isolation:isolate;display:block;font-family:Poppins,Arial,sans-serif;font-size:16px;line-height:1.5;color:#102f38";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = overlayStyles + tealOverlayOverrides + `.viewer{display:block;font-size:13px;font-weight:650;color:#082f2f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.viewer[hidden]{display:none}.comments-short{display:none}@media(max-width:360px){.comments-wide{display:none}.comments-short{display:inline}}.comment-choice{padding:16px;background:var(--review-pale);border-top:1px solid var(--review-line)}.comment-choice h2{margin:0 0 10px;font-size:18px}.comment-choice button{display:grid;width:100%;margin-top:8px;text-align:left}.comment-choice button span{font-size:14px;font-weight:400}.help-dialog ol{display:grid;gap:12px;padding-left:22px}.help-dialog li span{display:block;font-size:14px}.help-version{font-size:14px;color:#52666c}`;
  shadow.append(style);
  return createController(host, shadow, context, status, options, buildDiagnostics);
}

function createController(host: HTMLElement, shadow: ShadowRoot, initial: CourseContext, initialStatus: ConnectionStatus, options: ReviewOverlayOptions, buildDiagnostics: BuildDiagnostics): ReviewOverlay {
  const ownerDocument = host.ownerDocument;
  let lastPageFocus: HTMLElement | null = null;
  const rememberPageFocus = (event: FocusEvent) => { const target = event.target as HTMLElement | null; if (target && target !== host && !host.contains(target)) lastPageFocus = target; };
  ownerDocument.addEventListener("focusin", rememberPageFocus, true);
  let context = initial;
  let status = initialStatus;
  let currentViewer: { display_name: string | null; email: string; role: string } | undefined;
  let authenticating = false;
  let stateVersion = 0;
  let returnFocus: HTMLElement | null = null;
  let previewCleanup: (() => void) | undefined;
  let pinListener: ((event: PointerEvent) => void) | undefined;
  let areaKeyListener: ((event: KeyboardEvent) => void) | undefined;
  let areaCandidates: HTMLElement[] = [];
  let areaCandidateIndex = -1;
  let choiceOutsideListener: ((event: PointerEvent) => void) | undefined;
  let fallbackPin = false;
  let frameUnavailable = false;
  let composerContext: CourseContext | undefined;
  let pendingScreenshotId: string | undefined;
  let storedAnchorCleanups: Array<() => void> = [];
  let loadedComments = new Map<string, PageComment>();
  let openThreads = new Map<string, () => void>();
  let activeThreadId: string | undefined;
  const repositioners = new Set<() => void>();
  let repositionFrame: number | undefined;
  const repositionAll = () => { repositionFrame = undefined; for (const reposition of repositioners) reposition(); };
  const scheduleReposition = () => { if (repositionFrame === undefined) repositionFrame = ownerDocument.defaultView?.requestAnimationFrame(repositionAll); };
  ownerDocument.defaultView?.addEventListener("resize", scheduleReposition);
  ownerDocument.defaultView?.addEventListener("scroll", scheduleReposition, true);
  const trackReposition = (reposition: () => void, marker: HTMLElement) => { repositioners.add(reposition); reposition(); storedAnchorCleanups.push(() => { repositioners.delete(reposition); marker.remove(); }); };
  const clearAreaSelection = () => {
    ownerDocument.removeEventListener("pointerdown", pinListener!, true);
    ownerDocument.removeEventListener("keydown", cancelPin, true);
    if (areaKeyListener) ownerDocument.removeEventListener("keydown", areaKeyListener, true);
    pinListener = undefined; areaKeyListener = undefined;
    ownerDocument.documentElement.style.removeProperty("cursor");
    const action = shadow.querySelector<HTMLElement>('[data-action="add-comment"]');
    if (action) { action.setAttribute("aria-pressed", "false"); action.textContent = "Add comment marker"; }
    for (const candidate of areaCandidates) { candidate.style.removeProperty("outline"); candidate.style.removeProperty("outline-offset"); }
    areaCandidates = []; areaCandidateIndex = -1;
  };
  const cancelPin = (event: KeyboardEvent) => { if (event.key === "Escape" && pinListener) { clearAreaSelection(); fallbackPin = false; shadow.querySelector<HTMLElement>(".panel")!.hidden = true; returnFocus?.focus(); } };
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
    const page = shadow.querySelector<HTMLElement>(".panel-title");
    if (course) { course.textContent = `${context.title}${context.identityConfidence === "unconfirmed" ? " (unconfirmed)" : ""}`; course.title = context.title; }
    if (page) page.textContent = context.pageTitle;
    const viewer = shadow.querySelector<HTMLElement>("[data-viewer]");
    if (viewer) { viewer.hidden = !currentViewer; viewer.textContent = currentViewer ? `${currentViewer.display_name || currentViewer.email} · ${currentViewer.role === "ld_dcd" ? "Learning Designer / Course Developer" : currentViewer.role === "sme" ? "Subject Matter Expert" : currentViewer.role === "beta_tester" ? "Beta Tester" : "Administrator"}` : ""; }
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
      if (status === "pending" && options.onCheckApproval) {
        authenticating = true; const attemptVersion = ++stateVersion; const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true; button.textContent = "Checking…"; button.setAttribute("aria-busy", "true");
        try { const outcome = await options.onCheckApproval(); if (attemptVersion !== stateVersion) return; status = outcome.status; authenticating = false; renderStateControls(outcome.message); if (status === "connected") shadow.querySelector<HTMLElement>('[data-action="add-comment"]')?.focus(); else shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus(); }
        catch { if (attemptVersion !== stateVersion) return; authenticating = false; renderStateControls("Waiting for approval — you can leave this page open or return later."); shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus(); }
        return;
      }
      if (options.onAccessSubmit && (options.useAccessForm?.() ?? true)) { openAccessDialog(event.currentTarget as HTMLElement); return; }
      authenticating = true;
      const attemptVersion = ++stateVersion;
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = "Signing in…"; button.setAttribute("aria-busy", "true");
      try {
        const outcome = await options.onAuthenticate?.();
        if (attemptVersion !== stateVersion) return;
        status = outcome?.status ?? "signed-out"; authenticating = false; renderStateControls(outcome?.message);
        if (status === "connected") shadow.querySelector<HTMLElement>('[data-action="add-comment"]')?.focus();
        else shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus();
      } catch {
        if (attemptVersion !== stateVersion) return;
        status = "signed-out"; authenticating = false; renderStateControls("Sign-in failed—try again"); shadow.querySelector<HTMLElement>('[data-action="authenticate"]')?.focus();
      }
    });
  };
  const openAccessDialog = (trigger: HTMLElement) => {
    returnFocus = trigger;
    const backdrop = ownerDocument.createElement("div"); backdrop.className = "backdrop";
    backdrop.innerHTML = `<form class="dialog" data-access-form><h2>Join this course review</h2>${options.onAuthenticate ? '<p><strong>Learning designer or course developer?</strong></p><button type="button" class="primary" data-team-sign-in>Course team sign in</button><hr>' : ''}<div class="mode-tabs"><button type="button" data-mode="new" aria-pressed="true">New reviewer</button><button type="button" data-mode="existing" aria-pressed="false">Existing reviewer</button></div><div data-new-fields><label class="field">Name<input name="displayName" required maxlength="100"></label><label class="field">Role<select name="role"><option value="beta_tester">Beta tester</option><option value="sme">Subject matter expert</option><option value="ld_dcd">Learning designer / course developer</option></select></label><label class="field">Email<input name="email" type="email" required maxlength="320"></label><label class="field">Invitation code<input name="code" required maxlength="32" autocomplete="one-time-code"></label></div><div data-existing-fields hidden><label class="field">Saved reviewer<select name="savedReviewer"></select></label><p data-no-saved hidden>No saved reviewers for this course in this browser.</p><button type="button" class="primary" data-use-existing>Continue as saved reviewer</button></div><p class="error" role="alert" hidden></p><div class="actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary" data-new-submit>Continue</button></div></form>`;
    const setMode = async (mode: "new" | "existing") => {
      backdrop.querySelector<HTMLElement>("[data-new-fields]")!.hidden = mode !== "new";
      backdrop.querySelector<HTMLElement>("[data-existing-fields]")!.hidden = mode !== "existing";
      backdrop.querySelector<HTMLElement>("[data-new-submit]")!.hidden = mode !== "new";
      backdrop.querySelectorAll<HTMLElement>("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
      if (mode === "existing") {
        const saved = await options.getSavedReviewers?.() ?? [];
        const select = backdrop.querySelector<HTMLSelectElement>('[name="savedReviewer"]')!; select.replaceChildren();
        for (const reviewer of saved) { const option = ownerDocument.createElement("option"); option.value = reviewer.email; option.textContent = reviewer.label; select.append(option); }
        backdrop.querySelector<HTMLElement>("[data-no-saved]")!.hidden = saved.length > 0;
        backdrop.querySelector<HTMLButtonElement>("[data-use-existing]")!.disabled = saved.length === 0;
      }
    };
    backdrop.querySelector('[data-mode="new"]')?.addEventListener("click", () => void setMode("new"));
    backdrop.querySelector('[data-mode="existing"]')?.addEventListener("click", () => void setMode("existing"));
    backdrop.querySelector<HTMLButtonElement>("[data-team-sign-in]")?.addEventListener("click", async (event) => { const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = "Signing in…"; try { const outcome = await options.onAuthenticate!(); close(); status = outcome.status; renderStateControls(outcome.message); } catch { button.disabled = false; button.textContent = "Course team sign in"; } });
    backdrop.querySelector("[data-use-existing]")?.addEventListener("click", async () => { const email = backdrop.querySelector<HTMLSelectElement>('[name="savedReviewer"]')!.value; if (!email || !options.onUseSavedReviewer) return; const outcome = await options.onUseSavedReviewer(email); close(); status = outcome.status; renderStateControls(outcome.message); });
    const close = () => { backdrop.remove(); returnFocus?.focus(); };
    backdrop.querySelector("[data-cancel]")?.addEventListener("click", close);
    backdrop.querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = new FormData(form); const error = form.querySelector<HTMLElement>(".error")!; const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; submit.disabled = true; error.hidden = true; try { const input: ReviewerAccessInput = { displayName: String(data.get("displayName") ?? "").trim(), email: String(data.get("email") ?? "").trim(), role: String(data.get("role") ?? "beta_tester"), code: String(data.get("code") ?? "").trim() }; const outcome = await options.onAccessSubmit!(input); close(); status = outcome.status; renderStateControls(outcome.message); } catch (caught) { error.textContent = caught instanceof Error ? caught.message : "Unable to verify reviewer access"; error.hidden = false; submit.disabled = false; } });
    shadow.append(backdrop); backdrop.querySelector<HTMLInputElement>('input[name="displayName"]')?.focus();
  };
  const cleanupPreview = () => { previewCleanup?.(); previewCleanup = undefined; };
  const closeDialog = () => { if (pendingScreenshotId) void options.cancelScreenshot?.(pendingScreenshotId).catch(() => undefined); pendingScreenshotId = undefined; shadow.querySelector(".backdrop")?.remove(); composerContext = undefined; cleanupPreview(); fallbackPin = false; returnFocus?.focus(); };
  const closeChoice = (restore = true) => { shadow.querySelector("[data-comment-choice]")?.remove(); if (choiceOutsideListener) ownerDocument.removeEventListener("pointerdown", choiceOutsideListener, true); choiceOutsideListener = undefined; if (restore) returnFocus?.focus(); };
  const startAreaSelection = (trigger: HTMLElement) => {
    closeChoice(false);
    if (pinListener) clearAreaSelection();
    returnFocus = trigger;
    trigger.setAttribute("aria-pressed", "true");
    trigger.textContent = "💬 Cancel marker";
    ownerDocument.documentElement.style.cursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cpath fill='%2328c4c2' stroke='%230b6261' stroke-width='2' d='M3 3h24v18H13l-7 6v-6H3z'/%3E%3C/svg%3E") 4 4, crosshair`;
    const panel = shadow.querySelector<HTMLElement>(".panel")!; panel.hidden = false;
    const instruction = shadow.querySelector<HTMLElement>("[data-panel-content]")!;
    instruction.tabIndex = -1;
    instruction.textContent = "Click an area, or use the arrow keys to choose one. Press Escape to cancel.";
    const finish = (element: HTMLElement, x: number, y: number) => { const anchor = capturePinAnchor(element, x, y); if (!anchor) return; clearAreaSelection(); previewCleanup = renderPin(ownerDocument, anchor); openDialog(trigger, frameUnavailable ? "Comment on embedded content" : "Comment on an area", { anchor_type: "visual_pin", ...anchor }); };
    pinListener = (pointer) => { const element = ownerDocument.elementFromPoint(pointer.clientX, pointer.clientY) as HTMLElement | null; if (!element || host.contains(element)) return; pointer.preventDefault(); pointer.stopPropagation(); finish(element, pointer.clientX, pointer.clientY); };
    areaCandidates = Array.from(ownerDocument.querySelectorAll<HTMLElement>("main,article,section,h1,h2,h3,h4,h5,h6,p,li,a,button,img,video,input,select,textarea,[role]"))
      .filter((element) => !host.contains(element) && element.getBoundingClientRect().width >= 24 && element.getBoundingClientRect().height >= 24).slice(0, 200);
    const showCandidate = (next: number) => { if (!areaCandidates.length) return; if (areaCandidateIndex >= 0) { areaCandidates[areaCandidateIndex]?.style.removeProperty("outline"); areaCandidates[areaCandidateIndex]?.style.removeProperty("outline-offset"); } areaCandidateIndex = (next + areaCandidates.length) % areaCandidates.length; const candidate = areaCandidates[areaCandidateIndex]!; candidate.style.setProperty("outline", "4px solid #d73b3d", "important"); candidate.style.setProperty("outline-offset", "3px", "important"); candidate.scrollIntoView?.({ block: "nearest", inline: "nearest" }); };
    areaKeyListener = (event) => { if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); showCandidate(areaCandidateIndex + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)); } else if (event.key === "Enter" && areaCandidateIndex >= 0) { event.preventDefault(); event.stopPropagation(); const candidate = areaCandidates[areaCandidateIndex]!; const rect = candidate.getBoundingClientRect(); finish(candidate, rect.left + rect.width / 2, rect.top + rect.height / 2); } };
    ownerDocument.addEventListener("pointerdown", pinListener, true); ownerDocument.addEventListener("keydown", cancelPin, true);
    ownerDocument.addEventListener("keydown", areaKeyListener, true);
    if (areaCandidates.length) showCandidate(Math.max(0, areaCandidates.indexOf(lastPageFocus!)));
    else instruction.textContent = "No selectable areas found; use Comment on text instead.";
    instruction.focus();
  };
  const openCommentChoice = (trigger: HTMLElement) => {
    closeChoice(false); returnFocus = trigger;
    const selection = ownerDocument.defaultView?.getSelection();
    const selectedRange = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : undefined;
    const textAnchor = selectedRange ? captureTextAnchor(selectedRange, ownerDocument) : null;
    const choice = ownerDocument.createElement("section"); choice.dataset.commentChoice = "true"; choice.className = "comment-choice"; choice.setAttribute("aria-label", "Choose how to add a comment");
    choice.innerHTML = `<h2>Add a comment</h2><button type="button" data-choice="text"><strong>Comment on text</strong><span>Select words on the course page, then choose this option.</span></button><button type="button" data-choice="area"><strong>${frameUnavailable ? "Comment on embedded content" : "Comment on an area"}</strong><span>${frameUnavailable ? "Mark the area of the embedded activity your feedback relates to." : "Click the part of the page your feedback relates to."}</span></button><button type="button" data-choice="cancel">Cancel</button>`;
    choice.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeChoice(); } });
    choice.querySelector('[data-choice="cancel"]')?.addEventListener("click", () => closeChoice());
    choice.querySelector('[data-choice="text"]')?.addEventListener("click", () => { if (!textAnchor || !selectedRange) { closeChoice(false); const panel = shadow.querySelector<HTMLElement>(".panel")!; panel.hidden = false; shadow.querySelector<HTMLElement>("[data-panel-content]")!.textContent = "Select text on the page first."; ownerDocument.body?.focus?.(); return; } closeChoice(false); previewCleanup = renderTextHighlight(ownerDocument, selectedRange); openDialog(trigger, "Comment on text", { anchor_type: "text_highlight", ...textAnchor }); });
    choice.querySelector('[data-choice="area"]')?.addEventListener("click", () => { fallbackPin = frameUnavailable; startAreaSelection(trigger); });
    shadow.querySelector(".shell")?.append(choice);
    choiceOutsideListener = (event) => { if (event.target !== host) closeChoice(); };
    ownerDocument.addEventListener("pointerdown", choiceOutsideListener, true);
    choice.querySelector<HTMLElement>('[data-choice="text"]')?.focus();
  };
  const selectedTextDraft = () => {
    const selection = ownerDocument.defaultView?.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return undefined;
    const range = selection.getRangeAt(0).cloneRange();
    const anchor = captureTextAnchor(range, ownerDocument);
    return anchor ? { range, anchor } : undefined;
  };
  const updateAdaptiveAction = () => {
    const button = shadow.querySelector<HTMLButtonElement>('[data-action="add-comment"]');
    if (button) button.textContent = selectedTextDraft() ? "Add comment to highlighted text" : "Add comment marker";
  };
  const selectionListener = () => updateAdaptiveAction();
  ownerDocument.addEventListener("selectionchange", selectionListener);
  const openHelp = (trigger: HTMLElement) => {
    returnFocus = trigger; const backdrop = ownerDocument.createElement("div"); backdrop.className = "backdrop";
    backdrop.innerHTML = `<div class="dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="review-help-title" aria-describedby="review-help-intro"><h2 id="review-help-title" tabindex="-1">How course review works</h2><p id="review-help-intro">Choose the method that best identifies what your feedback relates to.</p><ol><li><strong>Comment on text</strong><span>Select exact words on the page, then add your feedback.</span></li><li><strong>Comment on an area</strong><span>Mark a visual element, image, layout area, or control.</span></li><li><strong>Embedded activities</strong><span>Choose Comment on embedded content when a Rise or SCORM activity cannot be inspected directly. The location is attached to the containing Moodle page.</span></li><li><strong>Comments</strong><span>Open existing feedback for the current page.</span></li><li><strong>Conversations and status</strong><span>Replies stay with the comment; LD/DCD users can progress or resolve feedback.</span></li></ol><p class="help-version">Pilot ${escapeHtml(buildDiagnostics.version)} · build ${escapeHtml(buildDiagnostics.buildCommit.slice(0, 7))}</p><div class="actions"><button type="button" class="primary" data-close-help>Close help</button></div></div>`;
    const shell = shadow.querySelector<HTMLElement>(".shell")!; shell.inert = true;
    const close = () => { shell.inert = false; backdrop.remove(); (shadow.querySelector<HTMLElement>('[data-action="help"]') ?? shell)?.focus(); };
    backdrop.addEventListener("keydown", (event) => { const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>('h2,[data-close-help]')); const index = Math.max(0, focusable.indexOf(shadow.activeElement as HTMLElement)); const outcome = handleDialogKey({ key: event.key, shiftKey: event.shiftKey, activeIndex: index, focusableCount: focusable.length }); if (event.key === "Tab" || outcome.close) event.preventDefault(); if (outcome.close) close(); else if (event.key === "Tab") focusable[outcome.focusIndex]?.focus(); });
    backdrop.querySelector("[data-close-help]")?.addEventListener("click", close); shadow.append(backdrop); backdrop.querySelector<HTMLElement>("h2")?.focus();
  };
  const openDialog = (trigger: HTMLElement, label: string, anchor: CommentAnchor) => {
    const contextSnapshot = { ...context };
    composerContext = contextSnapshot;
    returnFocus = trigger;
    const backdrop = ownerDocument.createElement("div");
    backdrop.className = "backdrop";
    const preview = anchor.anchor_type === "text_highlight" ? `“${anchor.selected_quote}”` : `Pin: ${anchor.css_selector}`;
    backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title"><h2 id="review-dialog-title">${escapeHtml(label)}</h2><div class="preview">${escapeHtml(preview)}</div><label class="field">Comment<textarea data-initial-focus required></textarea></label><label class="field"><span><input type="checkbox" data-screenshot> Include a screenshot of the visible viewport</span><small>Only captured when you save this comment.</small></label><div class="error" role="alert" hidden></div><div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-save>Save comment</button></div></div>`;
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
        const saved = await options.submit?.({ body: textarea.value.trim(), category: "general", anchor, screenshot: wantsScreenshot, embeddedFrameUnavailable: fallbackPin, contextSnapshot });
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
    const addComment = shadow.querySelector<HTMLElement>('[data-action="add-comment"]');
    addComment?.addEventListener("click", (event) => {
      const trigger = event.currentTarget as HTMLElement;
      const selected = selectedTextDraft();
      if (selected) { returnFocus = trigger; previewCleanup = renderTextHighlight(ownerDocument, selected.range); openDialog(trigger, "Comment on highlighted text", { anchor_type: "text_highlight", ...selected.anchor }); }
      else startAreaSelection(trigger);
    });
    updateAdaptiveAction();
    shadow.querySelector<HTMLElement>('[data-action="help"]')?.addEventListener("click", (event) => openHelp(event.currentTarget as HTMLElement));
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
      stateVersion += 1; authenticating = false; context = next; status = nextStatus; closeChoice(false); updateLabels();
      if (nextStatus !== "connected") { shadow.querySelectorAll<HTMLElement>("[data-comment-count],[data-comment-count-short]").forEach((node) => { node.textContent = "0"; }); }
      const dialog = shadow.querySelector<HTMLElement>(".dialog");
      if (dialog && composerContext && (composerContext.page_url !== next.page_url || composerContext.course_url !== next.course_url) && !dialog.querySelector("[data-context-warning]")) {
        const warning = ownerDocument.createElement("p"); warning.dataset.contextWarning = "true"; warning.className = "error"; warning.textContent = "The page changed. This comment will stay attached to the page where you opened it."; dialog.querySelector(".preview")?.after(warning);
      }
    },
    setViewer(viewer) { currentViewer = viewer; updateLabels(); },
    setPageComments(comments) {
      for (const cleanup of storedAnchorCleanups) cleanup(); storedAnchorCleanups = [];
      loadedComments = new Map(comments.map((comment) => [comment.id, comment]));
      shadow.querySelectorAll<HTMLElement>("[data-comment-count],[data-comment-count-short]").forEach((node) => { node.textContent = String(comments.length); });
      openThreads = new Map();
      const unresolved: UnresolvedAnchor[] = [];
      const panel = shadow.querySelector<HTMLElement>(".panel")!;
      const panelContent = panel.querySelector<HTMLElement>("[data-panel-content]")!;
      panelContent.replaceChildren();
      for (const [commentIndex, comment] of comments.entries()) {
        const openThread = (marker?: HTMLElement) => {
          shadow.querySelector("[data-thread-popover]")?.remove();
          if (marker && activeThreadId === comment.id) { activeThreadId = undefined; marker.setAttribute("aria-expanded", "false"); marker.focus(); return; }
          ownerDocument.querySelectorAll<HTMLElement>("[data-moodle-review-stored-highlight],[data-moodle-review-stored-pin]").forEach((node) => node.setAttribute("aria-expanded", "false"));
          activeThreadId = marker ? comment.id : undefined; if (marker) marker.setAttribute("aria-expanded", "true");
          const article = ownerDocument.createElement("article"); article.dataset.threadPopover = "true"; article.tabIndex = -1;
          const contextLine = ownerDocument.createElement("p"); contextLine.textContent = `Comment ${commentIndex + 1} of ${comments.length}`; contextLine.style.cssText = "margin:0 44px 4px 0;font-size:12px;color:#52666c";
          const byline = ownerDocument.createElement("p"); byline.textContent = `${comment.author.display_name} · ${comment.author.role.replaceAll("_", " ")}`; byline.style.cssText = "margin:0 44px 10px 0;font-size:13px;font-weight:650";
          const body = ownerDocument.createElement("div"); body.textContent = comment.body; body.style.cssText = "padding:12px;border:1px solid #8ad9d8;border-radius:8px;background:#effafa"; article.append(contextLine, byline, body);
          if (comment.capabilities.can_edit && options.editThread) { const edit = ownerDocument.createElement("button"); edit.type = "button"; edit.textContent = "✎"; edit.setAttribute("aria-label", "Edit original comment"); edit.style.cssText = "width:44px;height:44px;padding:0;font-size:24px"; edit.addEventListener("click", () => { const existing = article.querySelector<HTMLElement>("[data-edit-composer]"); if (existing) { existing.remove(); edit.setAttribute("aria-pressed", "false"); body.hidden = false; edit.focus(); return; } article.querySelector("[data-reply-composer]")?.remove(); const editor = ownerDocument.createElement("div"); editor.dataset.editComposer = "true"; const input = ownerDocument.createElement("textarea"); input.value = body.textContent ?? comment.body; input.style.cssText = "width:100%;min-height:90px"; const save = ownerDocument.createElement("button"); save.type = "button"; save.textContent = "Save"; const cancel = ownerDocument.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; const close = () => { editor.remove(); edit.setAttribute("aria-pressed", "false"); body.hidden = false; edit.focus(); }; cancel.addEventListener("click", close); save.addEventListener("click", async () => { if (!input.value.trim()) return; save.disabled = true; try { await options.editThread!(comment.id, input.value.trim()); body.textContent = input.value.trim(); close(); } catch (error) { save.disabled = false; const alert = ownerDocument.createElement("p"); alert.setAttribute("role", "alert"); alert.textContent = error instanceof Error ? error.message : "Could not save edit"; editor.append(alert); } }); editor.append(input, save, cancel); body.hidden = true; body.after(editor); edit.setAttribute("aria-pressed", "true"); input.focus(); }); byline.append(" ", edit); }
          for (const reply of comment.replies) { const node = ownerDocument.createElement("div"); node.textContent = `${reply.author.display_name} (${reply.author.role.replaceAll("_", " ")}): ${reply.body}`; node.style.cssText = "margin-top:8px;padding:10px;border:1px solid #d7e6e6;border-radius:8px"; article.append(node); }
          if (comment.capabilities.can_reply && options.replyThread) { const replyToggle = ownerDocument.createElement("button"); replyToggle.type = "button"; replyToggle.dataset.replyToggle = "true"; replyToggle.textContent = "Reply"; replyToggle.style.cssText = "margin-top:10px;border:0;background:transparent;color:#0b6261;text-decoration:underline;padding:6px"; replyToggle.addEventListener("click", () => { const existing = article.querySelector<HTMLElement>("[data-reply-composer]"); if (existing) { existing.remove(); replyToggle.setAttribute("aria-expanded", "false"); replyToggle.focus(); return; } article.querySelector("[data-edit-composer]")?.remove(); const composer = ownerDocument.createElement("div"); composer.dataset.replyComposer = "true"; const replyBox = ownerDocument.createElement("textarea"); replyBox.placeholder = "Add a reply…"; replyBox.setAttribute("aria-label", "Add a reply"); replyBox.style.cssText = "width:100%;min-height:72px;margin-top:8px"; const save = ownerDocument.createElement("button"); save.type = "button"; save.dataset.saveReply = "true"; save.textContent = "Save reply"; const cancel = ownerDocument.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; const close = () => { composer.remove(); replyToggle.setAttribute("aria-expanded", "false"); replyToggle.focus(); }; cancel.addEventListener("click", close); save.addEventListener("click", async () => { const value = replyBox.value.trim(); if (!value) return; save.disabled = true; try { await options.replyThread!(comment.id, value); const node = ownerDocument.createElement("div"); node.textContent = value; node.style.cssText = "margin-top:8px;padding:10px;border:1px solid #d7e6e6;border-radius:8px"; replyToggle.before(node); close(); } catch (error) { save.disabled = false; const alert = ownerDocument.createElement("p"); alert.setAttribute("role", "alert"); alert.textContent = error instanceof Error ? error.message : "Could not save reply"; composer.append(alert); } }); composer.append(replyBox, save, cancel); replyToggle.after(composer); replyToggle.setAttribute("aria-expanded", "true"); replyBox.focus(); }); article.append(replyToggle); }
          if (comment.capabilities.can_share_with_sme && options.manageSme) { const ask = ownerDocument.createElement("button"); ask.type = "button"; ask.textContent = "Ask SME"; ask.addEventListener("click", async () => { ask.disabled = true; try { const state = await options.manageSme!(comment.id); const chooser = ownerDocument.createElement("div"); chooser.style.cssText = "margin-top:10px;padding:10px;border:1px solid #8ad9d8;border-radius:8px"; const boxes: HTMLInputElement[] = []; for (const sme of state.available_recipients) { const label = ownerDocument.createElement("label"); label.style.display = "block"; const box = ownerDocument.createElement("input"); box.type = "checkbox"; box.value = sme.id; box.checked = state.selected_user_ids.includes(sme.id); boxes.push(box); label.append(box, ` ${sme.display_name}`); chooser.append(label); } const save = ownerDocument.createElement("button"); save.type = "button"; save.textContent = "Save SME access"; save.addEventListener("click", async () => { save.disabled = true; await options.manageSme!(comment.id, boxes.filter((box) => box.checked).map((box) => box.value)); chooser.remove(); ask.disabled = false; }); chooser.append(save); ask.after(chooser); } catch { ask.disabled = false; } }); article.append(ask); }
          if (comment.capabilities.can_delete && options.deleteThread) { const remove = ownerDocument.createElement("button"); remove.type = "button"; remove.textContent = "🗑"; remove.setAttribute("aria-label", "Delete thread"); remove.style.cssText = "position:absolute;right:8px;top:8px;width:44px;height:44px;padding:0"; remove.addEventListener("click", async () => { if (!ownerDocument.defaultView?.confirm("Delete this entire thread, including all replies and screenshots?")) return; remove.disabled = true; try { await options.deleteThread!(comment.id); article.remove(); } catch (error) { remove.disabled = false; const alert = ownerDocument.createElement("p"); alert.setAttribute("role", "alert"); alert.textContent = error instanceof Error ? error.message : "Could not delete thread"; article.append(alert); } }); article.append(remove); }
          if (marker) { const position = () => { const rect = marker.getBoundingClientRect(); const width = Math.min(360, (ownerDocument.defaultView?.innerWidth ?? 800) - 16); const height = Math.min(article.offsetHeight || 300, (ownerDocument.defaultView?.innerHeight ?? 600) - 16); const right = rect.right + 8; const left = right + width <= (ownerDocument.defaultView?.innerWidth ?? 800) - 8 ? right : Math.max(8, rect.left - width - 8); article.style.left = `${left}px`; article.style.top = `${Math.max(8, Math.min((ownerDocument.defaultView?.innerHeight ?? 600) - height - 8, rect.top))}px`; }; article.style.cssText = "position:fixed;z-index:2147483647;width:min(360px,calc(100vw - 16px));max-height:min(480px,calc(100vh - 16px));overflow:auto;background:white;border:4px solid #28c4c2;border-radius:10px;padding:14px;box-shadow:0 8px 28px #0006"; shadow.append(article); position(); ownerDocument.defaultView?.addEventListener("scroll", position, true); ownerDocument.defaultView?.addEventListener("resize", position); const observer = new MutationObserver(() => { if (!article.isConnected) { ownerDocument.defaultView?.removeEventListener("scroll", position, true); ownerDocument.defaultView?.removeEventListener("resize", position); observer.disconnect(); } }); observer.observe(shadow, { childList: true }); article.focus(); }
          else { panel.hidden = false; panelContent.replaceChildren(article); }
        };
        openThreads.set(comment.id, openThread);
        if (comment.anchor_type === "text_highlight" && comment.selected_quote) {
          const recovered = recoverTextAnchor(ownerDocument, { selected_quote: comment.selected_quote, prefix: comment.prefix ?? "", suffix: comment.suffix ?? "" });
          if (recovered.status === "resolved") {
            storedAnchorCleanups.push(renderTextHighlight(ownerDocument, recovered.range));
            const marker = ownerDocument.createElement("button"); marker.type = "button"; marker.id = `moodle-review-highlight-${comment.id}`; marker.dataset.moodleReviewStoredHighlight = comment.id; marker.setAttribute("aria-label", `Open feedback: ${comment.body}`); marker.setAttribute("aria-expanded", "false"); marker.textContent = "💬"; marker.style.cssText = "position:fixed;z-index:2147483646;width:38px;height:38px;border:2px solid #0b6261;border-radius:10px;background:#28c4c2;color:#082f2f;padding:4px;font:20px/1 sans-serif;box-shadow:0 3px 10px #0005"; marker.addEventListener("click", () => openThread(marker));
            const place = () => { const position = recovered.range.getBoundingClientRect(); marker.hidden = position.width === 0 && position.height === 0; marker.style.left = `${Math.max(0, position.left)}px`; marker.style.top = `${Math.max(0, position.bottom + 4)}px`; };
            ownerDocument.documentElement.append(marker); trackReposition(place, marker);
          }
          else unresolved.push({ id: comment.id, label: `${comment.page_title} · ${comment.body}`, quote: comment.selected_quote });
        } else if (comment.anchor_type === "visual_pin" && comment.css_selector && comment.relative_x !== null && comment.relative_y !== null) {
          const anchor = { css_selector: comment.css_selector, relative_x: comment.relative_x, relative_y: comment.relative_y };
          const recovered = recoverPinAnchor(ownerDocument, anchor);
          if (recovered.status === "unresolved") unresolved.push({ id: comment.id, label: `${comment.page_title} · ${comment.body}` });
          else {
            const marker = ownerDocument.createElement("button"); marker.type = "button"; marker.dataset.moodleReviewStoredPin = comment.id; marker.setAttribute("aria-label", `Open feedback: ${comment.body}`); marker.setAttribute("aria-expanded", "false"); marker.style.cssText = "position:fixed;z-index:2147483646;width:38px;height:38px;border-radius:10px;border:2px solid #0b6261;background:#28c4c2;color:#082f2f;transform:translate(-50%,-50%);font:20px/1 sans-serif;box-shadow:0 3px 10px #0005"; marker.textContent = "💬"; marker.addEventListener("click", () => openThread(marker));
            const place = () => { const position = recoverPinAnchor(ownerDocument, anchor); marker.hidden = position.status !== "resolved"; if (position.status === "resolved") { marker.style.left = `${position.x}px`; marker.style.top = `${position.y}px`; } };
            ownerDocument.documentElement.append(marker); trackReposition(place, marker);
          }
        }
        const item = ownerDocument.createElement("button"); item.type = "button"; item.textContent = `${commentIndex + 1}. ${comment.author.display_name} — ${comment.body.slice(0, 90)}${comment.body.length > 90 ? "…" : ""}`; item.style.cssText = "display:block;width:100%;margin-top:8px;text-align:left"; item.addEventListener("click", () => { const marker = ownerDocument.querySelector<HTMLElement>(`[data-moodle-review-stored-highlight="${comment.id}"],[data-moodle-review-stored-pin="${comment.id}"]`); if (marker) { marker.scrollIntoView?.({ block: "center" }); marker.focus(); openThread(marker); } else openThread(); }); panelContent.append(item);
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
    showFrameFallback() { frameUnavailable = true; shadow.querySelector("[data-frame-fallback]")?.remove(); },
    hideFrameFallback() { frameUnavailable = false; fallbackPin = false; const region = shadow.querySelector<HTMLElement>("[data-frame-fallback]"); if (region) region.hidden = true; },
    setUnresolvedAnchors(anchors) {
      let region = shadow.querySelector<HTMLElement>("[data-unresolved]");
      if (!region) {
        region = ownerDocument.createElement("section");
        region.dataset.unresolved = "true";
        region.setAttribute("aria-labelledby", "unresolved-anchor-heading");
        shadow.querySelector(".shell")?.append(region);
      }
      region.hidden = true;
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
    destroy() { clearAreaSelection(); closeChoice(false); ownerDocument.removeEventListener("focusin", rememberPageFocus, true); ownerDocument.removeEventListener("selectionchange", selectionListener); ownerDocument.defaultView?.removeEventListener("resize", scheduleReposition); ownerDocument.defaultView?.removeEventListener("scroll", scheduleReposition, true); if (repositionFrame !== undefined) ownerDocument.defaultView?.cancelAnimationFrame(repositionFrame); cleanupPreview(); for (const cleanup of storedAnchorCleanups) cleanup(); host.remove(); },
  };
}
