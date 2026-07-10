export type PinAnchor = { css_selector: string; relative_x: number; relative_y: number };
const stableAttributes = ["data-region", "data-id", "data-testid", "data-activityname", "name"];
const escapeCss = (value: string) => globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `);

export function selectorFor(element: HTMLElement): string {
  if (element.id) return `#${escapeCss(element.id)}`;
  for (const name of stableAttributes) { const value = element.getAttribute(name); if (value) return `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`; }
  const parts: string[] = [];
  for (let current: Element | null = element; current && current.tagName.toLowerCase() !== "html"; current = current.parentElement) {
    let part = current.tagName.toLowerCase();
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((child) => child.tagName === current!.tagName) : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part); if (current.tagName.toLowerCase() === "body") break;
  }
  return parts.join(" > ");
}

export function capturePinAnchor(element: HTMLElement, clientX: number, clientY: number): PinAnchor | null {
  if (element.closest('[data-moodle-review-ui="true"]')) return null;
  const rect = element.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0) return null;
  return { css_selector: selectorFor(element), relative_x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), relative_y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) };
}

export function recoverPinAnchor(document: Document, anchor: PinAnchor): { status: "resolved"; element: HTMLElement; x: number; y: number } | { status: "unresolved" } {
  let element: HTMLElement | null = null; try { element = document.querySelector(anchor.css_selector); } catch { return { status: "unresolved" }; }
  if (!element || element.closest('[data-moodle-review-ui="true"]')) return { status: "unresolved" };
  const rect = element.getBoundingClientRect(); return { status: "resolved", element, x: rect.left + rect.width * anchor.relative_x, y: rect.top + rect.height * anchor.relative_y };
}

export function renderPin(document: Document, anchor: PinAnchor): () => void {
  const marker = document.createElement("button"); marker.type = "button"; marker.setAttribute("data-moodle-review-pin", "true"); marker.setAttribute("aria-label", "Selected page pin");
  marker.style.cssText = "position:fixed;z-index:2147483646;width:22px;height:22px;border-radius:50%;border:2px solid white;background:#087f78;color:white;pointer-events:none;transform:translate(-50%,-50%)";
  const place = () => { const result = recoverPinAnchor(document, anchor); marker.hidden = result.status !== "resolved"; if (result.status === "resolved") { marker.style.left = `${result.x}px`; marker.style.top = `${result.y}px`; } };
  document.documentElement.append(marker); place(); document.defaultView?.addEventListener("resize", place); document.defaultView?.addEventListener("scroll", place, true);
  return () => { document.defaultView?.removeEventListener("resize", place); document.defaultView?.removeEventListener("scroll", place, true); marker.remove(); };
}
