export type TextAnchor = { selected_quote: string; prefix: string; suffix: string };

export function textNodes(document: Document): Text[] {
  const filter = document.defaultView?.NodeFilter ?? NodeFilter;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, filter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('[data-moodle-review-ui="true"],script,style,noscript')) return filter.FILTER_REJECT;
      return filter.FILTER_ACCEPT;
    },
  });
  const result: Text[] = [];
  while (walker.nextNode()) result.push(walker.currentNode as Text);
  return result;
}

export function captureTextAnchor(range: Range, document: Document, contextLength = 64): TextAnchor | null {
  const quote = range.toString();
  if (!quote.trim() || range.collapsed) return null;
  const nodes = textNodes(document);
  let all = "", start = -1, end = -1;
  for (const node of nodes) {
    const nodeStart = all.length;
    if (node === range.startContainer) start = nodeStart + range.startOffset;
    if (node === range.endContainer) end = nodeStart + range.endOffset;
    all += node.data;
  }
  if (start < 0 || end < start || all.slice(start, end) !== quote) return null;
  return { selected_quote: quote, prefix: all.slice(Math.max(0, start - contextLength), start), suffix: all.slice(end, end + contextLength) };
}
