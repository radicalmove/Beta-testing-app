import type { CourseContext } from "../course-context.ts";

export const OVERLAY_HOST_ID = "moodle-course-review-overlay";
export const overlayStyles = `:host{--review-navy:#16324f;--review-teal:#087f78;--review-pale:#edf7f6;--review-line:#c8d9dc;all:initial;color:#152a38;font:14px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:min(560px,calc(100vw - 36px));background:#fff;border:1px solid var(--review-line);border-radius:12px;box-shadow:0 10px 32px #16324f33;overflow:hidden}.toolbar{display:flex;align-items:center;gap:8px;padding:8px;background:var(--review-navy);color:#fff}.identity{min-width:0;padding:0 6px;flex:1}.course,.page{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.course{font-weight:700}.page{font-size:12px;color:#d7e8ec}button{appearance:none;border:1px solid #ffffff66;border-radius:7px;background:#fff;color:var(--review-navy);font:inherit;font-weight:650;padding:7px 9px;cursor:pointer}button:hover{background:var(--review-pale)}button:focus-visible,textarea:focus-visible{outline:3px solid #f5b642;outline-offset:2px}.icon{padding:7px 10px}.status{display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:#f5b642}.connected .dot{background:#42d3b4}.signed-out .dot,.offline .dot{background:#ff8d85}.panel{padding:10px;background:#fff;border-top:1px solid var(--review-line)}.panel[hidden]{display:none}.backdrop{position:fixed;inset:0;background:#0b1f3380;display:grid;place-items:center;z-index:2147483647}.dialog{width:min(420px,calc(100vw - 32px));background:#fff;border-radius:12px;padding:18px;box-shadow:0 16px 44px #0005}.dialog h2{margin:0 0 10px;color:var(--review-navy);font-size:18px}.dialog textarea{box-sizing:border-box;width:100%;min-height:110px;border:1px solid var(--review-line);border-radius:7px;padding:8px;font:inherit}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.primary{background:var(--review-teal);color:#fff;border-color:var(--review-teal)}`;

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

export type ReviewOverlay = { update(context: CourseContext, status: ConnectionStatus): void; destroy(): void };

export function mountReviewOverlay(document: Document, context: CourseContext, status: ConnectionStatus = "connecting"): ReviewOverlay {
  const existing = document.getElementById(OVERLAY_HOST_ID) as HTMLElement | null;
  if (existing?.shadowRoot) return createController(existing, existing.shadowRoot, context, status);
  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  host.setAttribute("data-moodle-review-ui", "true");
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = overlayStyles;
  shadow.append(style);
  return createController(host, shadow, context, status);
}

function createController(host: HTMLElement, shadow: ShadowRoot, initial: CourseContext, initialStatus: ConnectionStatus): ReviewOverlay {
  const ownerDocument = host.ownerDocument;
  let context = initial;
  let status = initialStatus;
  let returnFocus: HTMLElement | null = null;
  const render = () => {
    const style = shadow.querySelector("style");
    shadow.innerHTML = "";
    if (style) shadow.append(style);
    const wrapper = ownerDocument.createElement("div");
    wrapper.innerHTML = createOverlayMarkup({ courseTitle: context.title, pageTitle: context.pageTitle, status });
    shadow.append(...Array.from(wrapper.childNodes));
    bind();
  };
  const closeDialog = () => { shadow.querySelector(".backdrop")?.remove(); returnFocus?.focus(); };
  const openDialog = (trigger: HTMLElement, label: string) => {
    returnFocus = trigger;
    const backdrop = ownerDocument.createElement("div");
    backdrop.className = "backdrop";
    backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title"><h2 id="review-dialog-title">${escapeHtml(label)}</h2><label>Comment<textarea data-initial-focus></textarea></label><div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary">Save comment</button></div></div>`;
    backdrop.addEventListener("keydown", (event) => {
      const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>("textarea,button"));
      const activeIndex = Math.max(0, focusable.indexOf(shadow.activeElement as HTMLElement));
      const outcome = handleDialogKey({ key: event.key, shiftKey: event.shiftKey, activeIndex, focusableCount: focusable.length });
      if (event.key === "Tab" || outcome.close) event.preventDefault();
      if (outcome.close) closeDialog(); else if (event.key === "Tab") focusable[outcome.focusIndex]?.focus();
    });
    backdrop.querySelector("[data-cancel]")?.addEventListener("click", closeDialog);
    shadow.append(backdrop);
    backdrop.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  };
  const bind = () => {
    shadow.querySelector<HTMLElement>('[data-action="highlight"]')?.addEventListener("click", (event) => openDialog(event.currentTarget as HTMLElement, "Comment on highlighted text"));
    shadow.querySelector<HTMLElement>('[data-action="pin"]')?.addEventListener("click", (event) => openDialog(event.currentTarget as HTMLElement, "Add a page pin"));
    shadow.querySelector<HTMLElement>('[data-action="panel"]')?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLElement;
      const panel = shadow.querySelector<HTMLElement>(".panel")!;
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      button.setAttribute("aria-label", panel.hidden ? "Open review panel" : "Close review panel");
    });
  };
  render();
  return { update(next, nextStatus) { context = next; status = nextStatus; render(); }, destroy() { host.remove(); } };
}
