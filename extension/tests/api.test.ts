import assert from "node:assert/strict";
import test from "node:test";

import { ApiClient, authenticate, getActiveToken, validateServiceOrigin } from "../src/api.ts";

test("API calls use the configured private service origin and bearer token", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ApiClient({
    serviceOrigin: "https://review.tailnet-name.ts.net",
    getToken: async () => "secret-token",
    clearToken: async () => undefined,
    onSignedOut: () => undefined,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await client.request("/api/reviews/42");

  assert.equal(calls[0]?.url, "https://review.tailnet-name.ts.net/api/reviews/42");
  assert.equal(new Headers(calls[0]?.init?.headers).get("Authorization"), "Bearer secret-token");
  assert.equal(calls[0]?.init?.credentials, "omit");
});

test("a 401 clears the session token and announces signed-out state", async () => {
  let cleared = false;
  let signedOut = false;
  const client = new ApiClient({
    serviceOrigin: "https://review.tailnet-name.ts.net",
    getToken: async () => "expired-token",
    clearToken: async () => { cleared = true; },
    onSignedOut: () => { signedOut = true; },
    fetch: async () => new Response(null, { status: 401 }),
  });

  await assert.rejects(client.request("/api/reviews"), /signed out/i);
  assert.equal(cleared, true);
  assert.equal(signedOut, true);
});

test("a locally expired session clears the token and announces signed-out state", async () => {
  let cleared = false;
  let signedOut = false;
  const token = await getActiveToken(
    { apiToken: "expired-token", expiresAt: 999 },
    { now: () => 1_000, clearToken: async () => { cleared = true; }, onSignedOut: () => { signedOut = true; } },
  );

  assert.equal(token, undefined);
  assert.equal(cleared, true);
  assert.equal(signedOut, true);
});

test("service origins require HTTPS except loopback development", () => {
  assert.equal(validateServiceOrigin("https://review.example.org").origin, "https://review.example.org");
  assert.equal(validateServiceOrigin("http://localhost:8000").origin, "http://localhost:8000");
  assert.throws(() => validateServiceOrigin("http://review.example.org"), /HTTPS/);
  assert.throws(() => validateServiceOrigin("https://review.example.org/path"), /origin/);
});

test("authentication exchanges an identity flow code and stores only the expiring API token", async () => {
  const stored: Record<string, unknown>[] = [];
  let authUrl = "";
  let tokenRequest: { url: string; init?: RequestInit } | undefined;
  const result = await authenticate({
    serviceOrigin: "https://review.example.org",
    getRedirectUrl: () => "https://abcdefghijklmnop.chromiumapp.org/callback",
    launchWebAuthFlow: async ({ url }) => {
      authUrl = url;
      return "https://abcdefghijklmnop.chromiumapp.org/callback?code=one-time-code";
    },
    fetch: async (url, init) => {
      tokenRequest = { url: String(url), init };
      return new Response(JSON.stringify({ access_token: "api-token", expires_in: 900 }), { status: 200 });
    },
    setSession: async (value) => { stored.push(value); },
    now: () => 1_000,
  });

  assert.match(authUrl, /^https:\/\/review\.example\.org\/extension\/authorize\?/);
  assert.match(authUrl, /redirect_uri=https%3A%2F%2Fabcdefghijklmnop\.chromiumapp\.org%2Fcallback/);
  assert.equal(tokenRequest?.url, "https://review.example.org/extension/token");
  assert.equal(tokenRequest?.init?.credentials, "omit");
  assert.deepEqual(JSON.parse(String(tokenRequest?.init?.body)), {
    code: "one-time-code",
    redirect_uri: "https://abcdefghijklmnop.chromiumapp.org/callback",
  });
  assert.deepEqual(stored, [{ apiToken: "api-token", expiresAt: 901_000 }]);
  assert.deepEqual(result, { apiToken: "api-token", expiresAt: 901_000 });
});

test("authentication rejects callbacks outside the exact identity redirect", async () => {
  await assert.rejects(authenticate({
    serviceOrigin: "https://review.example.org",
    getRedirectUrl: () => "https://abcdefghijklmnop.chromiumapp.org/callback",
    launchWebAuthFlow: async () => "https://abcdefghijklmnop.chromiumapp.org/other?code=stolen",
    setSession: async () => undefined,
  }), /redirect/i);
});

test("authentication rejects malformed token payloads", async () => {
  for (const payload of [
    { access_token: "", expires_in: 900 },
    { access_token: "   ", expires_in: 900 },
    { access_token: "token", expires_in: 0 },
    { access_token: "token", expires_in: Number.POSITIVE_INFINITY },
  ]) {
    await assert.rejects(authenticate({
      serviceOrigin: "https://review.example.org",
      getRedirectUrl: () => "https://abcdefghijklmnop.chromiumapp.org/callback",
      launchWebAuthFlow: async () => "https://abcdefghijklmnop.chromiumapp.org/callback?code=one-time-code",
      fetch: async () => new Response(JSON.stringify(payload), { status: 200 }),
      setSession: async () => undefined,
    }), /token|expir/i);
  }
});
