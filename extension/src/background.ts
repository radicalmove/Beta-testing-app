import { ApiClient, authenticate, findCourseReviewer, getActiveToken, lookupReviewCourse, redeemReviewerInvitation, renewReviewerDevice, resumeReviewerMembership, signInExistingReviewer, type SessionToken } from "./api";
import { authorizeAuthenticateSender, authorizeResolveSender, handleCreateCommentBridge, handleCreateEmbeddedCommentBridge, handleDeleteCommentBridge, handleListCourseCommentsBridge, handleListPageCommentsBridge, handleResolveCourseBridge, normalizeErrorMessage, validateAuthenticateMessage, validateCancelScreenshotMessage, validatePageCommentsResponse, validateUploadScreenshotMessage, validateViewerResponse, type CreateCommentPayload, type ResolveCoursePayload } from "./background-bridge.ts";
import { EmbeddedCommentNavigation, handleCommentNavigationMessage } from "./embedded-comment-navigation.ts";
import { EmbeddedAnchorCapabilities, issueEmbeddedAnchorFromWorker } from "./embedded-anchor-capabilities.ts";
import { validateScreenshotDataUrl } from "./screenshot-validation.ts";
import { grantOptionalFrameAccess, handleOptionalPermissionRevocation, optionalPatternForOrigin, reconcileOptionalContentScript } from "./optional-content-scripts";
import { authoritativeNavigationFor, ReviewContextCache, validateContextMessage, type ReviewSender, type StoredReviewContext } from "./review-context.ts";
import { ScreenshotCapabilities } from "./screenshot-capabilities.ts";
import { PendingAccessStore, PendingApprovalManager } from "./pending-access.ts";
import { FrameCoordinatorRuntime, workerReadyMatchesState, type WorkerReadyNotification } from "./frame-coordination-runtime.ts";
import { validateScormMessage, type ScormCommand, type ScormEvent } from "./scorm-protocol.ts";
import { packageRootFromScormUrl, ScormLaunchCache, validateScormLaunchRegistration } from "./scorm-launch.ts";

declare const chrome: any;
declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const __REVIEW_SERVICE_ORIGIN__: string;

const DEFAULT_SERVICE_ORIGIN = __REVIEW_SERVICE_ORIGIN__;

let optionalRegistration = Promise.resolve();
const reviewContexts = new ReviewContextCache();
const latestWorkerEvent = new Map<number, ScormEvent>();
const pendingWorkerReady = new Map<number, WorkerReadyNotification>();
const seenWorkerEventIds = new Map<number, Set<string>>();
const workerProjections = new Map<number, { pageUrl: string; commentIds: Set<string> }>();
function rememberWorkerEvent(tabId: number, requestId: string): void {
  const seen = seenWorkerEventIds.get(tabId) ?? new Set<string>();
  if (seen.has(requestId)) throw new Error("Duplicate SCORM event request id");
  seen.add(requestId); if (seen.size > 256) seen.delete(seen.values().next().value!); seenWorkerEventIds.set(tabId, seen);
}
const frameCoordination = new FrameCoordinatorRuntime({
  send: (tabId, frameId, message) => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response: unknown) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(response as { ok?: boolean; dormant?: boolean; worker_instance_id?: string; generation?: number } | undefined);
    });
  }),
  onWorkerReady: ({ tabId, frameId, workerInstanceId, generation, replaced }) => {
    pendingWorkerReady.set(tabId, { tabId, frameId, workerInstanceId, generation, replaced });
  },
});

function publishWorkerReady(tabId: number): boolean {
  const ready = pendingWorkerReady.get(tabId); const state = latestWorkerEvent.get(tabId);
  if (!workerReadyMatchesState(ready, state)) return false;
  pendingWorkerReady.delete(tabId);
  chrome.tabs.sendMessage(tabId, { type: "REVIEW_WORKER_READY", frame_id: ready.frameId, worker_instance_id: ready.workerInstanceId, generation: ready.generation, replaced: ready.replaced }, { frameId: 0 }, () => void chrome.runtime.lastError);
  resumeEmbeddedNavigation(tabId);
  return true;
}
const screenshotCapabilities = new ScreenshotCapabilities(chrome.storage.session);
const embeddedAnchorCapabilities = new EmbeddedAnchorCapabilities(chrome.storage.session);
const scormLaunchCache = new ScormLaunchCache(chrome.storage.session);
const cacheScormLaunchForEvent = async (tabId: number, event: ScormEvent) => {
  const context = reviewContexts.exportTab(tabId); if (!context) return;
  let player: URL; try { player = new URL(context.parent_activity_url); } catch { return; }
  const cmid = Number(player.searchParams.get("cm")); if (!Number.isSafeInteger(cmid) || cmid <= 0) return;
  try { await scormLaunchCache.put({ courseId: context.id, configuredOrigin: new URL(context.course_url).origin, cmid, packageRoot: packageRootFromScormUrl(event.page_url), playerUrl: context.parent_activity_url }); } catch { /* non-package worker events are not cacheable */ }
};
const navigationCommand = async (tabId: number, type: "SCORM_ACTIVATE_COVER" | "SCORM_APPLY_LOCATOR" | "SCORM_TAKE_TO_CONTEXT", payload: Record<string, string>): Promise<void> => {
  const owner = frameCoordination.currentOwner(tabId); const state = latestWorkerEvent.get(tabId); const context = reviewContexts.exportTab(tabId);
  if (!owner || !state || !context || state.worker_instance_id !== owner.workerInstanceId || state.generation !== owner.generation) throw new Error("SCORM worker is not ready");
  const command = validateScormMessage({ protocol: 1, type, request_id: crypto.randomUUID(), worker_instance_id: owner.workerInstanceId, generation: owner.generation, course_id: context.id, page_url: state.page_url, payload }) as ScormCommand;
  const acknowledgement = await frameCoordination.sendCommand(tabId, command);
  if (!acknowledgement.ok) {
    if (acknowledgement.error_code === "USER_ACTION_REQUIRED") {
      chrome.tabs.sendMessage(tabId, { type: "REVIEW_SCORM_START_REQUIRED" }, { frameId: 0 }, () => void chrome.runtime.lastError);
      throw new Error("Start this lesson using the flashing arrow or Tab+Enter to continue to the comment.");
    }
    throw new Error(acknowledgement.error_code === "COMMENT_NOT_FOUND" ? "Comment projection is not ready" : "SCORM navigation failed");
  }
};
const embeddedNavigation = new EmbeddedCommentNavigation(chrome.storage.session, {
  current: (tabId) => { const context = reviewContexts.exportTab(tabId); const owner = frameCoordination.currentOwner(tabId); const state = latestWorkerEvent.get(tabId); return { courseId: context?.id, topUrl: context?.parent_activity_url ?? "", workerInstanceId: owner?.workerInstanceId, generation: owner?.generation, pageUrl: state?.page_url }; },
  navigateParent: async (tabId, url) => { await chrome.tabs.update(tabId, { url }); },
  activateCover: (tabId) => navigationCommand(tabId, "SCORM_ACTIVATE_COVER", {}),
  applyLocator: (tabId, locator) => navigationCommand(tabId, "SCORM_APPLY_LOCATOR", { embedded_locator: locator }),
  projectionContains: (tabId, commentId, pageUrl) => { const projection = workerProjections.get(tabId); return projection?.pageUrl === pageUrl && projection.commentIds.has(commentId); },
  takeToContext: (tabId, commentId) => navigationCommand(tabId, "SCORM_TAKE_TO_CONTEXT", { comment_id: commentId }),
});
const resumeEmbeddedNavigation = (tabId: number) => void embeddedNavigation.advance(tabId).catch(() => undefined);
const pendingAccess = new PendingAccessStore(chrome.storage.local);
const pendingApprovals = new PendingApprovalManager(
  pendingAccess,
  (record) => resumeReviewerMembership({ serviceOrigin: DEFAULT_SERVICE_ORIGIN, courseHandle: record.courseHandle, email: record.email, reconnectCode: record.reconnectCredential }),
  async (access, record) => {
    if (!access.session || !access.deviceCredential) return;
    await chrome.storage.session.set(access.session);
    await chrome.storage.local.set({ deviceCredential: access.deviceCredential, deviceCourseHandle: record.courseHandle, reviewerEmail: record.email });
  },
);
let renewalPromise: Promise<string | undefined> | undefined;
void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
void screenshotCapabilities.cleanup().catch((error: Error) => console.error("Unable to clean screenshot capabilities", error));
void embeddedAnchorCapabilities.cleanup().catch((error: Error) => console.error("Unable to clean embedded anchor capabilities", error));

function refreshOptionalContentScript(): void {
  optionalRegistration = optionalRegistration.then(async () => {
    const permissions = await chrome.permissions.getAll();
    await reconcileOptionalContentScript({
      optionalPatterns: __OPTIONAL_FRAME_PATTERNS__,
      grantedOrigins: permissions.origins ?? [],
      scripting: chrome.scripting,
    });
  }).catch((error: Error) => console.error("Unable to refresh optional frame injection", error));
}

refreshOptionalContentScript();
chrome.runtime.onStartup.addListener(refreshOptionalContentScript);
chrome.runtime.onInstalled.addListener(refreshOptionalContentScript);
chrome.permissions.onAdded.addListener(refreshOptionalContentScript);
chrome.permissions.onRemoved.addListener(() => { void handleOptionalPermissionRevocation({
  reconcile: async () => { refreshOptionalContentScript(); await optionalRegistration; },
  invalidateCapabilities: () => chrome.storage.session.remove("embeddedAnchorCapabilities"),
  invalidateWorkers: () => { for (const tabId of new Set([...latestWorkerEvent.keys(), ...pendingWorkerReady.keys()])) {
    chrome.tabs.sendMessage(tabId, { type: "SCORM_PERMISSION_REVOKED" }, { frameId: 0 }, () => void chrome.runtime.lastError);
    latestWorkerEvent.delete(tabId); pendingWorkerReady.delete(tabId); seenWorkerEventIds.delete(tabId); frameCoordination.removeTab(tabId);
    const context = reviewContexts.exportTab(tabId); if (context) frameCoordination.bindCourse(tabId, context.id);
  } },
}).catch((error: Error) => console.error("Unable to revoke optional SCORM access", error)); });

async function serviceOrigin(): Promise<string> {
  return DEFAULT_SERVICE_ORIGIN;
}

async function activeToken(): Promise<string | undefined> {
  let stored = await chrome.storage.session.get(["apiToken", "expiresAt"]) as Partial<SessionToken>;
  if (typeof stored.apiToken !== "string" || typeof stored.expiresAt !== "number") {
    const durable = await chrome.storage.local.get(["courseTeamSession"]); const candidate = durable.courseTeamSession;
    if (candidate && typeof candidate.apiToken === "string" && typeof candidate.expiresAt === "number" && candidate.expiresAt > Date.now()) { stored = candidate; await chrome.storage.session.set(candidate); }
  }
  const session = typeof stored.apiToken === "string" && typeof stored.expiresAt === "number" ? stored as SessionToken : undefined;
  const active = await getActiveToken(session, {
    clearToken: async () => { await chrome.storage.session.remove(["apiToken", "expiresAt"]); await chrome.storage.local.remove(["courseTeamSession"]); },
    onSignedOut: () => undefined,
  });
  if (active) return active;
  if (renewalPromise) return renewalPromise;
  renewalPromise = renewStoredDevice();
  try { return await renewalPromise; } finally { renewalPromise = undefined; }
}

async function renewStoredDevice(): Promise<string | undefined> {
  const local = await chrome.storage.local.get(["deviceCredential", "deviceCourseHandle"]);
  if (typeof local.deviceCredential !== "string" || typeof local.deviceCourseHandle !== "string") return undefined;
  try {
    const renewed = await renewReviewerDevice({ serviceOrigin: await serviceOrigin(), courseHandle: local.deviceCourseHandle, deviceCredential: local.deviceCredential });
    if (!renewed.session || !renewed.deviceCredential) return undefined;
    await chrome.storage.session.set(renewed.session);
    await chrome.storage.local.set({ deviceCredential: renewed.deviceCredential });
    return renewed.session.apiToken;
  } catch {
    // A suspended laptop or temporary Tailscale/server outage must not forget
    // the approved reviewer. Terminal revocation is handled by explicit
    // authenticated renewal outcomes rather than generic connectivity errors.
    return undefined;
  }
}

async function resolveCourse(payload: ResolveCoursePayload): Promise<unknown> {
  const client = new ApiClient({
    serviceOrigin: await serviceOrigin(),
    getToken: activeToken,
    clearToken: () => chrome.storage.session.remove(["apiToken", "expiresAt"]),
    onSignedOut: () => undefined,
  });
  const response = await client.request("/api/courses/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 403) throw new Error("Account pending approval");
  if (!response.ok) throw new Error(`Course resolution failed (${response.status})`);
  return response.json();
}

function client(): Promise<ApiClient> {
  return serviceOrigin().then((origin) => new ApiClient({ serviceOrigin: origin, getToken: activeToken, clearToken: () => chrome.storage.session.remove(["apiToken", "expiresAt"]), onSignedOut: () => undefined }));
}

async function createComment(payload: CreateCommentPayload): Promise<unknown> {
  const api = await client();
  const response = await api.request("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (response.status === 403) throw new Error("Account pending approval");
  if (!response.ok) throw new Error(`Comment creation failed (${response.status})`);
  return response.json();
}

async function listPageComments(courseId: string, pageUrl: string): Promise<unknown> {
  const api = await client();
  const query = new URLSearchParams({ course_id: courseId, page_url: pageUrl });
  const response = await api.request(`/api/comments?${query.toString()}`);
  if (response.status === 403) throw new Error("Account pending approval");
  if (!response.ok) throw new Error(`Comment list failed (${response.status})`);
  return response.json();
}
async function listCourseComments(courseId: string): Promise<unknown> {
  const api = await client(); const response = await api.request(`/api/comments?${new URLSearchParams({ course_id: courseId })}`);
  if (!response.ok) throw new Error(`Course comment list failed (${response.status})`); return response.json();
}

async function currentViewer(courseId: string): Promise<unknown> {
  const api = await client();
  const response = await api.request(`/api/me?${new URLSearchParams({ course_id: courseId })}`);
  if (!response.ok) throw new Error(`Viewer identity failed (${response.status})`);
  return validateViewerResponse(await response.json(), courseId);
}

async function deleteComment(commentId: string, _courseId: string): Promise<unknown> {
  const api = await client();
  const response = await api.request(`/api/comments/${commentId}`, { method: "DELETE" });
  if (response.status === 404) throw new Error("Comment was already removed");
  if (response.status === 403) throw new Error("You do not have permission to delete this thread");
  if (!response.ok) throw new Error(`Comment deletion failed (${response.status})`);
  return {};
}

chrome.tabs?.onRemoved?.addListener((tabId: number) => { latestWorkerEvent.delete(tabId); pendingWorkerReady.delete(tabId); seenWorkerEventIds.delete(tabId); workerProjections.delete(tabId); reviewContexts.removeTab(tabId); frameCoordination.removeTab(tabId); void chrome.storage.session.remove(`reviewContext:${tabId}`); });
chrome.tabs?.onRemoved?.addListener((tabId: number) => { embeddedNavigation.cancel(tabId); void chrome.storage.session.remove(`commentNavigation:${tabId}`); });
chrome.webNavigation?.onCommitted?.addListener((details: { tabId: number; frameId: number }) => { if (details.frameId === 0) { latestWorkerEvent.delete(details.tabId); pendingWorkerReady.delete(details.tabId); seenWorkerEventIds.delete(details.tabId); workerProjections.delete(details.tabId); reviewContexts.removeTab(details.tabId); frameCoordination.removeTab(details.tabId); void chrome.storage.session.remove(`reviewContext:${details.tabId}`); } });

chrome.runtime.onMessage.addListener((message: unknown, sender: ReviewSender & { tab?: { id?: number; windowId?: number } }, sendResponse: (value: unknown) => void) => {
  void screenshotCapabilities.cleanup().catch(() => undefined);
  void embeddedAnchorCapabilities.cleanup().catch(() => undefined);
  let operation: Promise<unknown> | undefined;
  if (message && typeof message === "object" && (message as { type?: unknown }).type === "REQUEST_SCORM_PERMISSION") {
    const record = message as Record<string, unknown>;
    let trustedMoodle = false;
    try { trustedMoodle = sender.id === chrome.runtime.id && sender.frameId === 0 && typeof sender.url === "string" && Boolean(optionalPatternForOrigin(new URL(sender.url).origin, __MOODLE_PATTERNS__)); } catch { /* invalid sender URL */ }
    if (Object.keys(record).sort().join() !== "origin,type" || typeof record.origin !== "string" || typeof sender.tab?.id !== "number" || !trustedMoodle) operation = Promise.reject(new Error("Invalid SCORM permission request"));
    else {
      operation = grantOptionalFrameAccess(sender, sender.tab.id, record.origin, {
        optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, request: (origins) => chrome.permissions.request({ origins }),
        grantedOrigins: async () => (await chrome.permissions.getAll()).origins ?? [],
        reconcile: (grantedOrigins) => reconcileOptionalContentScript({ optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, grantedOrigins, scripting: chrome.scripting }),
        inject: (tabId) => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).then(() => undefined),
      });
    }
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "LOOKUP_REVIEW_COURSE") {
    operation = (async () => {
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized course lookup sender");
      const candidate = message as { moodle_origin?: unknown; moodle_course_id?: unknown };
      if (typeof candidate.moodle_origin !== "string" || typeof candidate.moodle_course_id !== "number" || !Number.isInteger(candidate.moodle_course_id)) throw new Error("Invalid course lookup");
      return lookupReviewCourse({ serviceOrigin: await serviceOrigin(), moodleOrigin: candidate.moodle_origin, moodleCourseId: candidate.moodle_course_id });
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "REDEEM_REVIEW_ACCESS") {
    operation = (async () => {
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized access sender");
      const value = message as { course_handle?: unknown; display_name?: unknown; email?: unknown; role?: unknown; invitation_code?: unknown };
      if (![value.course_handle, value.display_name, value.email, value.role, value.invitation_code].every((item) => typeof item === "string")) throw new Error("Invalid reviewer access request");
      const access = await redeemReviewerInvitation({ serviceOrigin: await serviceOrigin(), courseHandle: value.course_handle as string, displayName: value.display_name as string, email: value.email as string, role: value.role as string, invitationCode: value.invitation_code as string });
      if (access.session && access.deviceCredential) {
        await chrome.storage.session.set(access.session);
        await chrome.storage.local.set({ deviceCredential: access.deviceCredential, deviceCourseHandle: value.course_handle, reviewerEmail: value.email });
      } else if (access.state === "pending" && access.reconnectCode) {
        await pendingAccess.save({ courseHandle: value.course_handle as string, email: value.email as string, reconnectCredential: access.reconnectCode });
      }
      return { state: access.state, role: access.role };
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "CHECK_PENDING_REVIEW_ACCESS") {
    operation = (async () => {
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized access sender");
      const value = message as { type?: unknown; course_handle?: unknown };
      if (Object.keys(value).sort().join(",") !== "course_handle,type" || typeof value.course_handle !== "string") throw new Error("Invalid pending access check");
      const pending = await pendingApprovals.check(value.course_handle);
      if (pending.state !== "none") return pending;
      const saved = await chrome.storage.local.get(["deviceCourseHandle"]);
      return saved.deviceCourseHandle === value.course_handle && await activeToken() ? { state: "connected" } : { state: "none" };
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "FIND_APPROVED_REVIEWER") {
    operation = (async () => {
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized access sender");
      const value = message as { type?: unknown; course_handle?: unknown; email?: unknown };
      if (Object.keys(value).sort().join(",") !== "course_handle,email,type" || typeof value.course_handle !== "string" || typeof value.email !== "string") throw new Error("Invalid reviewer lookup request");
      return findCourseReviewer({ serviceOrigin: await serviceOrigin(), courseHandle: value.course_handle, email: value.email });
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "USE_SAVED_REVIEWER") {
    operation = (async () => {
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized access sender");
      const value = message as { type?: unknown; course_handle?: unknown; membership_id?: unknown };
      if (Object.keys(value).sort().join(",") !== "course_handle,membership_id,type" || typeof value.course_handle !== "string" || typeof value.membership_id !== "string") throw new Error("Invalid existing reviewer request");
      const access = await signInExistingReviewer({ serviceOrigin: await serviceOrigin(), courseHandle: value.course_handle, membershipId: value.membership_id });
      if (!access.session || !access.deviceCredential || access.state !== "approved") throw new Error("Unable to verify reviewer access");
      await chrome.storage.session.set(access.session);
      await chrome.storage.local.set({ deviceCredential: access.deviceCredential, deviceCourseHandle: value.course_handle, reviewerMembershipId: value.membership_id });
      return { state: access.state, role: access.role };
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "RESUME_REVIEW_ACCESS") {
    operation = (async () => {
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized access sender");
      const value = message as { course_handle?: unknown; email?: unknown; reconnect_code?: unknown };
      if (![value.course_handle, value.email, value.reconnect_code].every((item) => typeof item === "string")) throw new Error("Invalid reviewer access request");
      const access = await resumeReviewerMembership({ serviceOrigin: await serviceOrigin(), courseHandle: value.course_handle as string, email: value.email as string, reconnectCode: value.reconnect_code as string });
      if (!access.session || !access.deviceCredential) throw new Error("Reviewer access is pending approval");
      await chrome.storage.session.set(access.session);
      await chrome.storage.local.set({ deviceCredential: access.deviceCredential, deviceCourseHandle: value.course_handle, reviewerEmail: value.email });
      return { state: access.state, role: access.role };
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "SIGN_OUT") {
    operation = (async () => {
      if (Object.keys(message as object).join(",") !== "type") throw new Error("Invalid sign-out request");
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized sign-out sender");
      await chrome.storage.session.remove(["apiToken", "expiresAt"]);
      await chrome.storage.local.remove(["courseTeamSession", "deviceCredential", "reviewerMembershipId"]);
      return { state: "signed-out" };
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "AUTHENTICATE") {
    operation = (async () => {
      validateAuthenticateMessage(message);
      if (!await authorizeAuthenticateSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, hasPermission: async () => false })) throw new Error("Unauthorized AUTHENTICATE sender");
      return authenticate({
        serviceOrigin: await serviceOrigin(),
        getRedirectUrl: () => chrome.identity.getRedirectURL(),
        launchWebAuthFlow: (details) => chrome.identity.launchWebAuthFlow(details),
        setSession: async (session: SessionToken) => { await chrome.storage.session.set(session); await chrome.storage.local.set({ courseTeamSession: session }); },
      });
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "RESOLVE_COURSE") {
    operation = handleResolveCourseBridge(message, sender, {
      authorize: (candidate) => authorizeResolveSender(candidate, {
        extensionId: chrome.runtime.id,
        moodlePatterns: __MOODLE_PATTERNS__,
        optionalPatterns: __OPTIONAL_FRAME_PATTERNS__,
        hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }),
      }),
      resolve: async (payload) => {
        const resolved = await resolveCourse(payload) as { id?: unknown; title?: unknown };
        if (typeof resolved?.id === "string" && sender.frameId === 0) {
          const storedContext: StoredReviewContext = {
            id: resolved.id,
            title: typeof resolved.title === "string" && resolved.title.trim() ? resolved.title : payload.title,
            course_url: payload.course_url,
            parent_activity_url: sender.url!,
          };
          reviewContexts.register(sender, storedContext);
          if (typeof sender.tab?.id === "number") {
            frameCoordination.bindCourse(sender.tab.id, resolved.id);
            await chrome.storage.session.set({ [`reviewContext:${sender.tab.id}`]: storedContext });
            resumeEmbeddedNavigation(sender.tab.id);
          }
        }
        return resolved;
      },
    });
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "REGISTER_SCORM_LAUNCH") {
    operation = (async () => {
      const registration = validateScormLaunchRegistration(message);
      if (sender.frameId !== 0 || typeof sender.tab?.id !== "number" || !await authorizeAuthenticateSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, hasPermission: async () => false })) throw new Error("Unauthorized SCORM launch registration");
      const senderOrigin = new URL(sender.url!).origin; const player = new URL(registration.player_url);
      if (player.origin !== senderOrigin || reviewContexts.courseId(sender) !== registration.course_id || !reviewContexts.updateParentActivity(sender, registration.course_id, registration.player_url)) throw new Error("SCORM launch registration context mismatch");
      const stored = reviewContexts.exportTab(sender.tab.id); if (!stored) throw new Error("SCORM launch registration context mismatch");
      await chrome.storage.session.set({ [`reviewContext:${sender.tab.id}`]: stored });
      const workerEvent = latestWorkerEvent.get(sender.tab.id); if (workerEvent) await cacheScormLaunchForEvent(sender.tab.id, workerEvent);
      return {};
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "SCORM_TOP_COMMAND") {
    operation = (async () => {
      const record = message as Record<string, unknown>;
      if (Object.keys(record).sort().join() !== "command_type,payload,request_id,type" || typeof sender.tab?.id !== "number" || sender.frameId !== 0
        || typeof record.request_id !== "string" || typeof record.command_type !== "string" || !["SCORM_START_SELECTION", "SCORM_START_MARKER", "SCORM_CANCEL_MARKER", "SCORM_SET_COMMENTS"].includes(record.command_type)) throw new Error("Invalid top SCORM command");
      if (!await authorizeAuthenticateSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, hasPermission: async () => false })) throw new Error("Unauthorized top SCORM command");
      const tabId = sender.tab.id; const owner = frameCoordination.currentOwner(tabId); const courseId = reviewContexts.courseId(sender); const state = latestWorkerEvent.get(tabId);
      if (!owner || !courseId || !state || state.worker_instance_id !== owner.workerInstanceId || state.generation !== owner.generation) throw new Error("SCORM worker is not ready");
      const command = validateScormMessage({ protocol: 1, type: record.command_type, request_id: record.request_id, worker_instance_id: owner.workerInstanceId, generation: owner.generation, course_id: courseId, page_url: state.page_url, payload: record.payload }) as ScormCommand;
      const acknowledgement = await frameCoordination.sendCommand(tabId, command);
      if (acknowledgement.ok && command.type === "SCORM_SET_COMMENTS") {
        workerProjections.set(tabId, { pageUrl: command.page_url, commentIds: new Set(command.payload.comments.filter((comment) => comment.page_url === command.page_url).map((comment) => comment.id)) });
        resumeEmbeddedNavigation(tabId);
      }
      return acknowledgement;
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "SCORM_ANCHOR_CAPTURED") {
    operation = (async () => {
      if (typeof sender.tab?.id !== "number" || !await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized SCORM anchor sender");
      const capability = await issueEmbeddedAnchorFromWorker(message, sender, {
        extensionId: chrome.runtime.id,
        context: reviewContexts.exportTab(sender.tab.id),
        currentOwner: frameCoordination.currentOwner(sender.tab.id),
        capabilities: embeddedAnchorCapabilities,
      });
      const event = validateScormMessage(message) as ScormEvent; rememberWorkerEvent(sender.tab.id, event.request_id); latestWorkerEvent.set(sender.tab.id, event); await cacheScormLaunchForEvent(sender.tab.id, event);
      chrome.tabs.sendMessage(sender.tab.id, { type: "SCORM_WORKER_EVENT", event: message, capability }, { frameId: 0 }, () => void chrome.runtime.lastError);
      return { capability };
    })();
  } else if (message && typeof message === "object" && ["SCORM_SELECTION_CHANGED", "SCORM_PAGE_IDENTITY_CHANGED", "SCORM_COMMENTS_CHANGED", "SCORM_COMMENT_NAVIGATION_REQUESTED", "SCORM_COVER_ACTIVATED"].includes((message as { type?: string }).type ?? "")) {
    operation = (async () => {
      if (typeof sender.tab?.id !== "number" || typeof sender.frameId !== "number") throw new Error("Invalid SCORM event sender");
      const event = validateScormMessage(message) as ScormEvent; rememberWorkerEvent(sender.tab.id, event.request_id); const owner = frameCoordination.currentOwner(sender.tab.id); const courseId = reviewContexts.courseId(sender);
      if (!owner || owner.frameId !== sender.frameId || owner.workerInstanceId !== event.worker_instance_id || owner.generation !== event.generation || courseId !== event.course_id) throw new Error("Stale SCORM event");
      latestWorkerEvent.set(sender.tab.id, event);
      await cacheScormLaunchForEvent(sender.tab.id, event);
      chrome.tabs.sendMessage(sender.tab.id, { type: "SCORM_WORKER_EVENT", event }, { frameId: 0 }, () => void chrome.runtime.lastError);
      if (event.type === "SCORM_COVER_ACTIVATED") {
        if (await embeddedNavigation.confirmCover(sender.tab.id)) {
          chrome.tabs.sendMessage(sender.tab.id, { type: "REVIEW_SCORM_START_COMPLETE" }, { frameId: 0 }, () => void chrome.runtime.lastError);
          resumeEmbeddedNavigation(sender.tab.id);
        }
      } else if (event.type === "SCORM_PAGE_IDENTITY_CHANGED") resumeEmbeddedNavigation(sender.tab.id);
      return {};
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "CREATE_EMBEDDED_COMMENT") {
    operation = handleCreateEmbeddedCommentBridge(message, sender, {
      extensionId: chrome.runtime.id,
      authorizeMoodle: (candidate) => authorizeAuthenticateSender(candidate, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, hasPermission: async () => false }),
      expectedCourseId: () => reviewContexts.courseId(sender),
      claim: (token, expected) => embeddedAnchorCapabilities.claim(token, expected),
      current: (claim) => {
        const owner = frameCoordination.currentOwner(claim.tabId);
        const context = reviewContexts.exportTab(claim.tabId);
        return owner?.frameId === claim.frameId && owner.workerInstanceId === claim.workerInstanceId && owner.generation === claim.generation
          && context?.id === claim.courseId && context.parent_activity_url === claim.parentActivityUrl && context.course_url === claim.courseUrl;
      },
      restore: (token, claim) => embeddedAnchorCapabilities.restore(token, claim),
      create: async (payload, screenshotRequested) => {
        const result = await createComment(payload) as { id?: unknown };
        if (screenshotRequested && typeof result.id === "string" && typeof sender.tab?.id === "number") {
          try { await screenshotCapabilities.grant(result.id, sender.tab.id, payload.course_id); }
          catch { return { ...result, screenshot_available: false }; }
        }
        return result;
      },
    });
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "CREATE_COMMENT") {
    operation = handleCreateCommentBridge(message, sender, {
      authorize: (candidate) => authorizeResolveSender(candidate, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }),
      contextMatches: (_candidate, courseId) => reviewContexts.matchesCourse(sender, courseId),
      create: async (payload, screenshotRequested) => {
        const result = await createComment(payload) as { id?: unknown };
        if (screenshotRequested && typeof result.id === "string" && typeof sender.tab?.id === "number") {
          try { await screenshotCapabilities.grant(result.id, sender.tab.id, payload.course_id); }
          catch { return { ...result, screenshot_available: false }; }
        }
        return result;
      },
    });
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "LIST_PAGE_COMMENTS") {
    operation = handleListPageCommentsBridge(message, sender, {
      authorize: (candidate) => authorizeResolveSender(candidate, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }),
      courseId: () => reviewContexts.courseId(sender),
      list: listPageComments,
    });
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "LIST_COURSE_COMMENTS") {
    operation = handleListCourseCommentsBridge(message, sender, {
      authorize: (candidate) => authorizeResolveSender(candidate, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }),
      courseId: () => reviewContexts.courseId(sender), list: listCourseComments,
    });
  } else if (message && typeof message === "object" && ["PREPARE_COMMENT_NAVIGATION", "CONSUME_COMMENT_NAVIGATION", "COMPLETE_COMMENT_NAVIGATION"].includes((message as { type?: string }).type ?? "")) {
    operation = handleCommentNavigationMessage(message, sender, {
      extensionId: chrome.runtime.id,
      authorizeMoodle: (candidate) => authorizeAuthenticateSender(candidate, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, hasPermission: async () => false }),
      courseId: (candidate) => reviewContexts.courseId(candidate),
      listCourseComments: async (courseId) => validatePageCommentsResponse(await listCourseComments(courseId)),
      storage: chrome.storage.session,
      navigation: embeddedNavigation,
      recoverScormParent: async (courseId, pageUrl) => {
        const context = typeof sender.tab?.id === "number" ? reviewContexts.exportTab(sender.tab.id) : undefined;
        if (!context || context.id !== courseId) return undefined;
        return scormLaunchCache.get({ courseId, configuredOrigin: new URL(context.course_url).origin, packageUrl: pageUrl });
      },
    });
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "GET_CURRENT_VIEWER") {
    operation = (async () => {
      if (Object.keys(message as object).length !== 1) throw new Error("Invalid GET_CURRENT_VIEWER message");
      if (!(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }))) throw new Error("Unauthorized GET_CURRENT_VIEWER sender");
      const courseId = reviewContexts.courseId(sender);
      if (!courseId) throw new Error("GET_CURRENT_VIEWER course context unavailable");
      return currentViewer(courseId);
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "DELETE_COMMENT_THREAD") {
    operation = handleDeleteCommentBridge(message, sender, {
      authorize: (candidate) => authorizeResolveSender(candidate, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }),
      courseId: () => reviewContexts.courseId(sender),
      remove: deleteComment,
    });
  } else if (message && typeof message === "object" && ["EDIT_COMMENT_THREAD", "REPLY_COMMENT_THREAD"].includes((message as { type?: string }).type ?? "")) {
    operation = (async () => {
      const record = message as Record<string, unknown>; const keys = Object.keys(record).sort().join();
      if (keys !== "body,comment_id,type" || typeof record.comment_id !== "string" || !/^[0-9a-f-]{36}$/i.test(record.comment_id) || typeof record.body !== "string" || !record.body.trim() || record.body.trim().length > 10000) throw new Error("Invalid comment mutation message");
      if (!(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }))) throw new Error("Unauthorized comment mutation sender");
      if (!reviewContexts.courseId(sender)) throw new Error("Comment mutation course context unavailable");
      const api = await client(); const editing = record.type === "EDIT_COMMENT_THREAD"; const response = await api.request(`/api/comments/${record.comment_id}${editing ? "" : "/replies"}`, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: record.body.trim() }) });
      if (!response.ok) throw new Error(`Comment mutation failed (${response.status})`); return response.json();
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "UPDATE_COMMENT_STATUS") {
    operation = (async () => { const record = message as Record<string, unknown>; if (Object.keys(record).sort().join() !== "comment_id,status,type" || typeof record.comment_id !== "string" || !/^[0-9a-f-]{36}$/i.test(record.comment_id) || !["open", "resolved"].includes(record.status as string)) throw new Error("Invalid status update"); if (!(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) || !reviewContexts.courseId(sender)) throw new Error("Status update course context unavailable"); const api = await client(); const response = await api.request(`/api/comments/${record.comment_id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: record.status }) }); if (!response.ok) throw new Error(`Status update failed (${response.status})`); return response.json(); })();
  } else if (message && typeof message === "object" && ["GET_SME_RECIPIENTS", "SET_SME_RECIPIENTS"].includes((message as { type?: string }).type ?? "")) {
    operation = (async () => {
      const record = message as Record<string, unknown>; const setting = record.type === "SET_SME_RECIPIENTS";
      if (typeof record.comment_id !== "string" || !/^[0-9a-f-]{36}$/i.test(record.comment_id) || Object.keys(record).some((key) => !["type", "comment_id", "user_ids"].includes(key)) || (setting && (!Array.isArray(record.user_ids) || record.user_ids.some((id) => typeof id !== "string")))) throw new Error("Invalid SME recipients message");
      if (!(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) || !reviewContexts.courseId(sender)) throw new Error("SME recipients course context unavailable");
      const api = await client(); const response = await api.request(`/api/comments/${record.comment_id}/sme-recipients`, setting ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_ids: record.user_ids }) } : {});
      if (!response.ok) throw new Error(`SME recipients failed (${response.status})`); return response.json();
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "UPLOAD_SCREENSHOT") {
    operation = (async () => {
      const payload = validateUploadScreenshotMessage(message);
      if (typeof sender.tab?.id !== "number" || !(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }))) throw new Error("Unauthorized UPLOAD_SCREENSHOT sender");
      const courseId = reviewContexts.courseId(sender);
      if (!courseId) throw new Error("This course is not connected. Reload the Moodle page and try again.");
      const decoded = validateScreenshotDataUrl(payload.data_url);
      const bytes = new Uint8Array(decoded.bytes.length); bytes.set(decoded.bytes);
      const extension = decoded.mime === "image/png" ? "png" : decoded.mime === "image/jpeg" ? "jpg" : decoded.mime === "application/pdf" ? "pdf" : decoded.mime === "application/msword" ? "doc" : "docx";
      const form = new FormData(); form.append("file", new Blob([bytes.buffer], { type: decoded.mime }), `review-attachment.${extension}`);
      const api = await client(); const upload = await api.request(`/api/comments/${payload.comment_id}/attachments`, { method: "POST", body: form });
      if (!upload.ok) {
        const detail = await upload.json().catch(() => undefined) as { detail?: unknown } | undefined;
        throw new Error(typeof detail?.detail === "string" ? detail.detail : "The file could not be attached. Please try again.");
      }
      await screenshotCapabilities.cancel(payload.comment_id, sender.tab.id, courseId).catch(() => undefined);
      return upload.json();
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "CANCEL_SCREENSHOT") {
    operation = (async () => {
      const payload = validateCancelScreenshotMessage(message);
      if (typeof sender.tab?.id !== "number" || !(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }))) throw new Error("Unauthorized CANCEL_SCREENSHOT sender");
      const courseId = reviewContexts.courseId(sender);
      if (courseId) await screenshotCapabilities.cancel(payload.comment_id, sender.tab.id, courseId).catch(() => undefined);
      return {};
    })();
  } else if (message && typeof message === "object" && ["GET_REVIEW_CONTEXT", "REVIEW_FRAME_READY", "GET_REVIEW_FRAME_STATUS", "REGISTER_REVIEW_FRAME", "RENEW_REVIEW_FRAME_LEASE", "ACK_REVIEW_FRAME_DORMANT"].includes((message as { type?: string }).type ?? "")) {
    operation = (async () => {
      const control = validateContextMessage(message);
      const authorized = await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) });
      if (!authorized) throw new Error("Unauthorized review context sender");
      if (control.type === "GET_REVIEW_CONTEXT") {
        let context = reviewContexts.obtain(sender);
        if (!context && typeof sender.tab?.id === "number") {
          const key = `reviewContext:${sender.tab.id}`;
          const stored = (await chrome.storage.session.get(key))[key] as StoredReviewContext | undefined;
          if (stored && reviewContexts.restoreTab(sender.tab.id, chrome.runtime.id, stored)) {
            frameCoordination.bindCourse(sender.tab.id, stored.id);
            context = reviewContexts.obtain(sender);
          }
        }
        if (!context) throw new Error("Review context unavailable");
        return context;
      }
      if (control.type === "REVIEW_FRAME_READY") {
        if (!reviewContexts.markReady(sender)) throw new Error("Review context unavailable");
        if (typeof sender.tab?.id !== "number" || !publishWorkerReady(sender.tab.id)) throw new Error("SCORM initial state unavailable");
        return {};
      }
      if (control.type === "REGISTER_REVIEW_FRAME") {
        if (!reviewContexts.obtain(sender) || typeof sender.tab?.id !== "number" || typeof sender.frameId !== "number") throw new Error("Review context unavailable");
        const navigation = await chrome.webNavigation.getAllFrames({ tabId: sender.tab.id }) as Array<{ frameId: number; parentFrameId: number; url: string; documentId?: string }> | null;
        const authoritativeNavigation = navigation && authoritativeNavigationFor(sender, navigation);
        if (!authoritativeNavigation) throw new Error("Review frame navigation mismatch");
        const now = Date.now();
        await frameCoordination.registerFrame(sender.tab.id, sender.frameId, sender.documentId!, control.worker_instance_epoch, control.worker_instance_id, control.capabilities, authoritativeNavigation, now);
        setTimeout(() => void frameCoordination.reevaluate(sender.tab!.id!, Date.now()), 260);
        return { registered: true };
      }
      if (control.type === "ACK_REVIEW_FRAME_DORMANT") return { dormant: true };
      if (control.type === "RENEW_REVIEW_FRAME_LEASE") return { valid: frameCoordination.snapshot(sender.tab!.id!).activeFrameIds.includes(sender.frameId!) };
      const activeEmbeddedCount = typeof sender.tab?.id === "number" ? frameCoordination.snapshot(sender.tab.id).activeFrameIds.filter((frameId) => frameId !== 0).length : 0;
      const granted = await chrome.permissions.getAll();
      return { ready_count: reviewContexts.readyFrameCount(sender), ready_origins: reviewContexts.readyOrigins(sender), active_embedded_count: activeEmbeddedCount, granted_optional_patterns: (granted.origins ?? []).filter((pattern: string) => __OPTIONAL_FRAME_PATTERNS__.includes(pattern)) };
    })();
  }
  if (!operation) return false;
  void operation.then((data) => sendResponse({ ok: true, data }), (error: unknown) => {
    const message = normalizeErrorMessage(error);
    const status = message.startsWith("Signed out") ? "signed-out" : message.startsWith("Account pending") ? "pending" : message.includes("cancelled") || message.includes("unexpected redirect") ? "cancelled" : (message.includes("Token exchange") || message.includes("Authentication response")) ? "failed" : "offline";
    sendResponse({ ok: false, status, error: message });
  });
  return true;
});
