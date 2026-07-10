export type ResolveCoursePayload = { course_url: string; title: string; moodle_course_id?: number };

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

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
  if (!await dependencies.authorize(sender)) throw new Error("Unauthorized RESOLVE_COURSE sender");
  return dependencies.resolve(payload);
}
