export const OPTIONAL_CONTENT_SCRIPT_ID = "moodle-review-optional-frames";

type RegisteredContentScript = {
  id: string;
  matches?: string[];
  js?: string[];
  allFrames?: boolean;
  matchOriginAsFallback?: boolean;
  runAt?: string;
  persistAcrossSessions?: boolean;
};

const desiredRegistration = (matches: string[]) => ({
  id: OPTIONAL_CONTENT_SCRIPT_ID,
  matches,
  js: ["content.js"],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: "document_idle",
  persistAcrossSessions: true,
});

type ScriptingApi = {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<RegisteredContentScript[]>;
  registerContentScripts(scripts: unknown[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
};

export async function reconcileOptionalContentScript(options: {
  optionalPatterns: string[];
  grantedOrigins: string[];
  scripting: ScriptingApi;
}): Promise<void> {
  const granted = new Set(options.grantedOrigins);
  const matches = options.optionalPatterns.filter((pattern) => granted.has(pattern));
  const existing = await options.scripting.getRegisteredContentScripts({ ids: [OPTIONAL_CONTENT_SCRIPT_ID] });
  const desired = desiredRegistration(matches);

  if (existing.length === 1) {
    const current = existing[0];
    const unchanged = JSON.stringify(current.matches) === JSON.stringify(desired.matches)
      && JSON.stringify(current.js) === JSON.stringify(desired.js)
      && current.allFrames === desired.allFrames
      && current.matchOriginAsFallback === desired.matchOriginAsFallback
      && current.runAt === desired.runAt
      && current.persistAcrossSessions === desired.persistAcrossSessions;
    if (unchanged) return;
  }

  if (existing.length > 0) {
    await options.scripting.unregisterContentScripts({ ids: [OPTIONAL_CONTENT_SCRIPT_ID] });
  }
  if (matches.length === 0) return;

  await options.scripting.registerContentScripts([desired]);
}
