export const OPTIONAL_CONTENT_SCRIPT_ID = "moodle-review-optional-frames";

export function optionalPatternForOrigin(origin: string, patterns: string[]): string | undefined {
  let candidate: URL; try { candidate = new URL(origin); } catch { return undefined; }
  if (candidate.origin !== origin || candidate.protocol !== "https:") return undefined;
  return patterns.find((pattern) => {
    const match = /^https:\/\/([^/]+)\/\*$/.exec(pattern); if (!match) return false;
    const host = match[1]!;
    return host === candidate.hostname || (host.startsWith("*.") && (candidate.hostname === host.slice(2) || candidate.hostname.endsWith(`.${host.slice(2)}`)));
  });
}

export function requestOptionalFramePermission(
  sender: { frameId?: number }, origin: string,
  dependencies: { optionalPatterns: string[]; request(origins: string[]): Promise<boolean> },
): Promise<boolean> {
  if (sender.frameId !== 0) return Promise.reject(new Error("Permission request must come from frame zero"));
  const pattern = optionalPatternForOrigin(origin, dependencies.optionalPatterns);
  if (!pattern) return Promise.reject(new Error("SCORM origin is not declared by this build"));
  // Deliberately invoke permissions.request in the same user-gesture call stack.
  return dependencies.request([pattern]);
}

export async function grantOptionalFrameAccess(
  sender: { frameId?: number }, tabId: number, origin: string,
  dependencies: {
    optionalPatterns: string[];
    request(origins: string[]): Promise<boolean>;
    grantedOrigins(): Promise<string[]>;
    reconcile(grantedOrigins: string[]): Promise<void>;
    inject(tabId: number, allFrames: true): Promise<void>;
  },
): Promise<{ granted: boolean; reload_required: boolean }> {
  // Keep the permission prompt in the direct user-gesture stack.
  const permission = requestOptionalFramePermission(sender, origin, dependencies);
  if (!await permission) return { granted: false, reload_required: false };
  await dependencies.reconcile(await dependencies.grantedOrigins());
  try { await dependencies.inject(tabId, true); return { granted: true, reload_required: false }; }
  catch { return { granted: true, reload_required: true }; }
}

export async function handleOptionalPermissionRevocation(dependencies: {
  reconcile(): Promise<void>;
  invalidateCapabilities(): Promise<void>;
  invalidateWorkers(): void;
}): Promise<void> {
  await dependencies.reconcile();
  await dependencies.invalidateCapabilities();
  dependencies.invalidateWorkers();
}

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
