export type ResolveCoursePayload = { course_url: string; title: string; moodle_course_id?: number };
export type CreateCommentPayload = { course_id: string; page_url: string; page_title: string; body: string; category: string; anchor_type: "text_highlight" | "visual_pin"; selected_quote?: string; prefix?: string; suffix?: string; css_selector?: string; dom_selector?: string; relative_x?: number; relative_y?: number };

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unexpected background error";
}

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function validateCreateCommentMessage(message: unknown): { payload: CreateCommentPayload; screenshot: boolean } {
  const invalid = (): never => { throw new Error("Invalid CREATE_COMMENT message"); };
  if (!message || typeof message !== "object" || Array.isArray(message)) return invalid();
  const record = message as Record<string, unknown>;
  if (record.type !== "CREATE_COMMENT" || Object.keys(record).some((key) => !["type", "payload", "screenshot"].includes(key)) || (own(record, "screenshot") && typeof record.screenshot !== "boolean")) return invalid();
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return invalid();
  const payload = record.payload as Record<string, unknown>;
  const allowed = ["course_id", "page_url", "page_title", "body", "category", "anchor_type", "selected_quote", "prefix", "suffix", "css_selector", "dom_selector", "relative_x", "relative_y"];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) return invalid();
  const stringLimits: Record<string, number> = { selected_quote: 20000, prefix: 2000, suffix: 2000, css_selector: 4000, dom_selector: 4000 };
  for (const [key, limit] of Object.entries(stringLimits)) if (own(payload, key) && (typeof payload[key] !== "string" || (payload[key] as string).length > limit)) return invalid();
  if (typeof payload.course_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.course_id)) return invalid();
  let page: URL; try { page = new URL(payload.page_url as string); } catch { return invalid(); }
  if (!["http:", "https:"].includes(page.protocol) || page.username || page.password || page.hash || page.href !== payload.page_url || page.href.length > 4096) return invalid();
  for (const [key, max] of [["page_title", 512], ["body", 10000]] as const) if (typeof payload[key] !== "string" || !payload[key].trim() || payload[key].length > max) return invalid();
  const categories = ["language_grammar", "learning_design_content_flow", "accessibility", "technical_link_media_interaction", "assessment", "general"];
  if (typeof payload.category !== "string" || !categories.includes(payload.category)) return invalid();
  if (payload.anchor_type === "text_highlight") {
    if (typeof payload.selected_quote !== "string" || !payload.selected_quote.trim() || (typeof payload.prefix !== "string" && typeof payload.suffix !== "string" && typeof payload.css_selector !== "string")) return invalid();
  } else if (payload.anchor_type === "visual_pin") {
    if (typeof payload.css_selector !== "string" || !payload.css_selector || typeof payload.relative_x !== "number" || typeof payload.relative_y !== "number" || payload.relative_x < 0 || payload.relative_x > 1 || payload.relative_y < 0 || payload.relative_y > 1) return invalid();
  } else return invalid();
  return { payload: payload as CreateCommentPayload, screenshot: record.screenshot === true };
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
