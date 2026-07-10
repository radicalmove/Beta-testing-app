export type ScreenshotCapability = { tabId: number; courseId: string; createdAt: number; expiresAt: number };
export type SessionStorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

const STORAGE_KEY = "screenshotCapabilities";

export class ScreenshotCapabilities {
  private mutex = Promise.resolve();
  private readonly storage: SessionStorageArea;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(storage: SessionStorageArea, options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
    this.storage = storage;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 100;
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutex.then(operation, operation);
    this.mutex = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(now: number): Promise<Record<string, ScreenshotCapability>> {
    const stored = (await this.storage.get(STORAGE_KEY))[STORAGE_KEY];
    const records: Record<string, ScreenshotCapability> = {};
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [commentId, value] of Object.entries(stored as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.tabId === "number" && Number.isInteger(candidate.tabId) && typeof candidate.courseId === "string" && typeof candidate.createdAt === "number" && typeof candidate.expiresAt === "number" && candidate.expiresAt > now) {
          records[commentId] = { tabId: candidate.tabId, courseId: candidate.courseId, createdAt: candidate.createdAt, expiresAt: candidate.expiresAt };
        }
      }
    }
    return records;
  }

  private async mutate<T>(operation: (records: Record<string, ScreenshotCapability>, now: number) => T): Promise<T> {
    return this.serialized(async () => {
      const now = this.now();
      const records = await this.read(now);
      const result = operation(records, now);
      await this.storage.set({ [STORAGE_KEY]: records });
      return result;
    });
  }

  cleanup(): Promise<void> { return this.mutate(() => undefined); }

  grant(commentId: string, tabId: number, courseId: string): Promise<void> {
    return this.mutate((records, now) => {
      records[commentId] = { tabId, courseId, createdAt: now, expiresAt: now + this.ttlMs };
      const overflow = Object.entries(records).sort(([, a], [, b]) => a.createdAt - b.createdAt).slice(0, Math.max(0, Object.keys(records).length - this.maxEntries));
      for (const [expiredId] of overflow) delete records[expiredId];
    });
  }

  claim(commentId: string, tabId: number, courseId: string): Promise<ScreenshotCapability | undefined> {
    return this.mutate((records) => {
      const capability = records[commentId];
      if (!capability || capability.tabId !== tabId || capability.courseId !== courseId) return undefined;
      delete records[commentId];
      return capability;
    });
  }

  cancel(commentId: string, tabId: number, courseId: string): Promise<boolean> {
    return this.mutate((records) => {
      const capability = records[commentId];
      if (!capability || capability.tabId !== tabId || capability.courseId !== courseId) return false;
      delete records[commentId];
      return true;
    });
  }

  restore(commentId: string, capability: ScreenshotCapability): Promise<void> {
    return this.mutate((records, now) => {
      if (!records[commentId] && capability.expiresAt > now) records[commentId] = capability;
    });
  }
}
