import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { capturePinAnchor, escapeCssIdentifier, recoverPinAnchor } from "../src/anchors/pin.ts";

test("records a stable selector and relative coordinates and restores after resize", () => {
  const window = new Window(); const document = window.document;
  document.body.innerHTML = `<main><button data-region="next">Next</button></main>`;
  const button = document.querySelector("button") as unknown as HTMLElement;
  Object.defineProperty(button, "getBoundingClientRect", { configurable: true, value: () => ({ left: 10, top: 20, width: 100, height: 40, right: 110, bottom: 60, x: 10, y: 20, toJSON() {} }) });
  const anchor = capturePinAnchor(button, 35, 30)!;
  assert.equal(anchor.css_selector, '[data-region="next"]');
  assert.deepEqual([anchor.relative_x, anchor.relative_y], [0.25, 0.25]);
  Object.defineProperty(button, "getBoundingClientRect", { configurable: true, value: () => ({ left: 20, top: 30, width: 200, height: 80, right: 220, bottom: 110, x: 20, y: 30, toJSON() {} }) });
  assert.deepEqual(recoverPinAnchor(document as unknown as Document, anchor), { status: "resolved", element: button, x: 70, y: 50 });
  button.remove();
  assert.equal(recoverPinAnchor(document as unknown as Document, anchor).status, "unresolved");
});

test("never anchors to extension UI", () => {
  const window = new Window(); const host = window.document.createElement("div");
  host.id = "moodle-course-review-overlay"; host.setAttribute("data-moodle-review-ui", "true"); window.document.body.append(host);
  assert.equal(capturePinAnchor(host as unknown as HTMLElement, 1, 1), null);
});

test("duplicate stable attributes fall back to a unique ancestry selector", () => {
  const window = new Window(); window.document.body.innerHTML = `<main><div><button id="same" data-region="same">One</button></div><div><button id="same" data-region="same">Two</button></div></main>`;
  const button = window.document.querySelectorAll("button")[1] as unknown as HTMLElement;
  button.getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10, x: 0, y: 0, toJSON() {} });
  const anchor = capturePinAnchor(button, 5, 5)!;
  assert.match(anchor.css_selector, /nth-of-type\(2\)/);
  assert.equal(recoverPinAnchor(window.document as unknown as Document, { ...anchor, css_selector: "#same" }).status, "unresolved");
});

test("CSS identifier escaping handles controls, leading digits, and non-ASCII", () => {
  assert.match(escapeCssIdentifier("1line\n café"), /^\\31 /);
  assert.match(escapeCssIdentifier("1line\n café"), /\\a /);
  assert.match(escapeCssIdentifier("1line\n café"), /é/);
});
