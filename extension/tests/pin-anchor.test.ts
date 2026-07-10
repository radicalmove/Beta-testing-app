import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { capturePinAnchor, recoverPinAnchor } from "../src/anchors/pin.ts";

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
