import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { resolveScormLaunchUrl } from "../src/scorm-launch.ts";

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
