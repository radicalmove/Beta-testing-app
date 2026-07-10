import { ApiClient, authenticate, getActiveToken, type SessionToken } from "./api";
import { reconcileOptionalContentScript } from "./optional-content-scripts";

declare const chrome: any;
declare const __OPTIONAL_FRAME_PATTERNS__: string[];

const DEFAULT_SERVICE_ORIGIN = "https://review.example.invalid";

let optionalRegistration = Promise.resolve();

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

type ResolveCourseMessage = { type: "RESOLVE_COURSE"; payload: { course_url: string; title: string; moodle_course_id?: number } };

async function activeToken(): Promise<string | undefined> {
  const stored = await chrome.storage.session.get(["apiToken", "expiresAt"]) as Partial<SessionToken>;
  const session = typeof stored.apiToken === "string" && typeof stored.expiresAt === "number" ? stored as SessionToken : undefined;
  return getActiveToken(session, {
    clearToken: () => chrome.storage.session.remove(["apiToken", "expiresAt"]),
    onSignedOut: () => undefined,
  });
}

async function resolveCourse(message: ResolveCourseMessage): Promise<unknown> {
  const client = new ApiClient({
    serviceOrigin: await serviceOrigin(),
    getToken: activeToken,
    clearToken: () => chrome.storage.session.remove(["apiToken", "expiresAt"]),
    onSignedOut: () => undefined,
  });
  const response = await client.request("/api/courses/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.payload),
  });
  if (response.status === 403) throw new Error("Account pending approval");
  if (!response.ok) throw new Error(`Course resolution failed (${response.status})`);
  return response.json();
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender: unknown, sendResponse: (value: unknown) => void) => {
  let operation: Promise<unknown> | undefined;
  if (message.type === "AUTHENTICATE") {
    operation = serviceOrigin().then((origin) => authenticate({
      serviceOrigin: origin,
      getRedirectUrl: () => chrome.identity.getRedirectURL(),
      launchWebAuthFlow: (details) => chrome.identity.launchWebAuthFlow(details),
      setSession: (session: SessionToken) => chrome.storage.session.set(session),
    }));
  } else if (message.type === "RESOLVE_COURSE") {
    operation = resolveCourse(message as ResolveCourseMessage);
  }
  if (!operation) return false;
  void operation.then((data) => sendResponse({ ok: true, data }), (error: Error) => {
    const status = error.message.startsWith("Signed out") ? "signed-out" : error.message.startsWith("Account pending") ? "pending" : "offline";
    sendResponse({ ok: false, status, error: error.message });
  });
  return true;
});
