export const OPTIONAL_CONTENT_SCRIPT_ID = "moodle-review-optional-frames";

type RegisteredContentScript = { id: string; matches?: string[] };

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

  if (existing.length === 1 && Array.isArray(existing[0]?.matches)
    && JSON.stringify(existing[0].matches) === JSON.stringify(matches)) return;

  if (existing.length > 0) {
    await options.scripting.unregisterContentScripts({ ids: [OPTIONAL_CONTENT_SCRIPT_ID] });
  }
  if (matches.length === 0) return;

  await options.scripting.registerContentScripts([{
    id: OPTIONAL_CONTENT_SCRIPT_ID,
    matches,
    js: ["content.js"],
    allFrames: true,
    runAt: "document_idle",
    persistAcrossSessions: true,
  }]);
}
