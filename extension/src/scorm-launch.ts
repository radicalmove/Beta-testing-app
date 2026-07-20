const POSITIVE_INTEGER = /^[1-9]\d{0,9}$/;
const SAFE_ORGANISATION = /^[A-Za-z0-9._:-]{1,200}$/;
const ALLOWED_MODES = new Set(["normal", "review", "browse"]);

function canonicalOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== value) throw new Error("Invalid Moodle origin");
  return url.origin;
}

function oneField(form: HTMLFormElement, name: string): string | undefined {
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
  return fields.length === 1 ? fields[0]!.value : undefined;
}

export function resolveScormLaunchUrl(document: Document, configuredOrigin: string, expectedCmid: number): string {
  const origin = canonicalOrigin(configuredOrigin);
  if (!Number.isSafeInteger(expectedCmid) || expectedCmid <= 0) throw new Error("Invalid SCORM launch fields");
  const candidates = Array.from(document.querySelectorAll<HTMLFormElement>("form")).filter((form) => {
    if (form.method.toLowerCase() !== "post") return false;
    try {
      const action = new URL(form.action, document.baseURI);
      return action.protocol === "https:" && !action.username && !action.password && action.origin === origin && action.pathname === "/mod/scorm/player.php" && !action.search && !action.hash;
    } catch { return false; }
  });
  if (candidates.length !== 1) throw new Error("Invalid SCORM launch form");
  const form = candidates[0]!;
  const mode = oneField(form, "mode");
  const scoid = oneField(form, "scoid");
  const cm = oneField(form, "cm");
  const currentorg = oneField(form, "currentorg");
  if (!mode || !ALLOWED_MODES.has(mode) || !scoid || !POSITIVE_INTEGER.test(scoid) || !cm || !POSITIVE_INTEGER.test(cm) || Number(cm) !== expectedCmid || !currentorg || !SAFE_ORGANISATION.test(currentorg)) throw new Error("Invalid SCORM launch fields");
  const result = new URL("/mod/scorm/player.php", origin);
  result.searchParams.set("mode", mode);
  result.searchParams.set("scoid", scoid);
  result.searchParams.set("cm", cm);
  result.searchParams.set("currentorg", currentorg);
  return result.href;
}

const CACHE_KEY = "moodleReviewScormLaunches";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ScormLaunchStorage = { get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void> };
type LaunchRecord = { courseId: string; configuredOrigin: string; cmid: number; packageRoot: string; playerUrl: string; createdAt: number; expiresAt: number };

export function packageRootFromScormUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid SCORM package root");
  const match = url.pathname.match(/^(\/pluginfile\.php\/\d+\/mod_scorm\/[^/]+\/\d+\/scormcontent\/)/);
  if (!match) throw new Error("Invalid SCORM package root");
  return `${url.origin}${match[1]}`;
}

function validPlayerUrl(value: string, origin: string, cmid: number): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.origin === origin && url.pathname === "/mod/scorm/player.php" && !url.hash
      && ALLOWED_MODES.has(url.searchParams.get("mode") ?? "") && POSITIVE_INTEGER.test(url.searchParams.get("scoid") ?? "")
      && url.searchParams.get("cm") === String(cmid) && SAFE_ORGANISATION.test(url.searchParams.get("currentorg") ?? "")
      && Array.from(url.searchParams.keys()).sort().join() === "cm,currentorg,mode,scoid" && url.href === value;
  } catch { return false; }
}

export type ScormLaunchRegistration = { type: "REGISTER_SCORM_LAUNCH"; course_id: string; cmid: number; player_url: string };
export function validateScormLaunchRegistration(value: unknown): ScormLaunchRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid SCORM launch registration");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== "cmid,course_id,player_url,type" || record.type !== "REGISTER_SCORM_LAUNCH" || typeof record.course_id !== "string" || !UUID.test(record.course_id)
    || typeof record.cmid !== "number" || !Number.isSafeInteger(record.cmid) || record.cmid <= 0 || typeof record.player_url !== "string") throw new Error("Invalid SCORM launch registration");
  let origin: string; try { origin = new URL(record.player_url).origin; } catch { throw new Error("Invalid SCORM launch registration"); }
  if (!validPlayerUrl(record.player_url, origin, record.cmid)) throw new Error("Invalid SCORM launch registration");
  return record as ScormLaunchRegistration;
}

function validRecord(value: unknown, now: number): value is LaunchRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<LaunchRecord>;
  if (typeof record.courseId !== "string" || !UUID.test(record.courseId) || typeof record.configuredOrigin !== "string" || typeof record.cmid !== "number" || !Number.isSafeInteger(record.cmid) || record.cmid <= 0
    || typeof record.packageRoot !== "string" || typeof record.playerUrl !== "string" || typeof record.createdAt !== "number" || typeof record.expiresAt !== "number" || record.createdAt > record.expiresAt || record.expiresAt <= now) return false;
  try { return canonicalOrigin(record.configuredOrigin) === record.configuredOrigin && packageRootFromScormUrl(record.packageRoot) === record.packageRoot && new URL(record.packageRoot).origin === record.configuredOrigin && validPlayerUrl(record.playerUrl, record.configuredOrigin, record.cmid); }
  catch { return false; }
}

export class ScormLaunchCache {
  private readonly storage: ScormLaunchStorage;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maximum: number;
  constructor(storage: ScormLaunchStorage, now: () => number = Date.now, ttlMs = 12 * 60 * 60 * 1_000, maximum = 128) { this.storage = storage; this.now = now; this.ttlMs = ttlMs; this.maximum = maximum; }

  private async records(): Promise<LaunchRecord[]> {
    const raw = (await this.storage.get(CACHE_KEY))[CACHE_KEY];
    const records = Array.isArray(raw) ? raw.filter((record): record is LaunchRecord => validRecord(record, this.now())) : [];
    if (!Array.isArray(raw) || records.length !== raw.length) await this.storage.set({ [CACHE_KEY]: records });
    return records;
  }

  async put(input: Omit<LaunchRecord, "createdAt" | "expiresAt">): Promise<void> {
    const now = this.now(); const record: LaunchRecord = { ...input, createdAt: now, expiresAt: now + this.ttlMs };
    if (!validRecord(record, now - 1)) throw new Error("Invalid SCORM launch cache record");
    const records = (await this.records()).filter((candidate) => !(candidate.courseId === record.courseId && candidate.configuredOrigin === record.configuredOrigin && candidate.packageRoot === record.packageRoot));
    records.push(record); records.sort((left, right) => left.createdAt - right.createdAt);
    await this.storage.set({ [CACHE_KEY]: records.slice(-this.maximum) });
  }

  async get(input: { courseId: string; configuredOrigin: string; packageUrl: string; cmid?: number }): Promise<string | undefined> {
    let packageRoot: string; try { packageRoot = packageRootFromScormUrl(input.packageUrl); } catch { return undefined; }
    const match = (await this.records()).find((record) => record.courseId === input.courseId && record.configuredOrigin === input.configuredOrigin && (input.cmid === undefined || record.cmid === input.cmid) && record.packageRoot === packageRoot);
    return match?.playerUrl;
  }
}
