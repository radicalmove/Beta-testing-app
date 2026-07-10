import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { inaccessibleFrameFallback } from "../src/anchors/recover.ts";
import { hasInaccessibleFrame } from "../src/content.ts";

test("frame access failure offers an accessible parent pin with exact label", () => {
  assert.deepEqual(inaccessibleFrameFallback(), { kind: "parent_pin", label: "embedded content—frame access unavailable", prompt: "Place a pin on the embedded content instead" });
});

test("distinguishes an accessible iframe fixture from simulated inaccessible content", () => {
  const window = new Window(); const frame = window.document.createElement("iframe"); window.document.body.append(frame);
  assert.equal(hasInaccessibleFrame(window.document as unknown as Document), false);
  Object.defineProperty(frame, "contentDocument", { configurable: true, value: null });
  assert.equal(hasInaccessibleFrame(window.document as unknown as Document), true);
});
