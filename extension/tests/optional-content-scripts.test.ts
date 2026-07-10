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
