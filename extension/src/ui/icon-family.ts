export type ReviewIconName = "save" | "edit" | "delete" | "help";

const iconContents: Record<ReviewIconName, string> = {
  save: '<path d="M5 3h11l3 3v15H5z"></path><path d="M8 3v6h8V3"></path><path d="M8 21v-7h8v7"></path>',
  edit: '<path d="M4 20l4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10z"></path><path d="m14.5 7.5 3 3M5.5 16l3 3"></path>',
  delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"></path>',
  help: '<circle cx="12" cy="12" r="9"></circle><path d="M9.75 9a2.4 2.4 0 1 1 3.38 2.2c-.75.36-1.13.9-1.13 1.8"></path><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"></circle>',
};

function setCommonAttributes(svg: SVGSVGElement, name: ReviewIconName): void {
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.reviewIcon = name;
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
}

export function reviewIconMarkup(name: ReviewIconName): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" data-review-icon="${name}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconContents[name]}</svg>`;
}

export function createReviewIcon(document: Document, name: ReviewIconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  setCommonAttributes(svg, name);
  svg.innerHTML = iconContents[name];
  return svg;
}
