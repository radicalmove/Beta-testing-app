export type EmbeddedAnchor =
  | { anchor_type: "text_highlight"; selected_quote: string; prefix: string; suffix: string }
  | { anchor_type: "visual_pin"; css_selector: string; relative_x: number; relative_y: number };

export type EmbeddedAnchorBinding = {
  tabId: number;
  courseId: string;
  frameId: number;
  workerInstanceId: string;
  generation: number;
  pageUrl: string;
  pageTitle: string;
  parentActivityUrl: string;
  courseUrl: string;
  embeddedLocator: string;
  anchor: EmbeddedAnchor;
};

export type EmbeddedAnchorClaim = EmbeddedAnchorBinding & { createdAt: number; expiresAt: number };
type StoredClaim = EmbeddedAnchorClaim & { anchorDigest: string };

export type EmbeddedAnchorStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

import { validateScormMessage } from "./scorm-protocol.ts";
import type { StoredReviewContext } from "./review-context.ts";

const STORAGE_KEY = "embeddedAnchorCapabilities";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

function exactUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href !== value || value.length > 4096) throw new Error("Invalid embedded capability URL");
  return url;
}

function validateBinding(value: EmbeddedAnchorBinding): void {
  if (!Number.isSafeInteger(value.tabId) || value.tabId < 0 || !Number.isSafeInteger(value.frameId) || value.frameId <= 0
    || !Number.isSafeInteger(value.generation) || value.generation < 1 || !UUID.test(value.courseId) || !UUID.test(value.workerInstanceId)) throw new Error("Invalid embedded capability binding");
  const page = exactUrl(value.pageUrl); void page;
  const parent = exactUrl(value.parentActivityUrl);
  const course = exactUrl(value.courseUrl);
  if (parent.protocol !== "https:" || course.protocol !== "https:" || parent.origin !== course.origin) throw new Error("Parent activity must use the trusted Moodle course origin");
  if (!value.pageTitle.trim() || value.pageTitle !== value.pageTitle.trim() || value.pageTitle.length > 512
    || value.embeddedLocator.length > 2048 || /[\u0000-\u001f\u007f]/.test(value.embeddedLocator)) throw new Error("Invalid embedded page identity");
  const anchor = value.anchor;
  if (anchor.anchor_type === "text_highlight") {
    if (!anchor.selected_quote.trim() || anchor.selected_quote.length > 20_000 || anchor.prefix.length > 2_000 || anchor.suffix.length > 2_000) throw new Error("Invalid embedded text anchor");
  } else if (anchor.anchor_type === "visual_pin") {
    if (!anchor.css_selector.trim() || anchor.css_selector !== anchor.css_selector.trim() || anchor.css_selector.length > 4_000
      || !Number.isFinite(anchor.relative_x) || anchor.relative_x < 0 || anchor.relative_x > 1
      || !Number.isFinite(anchor.relative_y) || anchor.relative_y < 0 || anchor.relative_y > 1) throw new Error("Invalid embedded pin anchor");
  } else throw new Error("Invalid embedded anchor");
}

function canonicalAnchor(anchor: EmbeddedAnchor): string {
  return anchor.anchor_type === "text_highlight"
    ? JSON.stringify([anchor.anchor_type, anchor.selected_quote, anchor.prefix, anchor.suffix])
    : JSON.stringify([anchor.anchor_type, anchor.css_selector, anchor.relative_x, anchor.relative_y]);
}

function canonicalBinding(binding: EmbeddedAnchorBinding): string {
  return JSON.stringify([
    binding.tabId, binding.courseId, binding.frameId, binding.workerInstanceId, binding.generation,
    binding.pageUrl, binding.pageTitle, binding.parentActivityUrl, binding.courseUrl, binding.embeddedLocator,
    canonicalAnchor(binding.anchor),
  ]);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validStoredClaim(value: unknown, now: number): value is StoredClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as StoredClaim;
  try { validateBinding(claim); } catch { return false; }
  return Number.isFinite(claim.createdAt) && Number.isFinite(claim.expiresAt) && claim.expiresAt > now
    && typeof claim.anchorDigest === "string" && /^[0-9a-f]{64}$/.test(claim.anchorDigest);
}

export class EmbeddedAnchorCapabilities {
  private mutex = Promise.resolve();
  private readonly storage: EmbeddedAnchorStorage;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly randomToken: () => string;

  constructor(storage: EmbeddedAnchorStorage, options: { now?: () => number; ttlMs?: number; maxEntries?: number; randomToken?: () => string } = {}) {
    this.storage = storage;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxEntries = options.maxEntries ?? 100;
    this.randomToken = options.randomToken ?? secureToken;
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutex.then(operation, operation);
    this.mutex = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(now: number): Promise<Record<string, StoredClaim>> {
    const value = (await this.storage.get(STORAGE_KEY))[STORAGE_KEY];
    const records: Record<string, StoredClaim> = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [token, claim] of Object.entries(value as Record<string, unknown>)) if (TOKEN.test(token) && validStoredClaim(claim, now)) records[token] = claim;
    }
    return records;
  }

  private async mutate<T>(operation: (records: Record<string, StoredClaim>, now: number) => Promise<T> | T): Promise<T> {
    return this.serialized(async () => {
      const now = this.now();
      const records = await this.read(now);
      const result = await operation(records, now);
      await this.storage.set({ [STORAGE_KEY]: records });
      return result;
    });
  }

  private prune(records: Record<string, StoredClaim>): void {
    const overflow = Object.entries(records).sort(([, left], [, right]) => left.createdAt - right.createdAt).slice(0, Math.max(0, Object.keys(records).length - this.maxEntries));
    for (const [expired] of overflow) delete records[expired];
  }

  async issue(binding: EmbeddedAnchorBinding): Promise<string> {
    validateBinding(binding);
    const anchorDigest = await sha256(canonicalBinding(binding));
    return this.mutate((records, now) => {
      let token = "";
      for (let attempt = 0; attempt < 4; attempt += 1) {
        token = this.randomToken();
        if (TOKEN.test(token) && !records[token]) break;
        token = "";
      }
      if (!token) throw new Error("Unable to generate embedded capability");
      records[token] = structuredClone({ ...binding, anchorDigest, createdAt: now, expiresAt: now + this.ttlMs });
      this.prune(records);
      return token;
    });
  }

  claim(token: string, expected: { tabId: number; courseId: string }): Promise<EmbeddedAnchorClaim | undefined> {
    if (!TOKEN.test(token)) return Promise.resolve(undefined);
    return this.mutate(async (records) => {
      const claim = records[token];
      if (!claim || claim.tabId !== expected.tabId || claim.courseId !== expected.courseId
        || claim.anchorDigest !== await sha256(canonicalBinding(claim))) return undefined;
      delete records[token];
      const { anchorDigest: _digest, ...result } = claim;
      return result;
    });
  }

  restore(token: string, claim: EmbeddedAnchorClaim): Promise<void> {
    if (!TOKEN.test(token)) return Promise.resolve();
    return this.mutate(async (records, now) => {
      if (!records[token] && claim.expiresAt > now) records[token] = { ...structuredClone(claim), anchorDigest: await sha256(canonicalBinding(claim)) };
      this.prune(records);
    });
  }

  cleanup(): Promise<void> { return this.mutate(() => undefined); }
}

type AnchorSender = { id?: string; tab?: { id?: number }; frameId?: number; url?: string };
type CurrentOwner = { frameId: number; workerInstanceId: string; generation: number } | undefined;

export async function issueEmbeddedAnchorFromWorker(
  message: unknown,
  sender: AnchorSender,
  dependencies: { extensionId: string; context: StoredReviewContext | undefined; currentOwner: CurrentOwner; capabilities: EmbeddedAnchorCapabilities },
): Promise<string> {
  const event = validateScormMessage(message);
  if (event.type !== "SCORM_ANCHOR_CAPTURED") throw new Error("Expected SCORM anchor event");
  if (sender.id !== dependencies.extensionId || typeof sender.tab?.id !== "number" || typeof sender.frameId !== "number" || sender.frameId <= 0) throw new Error("Anchor issuer is not the elected worker");
  const owner = dependencies.currentOwner;
  if (!owner || owner.frameId !== sender.frameId || owner.workerInstanceId !== event.worker_instance_id || owner.generation !== event.generation) throw new Error("Anchor issuer is not the elected worker");
  const context = dependencies.context;
  if (!context || context.id !== event.course_id) throw new Error("Anchor course context mismatch");
  let senderUrl: URL;
  try { senderUrl = new URL(sender.url ?? ""); } catch { throw new Error("Anchor page origin mismatch"); }
  if (senderUrl.origin !== new URL(event.page_url).origin) throw new Error("Anchor page origin mismatch");
  const { page_title, embedded_locator, anchor_type, ...anchorFields } = event.payload;
  const anchor = { anchor_type, ...anchorFields } as EmbeddedAnchor;
  return dependencies.capabilities.issue({
    tabId: sender.tab.id, courseId: event.course_id, frameId: sender.frameId, workerInstanceId: event.worker_instance_id,
    generation: event.generation, pageUrl: event.page_url, pageTitle: page_title,
    parentActivityUrl: context.parent_activity_url, courseUrl: context.course_url, embeddedLocator: embedded_locator, anchor,
  });
}
