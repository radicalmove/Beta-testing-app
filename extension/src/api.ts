export type SessionToken = { apiToken: string; expiresAt: number };

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function getActiveToken(
  session: SessionToken | undefined,
  options: { now?: () => number; clearToken: () => Promise<void>; onSignedOut: () => void },
): Promise<string | undefined> {
  if (session && session.expiresAt > (options.now ?? Date.now)()) return session.apiToken;
  if (session) await options.clearToken();
  options.onSignedOut();
  return undefined;
}

export function validateServiceOrigin(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Review service must use HTTPS (HTTP is allowed only on localhost for development)");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Review service URL must be an origin without a path, credentials, query, or fragment");
  }
  return url;
}

export class ApiClient {
  private readonly origin: string;
  private readonly options: {
    serviceOrigin: string;
    getToken: () => Promise<string | undefined>;
    clearToken: () => Promise<void>;
    onSignedOut: () => void;
    fetch?: Fetch;
  };

  constructor(options: {
    serviceOrigin: string;
    getToken: () => Promise<string | undefined>;
    clearToken: () => Promise<void>;
    onSignedOut: () => void;
    fetch?: Fetch;
  }) {
    this.options = options;
    this.origin = validateServiceOrigin(options.serviceOrigin).origin;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith("/")) throw new Error("API path must be absolute");
    const token = await this.options.getToken();
    if (!token) {
      this.options.onSignedOut();
      throw new Error("Signed out");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await (this.options.fetch ?? fetch)(`${this.origin}${path}`, {
      ...init,
      headers,
      credentials: "omit",
    });
    if (response.status === 401) {
      await this.options.clearToken();
      this.options.onSignedOut();
      throw new Error("Signed out: session expired");
    }
    return response;
  }
}

export async function authenticate(options: {
  serviceOrigin: string;
  getRedirectUrl: () => string;
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string | undefined>;
  fetch?: Fetch;
  setSession: (value: SessionToken) => Promise<void>;
  now?: () => number;
}): Promise<SessionToken> {
  const origin = validateServiceOrigin(options.serviceOrigin).origin;
  const redirectUri = options.getRedirectUrl();
  const authorizeUrl = new URL("/extension/authorize", origin);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  let callback: string | undefined;
  try {
    callback = await options.launchWebAuthFlow({ url: authorizeUrl.href, interactive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (/\buser\b.*(?:did not approve|cancelled|canceled)|access (?:was )?denied/i.test(message)) throw new Error("Authentication was cancelled");
    throw error;
  }
  if (!callback) throw new Error("Authentication was cancelled");
  const callbackUrl = new URL(callback);
  const expectedCallback = new URL(redirectUri);
  if (callbackUrl.origin !== expectedCallback.origin || callbackUrl.pathname !== expectedCallback.pathname) {
    throw new Error("Authentication response used an unexpected redirect URL");
  }
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("Authentication was cancelled");
  const response = await (options.fetch ?? fetch)(`${origin}/extension/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== "string" || body.access_token.trim() === "") {
    throw new Error("Token exchange returned no access token");
  }
  if (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in)
    || body.expires_in <= 0 || body.expires_in > 7 * 24 * 60 * 60) {
    throw new Error("Token exchange returned an invalid expiry");
  }
  const session = {
    apiToken: body.access_token,
    expiresAt: (options.now ?? Date.now)() + body.expires_in * 1_000,
  };
  await options.setSession(session);
  return session;
}
