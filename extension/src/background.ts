import { ApiClient, authenticate, getActiveToken, type SessionToken } from "./api";
import { authorizeResolveSender, handleCreateCommentBridge, handleListPageCommentsBridge, handleResolveCourseBridge, normalizeErrorMessage, validateCancelScreenshotMessage, validateUploadScreenshotMessage, type CreateCommentPayload, type ResolveCoursePayload } from "./background-bridge.ts";
import { validateScreenshotDataUrl } from "./screenshot-validation.ts";
import { reconcileOptionalContentScript } from "./optional-content-scripts";
import { ReviewContextCache, validateContextMessage, type ReviewSender } from "./review-context.ts";
import { ScreenshotCapabilities } from "./screenshot-capabilities.ts";

declare const chrome: any;
declare const __MOODLE_PATTERNS__: string[];
declare const __OPTIONAL_FRAME_PATTERNS__: string[];

const DEFAULT_SERVICE_ORIGIN = "https://review.example.invalid";

let optionalRegistration = Promise.resolve();
const reviewContexts = new ReviewContextCache();
const screenshotCapabilities = new ScreenshotCapabilities(chrome.storage.session);
void screenshotCapabilities.cleanup().catch((error: Error) => console.error("Unable to clean screenshot capabilities", error));

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
chrome.permissions.onRemoved.addListener(refreshOptionalContentScript);

async function serviceOrigin(): Promise<string> {
  const settings = await chrome.storage.local.get("serviceOrigin");
  return settings.serviceOrigin ?? DEFAULT_SERVICE_ORIGIN;
}

async function activeToken(): Promise<string | undefined> {
  const stored = await chrome.storage.session.get(["apiToken", "expiresAt"]) as Partial<SessionToken>;
  const session = typeof stored.apiToken === "string" && typeof stored.expiresAt === "number" ? stored as SessionToken : undefined;
  return getActiveToken(session, {
    clearToken: () => chrome.storage.session.remove(["apiToken", "expiresAt"]),
    onSignedOut: () => undefined,
  });
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

chrome.tabs?.onRemoved?.addListener((tabId: number) => reviewContexts.removeTab(tabId));
chrome.webNavigation?.onCommitted?.addListener((details: { tabId: number; frameId: number }) => { if (details.frameId === 0) reviewContexts.removeTab(details.tabId); });

chrome.runtime.onMessage.addListener((message: unknown, sender: ReviewSender & { tab?: { id?: number; windowId?: number } }, sendResponse: (value: unknown) => void) => {
  void screenshotCapabilities.cleanup().catch(() => undefined);
  let operation: Promise<unknown> | undefined;
  if (message && typeof message === "object" && (message as { type?: unknown }).type === "AUTHENTICATE") {
    operation = serviceOrigin().then((origin) => authenticate({
      serviceOrigin: origin,
      getRedirectUrl: () => chrome.identity.getRedirectURL(),
      launchWebAuthFlow: (details) => chrome.identity.launchWebAuthFlow(details),
      setSession: (session: SessionToken) => chrome.storage.session.set(session),
    }));
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
        if (typeof resolved?.id === "string" && sender.frameId === 0) reviewContexts.register(sender, {
          id: resolved.id,
          title: typeof resolved.title === "string" && resolved.title.trim() ? resolved.title : payload.title,
          course_url: payload.course_url,
          parent_activity_url: sender.url!,
        });
        return resolved;
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
        const form = new FormData(); form.append("file", new Blob([bytes.buffer], { type: decoded.mime }), decoded.mime === "image/png" ? "visible-viewport.png" : "visible-viewport.jpg");
        const api = await client(); const upload = await api.request(`/api/comments/${payload.comment_id}/attachments`, { method: "POST", body: form });
        if (!upload.ok) throw new Error(`Screenshot upload failed (${upload.status})`);
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
  } else if (message && typeof message === "object" && ["GET_REVIEW_CONTEXT", "REVIEW_FRAME_READY", "GET_REVIEW_FRAME_STATUS"].includes((message as { type?: string }).type ?? "")) {
    operation = (async () => {
      const control = validateContextMessage(message);
      const authorized = await authorizeResolveSender(sender, { extensionId: chrome.runtime.id, moodlePatterns: __MOODLE_PATTERNS__, optionalPatterns: __OPTIONAL_FRAME_PATTERNS__, hasPermission: (pattern) => chrome.permissions.contains({ origins: [pattern] }) });
      if (!authorized) throw new Error("Unauthorized review context sender");
      if (control.type === "GET_REVIEW_CONTEXT") {
        const context = reviewContexts.obtain(sender);
        if (!context) throw new Error("Review context unavailable");
        return context;
      }
      if (control.type === "REVIEW_FRAME_READY") {
        if (!reviewContexts.markReady(sender)) throw new Error("Review context unavailable");
        return {};
      }
      return { ready_count: reviewContexts.readyFrameCount(sender), ready_origins: reviewContexts.readyOrigins(sender) };
    })();
  }
  if (!operation) return false;
  void operation.then((data) => sendResponse({ ok: true, data }), (error: unknown) => {
    const message = normalizeErrorMessage(error);
    const status = message.startsWith("Signed out") ? "signed-out" : message.startsWith("Account pending") ? "pending" : "offline";
    sendResponse({ ok: false, status, error: message });
  });
  return true;
});
