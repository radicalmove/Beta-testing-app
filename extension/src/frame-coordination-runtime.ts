import { FrameCoordinator, type CoordinatorSnapshot, type FrameCapabilities } from "./frame-coordinator.ts";

export type NavigationFrame = { frameId: number; parentFrameId: number; url: string };
type DeliveryResult = { ok?: boolean; dormant?: boolean } | undefined;
type Dependencies = { send(tabId: number, frameId: number, message: unknown): Promise<DeliveryResult> };

export class FrameCoordinatorRuntime {
  private readonly coordinator: FrameCoordinator;
  private readonly dependencies: Dependencies;

  constructor(dependencies: Dependencies, stabilityMs = 250) {
    this.dependencies = dependencies;
    this.coordinator = new FrameCoordinator(stabilityMs);
  }

  bindCourse(tabId: number, courseId: string): void { this.coordinator.bindCourse(tabId, courseId, 0); }

  async registerFrame(tabId: number, frameId: number, capabilities: FrameCapabilities, navigation: NavigationFrame[], now = Date.now()): Promise<void> {
    for (const frame of navigation) this.coordinator.registerNavigation(tabId, frame.frameId, frame.parentFrameId, frame.url);
    this.coordinator.registerCapabilities(tabId, frameId, capabilities, now);
    await this.drive(tabId, now);
  }

  snapshot(tabId: number): CoordinatorSnapshot {
    try { return this.coordinator.snapshot(tabId); }
    catch { return { activeFrameIds: [], generation: 0 }; }
  }

  removeTab(tabId: number): void { this.coordinator.removeTab(tabId); }

  async reevaluate(tabId: number, now = Date.now()): Promise<void> {
    try { await this.drive(tabId, now); }
    catch { /* a navigation or worker restart can remove the tab before the delayed election */ }
  }

  private async drive(tabId: number, now: number): Promise<void> {
    const election = this.coordinator.advanceElection(tabId, now);
    if (election.deactivateFrameId !== undefined && election.generation !== undefined) {
      try {
        const result = await this.dependencies.send(tabId, election.deactivateFrameId, { type: "DEACTIVATE_REVIEW_FRAME", generation: election.generation });
        if (result?.ok && result.dormant && this.coordinator.acknowledgeDormant(tabId, election.deactivateFrameId, election.generation)) await this.drive(tabId, now);
      } catch { /* an unreachable but still-present frame remains the active owner */ }
      return;
    }
    if (election.activateFrameId !== undefined && election.generation !== undefined) {
      try {
        const result = await this.dependencies.send(tabId, election.activateFrameId, { type: "ACTIVATE_REVIEW_FRAME", generation: election.generation });
        if (result?.ok) this.coordinator.confirmActivated(tabId, election.activateFrameId, election.generation);
      } catch { /* activation can be retried after registration/navigation changes */ }
    }
  }
}
