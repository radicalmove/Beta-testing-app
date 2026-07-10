import assert from "node:assert/strict";
import test from "node:test";
import { createCommentWithOptionalScreenshot } from "../src/screenshot-flow.ts";

const payload = { course_id: "course", body: "note" };

test("explicit screenshot false creates only the comment", async () => {
  const calls: string[] = [];
  const result = await createCommentWithOptionalScreenshot(payload, false, {
    createComment: async () => { calls.push("create"); return { id: "comment-1" }; },
    captureVisibleTab: async () => { calls.push("capture"); return new Blob(); },
    uploadScreenshot: async () => { calls.push("upload"); return {}; },
  });
  assert.deepEqual(calls, ["create"]);
  assert.deepEqual(result, { id: "comment-1" });
});

test("explicit screenshot true creates first then captures and uploads against returned id", async () => {
  const calls: string[] = [];
  const result = await createCommentWithOptionalScreenshot(payload, true, {
    createComment: async () => { calls.push("create"); return { id: "comment-7" }; },
    captureVisibleTab: async () => { calls.push("capture"); return new Blob(["png"], { type: "image/png" }); },
    uploadScreenshot: async (id, blob) => { calls.push(`upload:${id}:${blob.type}`); return { id: "attachment-2" }; },
  });
  assert.deepEqual(calls, ["create", "capture", "upload:comment-7:image/png"]);
  assert.deepEqual(result, { id: "comment-7", attachment: { id: "attachment-2" } });
});

for (const stage of ["capture", "upload"] as const) test(`${stage} failure reports partial success without duplicating comment`, async () => {
  const calls: string[] = [];
  const result = await createCommentWithOptionalScreenshot(payload, true, {
    createComment: async () => { calls.push("create"); return { id: "comment-9" }; },
    captureVisibleTab: async () => { calls.push("capture"); if (stage === "capture") throw new Error("capture denied"); return new Blob(); },
    uploadScreenshot: async () => { calls.push("upload"); if (stage === "upload") throw new Error("upload unavailable"); return {}; },
  });
  assert.equal(calls.filter((call) => call === "create").length, 1);
  assert.equal(result.comment_saved, true);
  assert.equal(result.screenshot_failed, true);
  assert.match(result.screenshot_error, stage === "capture" ? /capture denied/ : /upload unavailable/);
});
