import type { PageComment } from "./background-bridge.ts";

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

type WorkerState = { courseId?: string; topUrl: string; workerInstanceId?: string; generation?: number; pageUrl?: string };
type Timer = unknown;
type Dependencies = {
  now?: () => number;
  setTimeout?: (handler: () => void, delay: number) => Timer;
  clearTimeout?: (timer: Timer) => void;
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
  private readonly retryTimers = new Map<number, Timer>();
  private readonly retryAttempts = new Map<number, number>();
  private readonly scheduleTimeout: (handler: () => void, delay: number) => Timer;
  private readonly cancelTimeout: (timer: Timer) => void;
  constructor(storage: EmbeddedNavigationStorage, dependencies: Dependencies, ttlMs = 300_000) {
    this.storage = storage;
    this.dependencies = dependencies;
    this.ttlMs = ttlMs;
    this.now = dependencies.now ?? Date.now;
    this.scheduleTimeout = dependencies.setTimeout ?? ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout = dependencies.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>));
  }

  async prepare(tabId: number, target: EmbeddedNavigationTarget): Promise<void> {
    if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error("Invalid embedded comment navigation tab");
    validateTarget(target);
    this.cancelRetry(tabId);
    const now = this.now();
    const record: RecordValue = { ...target, tabId, state: "prepared", createdAt: now, expiresAt: now + this.ttlMs };
    await this.storage.set({ [keyFor(tabId)]: record });
  }

  async advance(tabId: number): Promise<{ state: EmbeddedNavigationState }> {
    this.cancelRetry(tabId, false);
    const previous = this.operations.get(tabId) ?? Promise.resolve(undefined);
    const current = previous.catch(() => undefined).then(() => this.advanceOne(tabId));
    this.operations.set(tabId, current);
    try {
      const result = await current;
      if (result.state === "complete") this.cancelRetry(tabId);
      else await this.scheduleRetryIfRecoverable(tabId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/course context changed|navigation expired|original SCORM activity first|navigation unavailable/.test(message)) this.cancelRetry(tabId);
      else await this.scheduleRetryIfRecoverable(tabId);
      throw error;
    }
    finally { if (this.operations.get(tabId) === current) this.operations.delete(tabId); }
  }

  cancel(tabId: number): void { this.cancelRetry(tabId); }

  private async advanceOne(tabId: number): Promise<{ state: EmbeddedNavigationState }> {
    const key = keyFor(tabId);
    const record = (await this.storage.get(key))[key] as RecordValue | undefined;
    if (!record || record.tabId !== tabId) throw new Error("Embedded comment navigation unavailable");
    if (this.now() >= record.expiresAt) { await this.storage.remove(key); throw new Error("Embedded comment navigation expired"); }
    validateTarget(record);
    const current = this.dependencies.current(tabId);
    if (!current.courseId) {
      record.state = "worker-loading";
      await this.save(key, record);
      return { state: record.state };
    }
    if (current.courseId !== record.courseId) {
      await this.storage.remove(key);
      throw new Error("Embedded comment navigation course context changed");
    }

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

  private async scheduleRetryIfRecoverable(tabId: number): Promise<void> {
    if (this.retryTimers.has(tabId)) return;
    const record = (await this.storage.get(keyFor(tabId)))[keyFor(tabId)] as RecordValue | undefined;
    if (!record || record.tabId !== tabId || this.now() >= record.expiresAt || (this.dependencies.current(tabId).courseId !== undefined && this.dependencies.current(tabId).courseId !== record.courseId)) {
      if (record && this.now() >= record.expiresAt) await this.storage.remove(keyFor(tabId));
      this.cancelRetry(tabId);
      return;
    }
    const attempt = this.retryAttempts.get(tabId) ?? 0;
    const delay = Math.min(4_000, 250 * (2 ** Math.min(attempt, 4)));
    this.retryAttempts.set(tabId, attempt + 1);
    const timer = this.scheduleTimeout(() => {
      if (this.retryTimers.get(tabId) !== timer) return;
      this.retryTimers.delete(tabId);
      void this.advance(tabId).catch(() => undefined);
    }, Math.min(delay, Math.max(0, record.expiresAt - this.now())));
    this.retryTimers.set(tabId, timer);
  }

  private cancelRetry(tabId: number, resetAttempt = true): void {
    const timer = this.retryTimers.get(tabId);
    if (timer !== undefined) this.cancelTimeout(timer);
    this.retryTimers.delete(tabId);
    if (resetAttempt) this.retryAttempts.delete(tabId);
  }
}

type NavigationSender = { id?: string; url?: string; frameId?: number; tab?: { id?: number } };
type NavigationBoundaryDependencies = {
  extensionId: string;
  authorizeMoodle(sender: NavigationSender): Promise<boolean>;
  courseId(sender: NavigationSender): string | undefined;
  listCourseComments(courseId: string): Promise<PageComment[]>;
  storage: EmbeddedNavigationStorage;
  navigation: EmbeddedCommentNavigation;
  now?: () => number;
};

export async function handleCommentNavigationMessage(message: unknown, sender: NavigationSender, dependencies: NavigationBoundaryDependencies): Promise<unknown> {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid comment navigation");
  const record = message as Record<string, unknown>;
  if (sender.id !== dependencies.extensionId || sender.frameId !== 0 || typeof sender.tab?.id !== "number" || !await dependencies.authorizeMoodle(sender)) throw new Error("Unauthorized comment navigation");
  const tabId = sender.tab.id; const key = keyFor(tabId); const courseId = dependencies.courseId(sender); const now = dependencies.now ?? Date.now;
  if (!courseId) throw new Error("Comment navigation course unavailable");
  if (record.type === "CONSUME_COMMENT_NAVIGATION") {
    if (Object.keys(record).sort().join() !== "type") throw new Error("Invalid comment navigation");
    const stored = (await dependencies.storage.get(key))[key] as { comment_id?: unknown; course_id?: unknown; page_url?: unknown; created_at?: unknown } | undefined;
    if (!stored || stored.course_id !== courseId || stored.page_url !== sender.url || typeof stored.created_at !== "number" || now() - stored.created_at > 300_000) {
      if (stored && (typeof stored.created_at !== "number" || now() - stored.created_at > 300_000)) await dependencies.storage.remove(key);
      return {};
    }
    await dependencies.storage.remove(key); return { comment_id: stored.comment_id };
  }
  if (record.type !== "PREPARE_COMMENT_NAVIGATION" || Object.keys(record).sort().join() !== "comment_id,page_url,type"
    || typeof record.comment_id !== "string" || !UUID.test(record.comment_id) || typeof record.page_url !== "string" || record.page_url.length > 4096) throw new Error("Invalid comment navigation");
  let requestedPage: URL; try { requestedPage = new URL(record.page_url); } catch { throw new Error("Invalid comment navigation"); }
  if (!["http:", "https:"].includes(requestedPage.protocol) || requestedPage.username || requestedPage.password || requestedPage.href !== record.page_url) throw new Error("Invalid comment navigation");
  const comments = await dependencies.listCourseComments(courseId);
  const comment = comments.find((candidate) => candidate.id === record.comment_id && candidate.page_url === record.page_url);
  if (!comment) throw new Error("Comment navigation target unavailable");
  const senderOrigin = new URL(sender.url!).origin;
  if (comment.parent_activity_url !== null) {
    if (new URL(comment.parent_activity_url).origin !== senderOrigin) throw new Error("Invalid embedded parent activity");
    await dependencies.navigation.prepare(tabId, { id: comment.id, courseId, pageUrl: comment.page_url, parentActivityUrl: comment.parent_activity_url, embeddedLocator: comment.embedded_locator });
    return dependencies.navigation.advance(tabId);
  }
  if (new URL(comment.page_url).origin === senderOrigin) {
    await dependencies.storage.set({ [key]: { comment_id: comment.id, course_id: courseId, page_url: comment.page_url, created_at: now() } });
    return { destination_url: comment.page_url };
  }
  await dependencies.navigation.prepare(tabId, { id: comment.id, courseId, pageUrl: comment.page_url, parentActivityUrl: null, embeddedLocator: null });
  return dependencies.navigation.advance(tabId);
}
