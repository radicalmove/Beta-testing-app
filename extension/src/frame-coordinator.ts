export type FrameCapabilities = {
  contentBearing: boolean;
  wrapper: boolean;
  visible: boolean;
  area: number;
};

type FrameRecord = {
  frameId: number;
  parentFrameId: number;
  url: string;
  workerInstanceId?: string;
  retiredWorkerInstanceIds?: Set<string>;
  workerReplacementHistorySaturated?: boolean;
  capabilities?: FrameCapabilities;
  stableSince?: number;
};
const MAX_RETIRED_WORKER_INSTANCES = 32;
export type NavigationFrame = { frameId: number; parentFrameId: number; url: string };
export type ChildOwnerReport = { childFrameId: number; visible: boolean; area: number; origin: string };
type StoredOwnerReport = ChildOwnerReport & { parentFrameId: number };

type WorkerOwner = { frameId: number; workerInstanceId: string; generation: number };
type Handover = { from: WorkerOwner; to: Omit<WorkerOwner, "generation">; generation: number; dormant: boolean };
type TabState = {
  courseId: string;
  fallbackFrameId: number;
  frames: Map<number, FrameRecord>;
  ownerReports: Map<number, StoredOwnerReport>;
  active?: WorkerOwner;
  handover?: Handover;
  generation: number;
};

export type Election = {
  candidateFrameId?: number;
  candidateWorkerInstanceId?: string;
  deactivateFrameId?: number;
  deactivateWorkerInstanceId?: string;
  activateFrameId?: number;
  activateWorkerInstanceId?: string;
  generation?: number;
};

export type CoordinatorSnapshot = { activeFrameIds: number[]; generation: number };

export class FrameCoordinator {
  private readonly tabs = new Map<number, TabState>();
  private readonly stabilityMs: number;

  constructor(stabilityMs = 250) { this.stabilityMs = stabilityMs; }

  bindCourse(tabId: number, courseId: string, fallbackFrameId: number): void {
    const current = this.tabs.get(tabId);
    if (current?.courseId === courseId) return;
    this.tabs.set(tabId, { courseId, fallbackFrameId, frames: new Map(), ownerReports: new Map(), generation: 0 });
  }

  removeTab(tabId: number): void { this.tabs.delete(tabId); }

  registerNavigation(tabId: number, frameId: number, parentFrameId: number, url: string): void {
    const tab = this.requireTab(tabId);
    const previous = tab.frames.get(frameId);
    const sameDocument = previous?.parentFrameId === parentFrameId && previous.url === url;
    if (previous && !sameDocument) this.clearFrameState(tab, frameId);
    tab.frames.set(frameId, {
      frameId,
      parentFrameId,
      url,
      workerInstanceId: sameDocument ? previous.workerInstanceId : undefined,
      retiredWorkerInstanceIds: sameDocument ? previous.retiredWorkerInstanceIds : undefined,
      workerReplacementHistorySaturated: sameDocument ? previous.workerReplacementHistorySaturated : undefined,
      capabilities: sameDocument ? previous.capabilities : undefined,
      stableSince: sameDocument ? previous.stableSince : undefined,
    });
  }

  replaceNavigation(tabId: number, navigation: NavigationFrame[]): void {
    const tab = this.requireTab(tabId);
    const authoritativeIds = new Set(navigation.map((frame) => frame.frameId));
    for (const frameId of [...tab.frames.keys()]) {
      if (!authoritativeIds.has(frameId) && frameId !== tab.fallbackFrameId) this.removeFrame(tabId, frameId);
    }
    for (const frame of navigation) this.registerNavigation(tabId, frame.frameId, frame.parentFrameId, frame.url);
    for (const childFrameId of [...tab.ownerReports.keys()]) if (!authoritativeIds.has(childFrameId)) tab.ownerReports.delete(childFrameId);
  }

  registerCapabilities(tabId: number, frameId: number, workerInstanceId: string, capabilities: FrameCapabilities, now: number): void {
    const frame = this.requireFrame(tabId, frameId);
    const tab = this.requireTab(tabId);
    if (frame.retiredWorkerInstanceIds?.has(workerInstanceId)
      || (frame.workerReplacementHistorySaturated && frame.workerInstanceId !== workerInstanceId)) return;
    if (frame.workerInstanceId !== undefined && frame.workerInstanceId !== workerInstanceId) {
      this.clearFrameState(tab, frameId);
      this.retireWorker(frame, frame.workerInstanceId);
      frame.capabilities = undefined;
      frame.stableSince = undefined;
    }
    const same = frame.capabilities
      && frame.workerInstanceId === workerInstanceId
      && frame.capabilities.contentBearing === capabilities.contentBearing
      && frame.capabilities.wrapper === capabilities.wrapper
      && frame.capabilities.visible === capabilities.visible
      && frame.capabilities.area === capabilities.area;
    frame.workerInstanceId = workerInstanceId;
    frame.capabilities = { ...capabilities };
    if (!same) frame.stableSince = now;
  }

  registerChildOwnerReports(tabId: number, parentFrameId: number, reports: ChildOwnerReport[]): void {
    const tab = this.requireTab(tabId);
    for (const [childFrameId, report] of tab.ownerReports) if (report.parentFrameId === parentFrameId) tab.ownerReports.delete(childFrameId);
    for (const report of reports) {
      const child = tab.frames.get(report.childFrameId);
      if (!child || child.parentFrameId !== parentFrameId) continue;
      tab.ownerReports.set(report.childFrameId, { ...report, parentFrameId });
    }
  }

  removeFrame(tabId: number, frameId: number): void {
    const tab = this.requireTab(tabId);
    tab.frames.delete(frameId);
    tab.ownerReports.delete(frameId);
    if (tab.active?.frameId === frameId) tab.active = undefined;
    if (tab.handover?.from.frameId === frameId) tab.handover.dormant = true;
    if (tab.handover?.to.frameId === frameId) tab.handover = undefined;
  }

  abandonWorker(tabId: number, frameId: number, workerInstanceId: string, generation: number): boolean {
    const tab = this.requireTab(tabId);
    const frame = tab.frames.get(frameId);
    const handover = tab.handover;
    if (!frame || frame.workerInstanceId !== workerInstanceId || !handover
      || handover.from.frameId !== frameId || handover.from.workerInstanceId !== workerInstanceId || handover.generation !== generation) return false;
    this.retireWorker(frame, workerInstanceId);
    frame.workerInstanceId = undefined;
    frame.capabilities = undefined;
    frame.stableSince = undefined;
    if (tab.active?.frameId === frameId && tab.active.workerInstanceId === workerInstanceId) tab.active = undefined;
    handover.dormant = true;
    return true;
  }

  advanceElection(tabId: number, now: number): Election {
    const tab = this.requireTab(tabId);
    const winner = this.winner(tab, now);
    if (winner === undefined) return {};
    const winnerFrame = tab.frames.get(winner)!;
    const winnerInstance = winnerFrame.workerInstanceId!;

    if (tab.handover) {
      if (!tab.handover.dormant) return {
        candidateFrameId: tab.handover.to.frameId,
        candidateWorkerInstanceId: tab.handover.to.workerInstanceId,
        deactivateFrameId: tab.handover.from.frameId,
        deactivateWorkerInstanceId: tab.handover.from.workerInstanceId,
        generation: tab.handover.generation,
      };
      const handover = tab.handover;
      tab.handover = undefined;
      return {
        candidateFrameId: handover.to.frameId,
        candidateWorkerInstanceId: handover.to.workerInstanceId,
        activateFrameId: handover.to.frameId,
        activateWorkerInstanceId: handover.to.workerInstanceId,
        generation: handover.generation,
      };
    }

    if (tab.active?.frameId === winner && tab.active.workerInstanceId === winnerInstance) return { candidateFrameId: winner, candidateWorkerInstanceId: winnerInstance, generation: tab.active.generation };
    const generation = ++tab.generation;
    if (tab.active) {
      tab.handover = { from: tab.active, to: { frameId: winner, workerInstanceId: winnerInstance }, generation, dormant: false };
      return {
        candidateFrameId: winner,
        candidateWorkerInstanceId: winnerInstance,
        deactivateFrameId: tab.active.frameId,
        deactivateWorkerInstanceId: tab.active.workerInstanceId,
        generation,
      };
    }
    return { candidateFrameId: winner, candidateWorkerInstanceId: winnerInstance, activateFrameId: winner, activateWorkerInstanceId: winnerInstance, generation };
  }

  confirmActivated(tabId: number, frameId: number, workerInstanceId: string, generation: number): boolean {
    const tab = this.requireTab(tabId);
    if (generation !== tab.generation || tab.frames.get(frameId)?.workerInstanceId !== workerInstanceId) return false;
    tab.active = { frameId, workerInstanceId, generation };
    return true;
  }

  acknowledgeDormant(tabId: number, frameId: number, workerInstanceId: string, generation: number): boolean {
    const tab = this.requireTab(tabId);
    if (!tab.handover || tab.handover.from.frameId !== frameId || tab.handover.from.workerInstanceId !== workerInstanceId || tab.handover.generation !== generation) return false;
    tab.handover.dormant = true;
    tab.active = undefined;
    return true;
  }

  snapshot(tabId: number): CoordinatorSnapshot {
    const tab = this.requireTab(tabId);
    return { activeFrameIds: tab.active ? [tab.active.frameId] : [], generation: tab.generation };
  }

  private winner(tab: TabState, now: number): number | undefined {
    const eligible = [...tab.frames.values()].filter((frame) => {
      const capability = frame.capabilities;
      return frame.workerInstanceId !== undefined && capability?.contentBearing && !capability.wrapper && capability.visible && capability.area > 0
        && this.ownerChainVisible(tab, frame)
        && frame.stableSince !== undefined && now - frame.stableSince >= this.stabilityMs;
    });
    eligible.sort((left, right) => this.depth(tab, right) - this.depth(tab, left)
      || (right.capabilities?.area ?? 0) - (left.capabilities?.area ?? 0)
      || left.frameId - right.frameId);
    return eligible[0]?.frameId;
  }

  private ownerChainVisible(tab: TabState, frame: FrameRecord): boolean {
    let cursor = frame;
    const visited = new Set<number>();
    while (cursor.parentFrameId >= 0 && !visited.has(cursor.frameId)) {
      visited.add(cursor.frameId);
      const report = tab.ownerReports.get(cursor.frameId);
      if (report && (!report.visible || report.area <= 0)) return false;
      const parent = tab.frames.get(cursor.parentFrameId);
      if (!parent) return false;
      cursor = parent;
    }
    return true;
  }

  private depth(tab: TabState, frame: FrameRecord): number {
    let depth = 0;
    let cursor: FrameRecord | undefined = frame;
    const visited = new Set<number>();
    while (cursor && cursor.parentFrameId >= 0 && !visited.has(cursor.frameId)) {
      visited.add(cursor.frameId);
      depth += 1;
      cursor = tab.frames.get(cursor.parentFrameId);
    }
    return depth;
  }

  private requireTab(tabId: number): TabState {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error("Course is not bound to tab");
    return tab;
  }

  private clearFrameState(tab: TabState, frameId: number): void {
    if (tab.active?.frameId === frameId) tab.active = undefined;
    if (tab.handover?.from.frameId === frameId || tab.handover?.to.frameId === frameId) tab.handover = undefined;
  }

  private retireWorker(frame: FrameRecord, workerInstanceId: string): void {
    const retired = frame.retiredWorkerInstanceIds ?? new Set<string>();
    frame.retiredWorkerInstanceIds = retired;
    if (retired.size < MAX_RETIRED_WORKER_INSTANCES) retired.add(workerInstanceId);
    if (retired.size >= MAX_RETIRED_WORKER_INSTANCES) frame.workerReplacementHistorySaturated = true;
  }

  private requireFrame(tabId: number, frameId: number): FrameRecord {
    const frame = this.requireTab(tabId).frames.get(frameId);
    if (!frame) throw new Error("Frame navigation is not registered");
    return frame;
  }
}
