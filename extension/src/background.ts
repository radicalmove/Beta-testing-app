import { authenticate, type SessionToken } from "./api";

declare const chrome: any;

const DEFAULT_SERVICE_ORIGIN = "https://review.example.invalid";

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
