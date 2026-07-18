import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { packageRootFromScormUrl, resolveScormLaunchUrl, ScormLaunchCache, validateScormLaunchRegistration } from "../src/scorm-launch.ts";

const documentFor = (body: string) => {
  const window = new Window({ url: "https://my.uconline.ac.nz/mod/scorm/view.php?id=146308" });
  window.document.body.innerHTML = body;
  return window.document as unknown as Document;
};

const validForm = `<form method="post" action="https://my.uconline.ac.nz/mod/scorm/player.php">
  <input type="hidden" name="mode" value="normal">
  <input type="hidden" name="scoid" value="15621">
  <input type="hidden" name="cm" value="146308">
  <input type="hidden" name="currentorg" value="articulate_rise">
</form>`;

test("resolves one trusted Moodle POST form to a complete canonical player URL", () => {
  assert.equal(resolveScormLaunchUrl(documentFor(validForm), "https://my.uconline.ac.nz", 146308), "https://my.uconline.ac.nz/mod/scorm/player.php?mode=normal&scoid=15621&cm=146308&currentorg=articulate_rise");
});

test("rejects missing, duplicate, cross-origin, credentialed, and non-POST launch forms", () => {
  assert.throws(() => resolveScormLaunchUrl(documentFor(""), "https://my.uconline.ac.nz", 146308), /launch form/);
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm + validForm), "https://my.uconline.ac.nz", 146308), /launch form/);
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm.replace("https://my.uconline.ac.nz", "https://evil.example")), "https://my.uconline.ac.nz", 146308), /launch form/);
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm.replace("https://my.uconline.ac.nz", "https://user:pass@my.uconline.ac.nz")), "https://my.uconline.ac.nz", 146308), /launch form/);
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm.replace('method="post"', 'method="get"')), "https://my.uconline.ac.nz", 146308), /launch form/);
});

test("requires valid positive identifiers, matching cmid, bounded organisation, and allowed mode", () => {
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm.replace('value="146308"', 'value="9"')), "https://my.uconline.ac.nz", 146308), /launch fields/);
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm.replace('value="15621"', 'value="0"')), "https://my.uconline.ac.nz", 146308), /launch fields/);
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm.replace("articulate_rise", "x".repeat(300))), "https://my.uconline.ac.nz", 146308), /launch fields/);
  assert.throws(() => resolveScormLaunchUrl(documentFor(validForm.replace("normal", "javascript")), "https://my.uconline.ac.nz", 146308), /launch fields/);
});

class MemoryStorage {
  values: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.values[key] }; }
  async set(value: Record<string, unknown>) { Object.assign(this.values, value); }
}

const courseId = "00000000-0000-4000-8000-000000000001";
const packageUrl = "https://my.uconline.ac.nz/pluginfile.php/165226/mod_scorm/content/27/scormcontent/index.html#/lesson";
const playerUrl = "https://my.uconline.ac.nz/mod/scorm/player.php?mode=normal&scoid=15621&cm=146308&currentorg=articulate_rise";

test("derives an exact canonical SCORM package root", () => {
  assert.equal(packageRootFromScormUrl(packageUrl), "https://my.uconline.ac.nz/pluginfile.php/165226/mod_scorm/content/27/scormcontent/");
  assert.throws(() => packageRootFromScormUrl("https://my.uconline.ac.nz/mod/page/view.php?id=1"), /package root/);
});

test("cache binds course, origin, cmid and exact package root and survives reconstruction", async () => {
  const storage = new MemoryStorage();
  const cache = new ScormLaunchCache(storage, () => 1_000);
  await cache.put({ courseId, configuredOrigin: "https://my.uconline.ac.nz", cmid: 146308, packageRoot: packageRootFromScormUrl(packageUrl), playerUrl });
  const restarted = new ScormLaunchCache(storage, () => 2_000);
  assert.equal(await restarted.get({ courseId, configuredOrigin: "https://my.uconline.ac.nz", packageUrl, cmid: 146308 }), playerUrl);
  assert.equal(await restarted.get({ courseId, configuredOrigin: "https://my.uconline.ac.nz", packageUrl: packageUrl.replace("/27/", "/28/"), cmid: 146308 }), undefined);
});

test("cache expires records, purges malformed data, and evicts oldest records above its bound", async () => {
  const storage = new MemoryStorage(); let now = 0;
  const cache = new ScormLaunchCache(storage, () => now, 100, 2);
  for (const [cmid, suffix] of [[1, "one"], [2, "two"], [3, "three"]] as const) {
    now += 1;
    const root = `https://my.uconline.ac.nz/pluginfile.php/1/mod_scorm/content/${cmid}/scormcontent/`;
    await cache.put({ courseId, configuredOrigin: "https://my.uconline.ac.nz", cmid, packageRoot: root, playerUrl: `https://my.uconline.ac.nz/mod/scorm/player.php?mode=normal&scoid=${cmid}&cm=${cmid}&currentorg=${suffix}` });
  }
  assert.equal(await cache.get({ courseId, configuredOrigin: "https://my.uconline.ac.nz", packageUrl: "https://my.uconline.ac.nz/pluginfile.php/1/mod_scorm/content/1/scormcontent/index.html", cmid: 1 }), undefined);
  now = 500;
  assert.equal(await cache.get({ courseId, configuredOrigin: "https://my.uconline.ac.nz", packageUrl: "https://my.uconline.ac.nz/pluginfile.php/1/mod_scorm/content/3/scormcontent/index.html", cmid: 3 }), undefined);
  storage.values.moodleReviewScormLaunches = [{ bad: true }];
  assert.equal(await cache.get({ courseId, configuredOrigin: "https://my.uconline.ac.nz", packageUrl, cmid: 146308 }), undefined);
});

test("registration boundary accepts only an exact complete player record", () => {
  assert.deepEqual(validateScormLaunchRegistration({ type: "REGISTER_SCORM_LAUNCH", course_id: courseId, cmid: 146308, player_url: playerUrl }), { type: "REGISTER_SCORM_LAUNCH", course_id: courseId, cmid: 146308, player_url: playerUrl });
  assert.throws(() => validateScormLaunchRegistration({ type: "REGISTER_SCORM_LAUNCH", course_id: courseId, cmid: 146308, player_url: "https://my.uconline.ac.nz/mod/scorm/player.php" }), /registration/);
  assert.throws(() => validateScormLaunchRegistration({ type: "REGISTER_SCORM_LAUNCH", course_id: courseId, cmid: 146308, player_url: playerUrl, extra: true }), /registration/);
});
