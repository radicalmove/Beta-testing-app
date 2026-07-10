export type ReviewSender = { id?: string; frameId?: number; tab?: { id?: number }; url?: string };
export type StoredReviewContext = { id: string; title: string; course_url: string; parent_activity_url: string };
export type FrameReviewContext = { course_id: string; course_title: string; parent_activity_url: string };
export type ContextMessage = { type: "GET_REVIEW_CONTEXT" | "REVIEW_FRAME_READY" | "GET_REVIEW_FRAME_STATUS" };

type Entry = StoredReviewContext & { extensionId: string; registeredAt: number; readyFrames: Set<number> };

export function validateContextMessage(message: unknown): ContextMessage {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid review context message");
  const record = message as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !["GET_REVIEW_CONTEXT", "REVIEW_FRAME_READY", "GET_REVIEW_FRAME_STATUS"].includes(record.type as string)) throw new Error("Invalid review context message");
  return { type: record.type as ContextMessage["type"] };
}

export class ReviewContextCache {
  private readonly entries = new Map<number, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  constructor(ttlMs = 10 * 60_000, now = Date.now) { this.ttlMs = ttlMs; this.now = now; }

  register(sender: ReviewSender, context: StoredReviewContext): boolean {
    const tabId = sender.tab?.id;
    if (sender.frameId !== 0 || typeof tabId !== "number" || typeof sender.id !== "string") return false;
    this.entries.set(tabId, { ...context, extensionId: sender.id, registeredAt: this.now(), readyFrames: new Set() });
    return true;
  }

  obtain(sender: ReviewSender): FrameReviewContext | undefined {
    const entry = this.authorizedEntry(sender, true);
    return entry ? { course_id: entry.id, course_title: entry.title, parent_activity_url: entry.parent_activity_url } : undefined;
  }

  markReady(sender: ReviewSender): boolean {
    const entry = this.authorizedEntry(sender, true);
    if (!entry) return false;
    entry.readyFrames.add(sender.frameId!);
    return true;
  }

  hasReadyFrame(sender: ReviewSender): boolean {
    return (this.authorizedEntry(sender, false)?.readyFrames.size ?? 0) > 0;
  }

  removeTab(tabId: number): void { this.entries.delete(tabId); }

  private authorizedEntry(sender: ReviewSender, requireSubframe: boolean): Entry | undefined {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number" || typeof sender.frameId !== "number" || (requireSubframe ? sender.frameId <= 0 : sender.frameId !== 0)) return undefined;
    const entry = this.entries.get(tabId);
    if (!entry || sender.id !== entry.extensionId) return undefined;
    if (this.now() - entry.registeredAt > this.ttlMs) { this.entries.delete(tabId); return undefined; }
    return entry;
  }
}
