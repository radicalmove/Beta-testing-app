export type ResolveCoursePayload = { course_url: string; title: string; moodle_course_id?: number };
export type CreateCommentPayload = { course_id: string; page_url: string; page_title: string; body: string; category: string; anchor_type: "text_highlight" | "visual_pin"; selected_quote?: string; prefix?: string; suffix?: string; css_selector?: string; dom_selector?: string; relative_x?: number; relative_y?: number };
export type UploadScreenshotPayload = { comment_id: string; data_url: string };
export type CancelScreenshotPayload = { comment_id: string };
export type PageComment = { id: string; body: string; category: string; status: string; author_user_id: string; author_role: string; author_email: string; page_url: string; page_title: string; anchor_type: "text_highlight" | "visual_pin"; selected_quote: string | null; prefix: string | null; suffix: string | null; css_selector: string | null; dom_selector: string | null; relative_x: number | null; relative_y: number | null; replies: Array<{ id: string; body: string; author_user_id: string; author_role: string; author_email: string }>; status_history: Array<{ status: string; actor_user_id: string; actor_role: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unexpected background error";
}

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function exactHttpUrl(value: unknown, max = 4096): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href === value; } catch { return false; }
}

export function validateListPageCommentsMessage(message: unknown): { page_url: string } {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid LIST_PAGE_COMMENTS message");
  const record = message as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== "page_url,type" || record.type !== "LIST_PAGE_COMMENTS" || !exactHttpUrl(record.page_url)) throw new Error("Invalid LIST_PAGE_COMMENTS message");
  return { page_url: record.page_url };
}

const bounded = (value: unknown, max: number, nullable = false): boolean => (nullable && value === null) || (typeof value === "string" && value.length <= max);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();

export function validatePageCommentsResponse(value: unknown, requestedPageUrl: string): PageComment[] {
  const invalid = (): never => { throw new Error("Invalid page comments response"); };
  if (!Array.isArray(value) || value.length > 500) return invalid();
  const commentKeys = ["id", "body", "category", "status", "author_user_id", "author_role", "author_email", "page_url", "page_title", "anchor_type", "selected_quote", "prefix", "suffix", "css_selector", "dom_selector", "relative_x", "relative_y", "replies", "status_history"];
  const roles = ["beta_tester", "sme", "ld_dcd", "admin"];
  const statuses = ["open", "in_progress", "awaiting_sme", "resolved", "deferred"];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid();
    const row = entry as Record<string, unknown>;
    if (!exactKeys(row, commentKeys) || !uuid.test(row.id as string) || !uuid.test(row.author_user_id as string) || row.page_url !== requestedPageUrl || !exactHttpUrl(row.page_url) || !bounded(row.body, 10000) || !(row.body as string).trim() || !bounded(row.page_title, 512) || !(row.page_title as string).trim() || !bounded(row.author_email, 320) || !roles.includes(row.author_role as string) || !statuses.includes(row.status as string) || !bounded(row.category, 64)) return invalid();
    if (!["text_highlight", "visual_pin"].includes(row.anchor_type as string) || !bounded(row.selected_quote, 20000, true) || !bounded(row.prefix, 2000, true) || !bounded(row.suffix, 2000, true) || !bounded(row.css_selector, 4000, true) || !bounded(row.dom_selector, 4000, true)) return invalid();
    for (const coordinate of [row.relative_x, row.relative_y]) if (coordinate !== null && (typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1)) return invalid();
    if (!Array.isArray(row.replies) || row.replies.length > 1000 || !Array.isArray(row.status_history) || row.status_history.length > 1000) return invalid();
    for (const item of row.replies) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return invalid(); const reply = item as Record<string, unknown>;
      if (!exactKeys(reply, ["id", "body", "author_user_id", "author_role", "author_email"]) || !uuid.test(reply.id as string) || !uuid.test(reply.author_user_id as string) || !bounded(reply.body, 10000) || !roles.includes(reply.author_role as string) || !bounded(reply.author_email, 320)) return invalid();
    }
    for (const item of row.status_history) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return invalid(); const event = item as Record<string, unknown>;
      if (!exactKeys(event, ["status", "actor_user_id", "actor_role"]) || !statuses.includes(event.status as string) || !uuid.test(event.actor_user_id as string) || !roles.includes(event.actor_role as string)) return invalid();
    }
    return row as PageComment;
  });
}

export async function handleListPageCommentsBridge(message: unknown, sender: { id?: string; url?: string }, dependencies: { authorize(sender: { id?: string; url?: string }): Promise<boolean>; courseId(sender: { id?: string; url?: string }): string | undefined; list(courseId: string, pageUrl: string): Promise<unknown> }): Promise<PageComment[]> {
  const { page_url } = validateListPageCommentsMessage(message);
  let senderUrl: URL; try { senderUrl = new URL(sender.url ?? ""); } catch { throw new Error("Unauthorized LIST_PAGE_COMMENTS sender"); }
  if (new URL(page_url).origin !== senderUrl.origin) throw new Error("LIST_PAGE_COMMENTS page origin must match sender origin");
  if (!await dependencies.authorize(sender)) throw new Error("Unauthorized LIST_PAGE_COMMENTS sender");
  const courseId = dependencies.courseId(sender);
  if (!courseId) throw new Error("LIST_PAGE_COMMENTS course context unavailable");
  return validatePageCommentsResponse(await dependencies.list(courseId, page_url), page_url);
}

export function validateCreateCommentMessage(message: unknown): { payload: CreateCommentPayload; screenshotRequested?: true } {
  const invalid = (): never => { throw new Error("Invalid CREATE_COMMENT message"); };
  if (!message || typeof message !== "object" || Array.isArray(message)) return invalid();
  const record = message as Record<string, unknown>;
  if (record.type !== "CREATE_COMMENT" || Object.keys(record).some((key) => !["type", "payload", "screenshot_requested"].includes(key)) || (own(record, "screenshot_requested") && typeof record.screenshot_requested !== "boolean")) return invalid();
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return invalid();
  const payload = record.payload as Record<string, unknown>;
  const common = ["course_id", "page_url", "page_title", "body", "category", "anchor_type"];
  const expected = payload.anchor_type === "text_highlight"
    ? [...common, "selected_quote", "prefix", "suffix"]
    : payload.anchor_type === "visual_pin"
      ? [...common, "css_selector", "relative_x", "relative_y"]
      : [];
  if (!expected.length || Object.keys(payload).length !== expected.length || expected.some((key) => !own(payload, key))) return invalid();
  if (typeof payload.course_id !== "string" || !uuid.test(payload.course_id)) return invalid();
  let page: URL; try { page = new URL(payload.page_url as string); } catch { return invalid(); }
  if (!["http:", "https:"].includes(page.protocol) || page.username || page.password || page.href !== payload.page_url || page.href.length > 4096) return invalid();
  for (const [key, max] of [["page_title", 512], ["body", 10000]] as const) {
    if (typeof payload[key] !== "string") return invalid();
    payload[key] = payload[key].trim();
    if (!payload[key] || (payload[key] as string).length > max) return invalid();
  }
  const categories = ["language_grammar", "learning_design_content_flow", "accessibility", "technical_link_media_interaction", "assessment", "general"];
  if (typeof payload.category !== "string") return invalid();
  const category = payload.category.trim(); payload.category = category;
  if (!categories.includes(category)) return invalid();
  if (payload.anchor_type === "text_highlight") {
    if (typeof payload.selected_quote !== "string" || typeof payload.prefix !== "string" || typeof payload.suffix !== "string") return invalid();
    const selectedQuote = payload.selected_quote.trim(); const prefix = payload.prefix; const suffix = payload.suffix; payload.selected_quote = selectedQuote;
    if (!selectedQuote || selectedQuote.length > 20000 || prefix.length > 2000 || suffix.length > 2000) return invalid();
  } else if (payload.anchor_type === "visual_pin") {
    if (typeof payload.css_selector !== "string" || typeof payload.relative_x !== "number" || typeof payload.relative_y !== "number") return invalid();
    const selector = payload.css_selector.trim(); const relativeX = payload.relative_x; const relativeY = payload.relative_y; payload.css_selector = selector;
    if (!selector || selector.length > 4000 || !Number.isFinite(relativeX) || !Number.isFinite(relativeY) || relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return invalid();
  } else return invalid();
  return { payload: payload as CreateCommentPayload, ...(record.screenshot_requested === true ? { screenshotRequested: true as const } : {}) };
}

export function validateUploadScreenshotMessage(message: unknown): UploadScreenshotPayload {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid UPLOAD_SCREENSHOT message");
  const record = message as Record<string, unknown>;
  if (record.type !== "UPLOAD_SCREENSHOT" || Object.keys(record).sort().join() !== "comment_id,data_url,type" || typeof record.comment_id !== "string" || !uuid.test(record.comment_id) || typeof record.data_url !== "string") throw new Error("Invalid UPLOAD_SCREENSHOT message");
  return { comment_id: record.comment_id, data_url: record.data_url };
}

export function validateCancelScreenshotMessage(message: unknown): CancelScreenshotPayload {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid CANCEL_SCREENSHOT message");
  const record = message as Record<string, unknown>;
  if (record.type !== "CANCEL_SCREENSHOT" || Object.keys(record).sort().join() !== "comment_id,type" || typeof record.comment_id !== "string" || !uuid.test(record.comment_id)) throw new Error("Invalid CANCEL_SCREENSHOT message");
  return { comment_id: record.comment_id };
}

export async function handleCreateCommentBridge(
  message: unknown,
  sender: { id?: string; url?: string },
  dependencies: {
    authorize(sender: { id?: string; url?: string }): Promise<boolean>;
    contextMatches?(sender: { id?: string; url?: string }, courseId: string): boolean;
    create(payload: CreateCommentPayload, screenshotRequested: boolean): Promise<unknown>;
  },
): Promise<unknown> {
  const validated = validateCreateCommentMessage(message);
  let senderUrl: URL;
  try { senderUrl = new URL(sender.url ?? ""); } catch { throw new Error("Unauthorized CREATE_COMMENT sender"); }
  if (new URL(validated.payload.page_url).origin !== senderUrl.origin) throw new Error("CREATE_COMMENT page origin must match sender origin");
  if (!await dependencies.authorize(sender)) throw new Error("Unauthorized CREATE_COMMENT sender");
  if (dependencies.contextMatches?.(sender, validated.payload.course_id) !== true) throw new Error("CREATE_COMMENT course context mismatch");
  return dependencies.create(validated.payload, validated.screenshotRequested === true);
}

export function validateResolveCourseMessage(message: unknown): ResolveCoursePayload {
  const invalid = () => { throw new Error("Invalid RESOLVE_COURSE message"); };
  if (!message || typeof message !== "object" || Array.isArray(message)) return invalid();
  const record = message as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["type", "payload"].includes(key)) || record.type !== "RESOLVE_COURSE" || !record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return invalid();
  const payload = record.payload as Record<string, unknown>;
  if (Object.keys(payload).some((key) => !["course_url", "title", "moodle_course_id"].includes(key))) return invalid();
  if (typeof payload.course_url !== "string" || payload.course_url.length > 2048 || typeof payload.title !== "string" || payload.title.trim() !== payload.title || payload.title.length < 1 || payload.title.length > 200 || /[\u0000-\u001f\u007f]/.test(payload.title)) return invalid();
  let url: URL;
  try { url = new URL(payload.course_url); } catch { return invalid(); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.href !== payload.course_url) return invalid();
  if (own(payload, "moodle_course_id") && (typeof payload.moodle_course_id !== "number" || !Number.isSafeInteger(payload.moodle_course_id) || payload.moodle_course_id < 1)) return invalid();
  return { course_url: payload.course_url, title: payload.title, ...(own(payload, "moodle_course_id") ? { moodle_course_id: payload.moodle_course_id as number } : {}) };
}

function matches(url: string, pattern: string): boolean {
  const match = /^(\*|http|https):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match) return false;
  const candidate = new URL(url);
  const host = match[2];
  const hostMatches = host === "*" || (host.startsWith("*.") ? candidate.hostname === host.slice(2) || candidate.hostname.endsWith(`.${host.slice(2)}`) : candidate.hostname === host);
  const path = match[3].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return (match[1] === "*" ? ["http:", "https:"].includes(candidate.protocol) : candidate.protocol === `${match[1]}:`) && hostMatches && new RegExp(`^${path}$`).test(`${candidate.pathname}${candidate.search}${candidate.hash}`);
}

export async function authorizeResolveSender(sender: { id?: string; url?: string }, options: { extensionId: string; moodlePatterns: string[]; optionalPatterns: string[]; hasPermission(pattern: string): Promise<boolean> }): Promise<boolean> {
  if (sender.id !== options.extensionId || typeof sender.url !== "string") return false;
  try {
    if (options.moodlePatterns.some((pattern) => matches(sender.url!, pattern))) return true;
    for (const pattern of options.optionalPatterns) if (matches(sender.url, pattern) && await options.hasPermission(pattern)) return true;
  } catch { return false; }
  return false;
}

export async function handleResolveCourseBridge(
  message: unknown,
  sender: { id?: string; url?: string },
  dependencies: { authorize(sender: { id?: string; url?: string }): Promise<boolean>; resolve(payload: ResolveCoursePayload): Promise<unknown> },
): Promise<unknown> {
  const payload = validateResolveCourseMessage(message);
  let senderUrl: URL;
  try { senderUrl = new URL(sender.url ?? ""); } catch { throw new Error("Unauthorized RESOLVE_COURSE sender"); }
  const courseUrl = new URL(payload.course_url);
  if (courseUrl.origin !== senderUrl.origin) throw new Error("RESOLVE_COURSE course origin must match sender origin");
  if (!await dependencies.authorize(sender)) throw new Error("Unauthorized RESOLVE_COURSE sender");
  return dependencies.resolve(payload);
}
