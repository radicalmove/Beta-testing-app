import assert from "node:assert/strict";
import test from "node:test";
import { FrameCoordinator, type FrameCapabilities } from "../src/frame-coordinator.ts";

const content = (area = 800_000): FrameCapabilities => ({
  contentBearing: true,
  wrapper: false,
  visible: true,
  area,
});
const workerA = "123e4567-e89b-42d3-a456-426614174000";
const workerB = "223e4567-e89b-42d3-a456-426614174000";
const workerC = "323e4567-e89b-42d3-a456-426614174000";

test("elects deepest stable content frame", () => {
  const coordinator = new FrameCoordinator(250);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerNavigation(1, 2, 0, "https://moodle.example/scorm-shell", "document-2");
  coordinator.registerNavigation(1, 7, 2, "https://rise.example/lesson", "document-7");
  coordinator.registerCapabilities(1, 0, "document-0", workerA, content(1_000_000), 0);
  coordinator.registerCapabilities(1, 2, "document-2", workerA, { ...content(), wrapper: true }, 0);
  coordinator.registerCapabilities(1, 7, "document-7", workerA, content(), 0);

  assert.equal(coordinator.advanceElection(1, 249).candidateFrameId, undefined);
  assert.equal(coordinator.advanceElection(1, 250).candidateFrameId, 7);
});

test("breaks sibling ties by visible area then stable frame id", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerNavigation(1, 8, 0, "https://rise.example/a", "document-8");
  coordinator.registerNavigation(1, 4, 0, "https://rise.example/b", "document-4");
  coordinator.registerCapabilities(1, 8, "document-8", workerA, content(400), 0);
  coordinator.registerCapabilities(1, 4, "document-4", workerA, content(900), 0);
  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 4);

  coordinator.registerCapabilities(1, 8, "document-8", workerA, content(900), 1);
  assert.equal(coordinator.advanceElection(1, 1).candidateFrameId, 4);
});

test("never reports two active frames during acknowledged handover", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerCapabilities(1, 0, "document-0", workerA, content(), 0);
  const first = coordinator.advanceElection(1, 0);
  coordinator.confirmActivated(1, first.candidateFrameId!, workerA, first.generation!);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, [0]);

  coordinator.registerNavigation(1, 3, 0, "https://rise.example/lesson", "document-3");
  coordinator.registerCapabilities(1, 3, "document-3", workerB, content(), 1);
  const pending = coordinator.advanceElection(1, 1);
  assert.equal(pending.deactivateFrameId, 0);
  assert.equal(pending.activateFrameId, undefined);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, [0]);

  coordinator.acknowledgeDormant(1, 0, workerA, pending.generation!);
  const replacement = coordinator.advanceElection(1, 1);
  assert.equal(replacement.activateFrameId, 3);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, []);
  coordinator.confirmActivated(1, 3, workerB, replacement.generation!);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, [3]);
});

test("hidden owner chain makes a large content child ineligible", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerNavigation(1, 2, 0, "https://moodle.example/wrapper", "document-2");
  coordinator.registerNavigation(1, 7, 2, "https://rise.example/lesson", "document-7");
  coordinator.registerCapabilities(1, 0, "document-0", workerA, content(100), 0);
  coordinator.registerCapabilities(1, 2, "document-2", workerA, { ...content(), wrapper: true }, 0);
  coordinator.registerCapabilities(1, 7, "document-7", workerA, content(1_000_000), 0);
  coordinator.registerChildOwnerReports(1, 0, [{ childFrameId: 2, visible: true, area: 500_000, origin: "https://moodle.example" }]);
  coordinator.registerChildOwnerReports(1, 2, [{ childFrameId: 7, visible: false, area: 0, origin: "https://rise.example" }]);

  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 0);
});

test("owner visibility change reelects the content child", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson", "document-7");
  coordinator.registerCapabilities(1, 0, "document-0", workerA, content(100), 0);
  coordinator.registerCapabilities(1, 7, "document-7", workerA, content(1_000_000), 0);
  coordinator.registerChildOwnerReports(1, 0, [{ childFrameId: 7, visible: false, area: 0, origin: "https://rise.example" }]);
  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 0);

  coordinator.registerChildOwnerReports(1, 0, [{ childFrameId: 7, visible: true, area: 1_000_000, origin: "https://rise.example" }]);
  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 7);
});

test("authoritative frame removal permits a pending replacement", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerNavigation(1, 2, 0, "https://rise.example/old", "document-2");
  coordinator.registerCapabilities(1, 0, "document-0", workerA, { ...content(), wrapper: true }, 0);
  coordinator.registerCapabilities(1, 2, "document-2", workerA, content(), 0);
  const first = coordinator.advanceElection(1, 0);
  coordinator.confirmActivated(1, 2, workerA, first.generation!);
  coordinator.registerNavigation(1, 3, 0, "https://rise.example/lesson", "document-3");
  coordinator.registerCapabilities(1, 3, "document-3", workerB, content(2_000_000), 0);
  coordinator.advanceElection(1, 0);

  coordinator.removeFrame(1, 2);
  const replacement = coordinator.advanceElection(1, 0);
  assert.equal(replacement.activateFrameId, 3);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, []);
});

test("rebinding the same course preserves frames while tab removal clears them", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerNavigation(1, 3, 0, "https://rise.example/lesson", "document-3");
  coordinator.registerCapabilities(1, 3, "document-3", workerA, content(), 0);
  coordinator.bindCourse(1, "course-a", 0);
  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 3);
  coordinator.removeTab(1);
  assert.throws(() => coordinator.snapshot(1), /not bound/);
});

test("a new worker instance on the same frame clears stale ownership and stability", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-0");
  coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson", "document-7");
  coordinator.registerCapabilities(1, 7, "document-7", workerA, content(), 0);
  const first = coordinator.advanceElection(1, 0);
  assert.equal(coordinator.confirmActivated(1, 7, workerA, first.generation!), true);

  coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson", "document-7b");
  coordinator.registerCapabilities(1, 7, "document-7b", workerB, content(), 1);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, []);
  const replacement = coordinator.advanceElection(1, 1);
  assert.equal(replacement.activateFrameId, 7);
  assert.equal(replacement.activateWorkerInstanceId, workerB);
  assert.equal(coordinator.confirmActivated(1, 7, workerA, replacement.generation!), false);
  assert.equal(coordinator.confirmActivated(1, 7, workerB, replacement.generation!), true);
});

test("a stale same-frame document cannot reclaim ownership after its replacement", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-top");
  coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson", "document-a");
  coordinator.registerCapabilities(1, 7, "document-a", workerA, content(), 0);
  const first = coordinator.advanceElection(1, 0);
  coordinator.confirmActivated(1, 7, workerA, first.generation!);

  coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson", "document-b");
  coordinator.registerCapabilities(1, 7, "document-b", workerB, content(), 1);
  const second = coordinator.advanceElection(1, 1);
  coordinator.confirmActivated(1, 7, workerB, second.generation!);

  coordinator.registerCapabilities(1, 7, "document-a", workerA, content(2_000_000), 2);
  const staleLease = coordinator.advanceElection(1, 2);
  assert.equal(staleLease.candidateWorkerInstanceId, workerB);
  assert.equal(staleLease.generation, second.generation);
  assert.equal(staleLease.activateFrameId, undefined);
  assert.deepEqual(coordinator.snapshot(1), { activeFrameIds: [7], generation: second.generation! });

  coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson", "document-c");
  coordinator.registerCapabilities(1, 7, "document-c", workerC, content(), 3);
  const third = coordinator.advanceElection(1, 3);
  assert.equal(third.activateWorkerInstanceId, workerC);
  assert.equal(third.generation, second.generation! + 1);
});

test("trusted document identity permits repeated same-URL replacements without a fixed ceiling", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course", "document-top");
  const workers = Array.from({ length: 40 }, (_, index) => `worker-${index}`);

  for (const [index, worker] of workers.entries()) {
    const documentId = `document-${index}`;
    coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson", documentId);
    coordinator.registerCapabilities(1, 7, documentId, worker, content(), index);
    const election = coordinator.advanceElection(1, index);
    assert.equal(election.activateWorkerInstanceId, worker);
    coordinator.confirmActivated(1, 7, worker, election.generation!);
  }

  assert.deepEqual(coordinator.snapshot(1), { activeFrameIds: [7], generation: 40 });
});

test("authoritative navigation prunes departed frames so they cannot win", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.replaceNavigation(1, [
    { frameId: 0, parentFrameId: -1, url: "https://moodle.example/course", documentId: "document-0" },
    { frameId: 7, parentFrameId: 0, url: "https://rise.example/departed", documentId: "document-7" },
  ]);
  coordinator.registerCapabilities(1, 7, "document-7", workerA, content(1_000_000), 0);
  coordinator.replaceNavigation(1, [
    { frameId: 0, parentFrameId: -1, url: "https://moodle.example/course", documentId: "document-0" },
    { frameId: 9, parentFrameId: 0, url: "https://rise.example/current", documentId: "document-9" },
  ]);
  coordinator.registerCapabilities(1, 9, "document-9", workerB, content(100), 1);

  assert.equal(coordinator.advanceElection(1, 1).candidateFrameId, 9);
});
