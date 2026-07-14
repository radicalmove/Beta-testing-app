import assert from "node:assert/strict";
import test from "node:test";
import { FrameCoordinatorRuntime } from "../src/frame-coordination-runtime.ts";
import type { FrameCapabilities } from "../src/frame-coordinator.ts";

const content: FrameCapabilities = { contentBearing: true, wrapper: false, visible: true, area: 500_000 };
const frames = [
  { frameId: 0, parentFrameId: -1, url: "https://moodle.example/mod/scorm/player.php" },
  { frameId: 2, parentFrameId: 0, url: "https://moodle.example/wrapper" },
  { frameId: 7, parentFrameId: 2, url: "https://rise.example/lesson" },
];

test("uses authoritative navigation parentage and activates the deepest frame", async () => {
  const sent: Array<{ frameId: number; message: unknown }> = [];
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => { sent.push({ frameId, message }); return { ok: true }; },
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 7, content, frames, 0);
  assert.deepEqual(sent, [{ frameId: 7, message: { type: "ACTIVATE_REVIEW_FRAME", generation: 1 } }]);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
});

test("deactivates and confirms dormancy before activating a replacement", async () => {
  const sent: Array<{ frameId: number; type: string }> = [];
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => { const type = (message as { type: string }).type; sent.push({ frameId, type }); return { ok: true, dormant: type === "DEACTIVATE_REVIEW_FRAME" }; },
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 2, content, frames, 0);
  await runtime.registerFrame(1, 7, { ...content, area: 900_000 }, frames, 1);
  assert.deepEqual(sent, [
    { frameId: 2, type: "ACTIVATE_REVIEW_FRAME" },
    { frameId: 2, type: "DEACTIVATE_REVIEW_FRAME" },
    { frameId: 7, type: "ACTIVATE_REVIEW_FRAME" },
  ]);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
});

test("does not activate a replacement when deactivation is lost", async () => {
  const sent: Array<{ frameId: number; type: string }> = [];
  let loseDeactivate = false;
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => {
      const type = (message as { type: string }).type; sent.push({ frameId, type });
      if (loseDeactivate && type === "DEACTIVATE_REVIEW_FRAME") throw new Error("frame unreachable");
      return { ok: true, dormant: type === "DEACTIVATE_REVIEW_FRAME" };
    },
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 2, content, frames, 0);
  loseDeactivate = true;
  await runtime.registerFrame(1, 7, { ...content, area: 900_000 }, frames, 1);
  assert.deepEqual(sent.map((entry) => entry.type), ["ACTIVATE_REVIEW_FRAME", "DEACTIVATE_REVIEW_FRAME"]);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [2]);
});

test("activates only after the election stability window", async () => {
  const sent: unknown[] = [];
  const runtime = new FrameCoordinatorRuntime({ send: async (_tabId, _frameId, message) => { sent.push(message); return { ok: true }; } }, 250);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 7, content, frames, 1000);
  assert.deepEqual(sent, []);
  await runtime.reevaluate(1, 1249);
  assert.deepEqual(sent, []);
  await runtime.reevaluate(1, 1250);
  assert.equal((sent[0] as { type: string }).type, "ACTIVATE_REVIEW_FRAME");
});

test("status and delayed reevaluation are harmless before a tab is bound", async () => {
  const runtime = new FrameCoordinatorRuntime({ send: async () => ({ ok: true }) }, 250);
  assert.deepEqual(runtime.snapshot(99), { activeFrameIds: [], generation: 0 });
  await assert.doesNotReject(() => runtime.reevaluate(99, 1250));
});
