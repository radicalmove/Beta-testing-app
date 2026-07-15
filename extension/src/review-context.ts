export type ReviewSender = { id?: string; frameId?: number; tab?: { id?: number }; url?: string; documentId?: string };
export type StoredReviewContext = { id: string; title: string; course_url: string; parent_activity_url: string };
export type FrameReviewContext = { course_id: string; course_title: string; parent_activity_url: string };
import type { FrameCapabilities } from "./frame-coordinator.ts";

export type ContextMessage =
  | { type: "GET_REVIEW_CONTEXT" | "REVIEW_FRAME_READY" | "GET_REVIEW_FRAME_STATUS" }
  | { type: "REGISTER_REVIEW_FRAME"; worker_instance_id: string; worker_instance_epoch: number; capabilities: FrameCapabilities }
  | { type: "RENEW_REVIEW_FRAME_LEASE" | "ACK_REVIEW_FRAME_DORMANT"; generation: number };

type ReadyFrame = { origin: string; readyAt: number };
type Entry = StoredReviewContext & { extensionId: string; lastActivityAt: number; readyFrames: Map<number, ReadyFrame> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WORKER_INSTANCE_EPOCH = 2_147_483_647;

export function validateContextMessage(message: unknown): ContextMessage {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid review context message");
  const record = message as Record<string, unknown>;
  if (["GET_REVIEW_CONTEXT", "REVIEW_FRAME_READY", "GET_REVIEW_FRAME_STATUS"].includes(record.type as string)) {
    if (Object.keys(record).length !== 1) throw new Error("Invalid review context message");
    return { type: record.type as "GET_REVIEW_CONTEXT" | "REVIEW_FRAME_READY" | "GET_REVIEW_FRAME_STATUS" };
  }
  if (record.type === "REGISTER_REVIEW_FRAME") {
    if (Object.keys(record).sort().join() !== "capabilities,type,worker_instance_epoch,worker_instance_id" || typeof record.worker_instance_id !== "string" || !UUID.test(record.worker_instance_id)
      || !Number.isSafeInteger(record.worker_instance_epoch) || (record.worker_instance_epoch as number) < 1 || (record.worker_instance_epoch as number) > MAX_WORKER_INSTANCE_EPOCH
      || !record.capabilities || typeof record.capabilities !== "object" || Array.isArray(record.capabilities)) throw new Error("Invalid review context message");
    const capability = record.capabilities as Record<string, unknown>;
    if (Object.keys(capability).sort().join() !== "area,contentBearing,visible,wrapper"
      || typeof capability.contentBearing !== "boolean" || typeof capability.wrapper !== "boolean" || typeof capability.visible !== "boolean"
      || typeof capability.area !== "number" || !Number.isFinite(capability.area) || capability.area < 0) throw new Error("Invalid review context message");
    return { type: record.type, worker_instance_id: record.worker_instance_id, worker_instance_epoch: record.worker_instance_epoch as number, capabilities: capability as FrameCapabilities };
  }
  if (["RENEW_REVIEW_FRAME_LEASE", "ACK_REVIEW_FRAME_DORMANT"].includes(record.type as string)) {
    if (Object.keys(record).sort().join() !== "generation,type" || !Number.isInteger(record.generation) || (record.generation as number) < 0) throw new Error("Invalid review context message");
    return { type: record.type as "RENEW_REVIEW_FRAME_LEASE" | "ACK_REVIEW_FRAME_DORMANT", generation: record.generation as number };
  }
  throw new Error("Invalid review context message");
}

export class ReviewContextCache {
  private readonly entries = new Map<number, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  constructor(ttlMs = 10 * 60_000, now = Date.now) { this.ttlMs = ttlMs; this.now = now; }

  register(sender: ReviewSender, context: StoredReviewContext): boolean {
    const tabId = sender.tab?.id;
    if (sender.frameId !== 0 || typeof tabId !== "number" || typeof sender.id !== "string" || !isStoredReviewContext(context)) return false;
    try { if (new URL(sender.url ?? "").origin !== new URL(context.course_url).origin) return false; } catch { return false; }
    this.entries.set(tabId, { ...context, extensionId: sender.id, lastActivityAt: this.now(), readyFrames: new Map() });
    return true;
  }

  obtain(sender: ReviewSender): FrameReviewContext | undefined {
    const entry = this.authorizedEntry(sender, true);
    return entry ? { course_id: entry.id, course_title: entry.title, parent_activity_url: entry.parent_activity_url } : undefined;
  }

  markReady(sender: ReviewSender): boolean {
    let origin: string; try { origin = new URL(sender.url ?? "").origin; } catch { return false; }
    const entry = this.authorizedEntry(sender, true);
    if (!entry) return false;
    entry.readyFrames.set(sender.frameId!, { origin, readyAt: this.now() });
    return true;
  }

  readyFrameCount(sender: ReviewSender): number {
    const entry = this.authorizedEntry(sender, false);
    if (!entry) return 0;
    const now = this.now();
    for (const [frameId, ready] of entry.readyFrames) if (now - ready.readyAt > this.ttlMs) entry.readyFrames.delete(frameId);
    return entry.readyFrames.size;
  }

  readyOrigins(sender: ReviewSender): string[] {
    const entry = this.authorizedEntry(sender, false); if (!entry) return [];
    const now = this.now();
    for (const [frameId, ready] of entry.readyFrames) if (now - ready.readyAt > this.ttlMs) entry.readyFrames.delete(frameId);
    return [...new Set([...entry.readyFrames.values()].map((ready) => ready.origin))];
  }

  matchesCourse(sender: ReviewSender, courseId: string): boolean {
    const entry = this.authorizedEntry(sender, false, true); return entry?.id === courseId;
  }

  courseId(sender: ReviewSender): string | undefined { return this.authorizedEntry(sender, false, true)?.id; }

  exportTab(tabId: number): StoredReviewContext | undefined {
    const entry = this.entries.get(tabId);
    if (!entry || this.now() - entry.lastActivityAt > this.ttlMs) return undefined;
    return { id: entry.id, title: entry.title, course_url: entry.course_url, parent_activity_url: entry.parent_activity_url };
  }

  restoreTab(tabId: number, extensionId: string, context: StoredReviewContext): boolean {
    if (!Number.isInteger(tabId) || tabId < 0 || !extensionId || !isStoredReviewContext(context)) return false;
    this.entries.set(tabId, { ...context, extensionId, lastActivityAt: this.now(), readyFrames: new Map() });
    return true;
  }

  removeTab(tabId: number): void { this.entries.delete(tabId); }

  private authorizedEntry(sender: ReviewSender, requireSubframe: boolean, allowAnyFrame = false): Entry | undefined {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number" || typeof sender.frameId !== "number" || (!allowAnyFrame && (requireSubframe ? sender.frameId <= 0 : sender.frameId !== 0))) return undefined;
    const entry = this.entries.get(tabId);
    if (!entry || sender.id !== entry.extensionId) return undefined;
    const now = this.now();
    if (now - entry.lastActivityAt > this.ttlMs) { this.entries.delete(tabId); return undefined; }
    entry.lastActivityAt = now;
    return entry;
  }
}

function isStoredReviewContext(context: StoredReviewContext): boolean {
  if (!context || typeof context !== "object") return false;
  if (![context.id, context.title, context.course_url, context.parent_activity_url].every((value) => typeof value === "string" && value.length > 0)) return false;
  try {
    const course = new URL(context.course_url); const parent = new URL(context.parent_activity_url);
    return course.protocol === "https:" && parent.protocol === "https:" && !course.username && !course.password && !parent.username && !parent.password
      && course.href === context.course_url && parent.href === context.parent_activity_url && course.origin === parent.origin;
  } catch { return false; }
}

export function matchesCurrentNavigationDocument(sender: ReviewSender, navigation: Array<{ frameId: number; url: string; documentId?: string }>): boolean {
  return typeof sender.frameId === "number" && typeof sender.url === "string" && typeof sender.documentId === "string" && sender.documentId.length > 0
    && navigation.some((frame) => frame.frameId === sender.frameId && frame.url === sender.url && frame.documentId === sender.documentId);
}
