declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const chrome: any;

import { canonicalCourseUrlFromDocument, courseTitleFromDocument, detectCourseContext, explicitCourseIdFromDocument, type CourseContext } from "./course-context.ts";
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
    canonicalCourseUrl: canonicalCourseUrlFromDocument(targetDocument),
  });
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

export function startCourseReview(targetWindow: Window & typeof globalThis = window, targetDocument: Document = document, runtime: { sendMessage(message: unknown, callback: (response: { ok?: boolean; status?: ConnectionStatus } | undefined) => void): void } = chrome.runtime): () => void {
  let context = currentContext(targetWindow, targetDocument);
  let overlay: ReviewOverlay = mountReviewOverlay(targetDocument, context, "connecting");
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
    const payload = { course_url: context.course_url, title: context.title, ...(context.moodle_course_id ? { moodle_course_id: context.moodle_course_id } : {}) };
    runtime.sendMessage({ type: "RESOLVE_COURSE", payload }, (response) => {
      if (sequence !== requestSequence) return;
      const status: ConnectionStatus = response?.ok ? "connected" : response?.status === "signed-out" ? "signed-out" : response?.status === "pending" ? "pending" : "offline";
      overlay.update(context, status);
    });
  };
  const lifecycle = createLifecycleController(targetWindow, targetDocument, refresh);
  refresh();
  return () => { lifecycle.teardown(); overlay.destroy(); };
}
