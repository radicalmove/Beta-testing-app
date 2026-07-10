declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const chrome: any;

import { canonicalCourseUrlFromDocument, courseTitleFromDocument, detectCourseContext, explicitActivityIdFromDocument, explicitCourseIdFromDocument, type CourseContext } from "./course-context.ts";
import { mountReviewOverlay, type ConnectionStatus, type ReviewOverlay } from "./overlay/root.ts";

const MARKER = "data-moodle-review-extension";
const OWNER = Symbol.for("moodle-course-review.content-owner");
type MarkerRoot = {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};
type OwnedRoot = MarkerRoot & { [OWNER]?: { cleanup(): void } };

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
): boolean {
  if (moodlePatterns.some((pattern) => matchPattern(url, pattern))) return true;
  return optionalFramePatterns.some((pattern) => matchPattern(url, pattern) && hasOptionalPermission(pattern));
}

export async function bootstrapContentScript(options: {
  url: string;
  document: { documentElement: MarkerRoot };
  moodlePatterns: string[];
  optionalFramePatterns: string[];
  inject: () => void | (() => void);
}): Promise<boolean> {
  // Chrome gates static Moodle matches and background registration gates optional
  // frames, so a running content script is already authorized for this URL.
  if (!isConfiguredFrame(options.url, [...options.moodlePatterns, ...options.optionalFramePatterns], [])) return false;
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

export function startCourseReview(targetWindow: Window & typeof globalThis = window, targetDocument: Document = document, runtime: { sendMessage(message: unknown, callback: (response: { ok?: boolean; status?: ConnectionStatus; error?: string; data?: unknown } | undefined) => void): void } = chrome.runtime): () => void {
  let context = currentContext(targetWindow, targetDocument);
  let courseId: string | undefined;
  const courseIds = new Map<string, string>();
  const send = <T>(message: unknown) => new Promise<T>((resolve, reject) => runtime.sendMessage(message, (response) => response?.ok ? resolve(response.data as T) : reject(new Error(response?.error ?? "Review service unavailable"))));
  let overlay: ReviewOverlay = mountReviewOverlay(targetDocument, context, "connecting", { submit: async ({ body, category, anchor, embeddedFrameUnavailable, contextSnapshot }) => {
    const snapshotCourseId = courseIds.get(contextSnapshot.course_url);
    if (!snapshotCourseId) throw new Error("The original course is no longer connected. Cancel and reopen the comment.");
    const fallbackSuffix = " — embedded content—frame access unavailable";
    const pageTitle = embeddedFrameUnavailable ? `${contextSnapshot.pageTitle.slice(0, 512 - fallbackSuffix.length)}${fallbackSuffix}` : contextSnapshot.pageTitle;
    return await send<{ id?: string }>({ type: "CREATE_COMMENT", payload: { course_id: snapshotCourseId, page_url: contextSnapshot.page_url, page_title: pageTitle, body, category, ...anchor } });
  }, uploadScreenshot: (commentId, dataUrl) => send({ type: "UPLOAD_SCREENSHOT", comment_id: commentId, data_url: dataUrl }) });
  let lastSignature = "";
  let requestSequence = 0;

  const refresh = () => {
    const next = currentContext(targetWindow, targetDocument);
    const signature = `${next.course_url}\n${next.page_url}\n${next.title}\n${next.pageTitle}\n${next.moodle_course_id ?? next.identityConfidence}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    context = next;
    overlay.update(context, "connecting");
    const sequence = ++requestSequence;
    const requestedCourseUrl = context.course_url;
    const payload = { course_url: context.course_url, title: context.title, ...(context.moodle_course_id ? { moodle_course_id: context.moodle_course_id } : {}) };
    runtime.sendMessage({ type: "RESOLVE_COURSE", payload }, (response) => {
      if (sequence !== requestSequence) return;
      const resolved = response?.data as { id?: unknown } | undefined;
      courseId = response?.ok && typeof resolved?.id === "string" ? resolved.id : undefined;
      if (courseId) courseIds.set(requestedCourseUrl, courseId);
      const status: ConnectionStatus = response?.ok ? "connected" : response?.status === "signed-out" ? "signed-out" : response?.status === "pending" ? "pending" : "offline";
      overlay.update(context, status);
    });
  };
  const lifecycle = createLifecycleController(targetWindow, targetDocument, refresh);
  const scheduleTimeout = typeof targetWindow.setTimeout === "function" ? targetWindow.setTimeout.bind(targetWindow) : globalThis.setTimeout;
  const cancelTimeout = typeof targetWindow.clearTimeout === "function" ? targetWindow.clearTimeout.bind(targetWindow) : globalThis.clearTimeout;
  let fallbackTimer: ReturnType<typeof setTimeout>;
  const checkFrames = () => {
    const inaccessible = inaccessibleFrameOrigins(targetDocument);
    if (!inaccessible.length) { overlay.hideFrameFallback(); return; }
    runtime.sendMessage({ type: "GET_REVIEW_FRAME_STATUS" }, (response) => {
      const ready = (response?.data as { ready_origins?: unknown } | undefined)?.ready_origins;
      const trusted = response?.ok && Array.isArray(ready) ? new Set(ready.filter((value): value is string => typeof value === "string")) : new Set<string>();
      if (inaccessible.some((origin) => !trusted.has(origin))) overlay.showFrameFallback(); else overlay.hideFrameFallback();
    });
  };
  fallbackTimer = scheduleTimeout(checkFrames, 250);
  const poll = scheduleTimeout(() => checkFrames(), 1000); const latePoll = scheduleTimeout(() => checkFrames(), 5000);
  const onFrameReady = (event: MessageEvent) => { if (event.data?.type === "MOODLE_REVIEW_FRAME_READY") checkFrames(); };
  targetWindow.addEventListener("message", onFrameReady);
  refresh();
  return () => { cancelTimeout(fallbackTimer); cancelTimeout(poll); cancelTimeout(latePoll); targetWindow.removeEventListener("message", onFrameReady); lifecycle.teardown(); overlay.destroy(); };
}

type Runtime = { sendMessage(message: unknown, callback: (response: { ok?: boolean; status?: ConnectionStatus; error?: string; data?: unknown } | undefined) => void): void };

export function startEmbeddedReview(targetWindow: Window & typeof globalThis, targetDocument: Document, runtime: Runtime, retryDelay = 200): () => void {
  let stopped = false;
  let lifecycle: { teardown(): void } | undefined;
  let overlay: ReviewOverlay | undefined;
  let courseId = "";
  let courseTitle = "";
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const scheduleRetry = typeof targetWindow.setTimeout === "function" ? targetWindow.setTimeout.bind(targetWindow) : globalThis.setTimeout;
  const cancelRetry = typeof targetWindow.clearTimeout === "function" ? targetWindow.clearTimeout.bind(targetWindow) : globalThis.clearTimeout;
  const send = <T>(message: unknown) => new Promise<T>((resolve, reject) => runtime.sendMessage(message, (response) => response?.ok ? resolve(response.data as T) : reject(new Error(response?.error ?? "Review service unavailable"))));
  const frameContext = (): CourseContext => ({
    course_url: targetWindow.location.href,
    page_url: targetWindow.location.href,
    title: courseTitle,
    pageTitle: `Embedded activity · ${pageLabel(targetDocument)}`,
    identityConfidence: "confirmed",
  });
  const obtain = () => void send<{ course_id: string; course_title: string; parent_activity_url: string }>({ type: "GET_REVIEW_CONTEXT" }).then((trusted) => {
    if (stopped || typeof trusted?.course_id !== "string" || typeof trusted?.course_title !== "string") return;
    courseId = trusted.course_id; courseTitle = trusted.course_title;
    let context = frameContext();
    overlay = mountReviewOverlay(targetDocument, context, "connected", { submit: async ({ body, category, anchor, contextSnapshot }) => {
      return await send<{ id?: string }>({ type: "CREATE_COMMENT", payload: { course_id: courseId, page_url: contextSnapshot.page_url, page_title: contextSnapshot.pageTitle, body, category, ...anchor } });
    }, uploadScreenshot: (commentId, dataUrl) => send({ type: "UPLOAD_SCREENSHOT", comment_id: commentId, data_url: dataUrl }) });
    const refresh = () => { context = frameContext(); overlay?.update(context, "connected"); };
    lifecycle = createLifecycleController(targetWindow, targetDocument, refresh);
    runtime.sendMessage({ type: "REVIEW_FRAME_READY" }, () => undefined);
    try { targetWindow.parent.postMessage({ type: "MOODLE_REVIEW_FRAME_READY" }, "*"); } catch { /* trigger only */ }
  }).catch((error: unknown) => {
    attempts += 1;
    if (!stopped && attempts < 25 && error instanceof Error && error.message === "Review context unavailable") retryTimer = scheduleRetry(obtain, retryDelay);
  });
  obtain();
  return () => { stopped = true; if (retryTimer !== undefined) cancelRetry(retryTimer); lifecycle?.teardown(); overlay?.destroy(); };
}
