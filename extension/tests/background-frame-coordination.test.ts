import assert from "node:assert/strict";
import test from "node:test";
import { FrameCoordinatorRuntime } from "../src/frame-coordination-runtime.ts";
import type { FrameCapabilities } from "../src/frame-coordinator.ts";

const content: FrameCapabilities = { contentBearing: true, wrapper: false, visible: true, area: 500_000 };
const workerA = "123e4567-e89b-42d3-a456-426614174000";
const workerB = "223e4567-e89b-42d3-a456-426614174000";
const frames = [
  { frameId: 0, parentFrameId: -1, url: "https://moodle.example/mod/scorm/player.php", documentId: "document-0" },
  { frameId: 2, parentFrameId: 0, url: "https://moodle.example/wrapper", documentId: "document-2" },
  { frameId: 7, parentFrameId: 2, url: "https://rise.example/lesson", documentId: "document-7" },
];

function acknowledgement(message: unknown, dormant = false): { ok: true; dormant?: boolean; worker_instance_id: string; generation: number } {
  const command = message as { worker_instance_id: string; generation: number };
  return { ok: true, ...(dormant ? { dormant: true } : {}), worker_instance_id: command.worker_instance_id, generation: command.generation };
}

test("uses authoritative navigation parentage and activates the deepest frame", async () => {
  const sent: Array<{ frameId: number; message: unknown }> = [];
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => { sent.push({ frameId, message }); return acknowledgement(message); },
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 7, "document-7", 1, workerA, content, frames, 0);
  assert.deepEqual(sent, [{ frameId: 7, message: { type: "ACTIVATE_REVIEW_FRAME", worker_instance_id: workerA, generation: 1 } }]);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
});

test("deactivates and confirms dormancy before activating a replacement", async () => {
  const sent: Array<{ frameId: number; type: string }> = [];
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => { const type = (message as { type: string }).type; sent.push({ frameId, type }); return acknowledgement(message, type === "DEACTIVATE_REVIEW_FRAME"); },
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 2, "document-2", 1, workerA, content, frames, 0);
  await runtime.registerFrame(1, 7, "document-7", 1, workerB, { ...content, area: 900_000 }, frames, 1);
  assert.deepEqual(sent, [
    { frameId: 2, type: "ACTIVATE_REVIEW_FRAME" },
    { frameId: 2, type: "DEACTIVATE_REVIEW_FRAME" },
    { frameId: 7, type: "ACTIVATE_REVIEW_FRAME" },
  ]);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
});

test("serializes overlapping election drives per tab without blocking another tab", async () => {
  let resolveFirstActivation: ((value: ReturnType<typeof acknowledgement>) => void) | undefined;
  let firstActivationMessage: unknown;
  const sent: Array<{ tabId: number; frameId: number; type: string }> = [];
  const live = new Map<number, Set<number>>();
  const runtime = new FrameCoordinatorRuntime({
    send: async (tabId, frameId, message) => {
      const type = (message as { type: string }).type;
      sent.push({ tabId, frameId, type });
      const liveFrames = live.get(tabId) ?? new Set<number>();
      live.set(tabId, liveFrames);
      if (type === "ACTIVATE_REVIEW_FRAME") liveFrames.add(frameId);
      if (type === "DEACTIVATE_REVIEW_FRAME") liveFrames.delete(frameId);
      if (tabId === 1 && frameId === 2 && type === "ACTIVATE_REVIEW_FRAME") {
        firstActivationMessage = message;
        return new Promise((resolve) => { resolveFirstActivation = resolve; });
      }
      return acknowledgement(message, type === "DEACTIVATE_REVIEW_FRAME");
    },
  }, 0);
  runtime.bindCourse(1, "course-a");
  runtime.bindCourse(2, "course-b");

  const first = runtime.registerFrame(1, 2, "document-2", 1, workerA, content, frames, 0);
  await Promise.resolve();
  const replacement = runtime.registerFrame(1, 7, "document-7", 1, workerB, { ...content, area: 900_000 }, frames, 1);
  await Promise.resolve();
  await runtime.registerFrame(2, 7, "document-7", 1, workerB, content, frames, 1);

  assert.deepEqual(sent, [
    { tabId: 1, frameId: 2, type: "ACTIVATE_REVIEW_FRAME" },
    { tabId: 2, frameId: 7, type: "ACTIVATE_REVIEW_FRAME" },
  ]);
  resolveFirstActivation!(acknowledgement(firstActivationMessage));
  await Promise.all([first, replacement]);

  assert.deepEqual(sent.slice(2), [
    { tabId: 1, frameId: 2, type: "DEACTIVATE_REVIEW_FRAME" },
    { tabId: 1, frameId: 7, type: "ACTIVATE_REVIEW_FRAME" },
  ]);
  assert.deepEqual([...live.get(1)!], [7]);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
  assert.deepEqual(runtime.snapshot(2).activeFrameIds, [7]);
});

test("abandons an unreachable old owner and activates the replacement", async () => {
  const sent: Array<{ frameId: number; type: string }> = [];
  let loseDeactivate = false;
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => {
      const type = (message as { type: string }).type; sent.push({ frameId, type });
      if (loseDeactivate && type === "DEACTIVATE_REVIEW_FRAME") throw new Error("frame unreachable");
      return acknowledgement(message, type === "DEACTIVATE_REVIEW_FRAME");
    },
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 2, "document-2", 1, workerA, content, frames, 0);
  loseDeactivate = true;
  await runtime.registerFrame(1, 7, "document-7", 1, workerB, { ...content, area: 900_000 }, frames, 1);
  assert.deepEqual(sent.map((entry) => entry.type), ["ACTIVATE_REVIEW_FRAME", "DEACTIVATE_REVIEW_FRAME", "ACTIVATE_REVIEW_FRAME"]);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
});

test("activates only after the election stability window", async () => {
  const sent: unknown[] = [];
  const runtime = new FrameCoordinatorRuntime({ send: async (_tabId, _frameId, message) => { sent.push(message); return acknowledgement(message); } }, 250);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 7, "document-7", 1, workerA, content, frames, 1000);
  assert.deepEqual(sent, []);
  await runtime.reevaluate(1, 1249);
  assert.deepEqual(sent, []);
  await runtime.reevaluate(1, 1250);
  assert.equal((sent[0] as { type: string }).type, "ACTIVATE_REVIEW_FRAME");
});

test("status and delayed reevaluation are harmless before a tab is bound", async () => {
  const runtime = new FrameCoordinatorRuntime({ send: async (_tabId, _frameId, message) => acknowledgement(message) }, 250);
  assert.deepEqual(runtime.snapshot(99), { activeFrameIds: [], generation: 0 });
  await assert.doesNotReject(() => runtime.reevaluate(99, 1250));
});

test("times out a hanging deactivation, ignores its late acknowledgement, and continues election", async () => {
  let fireTimeout: (() => void) | undefined;
  let resolveDormant: ((value: ReturnType<typeof acknowledgement>) => void) | undefined;
  let markDeactivationStarted: (() => void) | undefined;
  const deactivationStarted = new Promise<void>((resolve) => { markDeactivationStarted = resolve; });
  const sent: Array<{ frameId: number; message: any }> = [];
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => {
      sent.push({ frameId, message });
      if ((message as { type?: string }).type !== "DEACTIVATE_REVIEW_FRAME") return acknowledgement(message);
      markDeactivationStarted!();
      return new Promise((resolve) => { resolveDormant = resolve; });
    },
    setTimeout: (handler) => { fireTimeout = handler; return 1; },
    clearTimeout: () => undefined,
  }, 0, 50);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 2, "document-2", 1, workerA, content, frames, 0);
  const replacement = runtime.registerFrame(1, 7, "document-7", 1, workerB, { ...content, area: 900_000 }, frames, 1);
  await deactivationStarted;
  fireTimeout!();
  await replacement;
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);

  resolveDormant!(acknowledgement(sent[1]!.message, true));
  await Promise.resolve();
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
  assert.equal(sent.length, 3);
});

test("an abandoned worker instance cannot reclaim ownership through a stale lease", async () => {
  const siblingFrames = [
    { frameId: 0, parentFrameId: -1, url: "https://moodle.example/mod/scorm/player.php", documentId: "document-0" },
    { frameId: 2, parentFrameId: 0, url: "https://rise.example/old", documentId: "document-2" },
    { frameId: 7, parentFrameId: 0, url: "https://rise.example/current", documentId: "document-7" },
  ];
  const sent: Array<{ frameId: number; type: string }> = [];
  let failDeactivation = false;
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, frameId, message) => {
      const type = (message as { type: string }).type;
      sent.push({ frameId, type });
      if (failDeactivation && type === "DEACTIVATE_REVIEW_FRAME") throw new Error("stale worker");
      return acknowledgement(message, type === "DEACTIVATE_REVIEW_FRAME");
    },
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 2, "document-2", 1, workerA, content, siblingFrames, 0);
  failDeactivation = true;
  await runtime.registerFrame(1, 7, "document-7", 1, workerB, { ...content, area: 900_000 }, siblingFrames, 1);
  await runtime.registerFrame(1, 2, "document-2", 1, workerA, { ...content, area: 2_000_000 }, siblingFrames, 2);

  assert.deepEqual(runtime.snapshot(1).activeFrameIds, [7]);
  assert.equal(sent.length, 3);
});

test("rejects activation acknowledgements bound to another worker instance", async () => {
  const runtime = new FrameCoordinatorRuntime({
    send: async (_tabId, _frameId, message) => ({ ...acknowledgement(message), worker_instance_id: workerB }),
  }, 0);
  runtime.bindCourse(1, "course-a");
  await runtime.registerFrame(1, 7, "document-7", 1, workerA, content, frames, 0);
  assert.deepEqual(runtime.snapshot(1).activeFrameIds, []);
});

test("notifies worker readiness after replacement and after runtime reconstruction", async () => {
  const ready: Array<{ tabId: number; frameId: number; workerInstanceId: string; generation: number; replaced: boolean }> = [];
  const createRuntime = () => new FrameCoordinatorRuntime({
    send: async (_tabId, _frameId, message) => acknowledgement(message, (message as any).type === "DEACTIVATE_REVIEW_FRAME"),
    onWorkerReady: (notification) => { ready.push(notification); },
  }, 0);
  const first = createRuntime();
  first.bindCourse(1, "course-a");
  await first.registerFrame(1, 7, "document-7", 1, workerA, content, frames, 0);
  await first.registerFrame(1, 7, "document-7", 2, workerB, content, frames, 1);
  await first.registerFrame(1, 7, "document-7", 1, workerA, content, frames, 2);
  assert.deepEqual(ready.map(({ workerInstanceId, generation, replaced }) => ({ workerInstanceId, generation, replaced })), [
    { workerInstanceId: workerA, generation: 1, replaced: false },
    { workerInstanceId: workerB, generation: 2, replaced: true },
  ]);

  const reconstructed = createRuntime();
  reconstructed.bindCourse(1, "course-a");
  await reconstructed.registerFrame(1, 7, "document-7", 2, workerB, content, frames, 3);
  assert.deepEqual(ready.at(-1), { tabId: 1, frameId: 7, workerInstanceId: workerB, generation: 1, replaced: false });
});
