import type { ChildOwnerReport, FrameCapabilities } from "./frame-coordinator.ts";

const OVERLAY_SELECTOR = "#moodle-course-review-overlay,[data-moodle-review-extension],[data-review-marker],[data-review-highlight]";
const INTERACTIVE_SELECTOR = "a[href],button,input,select,textarea,[role='button'],[tabindex]";

export function measureFrameCapabilities(document: Document, window: Window): FrameCapabilities {
  const rect = document.documentElement.getBoundingClientRect();
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  const visible = document.visibilityState !== "hidden" && rect.width >= 200 && rect.height >= 150;
  const body = document.body;
  if (!body) return { contentBearing: false, wrapper: false, visible, area };

  const copy = body.cloneNode(true) as HTMLElement;
  for (const element of Array.from(copy.querySelectorAll(`${OVERLAY_SELECTOR},script,style,noscript,iframe`))) element.remove();
  const text = (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  const interactive = Array.from(body.querySelectorAll(INTERACTIVE_SELECTOR)).some((element) => !element.closest(OVERLAY_SELECTOR));
  const childFrames = body.querySelectorAll("iframe,frame").length;
  const contentBearing = text.length >= 20 || interactive;
  return { contentBearing, wrapper: childFrames > 0 && !contentBearing, visible, area };
}

export function measureChildOwnerFrame(iframe: HTMLIFrameElement, childFrameId: number): ChildOwnerReport {
  const rect = iframe.getBoundingClientRect();
  const style = iframe.ownerDocument.defaultView?.getComputedStyle(iframe);
  const visible = rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
  let origin = "null";
  try { origin = new URL(iframe.src, iframe.ownerDocument.baseURI).origin; } catch { /* unsupported owner URL */ }
  return { childFrameId, visible, area: Math.max(0, rect.width) * Math.max(0, rect.height), origin };
}
