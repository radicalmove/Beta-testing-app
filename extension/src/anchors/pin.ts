export type PinAnchor = { css_selector: string; relative_x: number; relative_y: number };
const stableAttributes = ["data-region", "data-id", "data-testid", "data-activityname", "name"];
export function escapeCssIdentifier(value: string): string {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  const codepoints = [...value]; let result = "";
  for (let index = 0; index < codepoints.length; index += 1) {
    const char = codepoints[index]; const code = char.codePointAt(0)!;
    if (code === 0) { result += "�"; continue; }
    if ((code >= 1 && code <= 31) || code === 127 || (index === 0 && code >= 48 && code <= 57) || (index === 1 && code >= 48 && code <= 57 && codepoints[0] === "-")) { result += `\\${code.toString(16)} `; continue; }
    if (index === 0 && char === "-" && codepoints.length === 1) { result += "\\-"; continue; }
    result += code >= 128 || char === "-" || char === "_" || /[A-Za-z0-9]/.test(char) ? char : `\\${char}`;
  }
  return result;
}
const attributeValue = (value: string) => value.replace(/[\u0000-\u001f\u007f"\\]/g, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
const unique = (document: Document, selector: string) => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };

export function selectorFor(element: HTMLElement): string {
  const document = element.ownerDocument;
  if (element.id) { const selector = `#${escapeCssIdentifier(element.id)}`; if (unique(document, selector)) return selector; }
  for (const name of stableAttributes) { const value = element.getAttribute(name); if (value) { const selector = `[${name}="${attributeValue(value)}"]`; if (unique(document, selector)) return selector; } }
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
  let matches: NodeListOf<HTMLElement>; try { matches = document.querySelectorAll<HTMLElement>(anchor.css_selector); } catch { return { status: "unresolved" }; }
  if (matches.length !== 1) return { status: "unresolved" }; const element = matches[0];
  if (!element || element.closest('[data-moodle-review-ui="true"]')) return { status: "unresolved" };
  const rect = element.getBoundingClientRect(); return { status: "resolved", element, x: rect.left + rect.width * anchor.relative_x, y: rect.top + rect.height * anchor.relative_y };
}

export function renderPin(document: Document, anchor: PinAnchor): () => void {
  const marker = document.createElement("button"); marker.type = "button"; marker.setAttribute("data-moodle-review-pin", "true"); marker.setAttribute("aria-label", "Selected page pin");
  marker.textContent = "💬";
  marker.style.cssText = "position:fixed;z-index:900;width:34px;height:34px;border-radius:9px;border:3px solid white;background:#28c4c2;color:#082f2f;pointer-events:none;transform:translate(-50%,-50%);font:20px/1 sans-serif;box-shadow:0 3px 10px #0005";
  const place = () => { const result = recoverPinAnchor(document, anchor); marker.hidden = result.status !== "resolved"; if (result.status === "resolved") { marker.style.left = `${result.x}px`; marker.style.top = `${result.y}px`; } };
  document.documentElement.append(marker); place(); document.defaultView?.addEventListener("resize", place); document.defaultView?.addEventListener("scroll", place, true);
  return () => { document.defaultView?.removeEventListener("resize", place); document.defaultView?.removeEventListener("scroll", place, true); marker.remove(); };
}
