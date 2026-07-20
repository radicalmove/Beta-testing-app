import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { createReviewIcon, reviewIconMarkup, type ReviewIconName } from "../src/ui/icon-family.ts";

const icons: Record<ReviewIconName, readonly string[]> = {
  save: [
    '<path d="M5 3h11l3 3v15H5z"></path>',
    '<path d="M8 3v6h8V3"></path>',
    '<path d="M8 21v-7h8v7"></path>',
  ],
  edit: [
    '<path d="M4 20l4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10z"></path>',
    '<path d="m14.5 7.5 3 3M5.5 16l3 3"></path>',
  ],
  delete: [
    '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"></path>',
  ],
  help: [
    '<circle cx="12" cy="12" r="9"></circle>',
    '<path d="M9.75 9a2.4 2.4 0 1 1 3.38 2.2c-.75.36-1.13.9-1.13 1.8"></path>',
    '<circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"></circle>',
  ],
};

const names = Object.keys(icons) as ReviewIconName[];

function assertCommonAttributes(svg: SVGSVGElement, name: ReviewIconName): void {
  assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.dataset.reviewIcon, name);
  assert.equal(svg.getAttribute("fill"), "none");
  assert.equal(svg.getAttribute("stroke"), "currentColor");
  assert.equal(svg.getAttribute("stroke-width"), "2");
  assert.equal(svg.getAttribute("stroke-linecap"), "round");
  assert.equal(svg.getAttribute("stroke-linejoin"), "round");
}

function assertLocalOnly(markup: string): void {
  assert.doesNotMatch(markup, /<(?:image|mask|use)\b|\b(?:href|src)\s*=|url\(|data:image|font|<style\b/i);
}

test("review icon markup has the exact local SVG primitives and shared attributes", () => {
  for (const name of names) {
    const markup = reviewIconMarkup(name);
    const window = new Window();
    const container = window.document.createElement("div");
    container.innerHTML = markup;
    const svg = container.firstElementChild as unknown as SVGSVGElement;

    assertCommonAttributes(svg, name);
    assert.deepEqual(Array.from(svg.children, (child) => child.outerHTML), icons[name]);
    assertLocalOnly(markup);
  }
});

test("createReviewIcon creates the same SVG icon in the supplied document", () => {
  const window = new Window();
  const document = window.document as unknown as Document;

  for (const name of names) {
    const svg = createReviewIcon(document, name);

    assert.equal(svg.ownerDocument, document);
    assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
    assertCommonAttributes(svg, name);
    assert.deepEqual(Array.from(svg.children, (child) => child.outerHTML), icons[name]);
    assert.equal(svg.outerHTML, reviewIconMarkup(name));
    assertLocalOnly(svg.outerHTML);
  }
});
