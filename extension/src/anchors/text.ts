import { selectorFor } from "./pin.ts";

export type TextAnchor = { selected_quote: string; prefix: string; suffix: string; css_selector?: string };
export type CapturedTextAnchor = TextAnchor & { css_selector: string };

export function textNodes(document: Document, maxNodes = 20_000, maxCharacters = 2_000_000): Text[] {
  const filter = document.defaultView?.NodeFilter ?? NodeFilter;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, filter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('[data-moodle-review-ui="true"],script,style,template,noscript,[hidden],[aria-hidden="true"]')) return filter.FILTER_REJECT;
      const view = document.defaultView;
      if (view?.getComputedStyle) { const style = view.getComputedStyle(parent); if (style.display === "none" || style.visibility === "hidden") return filter.FILTER_REJECT; }
      return filter.FILTER_ACCEPT;
    },
  });
  const result: Text[] = [];
  let characters = 0;
  while (result.length < maxNodes && walker.nextNode()) { const node = walker.currentNode as Text; if (characters + node.length > maxCharacters) break; characters += node.length; result.push(node); }
  return result;
}

export function captureTextAnchor(range: Range, document: Document, contextLength = 64): CapturedTextAnchor | null {
  const quote = range.toString();
  if (!quote.trim() || range.collapsed) return null;
  const common = range.commonAncestorContainer;
  const element = common.nodeType === 1 ? common as HTMLElement : common.parentElement;
  if (!element || element.closest('[data-moodle-review-ui="true"]')) return null;
  const cssSelector = selectorFor(element);
  if (!cssSelector || cssSelector.length > 4_000) return null;
  const nodes = textNodes(document);
  let all = "", start = -1, end = -1;
  for (const node of nodes) {
    const nodeStart = all.length;
    if (node === range.startContainer) start = nodeStart + range.startOffset;
    if (node === range.endContainer) end = nodeStart + range.endOffset;
    all += node.data;
  }
  if (start < 0 || end < start || all.slice(start, end) !== quote) return null;
  return { selected_quote: quote, prefix: all.slice(Math.max(0, start - contextLength), start), suffix: all.slice(end, end + contextLength), css_selector: cssSelector };
}
