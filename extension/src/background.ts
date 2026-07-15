import { ApiClient, authenticate, getActiveToken, lookupReviewCourse, redeemReviewerInvitation, renewReviewerDevice, resumeReviewerMembership, type SessionToken } from "./api";
import { authorizeAuthenticateSender, authorizeResolveSender, handleCreateCommentBridge, handleCreateEmbeddedCommentBridge, handleDeleteCommentBridge, handleListCourseCommentsBridge, handleListPageCommentsBridge, handleResolveCourseBridge, normalizeErrorMessage, validateAuthenticateMessage, validateCancelScreenshotMessage, validateUploadScreenshotMessage, validateViewerResponse, type CreateCommentPayload, type ResolveCoursePayload } from "./background-bridge.ts";
import { EmbeddedAnchorCapabilities, issueEmbeddedAnchorFromWorker } from "./embedded-anchor-capabilities.ts";
import { validateScreenshotDataUrl } from "./screenshot-validation.ts";
import { optionalPatternForOrigin, reconcileOptionalContentScript, requestOptionalFramePermission } from "./optional-content-scripts";
import { matchesCurrentNavigationDocument, ReviewContextCache, validateContextMessage, type ReviewSender, type StoredReviewContext } from "./review-context.ts";
import { ScreenshotCapabilities } from "./screenshot-capabilities.ts";
import { PendingAccessStore, PendingApprovalManager } from "./pending-access.ts";
import { FrameCoordinatorRuntime } from "./frame-coordination-runtime.ts";
import { validateScormMessage, type ScormCommand, type ScormEvent } from "./scorm-protocol.ts";

declare const chrome: any;
declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];
declare const __REVIEW_SERVICE_ORIGIN__: string;

const DEFAULT_SERVICE_ORIGIN = __REVIEW_SERVICE_ORIGIN__;

let optionalRegistration = Promise.resolve();
const reviewContexts = new ReviewContextCache();
const latestWorkerEvent = new Map<number, ScormEvent>();
const seenWorkerEventIds = new Map<number, Set<string>>();
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
    chrome.tabs.sendMessage(tabId, {
      type: "REVIEW_WORKER_READY",
      frame_id: frameId,
      worker_instance_id: workerInstanceId,
      generation,
      replaced,
    }, { frameId: 0 }, () => void chrome.runtime.lastError);
  },
});
const screenshotCapabilities = new ScreenshotCapabilities(chrome.storage.session);
const embeddedAnchorCapabilities = new EmbeddedAnchorCapabilities(chrome.storage.session);
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
chrome.permissions.onRemoved.addListener(() => {
  refreshOptionalContentScript();
  void chrome.storage.session.remove("embeddedAnchorCapabilities");
  for (const tabId of latestWorkerEvent.keys()) {
    chrome.tabs.sendMessage(tabId, { type: "SCORM_PERMISSION_REVOKED" }, { frameId: 0 }, () => void chrome.runtime.lastError);
    latestWorkerEvent.delete(tabId); seenWorkerEventIds.delete(tabId); frameCoordination.removeTab(tabId);
    const context = reviewContexts.exportTab(tabId); if (context) frameCoordination.bindCourse(tabId, context.id);
  }
});

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

chrome.tabs?.onRemoved?.addListener((tabId: number) => { latestWorkerEvent.delete(tabId); seenWorkerEventIds.delete(tabId); reviewContexts.removeTab(tabId); frameCoordination.removeTab(tabId); void chrome.storage.session.remove(`reviewContext:${tabId}`); });
chrome.tabs?.onRemoved?.addListener((tabId: number) => chrome.storage.session.remove(`commentNavigation:${tabId}`));
chrome.webNavigation?.onCommitted?.addListener((details: { tabId: number; frameId: number }) => { if (details.frameId === 0) { latestWorkerEvent.delete(details.tabId); seenWorkerEventIds.delete(details.tabId); reviewContexts.removeTab(details.tabId); frameCoordination.removeTab(details.tabId); void chrome.storage.session.remove(`reviewContext:${details.tabId}`); } });

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
      // requestOptionalFramePermission invokes chrome.permissions.request before any await.
      operation = requestOptionalFramePermission(sender, record.origin, {
        optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, request: (origins) => chrome.permissions.request({ origins }),
      }).then(async (granted) => {
        if (!granted) return { granted: false };
        await optionalRegistration; refreshOptionalContentScript(); await optionalRegistration;
        try { await chrome.scripting.executeScript({ target: { tabId: sender.tab!.id!, allFrames: true }, files: ["content.js"] }); return { granted: true, reload_required: false }; }
        catch { return { granted: true, reload_required: true }; }
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
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "LIST_SAVED_REVIEWERS") {
    operation = (async () => {
      if (!await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) })) throw new Error("Unauthorized access sender");
      const value = message as { type?: unknown; course_handle?: unknown };
      if (Object.keys(value).sort().join(",") !== "course_handle,type" || typeof value.course_handle !== "string") throw new Error("Invalid saved reviewer request");
      const reviewers = new Set<string>();
      const pending = await pendingAccess.get(value.course_handle); if (pending) reviewers.add(pending.email);
      const saved = await chrome.storage.local.get(["deviceCourseHandle", "reviewerEmail"]);
      if (saved.deviceCourseHandle === value.course_handle && typeof saved.reviewerEmail === "string") reviewers.add(saved.reviewerEmail.trim().toLowerCase());
      return Array.from(reviewers).sort().map((email) => ({ email, label: email }));
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
          }
        }
        return resolved;
      },
    });
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "SCORM_TOP_COMMAND") {
    operation = (async () => {
      const record = message as Record<string, unknown>;
      if (Object.keys(record).sort().join() !== "command_type,payload,request_id,type" || typeof sender.tab?.id !== "number" || sender.frameId !== 0
        || typeof record.request_id !== "string" || typeof record.command_type !== "string" || !["SCORM_START_SELECTION", "SCORM_START_MARKER", "SCORM_CANCEL_MARKER", "SCORM_SET_COMMENTS"].includes(record.command_type)) throw new Error("Invalid top SCORM command");
      if (!await authorizeAuthenticateSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, hasPermission: async () => false })) throw new Error("Unauthorized top SCORM command");
      const tabId = sender.tab.id; const owner = frameCoordination.currentOwner(tabId); const courseId = reviewContexts.courseId(sender); const state = latestWorkerEvent.get(tabId);
      if (!owner || !courseId || !state || state.worker_instance_id !== owner.workerInstanceId || state.generation !== owner.generation) throw new Error("SCORM worker is not ready");
      const command = validateScormMessage({ protocol: 1, type: record.command_type, request_id: record.request_id, worker_instance_id: owner.workerInstanceId, generation: owner.generation, course_id: courseId, page_url: state.page_url, payload: record.payload }) as ScormCommand;
      return frameCoordination.sendCommand(tabId, command);
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
      const event = validateScormMessage(message) as ScormEvent; rememberWorkerEvent(sender.tab.id, event.request_id); latestWorkerEvent.set(sender.tab.id, event);
      chrome.tabs.sendMessage(sender.tab.id, { type: "SCORM_WORKER_EVENT", event: message, capability }, { frameId: 0 }, () => void chrome.runtime.lastError);
      return { capability };
    })();
  } else if (message && typeof message === "object" && ["SCORM_SELECTION_CHANGED", "SCORM_PAGE_IDENTITY_CHANGED", "SCORM_COMMENTS_CHANGED"].includes((message as { type?: string }).type ?? "")) {
    operation = (async () => {
      if (typeof sender.tab?.id !== "number" || typeof sender.frameId !== "number") throw new Error("Invalid SCORM event sender");
      const event = validateScormMessage(message) as ScormEvent; rememberWorkerEvent(sender.tab.id, event.request_id); const owner = frameCoordination.currentOwner(sender.tab.id); const courseId = reviewContexts.courseId(sender);
      if (!owner || owner.frameId !== sender.frameId || owner.workerInstanceId !== event.worker_instance_id || owner.generation !== event.generation || courseId !== event.course_id) throw new Error("Stale SCORM event");
      latestWorkerEvent.set(sender.tab.id, event);
      chrome.tabs.sendMessage(sender.tab.id, { type: "SCORM_WORKER_EVENT", event }, { frameId: 0 }, () => void chrome.runtime.lastError);
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
  } else if (message && typeof message === "object" && ["PREPARE_COMMENT_NAVIGATION", "CONSUME_COMMENT_NAVIGATION"].includes((message as { type?: string }).type ?? "")) {
    operation = (async () => { if (typeof sender.tab?.id !== "number" || !(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }))) throw new Error("Unauthorized comment navigation"); const key = `commentNavigation:${sender.tab.id}`; const courseId = reviewContexts.courseId(sender); if (!courseId) throw new Error("Comment navigation course unavailable"); if ((message as { type: string }).type === "PREPARE_COMMENT_NAVIGATION") { const record = message as Record<string, unknown>; if (Object.keys(record).sort().join() !== "comment_id,page_url,type" || typeof record.comment_id !== "string" || !/^[0-9a-f-]{36}$/i.test(record.comment_id) || typeof record.page_url !== "string") throw new Error("Invalid comment navigation"); const url = new URL(record.page_url); const senderUrl = new URL(sender.url!); if (url.protocol !== "https:" || url.origin !== senderUrl.origin) throw new Error("Invalid comment destination"); await chrome.storage.session.set({ [key]: { comment_id: record.comment_id, course_id: courseId, page_url: url.href, created_at: Date.now() } }); return {}; } const stored = (await chrome.storage.session.get(key))[key]; if (!stored || stored.course_id !== courseId || stored.page_url !== sender.url || Date.now() - stored.created_at > 300000) { if (stored) await chrome.storage.session.remove(key); return {}; } await chrome.storage.session.remove(key); return { comment_id: stored.comment_id }; })();
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
      if (!courseId) throw new Error("UPLOAD_SCREENSHOT comment context mismatch");
      const claimed = await screenshotCapabilities.claim(payload.comment_id, sender.tab.id, courseId);
      if (!claimed) throw new Error("UPLOAD_SCREENSHOT comment context mismatch");
      try {
        const decoded = validateScreenshotDataUrl(payload.data_url);
        const bytes = new Uint8Array(decoded.bytes.length); bytes.set(decoded.bytes);
        const extension = decoded.mime === "image/png" ? "png" : decoded.mime === "image/jpeg" ? "jpg" : decoded.mime === "application/pdf" ? "pdf" : decoded.mime === "application/msword" ? "doc" : "docx";
        const form = new FormData(); form.append("file", new Blob([bytes.buffer], { type: decoded.mime }), `review-attachment.${extension}`);
        const api = await client(); const upload = await api.request(`/api/comments/${payload.comment_id}/attachments`, { method: "POST", body: form });
        if (!upload.ok) throw new Error(`Attachment upload failed (${upload.status})`);
        return upload.json();
      } catch (error) { await screenshotCapabilities.restore(payload.comment_id, claimed); throw error; }
    })();
  } else if (message && typeof message === "object" && (message as { type?: unknown }).type === "CANCEL_SCREENSHOT") {
    operation = (async () => {
      const payload = validateCancelScreenshotMessage(message);
      if (typeof sender.tab?.id !== "number" || !(await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) }))) throw new Error("Unauthorized CANCEL_SCREENSHOT sender");
      const courseId = reviewContexts.courseId(sender);
      if (!courseId || !await screenshotCapabilities.cancel(payload.comment_id, sender.tab.id, courseId)) throw new Error("CANCEL_SCREENSHOT comment context mismatch");
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
        return {};
      }
      if (control.type === "REGISTER_REVIEW_FRAME") {
        if (!reviewContexts.obtain(sender) || typeof sender.tab?.id !== "number" || typeof sender.frameId !== "number") throw new Error("Review context unavailable");
        const navigation = await chrome.webNavigation.getAllFrames({ tabId: sender.tab.id }) as Array<{ frameId: number; parentFrameId: number; url: string; documentId?: string }> | null;
        if (!navigation || !matchesCurrentNavigationDocument(sender, navigation)
          || navigation.some((frame) => typeof frame.documentId !== "string" || frame.documentId.length === 0)) throw new Error("Review frame navigation mismatch");
        const authoritativeNavigation = navigation as Array<{ frameId: number; parentFrameId: number; url: string; documentId: string }>;
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
