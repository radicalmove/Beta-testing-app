declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const __EXTENSION_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const chrome: any;

import { canonicalCourseUrlFromDocument, courseTitleFromDocument, detectCourseContext, explicitActivityIdFromDocument, explicitCourseIdFromDocument, type CourseContext } from "./course-context.ts";
import { mountReviewOverlay, type AuthenticationOutcome, type BuildDiagnostics, type ConnectionStatus, type ReviewOverlay } from "./overlay/root.ts";
import type { PageComment } from "./background-bridge.ts";
import { measureFrameCapabilities } from "./frame-capabilities.ts";

const MARKER = "data-moodle-review-extension";
const BUILD_DIAGNOSTICS = {
  version: typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "0.0.0",
  buildCommit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "0000000000000000000000000000000000000000",
};
const OWNER = Symbol.for("moodle-course-review.content-owner");
type MarkerRoot = {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};
type OwnedRoot = MarkerRoot & { [OWNER]?: { cleanup(): void } };

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
  inject: () => void | (() => void);
}): Promise<boolean> {
  // Chrome gates static Moodle matches and background registration gates optional
  // frames, so a running content script is already authorized for this URL.
  if (!isConfiguredFrame(options.url, [...options.moodlePatterns, ...options.optionalFramePatterns], [], () => false, options.parentUrl)) return false;
  const root = options.document.documentElement as OwnedRoot;
  root[OWNER]?.cleanup();
  if (root.hasAttribute(MARKER) && !root[OWNER]) root.removeAttribute(MARKER);
  const owner = { cleanup: () => {} };
  root[OWNER] = owner;
  root.setAttribute(MARKER, "active");
  const injectedCleanup = options.inject();
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
    inject: () => {
      document.documentElement.dispatchEvent(new CustomEvent("moodle-review:bootstrap"));
      if (window.top === window) return startCourseReview(window, document, chrome.runtime);
      return startEmbeddedReview(window, document, chrome.runtime);
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

export function startCourseReview(targetWindow: Window & typeof globalThis = window, targetDocument: Document = document, runtime: { sendMessage(message: unknown, callback: (response: { ok?: boolean; status?: ConnectionStatus; error?: string; data?: unknown } | undefined) => void): void } = chrome.runtime, buildDiagnostics: BuildDiagnostics = BUILD_DIAGNOSTICS): () => void {
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
  const loadPageComments = async (pageUrl: string) => { const sequence = ++commentSequence; overlay.setPageComments([]); try { const comments = await send<PageComment[]>({ type: "LIST_COURSE_COMMENTS" }); if (sequence === commentSequence && context.page_url === pageUrl) { overlay.setPageComments(comments); const pending: { comment_id?: string } = await send<{ comment_id?: string }>({ type: "CONSUME_COMMENT_NAVIGATION" }).catch(() => ({})); if (pending.comment_id) overlay.takeToContext(pending.comment_id); } } catch { if (sequence === commentSequence) overlay.setPageComments([]); } };
  overlay = mountReviewOverlay(targetDocument, context, "connecting", { navigateToComment: async (commentId, pageUrl) => { await send({ type: "PREPARE_COMMENT_NAVIGATION", comment_id: commentId, page_url: pageUrl }); targetWindow.location.assign(pageUrl); }, useAccessForm: () => Boolean(courseHandle), onAccessSubmit: async (input) => {
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
  }, editThread: async (commentId, body) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "EDIT_COMMENT_THREAD", comment_id: commentId, body }); await loadPageComments(context.page_url); }, replyThread: async (commentId, body) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "REPLY_COMMENT_THREAD", comment_id: commentId, body }); await loadPageComments(context.page_url); }, changeStatus: async (commentId, nextStatus) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "UPDATE_COMMENT_STATUS", comment_id: commentId, status: nextStatus }); await loadPageComments(context.page_url); }, manageSme: async (commentId, userIds) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); return send({ type: userIds ? "SET_SME_RECIPIENTS" : "GET_SME_RECIPIENTS", comment_id: commentId, ...(userIds ? { user_ids: userIds } : {}) }); }, deleteThread: async (commentId) => { if (!courseId) throw new Error("Course connection unavailable"); await refreshCourseBindingBeforeComment(send, context, courseId); await send({ type: "DELETE_COMMENT_THREAD", comment_id: commentId }); await loadPageComments(context.page_url); }, uploadScreenshot: (commentId, dataUrl) => send({ type: "UPLOAD_SCREENSHOT", comment_id: commentId, data_url: dataUrl }), cancelScreenshot: (commentId) => send({ type: "CANCEL_SCREENSHOT", comment_id: commentId }) }, buildDiagnostics);
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
  const setParentOverlayVisible = (visible: boolean) => {
    overlay.setPresentationVisible(visible);
  };
  const checkFrames = () => {
    const inaccessible = inaccessibleFrameOrigins(targetDocument);
    sendRuntimeMessage(runtime, { type: "GET_REVIEW_FRAME_STATUS" }, (response) => {
      const status = response?.data as { ready_origins?: unknown; active_embedded_count?: unknown } | undefined;
      if (response?.ok && typeof status?.active_embedded_count === "number" && status.active_embedded_count > 0) {
        overlay.hideFrameFallback();
        setParentOverlayVisible(false);
        return;
      }
      if (!inaccessible.length) { setParentOverlayVisible(true); overlay.hideFrameFallback(); return; }
      const ready = status?.ready_origins;
      const trusted = response?.ok && Array.isArray(ready) ? new Set(ready.filter((value): value is string => typeof value === "string")) : new Set<string>();
      if (inaccessible.some((origin) => !trusted.has(origin))) {
        setParentOverlayVisible(true);
        overlay.showFrameFallback();
      } else {
        overlay.hideFrameFallback();
        setParentOverlayVisible(false);
      }
    });
  };
  fallbackTimer = scheduleTimeout(checkFrames, 250);
  const poll = scheduleTimeout(() => checkFrames(), 1000); const latePoll = scheduleTimeout(() => checkFrames(), 5000);
  const onFrameReady = (event: MessageEvent) => { if (event.data?.type === "MOODLE_REVIEW_FRAME_READY") checkFrames(); };
  targetWindow.addEventListener("message", onFrameReady);
  refresh();
  return () => { stopped = true; clearApprovalTimer(); targetDocument.removeEventListener("visibilitychange", onVisibility); cancelTimeout(fallbackTimer); cancelTimeout(poll); cancelTimeout(latePoll); targetWindow.removeEventListener("message", onFrameReady); for (const eventName of ["popstate", "hashchange", "moodle-review:navigate"]) targetWindow.removeEventListener(eventName, clearNavigatedPage); lifecycle.teardown(); overlay.destroy(); };
}

type RuntimeResponse = { ok?: boolean; status?: ConnectionStatus; error?: string; data?: unknown } | undefined;
type RuntimeListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void;
type Runtime = {
  sendMessage(message: unknown, callback: (response: RuntimeResponse) => void): void;
  onMessage?: { addListener(listener: RuntimeListener): void; removeListener(listener: RuntimeListener): void };
};

export function startEmbeddedReview(targetWindow: Window & typeof globalThis, targetDocument: Document, runtime: Runtime, retryDelay = 200, leaseDelay = 2_000): () => void {
  let stopped = false;
  let activeCleanup: (() => void) | undefined;
  let generation = -1;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let leaseTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  let attempts = 0;
  const scheduleRetry = typeof targetWindow.setTimeout === "function" ? targetWindow.setTimeout.bind(targetWindow) : globalThis.setTimeout;
  const cancelRetry = typeof targetWindow.clearTimeout === "function" ? targetWindow.clearTimeout.bind(targetWindow) : globalThis.clearTimeout;
  const scheduleLease: (handler: () => void, delay: number) => ReturnType<typeof globalThis.setInterval> = typeof targetWindow.setInterval === "function"
    ? ((handler: () => void, delay: number) => targetWindow.setInterval(handler, delay) as unknown as ReturnType<typeof globalThis.setInterval>)
    : ((handler, delay) => globalThis.setInterval(handler, delay));
  const cancelLease: (timer: ReturnType<typeof globalThis.setInterval>) => void = typeof targetWindow.clearInterval === "function"
    ? ((timer: ReturnType<typeof globalThis.setInterval>) => targetWindow.clearInterval(timer as unknown as number))
    : ((timer) => globalThis.clearInterval(timer));
  const activate = (nextGeneration: number) => {
    if (stopped || nextGeneration < generation) return;
    if (nextGeneration === generation && activeCleanup) return;
    activeCleanup?.();
    generation = nextGeneration;
    activeCleanup = startActiveEmbeddedReview(targetWindow, targetDocument, runtime, retryDelay);
  };
  const deactivate = () => { activeCleanup?.(); activeCleanup = undefined; };
  const onCommand: RuntimeListener = (message, _sender, sendResponse) => {
    const command = message as { type?: unknown; generation?: unknown };
    if (command.type === "ACTIVATE_REVIEW_FRAME" && Number.isInteger(command.generation)) {
      activate(command.generation as number); sendResponse({ ok: true }); return;
    }
    if (command.type === "DEACTIVATE_REVIEW_FRAME" && Number.isInteger(command.generation)) {
      generation = Math.max(generation, command.generation as number); deactivate(); sendResponse({ ok: true, dormant: true }); return;
    }
  };
  runtime.onMessage?.addListener(onCommand);

  const register = () => sendRuntimeMessage(runtime, { type: "GET_REVIEW_CONTEXT" }, (context) => {
    if (stopped) return;
    if (!context?.ok) {
      attempts += 1;
      if (attempts < 25 && context?.error === "Review context unavailable") retryTimer = scheduleRetry(register, retryDelay);
      return;
    }
    attempts = 0;
    sendRuntimeMessage(runtime, { type: "REGISTER_REVIEW_FRAME", capabilities: measureFrameCapabilities(targetDocument, targetWindow) }, () => undefined);
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

function startActiveEmbeddedReview(targetWindow: Window & typeof globalThis, targetDocument: Document, runtime: Runtime, retryDelay = 200): () => void {
  let stopped = false;
  let lifecycle: { teardown(): void } | undefined;
  let overlay: ReviewOverlay | undefined;
  let courseId = "";
  let courseTitle = "";
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const scheduleRetry = typeof targetWindow.setTimeout === "function" ? targetWindow.setTimeout.bind(targetWindow) : globalThis.setTimeout;
  const cancelRetry = typeof targetWindow.clearTimeout === "function" ? targetWindow.clearTimeout.bind(targetWindow) : globalThis.clearTimeout;
  const send = <T>(message: unknown) => new Promise<T>((resolve, reject) => sendRuntimeMessage(runtime, message, (response) => response?.ok ? resolve(response.data as T) : reject(new Error(response?.error ?? "Review service unavailable"))));
  const frameContext = (): CourseContext => {
    const label = pageLabel(targetDocument); const identity = new URL(targetWindow.location.href); identity.hash = `moodle-review-page=${encodeURIComponent(label)}`;
    return ({
    course_url: targetWindow.location.href.split("#")[0]!,
    page_url: identity.href,
    title: courseTitle,
    pageTitle: `Embedded activity · ${label}`,
    identityConfidence: "confirmed",
  }); };
  const obtain = () => void send<{ course_id: string; course_title: string; parent_activity_url: string }>({ type: "GET_REVIEW_CONTEXT" }).then((trusted) => {
    if (stopped || typeof trusted?.course_id !== "string" || typeof trusted?.course_title !== "string") return;
    courseId = trusted.course_id; courseTitle = trusted.course_title;
    let context = frameContext();
    let commentSequence = 0;
    const loadPageComments = async () => { const pageUrl = context.page_url; const sequence = ++commentSequence; overlay?.setPageComments([]); try { const comments = await send<PageComment[]>({ type: "LIST_COURSE_COMMENTS" }); if (sequence === commentSequence && context.page_url === pageUrl) overlay?.setPageComments(comments); } catch { /* connection state remains usable */ } };
    overlay = mountReviewOverlay(targetDocument, context, "connected", { onTakeToContext: (id) => { overlay?.takeToContext(id); }, submit: async ({ body, category, anchor, screenshot, contextSnapshot }) => {
      const saved = await send<{ id?: string; screenshot_available?: boolean }>({ type: "CREATE_COMMENT", payload: { course_id: courseId, page_url: contextSnapshot.page_url, page_title: contextSnapshot.pageTitle, body, category, ...anchor }, screenshot_requested: screenshot });
      if (context.page_url === contextSnapshot.page_url) void loadPageComments();
      return saved;
    }, uploadScreenshot: (commentId, dataUrl) => send({ type: "UPLOAD_SCREENSHOT", comment_id: commentId, data_url: dataUrl }), cancelScreenshot: (commentId) => send({ type: "CANCEL_SCREENSHOT", comment_id: commentId }) }, BUILD_DIAGNOSTICS);
    const refresh = () => { const next = frameContext(); if (context.page_url !== next.page_url) { commentSequence += 1; overlay?.setPageComments([]); } context = next; overlay?.update(context, "connected"); void loadPageComments(); };
    lifecycle = createLifecycleController(targetWindow, targetDocument, refresh);
    const clearNavigatedPage = () => { const next = frameContext(); if (context.page_url !== next.page_url) { commentSequence += 1; overlay?.setPageComments([]); } };
    for (const eventName of ["popstate", "hashchange", "moodle-review:navigate"]) targetWindow.addEventListener(eventName, clearNavigatedPage);
    const previousTeardown = lifecycle.teardown.bind(lifecycle);
    lifecycle.teardown = () => { for (const eventName of ["popstate", "hashchange", "moodle-review:navigate"]) targetWindow.removeEventListener(eventName, clearNavigatedPage); previousTeardown(); };
    void loadPageComments();
    sendRuntimeMessage(runtime, { type: "REVIEW_FRAME_READY" }, () => undefined);
    try { targetWindow.parent.postMessage({ type: "MOODLE_REVIEW_FRAME_READY" }, "*"); } catch { /* trigger only */ }
  }).catch((error: unknown) => {
    attempts += 1;
    if (!stopped && attempts < 25 && error instanceof Error && error.message === "Review context unavailable") retryTimer = scheduleRetry(obtain, retryDelay);
  });
  obtain();
  return () => { stopped = true; if (retryTimer !== undefined) cancelRetry(retryTimer); lifecycle?.teardown(); overlay?.destroy(); };
}
