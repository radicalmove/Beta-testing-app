export const APPROVED_SAVE_ICON_PATH = "M5 2h12l5 5v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm2 1v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4.4L16.6 3H7Zm1 13v6h8v-6H8Zm3-13v5h4V3h-4Z";

export function saveIconMarkup(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="save-silhouette" d="${APPROVED_SAVE_ICON_PATH}" fill="currentColor" fill-rule="evenodd"/></svg>`;
}

export function createSaveIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("class", "save-silhouette");
  path.setAttribute("d", APPROVED_SAVE_ICON_PATH);
  path.setAttribute("fill", "currentColor");
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
  return svg;
}
