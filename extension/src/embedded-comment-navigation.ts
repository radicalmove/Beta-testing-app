export type EmbeddedNavigationStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

export type EmbeddedNavigationState =
  | "prepared" | "parent-loading" | "worker-loading" | "locator-applying"
  | "identity-waiting" | "projection-waiting" | "context-opening" | "complete";

export type EmbeddedNavigationTarget = {
  id: string;
  courseId: string;
  pageUrl: string;
  parentActivityUrl: string | null;
  embeddedLocator: string | null;
};

type RecordValue = EmbeddedNavigationTarget & {
  tabId: number;
  state: EmbeddedNavigationState;
  createdAt: number;
  expiresAt: number;
  locatorWorkerInstanceId?: string;
  locatorGeneration?: number;
};

type WorkerState = { topUrl: string; workerInstanceId?: string; generation?: number; pageUrl?: string };
type Dependencies = {
  now?: () => number;
  current(tabId: number): WorkerState;
  navigateParent(tabId: number, parentActivityUrl: string): Promise<void>;
  applyLocator(tabId: number, locator: string): Promise<void>;
  projectionContains(tabId: number, commentId: string, pageUrl: string): boolean;
  takeToContext(tabId: number, commentId: string): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyFor = (tabId: number) => `commentNavigation:${tabId}`;

function validateTarget(value: EmbeddedNavigationTarget): void {
  if (!UUID.test(value.id) || !UUID.test(value.courseId)) throw new Error("Invalid embedded comment navigation identity");
  let page: URL;
  try { page = new URL(value.pageUrl); } catch { throw new Error("Invalid embedded comment page identity"); }
  if (!["http:", "https:"].includes(page.protocol) || page.username || page.password || page.href !== value.pageUrl || value.pageUrl.length > 4096) throw new Error("Invalid embedded comment page identity");
  if ((value.parentActivityUrl === null) !== (value.embeddedLocator === null)) throw new Error("Invalid embedded comment navigation metadata");
  if (value.parentActivityUrl !== null) {
    let parent: URL;
    try { parent = new URL(value.parentActivityUrl); } catch { throw new Error("Invalid embedded parent activity"); }
    if (parent.protocol !== "https:" || parent.username || parent.password || parent.href !== value.parentActivityUrl || value.parentActivityUrl.length > 4096) throw new Error("Invalid embedded parent activity");
    const locator = value.embeddedLocator!;
    if (locator.length > 2048 || locator.trim() !== locator || /[\u0000-\u0020\u007f\\]/.test(locator) || (!locator.startsWith("#") && !locator.startsWith("/")) || locator.startsWith("//")) throw new Error("Invalid embedded locator");
  }
}

export class EmbeddedCommentNavigation {
  private readonly now: () => number;
  private readonly storage: EmbeddedNavigationStorage;
  private readonly dependencies: Dependencies;
  private readonly ttlMs: number;
  private readonly operations = new Map<number, Promise<{ state: EmbeddedNavigationState }>>();
  constructor(storage: EmbeddedNavigationStorage, dependencies: Dependencies, ttlMs = 300_000) {
    this.storage = storage;
    this.dependencies = dependencies;
    this.ttlMs = ttlMs;
    this.now = dependencies.now ?? Date.now;
  }

  async prepare(tabId: number, target: EmbeddedNavigationTarget): Promise<void> {
    if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error("Invalid embedded comment navigation tab");
    validateTarget(target);
    const now = this.now();
    const record: RecordValue = { ...target, tabId, state: "prepared", createdAt: now, expiresAt: now + this.ttlMs };
    await this.storage.set({ [keyFor(tabId)]: record });
  }

  async advance(tabId: number): Promise<{ state: EmbeddedNavigationState }> {
    const previous = this.operations.get(tabId) ?? Promise.resolve(undefined);
    const current = previous.catch(() => undefined).then(() => this.advanceOne(tabId));
    this.operations.set(tabId, current);
    try { return await current; }
    finally { if (this.operations.get(tabId) === current) this.operations.delete(tabId); }
  }

  private async advanceOne(tabId: number): Promise<{ state: EmbeddedNavigationState }> {
    const key = keyFor(tabId);
    const record = (await this.storage.get(key))[key] as RecordValue | undefined;
    if (!record || record.tabId !== tabId) throw new Error("Embedded comment navigation unavailable");
    if (this.now() > record.expiresAt) { await this.storage.remove(key); throw new Error("Embedded comment navigation expired"); }
    validateTarget(record);
    const current = this.dependencies.current(tabId);

    if (record.parentActivityUrl === null) {
      if (current.pageUrl !== record.pageUrl) throw new Error("Open the original SCORM activity first");
      return this.openWhenProjected(key, record);
    }

    if (current.pageUrl === record.pageUrl) return this.openWhenProjected(key, record);

    if (current.topUrl !== record.parentActivityUrl) {
      record.state = "parent-loading";
      await this.save(key, record);
      await this.dependencies.navigateParent(tabId, record.parentActivityUrl);
      return { state: record.state };
    }

    if (!current.workerInstanceId || !Number.isSafeInteger(current.generation)) {
      record.state = "worker-loading";
      await this.save(key, record);
      return { state: record.state };
    }

    const locatorAppliedToCurrentWorker = record.locatorWorkerInstanceId === current.workerInstanceId && record.locatorGeneration === current.generation;
    if (!locatorAppliedToCurrentWorker) {
      record.state = "locator-applying";
      await this.save(key, record);
      await this.dependencies.applyLocator(tabId, record.embeddedLocator!);
      record.locatorWorkerInstanceId = current.workerInstanceId;
      record.locatorGeneration = current.generation;
    }
    record.state = "identity-waiting";
    await this.save(key, record);
    return { state: record.state };
  }

  private async openWhenProjected(key: string, record: RecordValue): Promise<{ state: EmbeddedNavigationState }> {
    if (!this.dependencies.projectionContains(record.tabId, record.id, record.pageUrl)) {
      record.state = "projection-waiting";
      await this.save(key, record);
      return { state: record.state };
    }
    record.state = "context-opening";
    await this.save(key, record);
    await this.dependencies.takeToContext(record.tabId, record.id);
    record.state = "complete";
    await this.storage.remove(key);
    return { state: "complete" };
  }

  private save(key: string, record: RecordValue): Promise<void> { return this.storage.set({ [key]: record }); }
}
