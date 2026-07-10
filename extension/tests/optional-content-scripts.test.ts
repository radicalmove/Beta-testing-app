import assert from "node:assert/strict";
import test from "node:test";

import { OPTIONAL_CONTENT_SCRIPT_ID, reconcileOptionalContentScript } from "../src/optional-content-scripts.ts";

test("optional frames are unreachable before permission and registered after permission", async () => {
  const registrations: unknown[][] = [];
  let registered: Array<{ id: string }> = [];
  const scripting = {
    getRegisteredContentScripts: async () => registered,
    registerContentScripts: async (scripts: unknown[]) => {
      registrations.push(scripts);
      registered = [{ id: OPTIONAL_CONTENT_SCRIPT_ID }];
    },
    unregisterContentScripts: async () => {
      registered = [];
    },
  };

  await reconcileOptionalContentScript({
    optionalPatterns: ["https://rise.example.invalid/*", "https://scorm.example.invalid/*"],
    grantedOrigins: [],
    scripting,
  });
  assert.deepEqual(registrations, []);

  await reconcileOptionalContentScript({
    optionalPatterns: ["https://rise.example.invalid/*", "https://scorm.example.invalid/*"],
    grantedOrigins: ["https://rise.example.invalid/*"],
    scripting,
  });
  assert.deepEqual(registrations, [[{
    id: OPTIONAL_CONTENT_SCRIPT_ID,
    matches: ["https://rise.example.invalid/*"],
    js: ["content.js"],
    allFrames: true,
    runAt: "document_idle",
    persistAcrossSessions: true,
  }]]);
});

test("registration never includes ungranted optional origins and is removed with permission", async () => {
  let registered: Array<{ id: string }> = [{ id: OPTIONAL_CONTENT_SCRIPT_ID }];
  let removed = 0;
  const scripting = {
    getRegisteredContentScripts: async () => registered,
    registerContentScripts: async () => undefined,
    unregisterContentScripts: async () => {
      removed += 1;
      registered = [];
    },
  };

  await reconcileOptionalContentScript({
    optionalPatterns: ["https://rise.example.invalid/*"],
    grantedOrigins: [],
    scripting,
  });
  assert.equal(removed, 1);
});

test("unchanged registration is left in place without an unregister gap", async () => {
  let removed = 0;
  let added = 0;
  const scripting = {
    getRegisteredContentScripts: async () => [{
      id: OPTIONAL_CONTENT_SCRIPT_ID,
      matches: ["https://rise.example.invalid/*"],
      js: ["content.js"],
      allFrames: true,
      runAt: "document_idle" as const,
      persistAcrossSessions: true,
    }],
    registerContentScripts: async () => { added += 1; },
    unregisterContentScripts: async () => { removed += 1; },
  };
  await reconcileOptionalContentScript({
    optionalPatterns: ["https://rise.example.invalid/*"],
    grantedOrigins: ["https://rise.example.invalid/*"],
    scripting,
  });
  assert.equal(removed, 0);
  assert.equal(added, 0);
});

test("registration is replaced when any execution setting drifts", async () => {
  const desired = {
    id: OPTIONAL_CONTENT_SCRIPT_ID,
    matches: ["https://rise.example.invalid/*"],
    js: ["content.js"],
    allFrames: true,
    runAt: "document_idle" as const,
    persistAcrossSessions: true,
  };
  const drifts = [
    { js: ["old-content.js"] },
    { allFrames: false },
    { runAt: "document_start" as const },
    { persistAcrossSessions: false },
  ];

  for (const drift of drifts) {
    let removed = 0;
    let registered: unknown[] = [];
    const scripting = {
      getRegisteredContentScripts: async () => [{ ...desired, ...drift }],
      unregisterContentScripts: async () => { removed += 1; },
      registerContentScripts: async (scripts: unknown[]) => { registered = scripts; },
    };
    await reconcileOptionalContentScript({
      optionalPatterns: desired.matches,
      grantedOrigins: desired.matches,
      scripting,
    });
    assert.equal(removed, 1, `expected unregister for ${Object.keys(drift)[0]} drift`);
    assert.deepEqual(registered, [desired]);
  }
});
