import assert from "node:assert/strict";
import test from "node:test";
import { captureDisplayScreenshot, validateScreenshotDataUrl } from "../src/screenshot-flow.ts";

test("display capture is started only by the caller and always stops every track", async () => {
  const calls: string[] = [];
  const tracks = [{ stop: () => calls.push("stop-1") }, { stop: () => calls.push("stop-2") }];
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const result = await captureDisplayScreenshot({
    getDisplayMedia: async (constraints) => { calls.push(`media:${JSON.stringify(constraints)}`); return { getTracks: () => tracks } as unknown as MediaStream; },
    captureFrame: async () => { calls.push("frame"); return png; },
  });
  assert.equal(result, png);
  assert.deepEqual(calls, ['media:{"video":true,"audio":false,"preferCurrentTab":true}', "frame", "stop-1", "stop-2"]);
});

test("cancelled display capture rejects and still stops any acquired tracks", async () => {
  await assert.rejects(() => captureDisplayScreenshot({ getDisplayMedia: async () => { throw new DOMException("cancelled", "NotAllowedError"); } }), /cancelled/);
});

test("screenshot payload accepts only canonical bounded png/jpeg data URLs", () => {
  assert.deepEqual(validateScreenshotDataUrl("data:image/jpeg;base64,/9j/", 3), { mime: "image/jpeg", bytes: new Uint8Array([255, 216, 255]) });
  for (const value of ["data:image/gif;base64,aGVsbG8=", "data:image/png;base64, aGVsbG8=", "data:image/png;base64,aGVsbG8", "data:image/png;base64,aGVsbG8=\n"]) assert.throws(() => validateScreenshotDataUrl(value, 10));
  assert.throws(() => validateScreenshotDataUrl("data:image/png;base64,iVBORw0KGgo=", 7), /large/);
});
