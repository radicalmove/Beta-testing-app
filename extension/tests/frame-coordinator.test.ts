import assert from "node:assert/strict";
import test from "node:test";
import { FrameCoordinator, type FrameCapabilities } from "../src/frame-coordinator.ts";

const content = (area = 800_000): FrameCapabilities => ({
  contentBearing: true,
  wrapper: false,
  visible: true,
  area,
});

test("elects deepest stable content frame", () => {
  const coordinator = new FrameCoordinator(250);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course");
  coordinator.registerNavigation(1, 2, 0, "https://moodle.example/scorm-shell");
  coordinator.registerNavigation(1, 7, 2, "https://rise.example/lesson");
  coordinator.registerCapabilities(1, 0, content(1_000_000), 0);
  coordinator.registerCapabilities(1, 2, { ...content(), wrapper: true }, 0);
  coordinator.registerCapabilities(1, 7, content(), 0);

  assert.equal(coordinator.advanceElection(1, 249).candidateFrameId, undefined);
  assert.equal(coordinator.advanceElection(1, 250).candidateFrameId, 7);
});

test("breaks sibling ties by visible area then stable frame id", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course");
  coordinator.registerNavigation(1, 8, 0, "https://rise.example/a");
  coordinator.registerNavigation(1, 4, 0, "https://rise.example/b");
  coordinator.registerCapabilities(1, 8, content(400), 0);
  coordinator.registerCapabilities(1, 4, content(900), 0);
  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 4);

  coordinator.registerCapabilities(1, 8, content(900), 1);
  assert.equal(coordinator.advanceElection(1, 1).candidateFrameId, 4);
});

test("never reports two active frames during acknowledged handover", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course");
  coordinator.registerCapabilities(1, 0, content(), 0);
  const first = coordinator.advanceElection(1, 0);
  coordinator.confirmActivated(1, first.candidateFrameId!, first.generation!);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, [0]);

  coordinator.registerNavigation(1, 3, 0, "https://rise.example/lesson");
  coordinator.registerCapabilities(1, 3, content(), 1);
  const pending = coordinator.advanceElection(1, 1);
  assert.equal(pending.deactivateFrameId, 0);
  assert.equal(pending.activateFrameId, undefined);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, [0]);

  coordinator.acknowledgeDormant(1, 0, pending.generation!);
  const replacement = coordinator.advanceElection(1, 1);
  assert.equal(replacement.activateFrameId, 3);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, []);
  coordinator.confirmActivated(1, 3, replacement.generation!);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, [3]);
});

test("hidden owner chain makes a large content child ineligible", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course");
  coordinator.registerNavigation(1, 2, 0, "https://moodle.example/wrapper");
  coordinator.registerNavigation(1, 7, 2, "https://rise.example/lesson");
  coordinator.registerCapabilities(1, 0, content(100), 0);
  coordinator.registerCapabilities(1, 2, { ...content(), wrapper: true }, 0);
  coordinator.registerCapabilities(1, 7, content(1_000_000), 0);
  coordinator.registerChildOwnerReports(1, 0, [{ childFrameId: 2, visible: true, area: 500_000, origin: "https://moodle.example" }]);
  coordinator.registerChildOwnerReports(1, 2, [{ childFrameId: 7, visible: false, area: 0, origin: "https://rise.example" }]);

  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 0);
});

test("owner visibility change reelects the content child", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course");
  coordinator.registerNavigation(1, 7, 0, "https://rise.example/lesson");
  coordinator.registerCapabilities(1, 0, content(100), 0);
  coordinator.registerCapabilities(1, 7, content(1_000_000), 0);
  coordinator.registerChildOwnerReports(1, 0, [{ childFrameId: 7, visible: false, area: 0, origin: "https://rise.example" }]);
  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 0);

  coordinator.registerChildOwnerReports(1, 0, [{ childFrameId: 7, visible: true, area: 1_000_000, origin: "https://rise.example" }]);
  assert.equal(coordinator.advanceElection(1, 0).candidateFrameId, 7);
});

test("authoritative frame removal permits a pending replacement", () => {
  const coordinator = new FrameCoordinator(0);
  coordinator.bindCourse(1, "course-a", 0);
  coordinator.registerNavigation(1, 0, -1, "https://moodle.example/course");
  coordinator.registerNavigation(1, 2, 0, "https://rise.example/old");
  coordinator.registerCapabilities(1, 0, { ...content(), wrapper: true }, 0);
  coordinator.registerCapabilities(1, 2, content(), 0);
  const first = coordinator.advanceElection(1, 0);
  coordinator.confirmActivated(1, 2, first.generation!);
  coordinator.registerNavigation(1, 3, 0, "https://rise.example/lesson");
  coordinator.registerCapabilities(1, 3, content(2_000_000), 0);
  coordinator.advanceElection(1, 0);

  coordinator.removeFrame(1, 2);
  const replacement = coordinator.advanceElection(1, 0);
  assert.equal(replacement.activateFrameId, 3);
  assert.deepEqual(coordinator.snapshot(1).activeFrameIds, []);
});
