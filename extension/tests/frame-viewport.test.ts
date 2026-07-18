import assert from "node:assert/strict";
import test from "node:test";
import { mapVisibleRectToChild, toolbarDocumentPosition } from "../src/frame-viewport.ts";

test("maps bordered scaled iframe content box", () => {
  const mapped = mapVisibleRectToChild({ left: 100, top: 80, right: 900, bottom: 680 }, {
    renderedContentBox: { left: 120, top: 100, right: 920, bottom: 700 },
    childViewportWidth: 400,
    childViewportHeight: 300,
    axisAligned: true,
  });
  assert.deepEqual(mapped, { left: 0, top: 0, right: 390, bottom: 290 });
});

test("clips a partially visible iframe", () => {
  const mapped = mapVisibleRectToChild({ left: 0, top: 200, right: 1000, bottom: 700 }, {
    renderedContentBox: { left: 100, top: 100, right: 900, bottom: 900 },
    childViewportWidth: 800,
    childViewportHeight: 800,
    axisAligned: true,
  });
  assert.deepEqual(mapped, { left: 0, top: 100, right: 800, bottom: 600 });
});

test("adds child scroll offsets for absolute toolbar position", () => {
  assert.deepEqual(toolbarDocumentPosition(
    { left: 0, top: 100, right: 800, bottom: 600 },
    { x: 0, y: 1200 },
    { width: 320, height: 120 },
    16,
  ), { left: 464, top: 1664 });
});

test("rejects rotated skewed collapsed or noninvertible transforms", () => {
  for (const geometry of [
    { renderedContentBox: { left: 0, top: 0, right: 800, bottom: 600 }, childViewportWidth: 800, childViewportHeight: 600, axisAligned: false },
    { renderedContentBox: { left: 0, top: 0, right: 0, bottom: 600 }, childViewportWidth: 800, childViewportHeight: 600, axisAligned: true },
    { renderedContentBox: { left: 0, top: 0, right: 800, bottom: 600 }, childViewportWidth: 0, childViewportHeight: 600, axisAligned: true },
  ]) assert.equal(mapVisibleRectToChild({ left: 0, top: 0, right: 800, bottom: 600 }, geometry), undefined);
});
