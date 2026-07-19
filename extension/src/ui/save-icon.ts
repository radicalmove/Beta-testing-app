export const APPROVED_SAVE_ICON_PATH = "M48 10H208L246 48V215c0 18-13 31-31 31H48c-21 0-38-17-38-38V48c0-21 17-38 38-38ZM70 32h24v166c0 8-6 14-14 14H70V32Zm24 0h24v42h52V32h38v59c0 8-6 14-14 14h-86c-8 0-14-6-14-14V32Zm114 18h24v148c0 8-6 14-14 14h-10V50ZM94 151c0-8 6-14 14-14h86c8 0 14 6 14 14v61H94v-61Z";

export function saveIconMarkup(): string {
  return `<svg viewBox="0 0 256 256" aria-hidden="true"><path class="save-silhouette" d="${APPROVED_SAVE_ICON_PATH}" fill="currentColor" fill-rule="evenodd"/></svg>`;
}

export function createSaveIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("class", "save-silhouette");
  path.setAttribute("d", APPROVED_SAVE_ICON_PATH);
  path.setAttribute("fill", "currentColor");
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
  return svg;
}
