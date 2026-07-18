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
