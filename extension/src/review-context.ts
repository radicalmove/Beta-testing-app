export type ReviewSender = { id?: string; frameId?: number; tab?: { id?: number }; url?: string };
export type StoredReviewContext = { id: string; title: string; course_url: string; parent_activity_url: string };
export type FrameReviewContext = { course_id: string; course_title: string; parent_activity_url: string };
import type { FrameCapabilities } from "./frame-coordinator.ts";

export type ContextMessage =
  | { type: "GET_REVIEW_CONTEXT" | "REVIEW_FRAME_READY" | "GET_REVIEW_FRAME_STATUS" }
  | { type: "REGISTER_REVIEW_FRAME"; capabilities: FrameCapabilities }
  | { type: "RENEW_REVIEW_FRAME_LEASE" | "ACK_REVIEW_FRAME_DORMANT"; generation: number };

type ReadyFrame = { origin: string; readyAt: number };
type Entry = StoredReviewContext & { extensionId: string; lastActivityAt: number; readyFrames: Map<number, ReadyFrame> };

export function validateContextMessage(message: unknown): ContextMessage {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid review context message");
  const record = message as Record<string, unknown>;
  if (["GET_REVIEW_CONTEXT", "REVIEW_FRAME_READY", "GET_REVIEW_FRAME_STATUS"].includes(record.type as string)) {
    if (Object.keys(record).length !== 1) throw new Error("Invalid review context message");
    return { type: record.type as "GET_REVIEW_CONTEXT" | "REVIEW_FRAME_READY" | "GET_REVIEW_FRAME_STATUS" };
  }
  if (record.type === "REGISTER_REVIEW_FRAME") {
    if (Object.keys(record).sort().join() !== "capabilities,type" || !record.capabilities || typeof record.capabilities !== "object" || Array.isArray(record.capabilities)) throw new Error("Invalid review context message");
    const capability = record.capabilities as Record<string, unknown>;
    if (Object.keys(capability).sort().join() !== "area,contentBearing,visible,wrapper"
      || typeof capability.contentBearing !== "boolean" || typeof capability.wrapper !== "boolean" || typeof capability.visible !== "boolean"
      || typeof capability.area !== "number" || !Number.isFinite(capability.area) || capability.area < 0) throw new Error("Invalid review context message");
    return { type: record.type, capabilities: capability as FrameCapabilities };
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
    if (sender.frameId !== 0 || typeof tabId !== "number" || typeof sender.id !== "string") return false;
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
