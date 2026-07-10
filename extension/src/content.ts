declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const chrome: any;

import { detectCourseContext, explicitCourseIdFromDocument, type CourseContext } from "./course-context.ts";
import { mountReviewOverlay, type ConnectionStatus, type ReviewOverlay } from "./overlay/root.ts";

const MARKER = "data-moodle-review-extension";

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
  document: { documentElement: { hasAttribute(name: string): boolean; setAttribute(name: string, value: string): void } };
  moodlePatterns: string[];
  optionalFramePatterns: string[];
  inject: () => void;
}): Promise<boolean> {
  // Chrome gates static Moodle matches and background registration gates optional
  // frames, so a running content script is already authorized for this URL.
  if (!isConfiguredFrame(options.url, [...options.moodlePatterns, ...options.optionalFramePatterns], [])) return false;
  if (options.document.documentElement.hasAttribute(MARKER)) return false;
  options.document.documentElement.setAttribute(MARKER, "active");
  options.inject();
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
      if (window.top === window) startCourseReview();
    },
  });
}

function pageLabel(document: Document): string {
  return document.querySelector<HTMLElement>("h1")?.textContent?.trim() || document.title.trim() || "Current page";
}

function currentContext(): CourseContext {
  return detectCourseContext({
    url: window.location.href,
    title: document.querySelector<HTMLElement>("[data-course-name], .page-header-headings h1")?.textContent?.trim() || document.title,
    pageTitle: pageLabel(document),
    explicitCourseId: explicitCourseIdFromDocument(document),
  });
}

function startCourseReview(): void {
  let context = currentContext();
  let overlay: ReviewOverlay = mountReviewOverlay(document, context, "connecting");
  let lastSignature = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestSequence = 0;

  const refresh = () => {
    const next = currentContext();
    const signature = `${next.page_url}\n${next.title}\n${next.pageTitle}\n${next.moodle_course_id ?? "temporary"}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    context = next;
    overlay.update(context, "connecting");
    const sequence = ++requestSequence;
    const payload = { course_url: context.course_url, title: context.title, ...(context.moodle_course_id ? { moodle_course_id: context.moodle_course_id } : {}) };
    chrome.runtime.sendMessage({ type: "RESOLVE_COURSE", payload }, (response: { ok?: boolean; status?: ConnectionStatus } | undefined) => {
      if (sequence !== requestSequence) return;
      const status: ConnectionStatus = response?.ok ? "connected" : response?.status === "signed-out" ? "signed-out" : response?.status === "pending" ? "pending" : "offline";
      overlay.update(context, status);
    });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
  for (const eventName of ["popstate", "hashchange", "moodle-review:navigate"]) window.addEventListener(eventName, schedule);
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = ((data: unknown, unused: string, url?: string | URL | null) => {
      original(data, unused, url);
      window.dispatchEvent(new Event("moodle-review:navigate"));
    }) as History[typeof method];
  }
  const title = document.querySelector("title");
  if (title) new MutationObserver(schedule).observe(title, { childList: true, subtree: true, characterData: true });
  refresh();
}
