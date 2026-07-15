import assert from "node:assert/strict";
import test from "node:test";

import { EmbeddedAnchorCapabilities, issueEmbeddedAnchorFromWorker, type EmbeddedAnchorStorage } from "../src/embedded-anchor-capabilities.ts";

class Storage implements EmbeddedAnchorStorage {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(value: Record<string, unknown>) { Object.assign(this.data, structuredClone(value)); }
}
const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;
const event = {
  protocol: 1 as const, type: "SCORM_ANCHOR_CAPTURED" as const, request_id: id(1), worker_instance_id: id(2), generation: 4, course_id: id(3),
  page_url: "https://rise.example/index.html#moodle-review-page=Introduction",
  payload: { page_title: "Embedded activity · Introduction", embedded_locator: "#/lessons/one", anchor_type: "visual_pin" as const, css_selector: "#card", relative_x: 0.2, relative_y: 0.7 },
};
const sender = { id: "extension", tab: { id: 7 }, frameId: 12, url: "https://rise.example/index.html#/lessons/one" };
const context = { id: id(3), title: "Course", course_url: "https://my.uconline.ac.nz/course/view.php?id=896", parent_activity_url: "https://my.uconline.ac.nz/mod/scorm/player.php?a=9" };

test("only the current elected worker can issue a pending anchor", async () => {
  const capabilities = new EmbeddedAnchorCapabilities(new Storage(), { randomToken: () => "a".repeat(64) });
  const base = { extensionId: "extension", context, currentOwner: { frameId: 12, workerInstanceId: id(2), generation: 4 } };
  await assert.rejects(() => issueEmbeddedAnchorFromWorker(event, { ...sender, frameId: 11 }, { ...base, capabilities }), /elected worker/);
  await assert.rejects(() => issueEmbeddedAnchorFromWorker({ ...event, worker_instance_id: id(9) }, sender, { ...base, capabilities }), /elected worker/);
  await assert.rejects(() => issueEmbeddedAnchorFromWorker({ ...event, generation: 5 }, sender, { ...base, capabilities }), /elected worker/);
  await assert.rejects(() => issueEmbeddedAnchorFromWorker({ ...event, course_id: id(8) }, sender, { ...base, capabilities }), /course context/);
  const token = await issueEmbeddedAnchorFromWorker(event, sender, { ...base, capabilities });
  assert.equal(token, "a".repeat(64));
});

test("worker issuance binds exact trusted context and rejects a forged embedded origin", async () => {
  const storage = new Storage();
  const capabilities = new EmbeddedAnchorCapabilities(storage, { randomToken: () => "b".repeat(64) });
  const dependencies = { extensionId: "extension", context, currentOwner: { frameId: 12, workerInstanceId: id(2), generation: 4 }, capabilities };
  await assert.rejects(() => issueEmbeddedAnchorFromWorker(event, { ...sender, url: "https://evil.example/index.html" }, dependencies), /page origin/);
  await issueEmbeddedAnchorFromWorker(event, sender, dependencies);
  const claim = await capabilities.claim("b".repeat(64), { tabId: 7, courseId: id(3) });
  assert.deepEqual(claim && {
    tabId: claim.tabId, courseId: claim.courseId, frameId: claim.frameId, workerInstanceId: claim.workerInstanceId, generation: claim.generation,
    pageUrl: claim.pageUrl, pageTitle: claim.pageTitle, parentActivityUrl: claim.parentActivityUrl, embeddedLocator: claim.embeddedLocator, anchor: claim.anchor,
  }, {
    tabId: 7, courseId: id(3), frameId: 12, workerInstanceId: id(2), generation: 4,
    pageUrl: event.page_url, pageTitle: event.payload.page_title, parentActivityUrl: context.parent_activity_url, embeddedLocator: event.payload.embedded_locator,
    anchor: { anchor_type: "visual_pin", css_selector: "#card", relative_x: 0.2, relative_y: 0.7 },
  });
});
