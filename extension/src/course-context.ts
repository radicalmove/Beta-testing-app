export type CourseContext = {
  course_url: string;
  page_url: string;
  title: string;
  pageTitle: string;
  moodle_course_id?: number;
  temporaryIdentity?: string;
};

const DISCARD_PARAMS = new Set(["sesskey", "session", "sessionid", "fbclid", "gclid", "mc_cid", "mc_eid"]);

function isDiscardedParam(name: string): boolean {
  const lower = name.toLowerCase();
  return DISCARD_PARAMS.has(lower) || lower.startsWith("utm_");
}

export function normalizePageUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Course page must use HTTP or HTTPS");
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const name of [...url.searchParams.keys()]) {
    if (isDiscardedParam(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  return url.href;
}

function positiveInteger(value: string | number | null | undefined): number | undefined {
  const text = typeof value === "number" ? String(value) : value?.trim();
  if (!text || !/^[1-9]\d*$/.test(text)) return undefined;
  const result = Number(text);
  return Number.isSafeInteger(result) ? result : undefined;
}

function hashIdentity(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function detectCourseContext(input: {
  url: string;
  title: string;
  pageTitle?: string;
  explicitCourseId?: string | number | null;
  canonicalCourseUrl?: string | null;
}): CourseContext {
  const page_url = normalizePageUrl(input.url);
  const url = new URL(page_url);
  let canonical: URL | undefined;
  if (input.canonicalCourseUrl) {
    try {
      const normalized = normalizePageUrl(new URL(input.canonicalCourseUrl, url).href);
      const candidate = new URL(normalized);
      if (candidate.origin === url.origin && /\/course\/view\.php$/i.test(candidate.pathname)) canonical = candidate;
    } catch { /* Ignore malformed DOM URLs and fall back to a derived boundary. */ }
  }
  const explicit = positiveInteger(input.explicitCourseId);
  const courseParam = positiveInteger(url.searchParams.get("course"));
  const courseViewId = /\/course\/view\.php$/i.test(url.pathname) ? positiveInteger(url.searchParams.get("id")) : undefined;
  const canonicalId = canonical ? positiveInteger(canonical.searchParams.get("id")) : undefined;
  const moodle_course_id = explicit ?? courseParam ?? courseViewId ?? canonicalId;
  const title = input.title.trim() || "Untitled Moodle course";
  const stableTitle = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "untitled";
  const temporaryIdentity = `temporary:${hashIdentity(`${url.origin}\n${title.toLocaleLowerCase()}`)}`;
  const derivedCourseUrl = `${url.origin}/course/temporary/${stableTitle}-${temporaryIdentity.slice(10)}`;
  const course_url = moodle_course_id !== undefined ? `${url.origin}/course/view.php?id=${moodle_course_id}` : canonical?.href ?? derivedCourseUrl;
  const context: CourseContext = { course_url, page_url, title, pageTitle: input.pageTitle?.trim() || title };
  if (moodle_course_id !== undefined) context.moodle_course_id = moodle_course_id;
  else context.temporaryIdentity = temporaryIdentity;
  return context;
}

export function explicitCourseIdFromDocument(document: Document): string | undefined {
  const candidates = [
    document.body?.dataset.courseid,
    document.documentElement.dataset.courseid,
    document.querySelector<HTMLMetaElement>('meta[name="moodle-course-id"], meta[name="course-id"]')?.content,
    Array.from(document.body?.classList ?? []).find((name) => /^course-\d+$/.test(name))?.slice(7),
  ];
  return candidates.find((candidate) => positiveInteger(candidate) !== undefined)?.trim();
}

export function canonicalCourseUrlFromDocument(document: Document): string | undefined {
  const element = document.querySelector<HTMLElement>('[data-course-url], link[rel="course"], a[data-course-link], .breadcrumb a[href*="/course/view.php"]');
  return element?.dataset.courseUrl || element?.getAttribute("href") || undefined;
}
