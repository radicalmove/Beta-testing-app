import assert from "node:assert/strict";
import test from "node:test";
import { requestOptionalFramePermission } from "../src/optional-content-scripts.ts";

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
