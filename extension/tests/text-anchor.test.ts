import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { captureTextAnchor } from "../src/anchors/text.ts";
import { recoverTextAnchor } from "../src/anchors/recover.ts";

test("captures selected quote with surrounding text without changing content", () => {
  const window = new Window();
  window.document.body.innerHTML = `<p>Before words selected phrase after words</p>`;
  const text = window.document.querySelector("p")!.firstChild!;
  const range = window.document.createRange(); range.setStart(text, 13); range.setEnd(text, 28);
  const before = window.document.body.innerHTML;
  const anchor = captureTextAnchor(range as unknown as Range, window.document as unknown as Document)!;
  assert.equal(anchor.selected_quote, "selected phrase");
  assert.equal(anchor.prefix, "Before words ");
  assert.equal(anchor.suffix, " after words");
  assert.equal(anchor.css_selector, "body > p");
  assert.equal(window.document.body.innerHTML, before);
});

test("captures a stable selector when whole-element highlight context is only whitespace", () => {
  const window = new Window();
  window.document.body.innerHTML = `   <p id="intro">Please introduce yourself to your peers and share a little about yourself.</p>   `;
  const text = window.document.querySelector("#intro")!.firstChild!;
  const range = window.document.createRange(); range.selectNodeContents(text);
  const before = window.document.body.innerHTML;

  const anchor = captureTextAnchor(range as unknown as Range, window.document as unknown as Document)!;

  assert.equal(anchor.selected_quote, text.textContent);
  assert.equal(anchor.prefix.trim(), "");
  assert.equal(anchor.suffix.trim(), "");
  assert.equal(anchor.css_selector, "#intro");
  assert.equal(window.document.body.innerHTML, before);
});

test("spanning highlights use their nearest common eligible element", () => {
  const window = new Window();
  window.document.body.innerHTML = `<section id="lesson"><span>selected </span><strong>words</strong></section>`;
  const section = window.document.querySelector("#lesson")!;
  const range = window.document.createRange();
  range.setStart(section.querySelector("span")!.firstChild!, 0);
  range.setEnd(section.querySelector("strong")!.firstChild!, 5);

  const anchor = captureTextAnchor(range as unknown as Range, window.document as unknown as Document)!;

  assert.equal(anchor.selected_quote, "selected words");
  assert.equal(anchor.css_selector, "#lesson");
});

test("restores a quote after a small DOM split", () => {
  const window = new Window();
  window.document.body.innerHTML = `<p>Before words <em>selected</em> phrase after words</p>`;
  const result = recoverTextAnchor(window.document as unknown as Document, { selected_quote: "selected phrase", prefix: "Before words ", suffix: " after words" });
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") assert.equal(result.range.toString(), "selected phrase");
});

test("does not resolve absent or ambiguous quotes", () => {
  const window = new Window();
  window.document.body.textContent = "same text and same text";
  assert.equal(recoverTextAnchor(window.document as unknown as Document, { selected_quote: "missing", prefix: "", suffix: "" }).status, "unresolved");
  assert.equal(recoverTextAnchor(window.document as unknown as Document, { selected_quote: "same text", prefix: "", suffix: "" }).status, "unresolved");
});

test("recovery tolerates whitespace-only DOM changes and ignores hidden executable content", () => {
  const window = new Window();
  window.document.body.innerHTML = `<script>selected phrase</script><p aria-hidden="true">selected phrase</p><p>Before selected\n   phrase after</p>`;
  const result = recoverTextAnchor(window.document as unknown as Document, { selected_quote: "selected phrase", prefix: "Before ", suffix: " after" });
  assert.equal(result.status, "resolved");
});
