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
  capabilities?: FrameCapabilities;
  stableSince?: number;
};
export type ChildOwnerReport = { childFrameId: number; visible: boolean; area: number; origin: string };
type StoredOwnerReport = ChildOwnerReport & { parentFrameId: number };

type Handover = { from: number; to: number; generation: number; dormant: boolean };
type TabState = {
  courseId: string;
  fallbackFrameId: number;
  frames: Map<number, FrameRecord>;
  ownerReports: Map<number, StoredOwnerReport>;
  active?: { frameId: number; generation: number };
  handover?: Handover;
  generation: number;
};

export type Election = {
  candidateFrameId?: number;
  deactivateFrameId?: number;
  activateFrameId?: number;
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
    tab.frames.set(frameId, { frameId, parentFrameId, url, capabilities: previous?.capabilities, stableSince: previous?.stableSince });
  }

  registerCapabilities(tabId: number, frameId: number, capabilities: FrameCapabilities, now: number): void {
    const frame = this.requireFrame(tabId, frameId);
    const same = frame.capabilities
      && frame.capabilities.contentBearing === capabilities.contentBearing
      && frame.capabilities.wrapper === capabilities.wrapper
      && frame.capabilities.visible === capabilities.visible
      && frame.capabilities.area === capabilities.area;
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
    if (tab.handover?.from === frameId) tab.handover.dormant = true;
    if (tab.handover?.to === frameId) tab.handover = undefined;
  }

  advanceElection(tabId: number, now: number): Election {
    const tab = this.requireTab(tabId);
    const winner = this.winner(tab, now);
    if (winner === undefined) return {};

    if (tab.handover) {
      if (!tab.handover.dormant) return { candidateFrameId: tab.handover.to, deactivateFrameId: tab.handover.from, generation: tab.handover.generation };
      const handover = tab.handover;
      tab.handover = undefined;
      return { candidateFrameId: handover.to, activateFrameId: handover.to, generation: handover.generation };
    }

    if (tab.active?.frameId === winner) return { candidateFrameId: winner, generation: tab.active.generation };
    const generation = ++tab.generation;
    if (tab.active) {
      tab.handover = { from: tab.active.frameId, to: winner, generation, dormant: false };
      return { candidateFrameId: winner, deactivateFrameId: tab.active.frameId, generation };
    }
    return { candidateFrameId: winner, activateFrameId: winner, generation };
  }

  confirmActivated(tabId: number, frameId: number, generation: number): boolean {
    const tab = this.requireTab(tabId);
    if (generation !== tab.generation) return false;
    tab.active = { frameId, generation };
    return true;
  }

  acknowledgeDormant(tabId: number, frameId: number, generation: number): boolean {
    const tab = this.requireTab(tabId);
    if (!tab.handover || tab.handover.from !== frameId || tab.handover.generation !== generation) return false;
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
      return capability?.contentBearing && !capability.wrapper && capability.visible && capability.area > 0
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

  private requireFrame(tabId: number, frameId: number): FrameRecord {
    const frame = this.requireTab(tabId).frames.get(frameId);
    if (!frame) throw new Error("Frame navigation is not registered");
    return frame;
  }
}
