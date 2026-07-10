import assert from "node:assert/strict";
import test from "node:test";

import { createOverlayMarkup, handleDialogKey, OVERLAY_HOST_ID, overlayStyles } from "../src/overlay/root.ts";

test("overlay markup is a compact accessible toolbar with course and connection state", () => {
  const markup = createOverlayMarkup({ courseTitle: "Criminal Law", pageTitle: "Week 2", status: "connected" });
  assert.match(markup, /role="toolbar"/);
  assert.match(markup, /aria-label="Course review tools"/);
  assert.match(markup, /Highlight text/);
  assert.match(markup, /Add pin/);
  assert.match(markup, /Criminal Law/);
  assert.match(markup, /Week 2/);
  assert.match(markup, /Connected/);
  assert.match(createOverlayMarkup({ courseTitle: "Law", pageTitle: "Week 2", status: "pending" }), /Account pending/);
});

test("dialog keyboard controller traps focus, closes on Escape, and returns focus", () => {
  assert.deepEqual(handleDialogKey({ key: "Tab", shiftKey: false, activeIndex: 2, focusableCount: 3 }), { focusIndex: 0, close: false });
  assert.deepEqual(handleDialogKey({ key: "Tab", shiftKey: true, activeIndex: 0, focusableCount: 3 }), { focusIndex: 2, close: false });
  assert.deepEqual(handleDialogKey({ key: "Escape", shiftKey: false, activeIndex: 1, focusableCount: 3 }), { focusIndex: 1, close: true });
});

test("overlay uses a unique shadow host and scoped styles", () => {
  assert.equal(OVERLAY_HOST_ID, "moodle-course-review-overlay");
  assert.match(overlayStyles, /:host/);
  assert.match(overlayStyles, /--review-navy/);
  assert.doesNotMatch(overlayStyles, /(?:^|})\s*(?:body|html)\s*\{/);
});
