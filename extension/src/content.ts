declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const __EXTENSION_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const chrome: any;

import { canonicalCourseUrlFromDocument, courseTitleFromDocument, detectCourseContext, explicitActivityIdFromDocument, explicitCourseIdFromDocument, type CourseContext } from "./course-context.ts";
import { mountReviewOverlay, type AuthenticationOutcome, type BuildDiagnostics, type ConnectionStatus, type ReviewOverlay } from "./overlay/root.ts";
import type { PageComment } from "./background-bridge.ts";
import { measureFrameCapabilities } from "./frame-capabilities.ts";
import { createScormWorker, type ScormWorker } from "./scorm-worker.ts";

const MARKER = "data-moodle-review-extension";
const BUILD_DIAGNOSTICS = {
  version: typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "0.0.0",
  buildCommit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "0000000000000000000000000000000000000000",
};
const OWNER = Symbol.for("moodle-course-review.content-owner");
const MAX_WORKER_INSTANCE_EPOCH = 2_147_483_647;
const isTransientReviewContextError = (message: unknown) => message === "Review context unavailable" || message === "Course is not bound to tab";
type MarkerRoot = {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};
type OwnedRoot = MarkerRoot & { [OWNER]?: { cleanup(): void; workerInstanceEpoch: number } };
export type InteractionTarget = "local" | "loading" | "embedded" | "permission-required" | "reload-required" | "unavailable";
export type DesiredInteraction = "marker" | "selection";

export function createInteractionTargetController(options: {
  scorm: boolean; requestablePermission: boolean; loadingTimeoutMs: number;
  setTimeout(handler: () => void, delay: number): unknown; clearTimeout(timer: unknown): void;
  onState(state: InteractionTarget): void; onReplay(intent: DesiredInteraction): void; onCancel?: () => void;
}) {
  let current: InteractionTarget = options.scorm ? (options.requestablePermission ? "permission-required" : "loading") : "local";
  let requestablePermission = options.requestablePermission;
  let desired: DesiredInteraction | undefined;
  let deadline: unknown;
  let cancelled = false;
  const publish = (next: InteractionTarget) => { if (current === next && !cancelled) return; current = next; cancelled = false; options.onState(next); };
  const beginDeadline = () => {
    if (current !== "loading") return;
    deadline = options.setTimeout(() => { if (current === "loading") publish("unavailable"); }, options.loadingTimeoutMs);
  };
  options.onState(current);
  beginDeadline();
  return {
    state: () => current,
    queuedIntent: () => desired,
    request: (intent: DesiredInteraction) => { if (intent === "marker" && desired === "marker") { desired = undefined; options.onCancel?.(); return; } desired = intent; if (current === "embedded") options.onReplay(intent); },
    cancel: () => { desired = undefined; cancelled = true; },
    workerReady: () => { if (deadline !== undefined) options.clearTimeout(deadline); publish("embedded"); if (desired) options.onReplay(desired); },
    workerLost: () => { publish(requestablePermission ? "permission-required" : "loading"); beginDeadline(); },
    permissionRequired: () => { requestablePermission = true; publish("permission-required"); },
    permissionDenied: () => publish("permission-required"),
    permissionRevoked: () => publish("permission-required"),
    permissionGranted: (reloadRequired = false) => { publish(reloadRequired ? "reload-required" : "loading"); beginDeadline(); },
    destroy: () => { if (deadline !== undefined) options.clearTimeout(deadline); desired = undefined; },
  };
}

export function sendRuntimeMessage(
  runtime: { sendMessage(message: unknown, callback: (response: any) => void): void },
  message: unknown,
  callback: (response: any) => void,
): boolean {
  try { runtime.sendMessage(message, callback); return true; }
  catch { callback({ ok: false, status: "offline", error: "Extension context invalidated" }); return false; }
}

export async function refreshCourseBindingBeforeComment(
  send: (message: unknown) => Promise<{ id?: unknown }>,
  context: Pick<CourseContext, "course_url" | "title" | "moodle_course_id">,
  expectedCourseId: string,
): Promise<void> {
  const payload = { course_url: context.course_url, title: context.title, ...(context.moodle_course_id ? { moodle_course_id: context.moodle_course_id } : {}) };
  const resolved = await send({ type: "RESOLVE_COURSE", payload });
  if (resolved?.id !== expectedCourseId) throw new Error("The course connection changed. Close this comment and try again.");
}

function matchPattern(url: string, pattern: string): boolean {
  const match = /^(\*|http|https|file|ftp):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match) return false;
  const candidate = new URL(url);
  const [, scheme, host, path] = match;
  if (scheme === "*" ? !["http:", "https:"].includes(candidate.protocol) : candidate.protocol !== `${scheme}:`) return false;
  const hostMatches = host === "*"
    || (host.startsWith("*.")
      ? candidate.hostname === host.slice(2) || candidate.hostname.endsWith(`.${host.slice(2)}`)
      : candidate.hostname === host);
  if (!hostMatches) return false;
  const escapedPath = path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escapedPath}$`).test(`${candidate.pathname}${candidate.search}${candidate.hash}`);
}

export function isConfiguredFrame(
  url: string,
  moodlePatterns: string[],
  optionalFramePatterns: string[],
  hasOptionalPermission: (pattern: string) => boolean = () => false,
  parentUrl = "",
): boolean {
  const inheritedUrl = parentUrl || (url.startsWith("blob:") ? url.slice(5) : "");
  const candidate = /^(?:about:blank|about:srcdoc|blob:)/.test(url) && inheritedUrl ? inheritedUrl : url;
  if (moodlePatterns.some((pattern) => matchPattern(candidate, pattern))) return true;
  return optionalFramePatterns.some((pattern) => matchPattern(candidate, pattern) && hasOptionalPermission(pattern));
}

export async function bootstrapContentScript(options: {
  url: string;
  document: { documentElement: MarkerRoot };
  moodlePatterns: string[];
  optionalFramePatterns: string[];
  parentUrl?: string;
  inject: (workerInstanceEpoch: number) => void | (() => void);
}): Promise<boolean> {
  // Chrome gates static Moodle matches and background registration gates optional
  // frames, so a running content script is already authorized for this URL.
  if (!isConfiguredFrame(options.url, [...options.moodlePatterns, ...options.optionalFramePatterns], [], () => false, options.parentUrl)) return false;
  const root = options.document.documentElement as OwnedRoot;
  const workerInstanceEpoch = (root[OWNER]?.workerInstanceEpoch ?? 0) + 1;
  if (workerInstanceEpoch > MAX_WORKER_INSTANCE_EPOCH) return false;
  root[OWNER]?.cleanup();
  if (root.hasAttribute(MARKER) && !root[OWNER]) root.removeAttribute(MARKER);
  const owner = { cleanup: () => {}, workerInstanceEpoch };
  root[OWNER] = owner;
  root.setAttribute(MARKER, "active");
  const injectedCleanup = options.inject(workerInstanceEpoch);
  let stopped = false;
  owner.cleanup = () => {
    if (stopped) return;
    stopped = true;
    injectedCleanup?.();
    if (root[OWNER] === owner) {
      delete root[OWNER];
      root.removeAttribute(MARKER);
    }
  };
  return true;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void bootstrapContentScript({
    url: window.location.href,
    document,
    moodlePatterns: __MOODLE_PATTERNS__,
    optionalFramePatterns: __OPTIONAL_FRAME_PATTERNS__,
    parentUrl: document.referrer,
    inject: (workerInstanceEpoch) => {
      document.documentElement.dispatchEvent(new CustomEvent("moodle-review:bootstrap"));
      if (window.top === window) return startCourseReview(window, document, chrome.runtime);
      return startEmbeddedReview(window, document, chrome.runtime, 200, 2_000, workerInstanceEpoch);
    },
  });
}

function pageLabel(document: Document): string {
  return document.querySelector<HTMLElement>("h1")?.textContent?.trim() || document.title.trim() || "Current page";
}

function currentContext(targetWindow: Window & typeof globalThis, targetDocument: Document): CourseContext {
  return detectCourseContext({
    url: targetWindow.location.href,
    title: courseTitleFromDocument(targetDocument),
    pageTitle: pageLabel(targetDocument),
    explicitCourseId: explicitCourseIdFromDocument(targetDocument),
    explicitActivityId: explicitActivityIdFromDocument(targetDocument),
    canonicalCourseUrl: canonicalCourseUrlFromDocument(targetDocument),
  });
}

export function countInaccessibleFrames(targetDocument: Document): number {
  let count = 0;
  for (const frame of Array.from(targetDocument.querySelectorAll("iframe"))) {
    try { if (!frame.contentDocument) count += 1; } catch { count += 1; }
  }
  return count;
}

export function inaccessibleFrameOrigins(targetDocument: Document): string[] {
  const origins: string[] = [];
  for (const frame of Array.from(targetDocument.querySelectorAll("iframe"))) {
    let inaccessible = false; try { inaccessible = !frame.contentDocument; } catch { inaccessible = true; }
    if (!inaccessible) continue;
    try { origins.push(new URL(frame.src || frame.getAttribute("src") || "", targetDocument.baseURI).origin); } catch { origins.push("null"); }
  }
  return origins;
}

export function hasDescendantReviewOverlay(targetDocument: Document): boolean {
  for (const frame of Array.from(targetDocument.querySelectorAll("iframe"))) {
    let child: Document | null = null;
    try { child = frame.contentDocument; } catch { /* cross-origin descendants use coordinator status */ }
    if (!child) continue;
    if (child.getElementById("moodle-course-review-overlay") || hasDescendantReviewOverlay(child)) return true;
  }
  return false;
}

export function hasInaccessibleFrame(targetDocument: Document): boolean {
  return countInaccessibleFrames(targetDocument) > 0;
}

export function createLifecycleController(targetWindow: Window & typeof globalThis, targetDocument: Document, refresh: () => void, delay = 120): { teardown(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!stopped) refresh();
  };
  const schedule = () => { if (!stopped) { if (timer) clearTimeout(timer); timer = setTimeout(flush, delay); } };
  const events = ["popstate", "hashchange", "moodle-review:navigate"];
  for (const eventName of events) targetWindow.addEventListener(eventName, schedule);
  const originals = { pushState: targetWindow.history.pushState, replaceState: targetWindow.history.replaceState };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = originals[method].bind(targetWindow.history);
    targetWindow.history[method] = ((data: unknown, unused: string, url?: string | URL | null) => {
      original(data, unused, url);
      targetWindow.dispatchEvent(new targetWindow.Event("moodle-review:navigate"));
    }) as History[typeof method];
  }
  const observer = new targetWindow.MutationObserver(schedule);
  const title = targetDocument.querySelector("title");
  if (title) observer.observe(title, { childList: true, subtree: true, characterData: true });
  return { flush, teardown() {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    observer.disconnect();
    for (const eventName of events) targetWindow.removeEventListener(eventName, schedule);
    for (const method of ["pushState", "replaceState"] as const) targetWindow.history[method] = originals[method];
  } };
}

export function startCourseReview(targetWindow: Window & typeof globalThis = window, targetDocument: Document = document, runtime: Runtime = chrome.runtime, buildDiagnostics: BuildDiagnostics = BUILD_DIAGNOSTICS, framePollDelay = 1_000): () => void {
  let context = currentContext(targetWindow, targetDocument);
  let courseId: string | undefined;
  let courseHandle: string | undefined;
  const courseIds = new Map<string, string>();
  const send = <T>(message: unknown) => new Promise<T>((resolve, reject) => sendRuntimeMessage(runtime, message, (response) => response?.ok ? resolve(response.data as T) : reject(new Error(response?.error ?? "Review service unavailable"))));
  let lastSignature = "";
  let approvalCheck: Promise<AuthenticationOutcome> | undefined;
  let approvalTimer: number | undefined;
  let stopped = false;
  let commentSequence = 0;
  let latestComments: PageComment[] = [];
  let embeddedPageUrl = "";
  let interactionController: ReturnType<typeof createInteractionTargetController>;
  let embeddedHasSelection = false;
  let overlay: ReviewOverlay;
  const waitingForApproval = "Waiting for approval — you can leave this page open or return later.";
  const checkPendingApproval = (): Promise<AuthenticationOutcome> => {
    if (!courseHandle) return Promise.resolve({ status: "signed-out", message: "Enter your invitation code to join this course review." });
    if (approvalCheck) return approvalCheck;
    approvalCheck = send<{ state: string }>({ type: "CHECK_PENDING_REVIEW_ACCESS", course_handle: courseHandle }).then((response) => {
      if (response.state === "connected") { lastSignature = ""; refresh(); return { status: "connected" as const, message: "Approved — connected" }; }
      if (response.state === "pending") return { status: "pending" as const, message: waitingForApproval };
      return { status: "signed-out" as const, message: "Enter your invitation code to join this course review." };
    }).catch(() => ({ status: "pending" as const, message: waitingForApproval })).finally(() => { approvalCheck = undefined; });
    return approvalCheck;
  };
  const clearApprovalTimer = () => { if (approvalTimer !== undefined) targetWindow.clearTimeout(approvalTimer); approvalTimer = undefined; };
  const scheduleApprovalCheck = () => { clearApprovalTimer(); if (stopped) return; approvalTimer = targetWindow.setTimeout(async () => { approvalTimer = undefined; if (targetDocument.hidden) { scheduleApprovalCheck(); return; } const outcome = await checkPendingApproval(); overlay.update(context, outcome.status); if (outcome.status === "pending") scheduleApprovalCheck(); }, 10_000); };
  const onVisibility = () => { if (!targetDocument.hidden && courseHandle) void checkPendingApproval().then((outcome) => { overlay.update(context, outcome.status); if (outcome.status === "pending") scheduleApprovalCheck(); }); };
  targetDocument.addEventListener("visibilitychange", onVisibility);
  const sendScormCommand = (commandType: string, payload: unknown = {}) => send({ type: "SCORM_TOP_COMMAND", command_type: commandType, request_id: targetWindow.crypto.randomUUID(), payload });
  const scormRoute = /\/mod\/scorm\/player\.php$/.test(targetWindow.location.pathname);
  const optionalFramePatterns = typeof __OPTIONAL_FRAME_PATTERNS__ !== "undefined" ? __OPTIONAL_FRAME_PATTERNS__ : [];
  let permissionOrigin = inaccessibleFrameOrigins(targetDocument).find((origin) => optionalFramePatterns.some((pattern) => matchPattern(`${origin}/`, pattern)));
  const loadPageComments = async (pageUrl: string, preserveOnError = false) => { const sequence = ++commentSequence; try { const comments = await send<PageComment[]>({ type: "LIST_COURSE_COMMENTS" }); if (sequence === commentSequence && context.page_url === pageUrl) { latestComments = comments; overlay.setCommentList(comments); overlay.setRendererComments(scormRoute ? [] : comments); if (scormRoute && embeddedPageUrl) void sendScormCommand("SCORM_SET_COMMENTS", { comments: comments.filter((comment) => comment.page_url === embeddedPageUrl) }).catch(() => undefined); const pending: { comment_id?: string } = await send<{ comment_id?: string }>({ type: "CONSUME_COMMENT_NAVIGATION" }).catch(() => ({})); if (pending.comment_id) overlay.takeToContext(pending.comment_id); } } catch (error) { const current = sequence === commentSequence && context.page_url === pageUrl; if (preserveOnError && current) throw error; } };
  const refreshAfterMutation = async () => { try { await loadPageComments(context.page_url, true); } catch { throw new Error("Change saved, but comments could not be refreshed. Reload the page."); } };
  overlay = mountReviewOverlay(targetDocument, context, "connecting", { onRequestInteraction: (intent) => { interactionController.request(intent); }, onRequestPermission: () => new Promise<boolean>((resolve) => {
    if (!permissionOrigin) { resolve(false); return; }
    sendRuntimeMessage(runtime, { type: "REQUEST_SCORM_PERMISSION", origin: permissionOrigin }, (response) => { const outcome = response?.data as { granted?: boolean; reload_required?: boolean } | undefined; const granted = Boolean(response?.ok && outcome?.granted); if (granted) interactionController.permissionGranted(outcome?.reload_required === true); resolve(granted); });
  }), onReloadRequired: () => targetWindow.location.reload(), submitEmbedded: async ({ capability, body, category, screenshot }: { capability: string; body: string; category: string; screenshot: boolean }) => { const saved = await send<{ id?: string; screenshot_available?: boolean }>({ type: "CREATE_EMBEDDED_COMMENT", capability, body, category, ...(screenshot ? { screenshot_requested: true } : {}) }); void loadPageComments(context.page_url); return saved; }, navigateToComment: async (commentId, pageUrl) => { const navigation = await send<{ destination_url?: string }>({ type: "PREPARE_COMMENT_NAVIGATION", comment_id: commentId, page_url: pageUrl }); if (navigation.destination_url) targetWindow.location.assign(navigation.destination_url); }, useAccessForm: () => Boolean(courseHandle), onAccessSubmit: async (input) => {
    if (!courseHandle) throw new Error("Course not enabled for review");
    const response = await send<{ state: string }>({ type: "REDEEM_REVIEW_ACCESS", course_handle: courseHandle, display_name: input.displayName, email: input.email, role: input.role, invitation_code: input.code });
    if (response.state === "pending") { scheduleApprovalCheck(); return { status: "pending", message: waitingForApproval }; }
    lastSignature = ""; refresh();
    return { status: "connected" };
  }, getSavedReviewers: () => courseHandle ? send<Array<{ email: string; label: string }>>({ type: "LIST_SAVED_REVIEWERS", course_handle: courseHandle }) : Promise.resolve([]), onUseSavedReviewer: () => checkPendingApproval(), onCheckApproval: checkPendingApproval, onAuthenticate: () => new Promise((resolve) => {
    sendRuntimeMessage(runtime, { type: "AUTHENTICATE" }, (response) => {
      if (!response?.ok) {
        if ((response?.status as string | undefined) === "cancelled") resolve({ status: "signed-out", message: "Sign-in cancelled" });
        else if (response?.status === "pending") resolve({ status: "pending", message: waitingForApproval });
        else if (response?.status === "offline") resolve({ status: "offline", message: "Service unavailable—retry" });
        else resolve({ status: "signed-out", message: "Sign-in failed—try again" });
        return;
      }
      lastSignature = "";
      refresh();
      resolve({ status: "connected" });
    });
  }), onTakeToContext: (id) => { overlay.takeToContext(id); }, submit: async ({ body, category, anchor, screenshot, embeddedFrameUnavailable, contextSnapshot }) => {
    const snapshotCourseId = courseIds.get(contextSnapshot.course_url);
    if (!snapshotCourseId) throw new Error("The original course is no longer connected. Cancel and reopen the comment.");
    await refreshCourseBindingBeforeComment(send, contextSnapshot, snapshotCourseId);
    const fallbackSuffix = " — embedded content—frame access unavailable";
    const pageTitle = embeddedFrameUnavailable ? `${contextSnapshot.pageTitle.slice(0, 512 - fallbackSuffix.length)}${fallbackSuffix}` : contextSnapshot.pageTitle;
    const saved = await send<{ id?: string; screenshot_available?: boolean }>({ type: "CREATE_COMMENT", payload: { course_id: snapshotCourseId, page_url: contextSnapshot.page_url, page_title: pageTitle, body, category, ...anchor }, screenshot_requested: screenshot });
    if (context.page_url === contextSnapshot.page_url) void loadPageComments(context.page_url);
    return saved;
  }, editThread: async (commentId, body) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "EDIT_COMMENT_THREAD", comment_id: commentId, body }); await loadPageComments(context.page_url); }, replyThread: async (commentId, body) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "REPLY_COMMENT_THREAD", comment_id: commentId, body }); await loadPageComments(context.page_url); }, changeStatus: async (commentId, nextStatus) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "UPDATE_COMMENT_STATUS", comment_id: commentId, status: nextStatus }); }, refreshComments: refreshAfterMutation, manageSme: async (commentId, userIds) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); return send({ type: userIds ? "SET_SME_RECIPIENTS" : "GET_SME_RECIPIENTS", comment_id: commentId, ...(userIds ? { user_ids: userIds } : {}) }); }, deleteThread: async (commentId) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "DELETE_COMMENT_THREAD", comment_id: commentId }); await refreshAfterMutation(); }, uploadScreenshot: (commentId, dataUrl) => send({ type: "UPLOAD_SCREENSHOT", comment_id: commentId, data_url: dataUrl }), cancelScreenshot: (commentId) => send({ type: "CANCEL_SCREENSHOT", comment_id: commentId }) }, buildDiagnostics);
  interactionController = createInteractionTargetController({ scorm: scormRoute, requestablePermission: false, loadingTimeoutMs: Math.max(250, framePollDelay * 3), setTimeout: (handler, delay) => targetWindow.setTimeout(handler, delay), clearTimeout: (timer) => targetWindow.clearTimeout(timer as number), onState: (state) => { overlay.setInteractionState(state, state === "embedded" && embeddedHasSelection); if (state === "unavailable") overlay.showFrameFallback(); else overlay.hideFrameFallback(); }, onReplay: (intent) => { void sendScormCommand(intent === "selection" ? "SCORM_START_SELECTION" : "SCORM_START_MARKER").catch(() => interactionController.workerLost()); }, onCancel: () => { void sendScormCommand("SCORM_CANCEL_MARKER").catch(() => undefined); } });
  const topMessageListener: RuntimeListener = (message) => {
    const record = message as { type?: unknown; event?: any; capability?: unknown };
    if (record.type === "SCORM_PERMISSION_REVOKED") { interactionController.permissionRevoked(); return; }
    if (record.type === "REVIEW_WORKER_READY") { interactionController.workerReady(); if (embeddedPageUrl) void sendScormCommand("SCORM_SET_COMMENTS", { comments: latestComments.filter((comment) => comment.page_url === embeddedPageUrl) }).catch(() => undefined); return; }
    if (record.type !== "SCORM_WORKER_EVENT" || !record.event) return;
    const event = record.event; embeddedPageUrl = typeof event.page_url === "string" ? event.page_url : embeddedPageUrl;
    if (event.type === "SCORM_SELECTION_CHANGED") { embeddedHasSelection = event.payload?.has_selection === true; overlay.setInteractionState(interactionController.state(), interactionController.state() === "embedded" && embeddedHasSelection); }
    else if (event.type === "SCORM_ANCHOR_CAPTURED" && typeof record.capability === "string") { interactionController.cancel(); const { anchor_type, selected_quote, prefix, suffix, css_selector, relative_x, relative_y } = event.payload; const anchor = anchor_type === "text_highlight" ? { anchor_type, selected_quote, prefix, suffix } : { anchor_type, css_selector, relative_x, relative_y }; targetDocument.documentElement.dispatchEvent(new targetWindow.CustomEvent("moodle-review:embedded-anchor", { detail: { capability: record.capability, anchor } })); }
    else if (event.type === "SCORM_PAGE_IDENTITY_CHANGED") void sendScormCommand("SCORM_SET_COMMENTS", { comments: latestComments.filter((comment) => comment.page_url === embeddedPageUrl) }).catch(() => undefined);
    else if (event.type === "SCORM_COMMENTS_CHANGED") void loadPageComments(context.page_url);
  };
  runtime.onMessage?.addListener(topMessageListener);
  let requestSequence = 0;

  const refresh = () => {
    const next = currentContext(targetWindow, targetDocument);
    const signature = `${next.course_url}\n${next.page_url}\n${next.title}\n${next.pageTitle}\n${next.moodle_course_id ?? next.identityConfidence}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    const pageChanged = context.page_url !== next.page_url;
    context = next;
    if (pageChanged) { commentSequence += 1; overlay.setPageComments([]); }
    overlay.update(context, "connecting");
    const sequence = ++requestSequence;
    const requestedCourseUrl = context.course_url;
    const payload = { course_url: context.course_url, title: context.title, ...(context.moodle_course_id ? { moodle_course_id: context.moodle_course_id } : {}) };
    sendRuntimeMessage(runtime, { type: "RESOLVE_COURSE", payload }, (response) => {
      if (sequence !== requestSequence) return;
      const resolved = response?.data as { id?: unknown } | undefined;
      courseId = response?.ok && typeof resolved?.id === "string" ? resolved.id : undefined;
      if (courseId) courseIds.set(requestedCourseUrl, courseId);
      const status: ConnectionStatus = response?.ok ? "connected" : response?.status === "signed-out" ? "signed-out" : response?.status === "pending" ? "pending" : "offline";
      overlay.update(context, status);
      if (courseId && status === "connected") sendRuntimeMessage(runtime, { type: "GET_CURRENT_VIEWER" }, (viewerResponse) => {
        const identity = (viewerResponse?.data as { user?: { display_name: string | null; email: string; role: string } } | undefined)?.user;
        if (viewerResponse?.ok && identity && typeof identity.email === "string" && typeof identity.role === "string") overlay.setViewer(identity);
      }); else overlay.setViewer(undefined);
      if (!response?.ok && response?.status === "signed-out" && response.error?.includes("session expired")) {
        const message = targetDocument.getElementById("moodle-course-review-overlay")?.shadowRoot?.querySelector<HTMLElement>("[data-status-message]");
        if (message) message.textContent = "Session expired—sign in again";
      }
      if (courseId) void loadPageComments(context.page_url); else overlay.setPageComments([]);
      if (!response?.ok && context.moodle_course_id) {
        let moodleOrigin = ""; try { moodleOrigin = new URL(context.course_url).origin; } catch { /* invalid contexts are already rejected */ }
        if (moodleOrigin) sendRuntimeMessage(runtime, { type: "LOOKUP_REVIEW_COURSE", moodle_origin: moodleOrigin, moodle_course_id: context.moodle_course_id }, (lookup) => {
          const found = lookup?.data as { course_handle?: unknown } | undefined;
          courseHandle = lookup?.ok && typeof found?.course_handle === "string" ? found.course_handle : undefined;
          if (courseHandle) void checkPendingApproval().then((outcome) => { if (outcome.status !== "signed-out") { overlay.update(context, outcome.status); if (outcome.status === "pending") scheduleApprovalCheck(); } });
          if (!lookup?.ok && response?.status === "signed-out" && !response.error?.includes("session expired")) overlay.update(context, "offline");
        });
      }
    });
  };
  const lifecycle = createLifecycleController(targetWindow, targetDocument, refresh);
  const clearNavigatedPage = () => { const next = currentContext(targetWindow, targetDocument); if (context.page_url !== next.page_url) { commentSequence += 1; overlay.setPageComments([]); } };
  for (const eventName of ["popstate", "hashchange", "moodle-review:navigate"]) targetWindow.addEventListener(eventName, clearNavigatedPage);
  const scheduleTimeout = typeof targetWindow.setTimeout === "function" ? targetWindow.setTimeout.bind(targetWindow) : globalThis.setTimeout;
  const cancelTimeout = typeof targetWindow.clearTimeout === "function" ? targetWindow.clearTimeout.bind(targetWindow) : globalThis.clearTimeout;
  let fallbackTimer: ReturnType<typeof setTimeout>;
  const checkFrames = () => {
    if (hasDescendantReviewOverlay(targetDocument)) { overlay.hideFrameFallback(); return; }
    const inaccessible = inaccessibleFrameOrigins(targetDocument);
    sendRuntimeMessage(runtime, { type: "GET_REVIEW_FRAME_STATUS" }, (response) => {
      const status = response?.data as { ready_origins?: unknown; active_embedded_count?: unknown; granted_optional_patterns?: unknown } | undefined;
      if (response?.ok && typeof status?.active_embedded_count === "number" && status.active_embedded_count > 0) {
        interactionController.workerReady();
        return;
      }
      if (!inaccessible.length) return;
      const permissionCandidate = inaccessible.find((origin) => optionalFramePatterns.some((pattern) => matchPattern(`${origin}/`, pattern)));
      if (permissionCandidate) {
        permissionOrigin = permissionCandidate;
        const matchingPattern = optionalFramePatterns.find((pattern) => matchPattern(`${permissionCandidate}/`, pattern));
        const grantedPatterns = Array.isArray(status?.granted_optional_patterns)
          ? status.granted_optional_patterns.filter((value): value is string => typeof value === "string")
          : [];
        if (!matchingPattern || !grantedPatterns.includes(matchingPattern)) {
          interactionController.permissionRequired();
          return;
        }
      }
      const ready = status?.ready_origins;
      const trusted = response?.ok && Array.isArray(ready) ? new Set(ready.filter((value): value is string => typeof value === "string")) : new Set<string>();
      if (inaccessible.every((origin) => trusted.has(origin))) interactionController.workerReady();
    });
  };
  fallbackTimer = scheduleTimeout(checkFrames, Math.min(250, framePollDelay));
  const scheduleFramePoll: (handler: () => void, delay: number) => ReturnType<typeof globalThis.setInterval> = typeof targetWindow.setInterval === "function"
    ? ((handler, delay) => targetWindow.setInterval(handler, delay) as unknown as ReturnType<typeof globalThis.setInterval>)
    : ((handler, delay) => globalThis.setInterval(handler, delay));
  const cancelFramePoll: (timer: ReturnType<typeof globalThis.setInterval>) => void = typeof targetWindow.clearInterval === "function"
    ? ((timer) => targetWindow.clearInterval(timer as unknown as number))
    : ((timer) => globalThis.clearInterval(timer));
  const framePoll = scheduleFramePoll(checkFrames, framePollDelay);
  (framePoll as unknown as { unref?: () => void }).unref?.();
  const onFrameReady = (event: MessageEvent) => { if (event.data?.type === "MOODLE_REVIEW_FRAME_READY") checkFrames(); };
  targetWindow.addEventListener("message", onFrameReady);
  refresh();
  return () => { stopped = true; interactionController.destroy(); runtime.onMessage?.removeListener(topMessageListener); clearApprovalTimer(); targetDocument.removeEventListener("visibilitychange", onVisibility); cancelTimeout(fallbackTimer); cancelFramePoll(framePoll); targetWindow.removeEventListener("message", onFrameReady); for (const eventName of ["popstate", "hashchange", "moodle-review:navigate"]) targetWindow.removeEventListener(eventName, clearNavigatedPage); lifecycle.teardown(); overlay.destroy(); };
}

type RuntimeResponse = { ok?: boolean; status?: ConnectionStatus; error?: string; data?: unknown } | undefined;
type RuntimeListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void;
type Runtime = {
  sendMessage(message: unknown, callback: (response: RuntimeResponse) => void): void;
  onMessage?: { addListener(listener: RuntimeListener): void; removeListener(listener: RuntimeListener): void };
};

export function startEmbeddedReview(targetWindow: Window & typeof globalThis, targetDocument: Document, runtime: Runtime, retryDelay = 200, leaseDelay = 2_000, workerInstanceEpoch = 1): () => void {
  let stopped = false;
  let activeCleanup: (() => void) | undefined;
  let generation = -1;
  let handleWorkerCommand: ((message: unknown) => unknown) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let leaseTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  let attempts = 0;
  const workerInstanceId = targetWindow.crypto?.randomUUID?.() ?? globalThis.crypto.randomUUID();
  const scheduleRetry = typeof targetWindow.setTimeout === "function" ? targetWindow.setTimeout.bind(targetWindow) : globalThis.setTimeout;
  const cancelRetry = typeof targetWindow.clearTimeout === "function" ? targetWindow.clearTimeout.bind(targetWindow) : globalThis.clearTimeout;
  const scheduleLease: (handler: () => void, delay: number) => ReturnType<typeof globalThis.setInterval> = typeof targetWindow.setInterval === "function"
    ? ((handler: () => void, delay: number) => targetWindow.setInterval(handler, delay) as unknown as ReturnType<typeof globalThis.setInterval>)
    : ((handler, delay) => globalThis.setInterval(handler, delay));
  const cancelLease: (timer: ReturnType<typeof globalThis.setInterval>) => void = typeof targetWindow.clearInterval === "function"
    ? ((timer: ReturnType<typeof globalThis.setInterval>) => targetWindow.clearInterval(timer as unknown as number))
    : ((timer) => globalThis.clearInterval(timer));
  const activate = (nextGeneration: number): boolean => {
    if (stopped) return false;
    if (activeCleanup && generation === nextGeneration) return true;
    activeCleanup?.();
    generation = nextGeneration;
    activeCleanup = startActiveEmbeddedReview(targetWindow, targetDocument, runtime, workerInstanceId, generation, (handler) => { handleWorkerCommand = handler; }, retryDelay);
    return true;
  };
  const deactivate = () => { activeCleanup?.(); activeCleanup = undefined; };
  const onCommand: RuntimeListener = (message, _sender, sendResponse) => {
    const command = message as { type?: unknown; worker_instance_id?: unknown; generation?: unknown };
    if (["ACTIVATE_REVIEW_FRAME", "DEACTIVATE_REVIEW_FRAME"].includes(command.type as string)
      && Number.isInteger(command.generation) && command.worker_instance_id !== workerInstanceId) {
      sendResponse({ ok: false, worker_instance_id: workerInstanceId, generation: command.generation }); return;
    }
    if (command.type === "ACTIVATE_REVIEW_FRAME" && Number.isInteger(command.generation)) {
      targetDocument.documentElement.setAttribute("data-moodle-review-activation", `received:${command.generation}`);
      const accepted = activate(command.generation as number);
      sendResponse({ ok: accepted, worker_instance_id: workerInstanceId, generation: command.generation }); return;
    }
    if (command.type === "DEACTIVATE_REVIEW_FRAME" && Number.isInteger(command.generation)) {
      const nextGeneration = command.generation as number;
      if (nextGeneration < generation) { sendResponse({ ok: false, worker_instance_id: workerInstanceId, generation: nextGeneration }); return; }
      generation = nextGeneration; deactivate(); sendResponse({ ok: true, dormant: true, worker_instance_id: workerInstanceId, generation: nextGeneration }); return;
    }
    if (typeof command.type === "string" && command.type.startsWith("SCORM_") && handleWorkerCommand) {
      sendResponse(handleWorkerCommand(message)); return;
    }
  };
  runtime.onMessage?.addListener(onCommand);

  const register = () => sendRuntimeMessage(runtime, { type: "GET_REVIEW_CONTEXT" }, (context) => {
    if (stopped) return;
    if (!context?.ok) {
      targetDocument.documentElement.setAttribute("data-moodle-review-registration", `context:${String(context?.error ?? "unavailable").slice(0, 120)}`);
      attempts += 1;
      if (attempts < 25 && isTransientReviewContextError(context?.error)) retryTimer = scheduleRetry(register, retryDelay);
      return;
    }
    attempts = 0;
    const capabilities = measureFrameCapabilities(targetDocument, targetWindow);
    targetDocument.documentElement.setAttribute("data-moodle-review-capabilities", JSON.stringify(capabilities));
    sendRuntimeMessage(runtime, { type: "REGISTER_REVIEW_FRAME", worker_instance_id: workerInstanceId, worker_instance_epoch: workerInstanceEpoch, capabilities }, (response) => {
      targetDocument.documentElement.setAttribute("data-moodle-review-registration", response?.ok ? "registered" : `failed:${String(response?.error ?? "unknown").slice(0, 120)}`);
    });
    // Unit-test and legacy runtimes have no command channel. Production Chrome
    // always supplies runtime.onMessage and therefore remains coordinator-owned.
    if (!runtime.onMessage) activate(0);
  });
  register();
  leaseTimer = scheduleLease(register, leaseDelay);
  (leaseTimer as unknown as { unref?: () => void }).unref?.();
  return () => {
    stopped = true;
    if (retryTimer !== undefined) cancelRetry(retryTimer);
    if (leaseTimer !== undefined) cancelLease(leaseTimer);
    runtime.onMessage?.removeListener(onCommand);
    deactivate();
  };
}

function startActiveEmbeddedReview(targetWindow: Window & typeof globalThis, targetDocument: Document, runtime: Runtime, workerInstanceId: string, generation: number, setCommandHandler: (handler: ((message: unknown) => unknown) | undefined) => void, retryDelay = 200): () => void {
  let stopped = false;
  let worker: ScormWorker | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const scheduleRetry = typeof targetWindow.setTimeout === "function" ? targetWindow.setTimeout.bind(targetWindow) : globalThis.setTimeout;
  const cancelRetry = typeof targetWindow.clearTimeout === "function" ? targetWindow.clearTimeout.bind(targetWindow) : globalThis.clearTimeout;
  const send = <T>(message: unknown) => new Promise<T>((resolve, reject) => sendRuntimeMessage(runtime, message, (response) => response?.ok ? resolve(response.data as T) : reject(new Error(response?.error ?? "Review service unavailable"))));
  const obtain = () => void send<{ course_id: string; course_title: string; parent_activity_url: string }>({ type: "GET_REVIEW_CONTEXT" }).then(async (trusted) => {
    if (stopped || typeof trusted?.course_id !== "string" || typeof trusted?.course_title !== "string") return;
    worker?.destroy();
    worker = createScormWorker({
      window: targetWindow,
      document: targetDocument,
      workerInstanceId,
      generation,
      courseId: trusted.course_id,
      emit: (event) => { sendRuntimeMessage(runtime, event, () => undefined); },
      mutate: async (type, commentId, value) => {
        const message = type === "edit" ? { type: "EDIT_COMMENT_THREAD", comment_id: commentId, body: value }
          : type === "reply" ? { type: "REPLY_COMMENT_THREAD", comment_id: commentId, body: value }
            : type === "status" ? { type: "UPDATE_COMMENT_STATUS", comment_id: commentId, status: value }
              : { type: "DELETE_COMMENT_THREAD", comment_id: commentId };
        await send(message);
      },
      createLifecycle: createLifecycleController,
    });
    setCommandHandler((message) => worker?.handleCommand(message));
    for (const event of worker.initialEvents()) await send(event);
    await send({ type: "REVIEW_FRAME_READY" });
    targetDocument.documentElement.setAttribute("data-moodle-review-activation", `ready:${generation}`);
    try { targetWindow.parent.postMessage({ type: "MOODLE_REVIEW_FRAME_READY" }, "*"); } catch { /* trigger only */ }
  }).catch((error: unknown) => {
    targetDocument.documentElement.setAttribute("data-moodle-review-activation", `failed:${String(error instanceof Error ? error.message : error).slice(0, 120)}`);
    attempts += 1;
    if (!stopped && attempts < 25 && error instanceof Error && isTransientReviewContextError(error.message)) retryTimer = scheduleRetry(obtain, retryDelay);
  });
  obtain();
  return () => { stopped = true; if (retryTimer !== undefined) cancelRetry(retryTimer); setCommandHandler(undefined); worker?.destroy(); worker = undefined; };
}
