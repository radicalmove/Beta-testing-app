import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { inaccessibleFrameFallback, renderTextHighlight } from "../src/anchors/recover.ts";
import { hasInaccessibleFrame } from "../src/content.ts";

test("frame access failure offers an accessible parent pin with exact label", () => {
  assert.deepEqual(inaccessibleFrameFallback(), { kind: "parent_pin", label: "embedded content—frame access unavailable", prompt: "Place a pin on the embedded content instead" });
});

test("fallback highlight follows changing range geometry and cleans up listeners and DOM", () => {
  const window = new Window();
  const range = window.document.createRange();
  let rect = { left: 10, top: 20, width: 30, height: 40 };
  Object.defineProperty(range, "getBoundingClientRect", { value: () => rect });
  const cleanup = renderTextHighlight(window.document as unknown as Document, range as unknown as Range);
  const marker = window.document.querySelector("[data-moodle-review-highlight]") as unknown as HTMLElement;
  assert.equal(marker.style.left, "10px");
  assert.equal(marker.style.background, "rgba(255, 230, 106, 0.38)");
  rect = { left: 50, top: 60, width: 70, height: 80 };
  window.dispatchEvent(new window.Event("scroll"));
  assert.equal(marker.style.left, "50px");
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(marker.style.height, "80px");
  cleanup();
  assert.equal(window.document.querySelector("[data-moodle-review-highlight]"), null);
  rect = { left: 90, top: 90, width: 90, height: 90 };
  window.dispatchEvent(new window.Event("scroll"));
  assert.equal(marker.style.left, "50px");
});

test("distinguishes an accessible iframe fixture from simulated inaccessible content", () => {
  const window = new Window(); const frame = window.document.createElement("iframe"); window.document.body.append(frame);
  assert.equal(hasInaccessibleFrame(window.document as unknown as Document), false);
  Object.defineProperty(frame, "contentDocument", { configurable: true, value: null });
  assert.equal(hasInaccessibleFrame(window.document as unknown as Document), true);
});
