import assert from "node:assert/strict";
import test from "node:test";
import { grantOptionalFrameAccess, handleOptionalPermissionRevocation, requestOptionalFramePermission } from "../src/optional-content-scripts.ts";

test("permission requests are frame-zero-only and limited to build-declared candidates", async () => {
  let requested: string[] = [];
  const dependencies = { optionalPatterns: ["https://rise.example.org/*"], request: (origins: string[]) => { requested = origins; return Promise.resolve(true); } };
  await assert.rejects(() => requestOptionalFramePermission({ frameId: 2 }, "https://rise.example.org", dependencies), /frame zero/i);
  await assert.rejects(() => requestOptionalFramePermission({ frameId: 0 }, "https://evil.example.org", dependencies), /not declared/i);
  assert.equal(await requestOptionalFramePermission({ frameId: 0 }, "https://rise.example.org", dependencies), true);
  assert.deepEqual(requested, ["https://rise.example.org/*"]);
});

test("permission API is invoked synchronously before the returned promise is awaited", async () => {
  let called = false;
  const pending = requestOptionalFramePermission({ frameId: 0 }, "https://rise.example.org", {
    optionalPatterns: ["https://rise.example.org/*"],
    request: () => { called = true; return Promise.resolve(false); },
  });
  assert.equal(called, true);
  assert.equal(await pending, false);
});

test("optional permission denial can be retried without registration or injection", async () => {
  let attempts = 0; let reconciles = 0; let injections = 0;
  const dependencies = { optionalPatterns: ["https://rise.example.org/*"], request: () => Promise.resolve(++attempts > 1), grantedOrigins: () => Promise.resolve(["https://rise.example.org/*"]), reconcile: async () => { reconciles += 1; }, inject: async () => { injections += 1; } };
  assert.deepEqual(await grantOptionalFrameAccess({ frameId: 0 }, 7, "https://rise.example.org", dependencies), { granted: false, reload_required: false });
  assert.deepEqual(await grantOptionalFrameAccess({ frameId: 0 }, 7, "https://rise.example.org", dependencies), { granted: true, reload_required: false });
  assert.equal(reconciles, 1); assert.equal(injections, 1);
});

test("granted permission reports reload-required when loaded-frame injection fails", async () => {
  const outcome = await grantOptionalFrameAccess({ frameId: 0 }, 7, "https://rise.example.org", {
    optionalPatterns: ["https://rise.example.org/*"], request: () => Promise.resolve(true), grantedOrigins: () => Promise.resolve(["https://rise.example.org/*"]), reconcile: async () => undefined,
    inject: async (tabId, allFrames) => { assert.equal(tabId, 7); assert.equal(allFrames, true); throw new Error("frame gone"); },
  });
  assert.deepEqual(outcome, { granted: true, reload_required: true });
});

test("permission revocation removes dynamic injection and invalidates workers and capabilities", async () => {
  const calls: string[] = [];
  await handleOptionalPermissionRevocation({ reconcile: async () => { calls.push("registration"); }, invalidateCapabilities: async () => { calls.push("capabilities"); }, invalidateWorkers: () => { calls.push("workers"); } });
  assert.deepEqual(calls, ["registration", "capabilities", "workers"]);
});
