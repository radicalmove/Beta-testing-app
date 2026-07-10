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
  assert.equal(window.document.body.innerHTML, before);
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
