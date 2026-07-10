import { authenticate, type SessionToken } from "./api";
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

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender: unknown, sendResponse: (value: unknown) => void) => {
  if (message.type !== "AUTHENTICATE") return false;
  void serviceOrigin().then((origin) => authenticate({
    serviceOrigin: origin,
    getRedirectUrl: () => chrome.identity.getRedirectURL(),
    launchWebAuthFlow: (details) => chrome.identity.launchWebAuthFlow(details),
    setSession: (session: SessionToken) => chrome.storage.session.set(session),
  })).then(sendResponse, (error: Error) => sendResponse({ error: error.message }));
  return true;
});
