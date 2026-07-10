import { textNodes, type TextAnchor } from "./text.ts";

export type TextRecovery = { status: "resolved"; range: Range } | { status: "unresolved"; reason: "absent" | "ambiguous" };

function boundary(nodes: Text[], offset: number): [Text, number] | null {
  let cursor = 0;
  for (const node of nodes) {
    if (offset <= cursor + node.length) return [node, offset - cursor];
    cursor += node.length;
  }
  return null;
}

export function recoverTextAnchor(document: Document, anchor: TextAnchor): TextRecovery {
  const nodes = textNodes(document); const all = nodes.map((node) => node.data).join("");
  const candidates: number[] = [];
  for (let index = all.indexOf(anchor.selected_quote); index >= 0; index = all.indexOf(anchor.selected_quote, index + 1)) {
    const prefixMatches = !anchor.prefix || all.slice(Math.max(0, index - anchor.prefix.length), index) === anchor.prefix;
    const end = index + anchor.selected_quote.length;
    const suffixMatches = !anchor.suffix || all.slice(end, end + anchor.suffix.length) === anchor.suffix;
    if (prefixMatches && suffixMatches) candidates.push(index);
  }
  if (candidates.length !== 1) return { status: "unresolved", reason: candidates.length ? "ambiguous" : "absent" };
  const start = boundary(nodes, candidates[0]); const end = boundary(nodes, candidates[0] + anchor.selected_quote.length);
  if (!start || !end) return { status: "unresolved", reason: "absent" };
  const range = document.createRange(); range.setStart(...start); range.setEnd(...end);
  return { status: "resolved", range };
}

export function inaccessibleFrameFallback() {
  return { kind: "parent_pin" as const, label: "embedded content—frame access unavailable", prompt: "Place a pin on the embedded content instead" };
}

export function renderTextHighlight(document: Document, range: Range): () => void {
  const css = (document.defaultView as unknown as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...ranges: Range[]) => unknown }) ?? {};
  if (css.CSS?.highlights && css.Highlight) {
    css.CSS.highlights.set("moodle-course-review", new css.Highlight(range));
    return () => css.CSS?.highlights?.delete("moodle-course-review");
  }
  const marker = document.createElement("div"); marker.setAttribute("data-moodle-review-highlight", "true");
  marker.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;background:#f5b64255;border:2px solid #f5b642";
  const rect = range.getBoundingClientRect(); Object.assign(marker.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.documentElement.append(marker); return () => marker.remove();
}
