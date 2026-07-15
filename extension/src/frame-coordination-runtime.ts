import { FrameCoordinator, type ActiveWorkerOwner, type CoordinatorSnapshot, type FrameCapabilities, type NavigationFrame } from "./frame-coordinator.ts";
import { validateScormAckFor, validateScormMessage, type ScormAck, type ScormCommand } from "./scorm-protocol.ts";
export type { NavigationFrame } from "./frame-coordinator.ts";

type DeliveryResult = { ok?: boolean; dormant?: boolean; worker_instance_id?: string; generation?: number } | ScormAck | undefined;
export type WorkerReadyNotification = { tabId: number; frameId: number; workerInstanceId: string; generation: number; replaced: boolean };
type Timer = unknown;
type Dependencies = {
  send(tabId: number, frameId: number, message: unknown): Promise<DeliveryResult>;
  now?: () => number;
  setTimeout?: (handler: () => void, delay: number) => Timer;
  clearTimeout?: (timer: Timer) => void;
  onWorkerReady?: (notification: WorkerReadyNotification) => void;
};

export class FrameCoordinatorRuntime {
  private readonly coordinator: FrameCoordinator;
  private readonly dependencies: Dependencies;
  private readonly deactivationTimeoutMs: number;
  private readonly now: () => number;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => Timer;
  private readonly cancelTimeout: (timer: Timer) => void;
  private readonly lastReady = new Map<number, { frameId: number; workerInstanceId: string }>();
  private readonly tabOperations = new Map<number, Promise<void>>();
  private readonly pendingCommands = new Map<string, Timer>();
  private readonly completedRequestIds = new Set<string>();
  private readonly commandTimeoutMs: number;

  constructor(dependencies: Dependencies, stabilityMs = 250, deactivationTimeoutMs = 1_000, commandTimeoutMs = 2_000) {
    this.dependencies = dependencies;
    this.coordinator = new FrameCoordinator(stabilityMs);
    this.deactivationTimeoutMs = deactivationTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.now = dependencies.now ?? Date.now;
    this.scheduleTimeout = dependencies.setTimeout ?? ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout = dependencies.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>));
  }

  bindCourse(tabId: number, courseId: string): void { this.coordinator.bindCourse(tabId, courseId, 0); }

  async registerFrame(tabId: number, frameId: number, documentId: string, workerInstanceEpoch: number, workerInstanceId: string, capabilities: FrameCapabilities, navigation: NavigationFrame[], now = this.now()): Promise<void> {
    await this.runSerialized(tabId, async () => {
      this.coordinator.replaceNavigation(tabId, navigation);
      if (!this.coordinator.registerCapabilities(tabId, frameId, documentId, workerInstanceEpoch, workerInstanceId, capabilities, now)) return;
      await this.drive(tabId, now);
    });
  }

  snapshot(tabId: number): CoordinatorSnapshot {
    try { return this.coordinator.snapshot(tabId); }
    catch { return { activeFrameIds: [], generation: 0 }; }
  }

  currentOwner(tabId: number): ActiveWorkerOwner | undefined {
    try { return this.coordinator.activeOwner(tabId); } catch { return undefined; }
  }

  pendingCommandCount(): number { return this.pendingCommands.size; }

  async sendCommand(tabId: number, value: unknown): Promise<ScormAck> {
    const command = validateScormMessage(value);
    if (!command.type.startsWith("SCORM_") || ["SCORM_SELECTION_CHANGED", "SCORM_ANCHOR_CAPTURED", "SCORM_PAGE_IDENTITY_CHANGED", "SCORM_COMMENTS_CHANGED"].includes(command.type)) throw new Error("Expected SCORM command");
    const typed = command as ScormCommand;
    if (this.pendingCommands.has(typed.request_id) || this.completedRequestIds.has(typed.request_id)) throw new Error("Duplicate SCORM request id");
    const owner = this.currentOwner(tabId);
    if (!owner || owner.workerInstanceId !== typed.worker_instance_id || owner.generation !== typed.generation) throw new Error("SCORM command does not target elected worker");
    return new Promise<ScormAck>((resolve, reject) => {
      const timer = this.scheduleTimeout(() => {
        if (this.pendingCommands.delete(typed.request_id)) {
          this.rememberCompleted(typed.request_id);
          reject(new Error("SCORM command timed out"));
        }
      }, this.commandTimeoutMs);
      this.pendingCommands.set(typed.request_id, timer);
      void this.dependencies.send(tabId, owner.frameId, typed).then((result) => {
        if (!this.pendingCommands.delete(typed.request_id)) return;
        this.cancelTimeout(timer);
        this.rememberCompleted(typed.request_id);
        try { resolve(validateScormAckFor(typed, result)); }
        catch (error) { reject(error); }
      }, (error: unknown) => {
        if (!this.pendingCommands.delete(typed.request_id)) return;
        this.cancelTimeout(timer);
        this.rememberCompleted(typed.request_id);
        reject(error);
      });
    });
  }

  removeTab(tabId: number): void { this.coordinator.removeTab(tabId); this.lastReady.delete(tabId); }

  async reevaluate(tabId: number, now = this.now()): Promise<void> {
    try { await this.runSerialized(tabId, () => this.drive(tabId, now)); }
    catch { /* a navigation or worker restart can remove the tab before the delayed election */ }
  }

  private async drive(tabId: number, now: number): Promise<void> {
    const election = this.coordinator.advanceElection(tabId, now);
    if (election.deactivateFrameId !== undefined && election.deactivateWorkerInstanceId !== undefined && election.generation !== undefined) {
      try {
        const result = await this.deliverDeactivation(tabId, election.deactivateFrameId, {
          type: "DEACTIVATE_REVIEW_FRAME",
          worker_instance_id: election.deactivateWorkerInstanceId,
          generation: election.generation,
        });
        if (this.matches(result, election.deactivateWorkerInstanceId, election.generation) && result && "dormant" in result && result.dormant
          && this.coordinator.acknowledgeDormant(tabId, election.deactivateFrameId, election.deactivateWorkerInstanceId, election.generation)) {
          await this.drive(tabId, now);
          return;
        }
      } catch { /* timeout and delivery failure both abandon the stale owner below */ }
      this.coordinator.abandonWorker(tabId, election.deactivateFrameId, election.deactivateWorkerInstanceId, election.generation);
      await this.drive(tabId, now);
      return;
    }
    if (election.activateFrameId !== undefined && election.activateWorkerInstanceId !== undefined && election.generation !== undefined) {
      try {
        const result = await this.dependencies.send(tabId, election.activateFrameId, {
          type: "ACTIVATE_REVIEW_FRAME",
          worker_instance_id: election.activateWorkerInstanceId,
          generation: election.generation,
        });
        if (this.matches(result, election.activateWorkerInstanceId, election.generation)
          && this.coordinator.confirmActivated(tabId, election.activateFrameId, election.activateWorkerInstanceId, election.generation)) {
          const previous = this.lastReady.get(tabId);
          const notification = {
            tabId,
            frameId: election.activateFrameId,
            workerInstanceId: election.activateWorkerInstanceId,
            generation: election.generation,
            replaced: Boolean(previous && (previous.frameId !== election.activateFrameId || previous.workerInstanceId !== election.activateWorkerInstanceId)),
          };
          this.lastReady.set(tabId, { frameId: notification.frameId, workerInstanceId: notification.workerInstanceId });
          this.dependencies.onWorkerReady?.(notification);
        }
      } catch { /* activation can be retried after registration/navigation changes */ }
    }
  }

  private runSerialized(tabId: number, operation: () => Promise<void>): Promise<void> {
    const previous = this.tabOperations.get(tabId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.tabOperations.set(tabId, current);
    return current.finally(() => {
      if (this.tabOperations.get(tabId) === current) this.tabOperations.delete(tabId);
    });
  }

  private matches(result: DeliveryResult, workerInstanceId: string, generation: number): boolean {
    return result?.ok === true && result.worker_instance_id === workerInstanceId && result.generation === generation;
  }

  private rememberCompleted(requestId: string): void {
    this.completedRequestIds.add(requestId);
    if (this.completedRequestIds.size > 256) this.completedRequestIds.delete(this.completedRequestIds.values().next().value!);
  }

  private deliverDeactivation(tabId: number, frameId: number, message: unknown): Promise<DeliveryResult> {
    return new Promise((resolve, reject) => {
      const timer = this.scheduleTimeout(() => reject(new Error("Review frame deactivation timed out")), this.deactivationTimeoutMs);
      void this.dependencies.send(tabId, frameId, message).then(
        (result) => { this.cancelTimeout(timer); resolve(result); },
        (error: unknown) => { this.cancelTimeout(timer); reject(error); },
      );
    });
  }
}
