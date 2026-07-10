import assert from "node:assert/strict";
import test from "node:test";
import { StatefulCommentBackend } from "../e2e/stateful-comment-backend.ts";

const pageUrl = "https://moodle.example.invalid/page/one";

test("beta creation gains an LD reply while SME replies remain hidden from beta", () => {
  const backend = new StatefulCommentBackend();
  backend.setViewer({ role: "beta_tester", userId: "beta-1", email: "beta@example.test" });
  const created = backend.create({ page_url: pageUrl, page_title: "Fixture", body: "Beta body", category: "content_accuracy", anchor_type: "text_highlight", selected_quote: "important phrase", prefix: "An ", suffix: " here", css_selector: null, dom_selector: null, relative_x: null, relative_y: null });
  backend.reply(created.id, { role: "sme", userId: "sme-1", email: "sme@example.test" }, "Hidden SME reply");

  const [visible] = backend.list(pageUrl);
  assert.equal(visible.body, "Beta body");
  backend.reply(created.id, { role: "beta_tester", userId: "beta-1", email: "beta@example.test" }, "Beta follow-up");
  assert.deepEqual(backend.list(pageUrl)[0].replies.map((reply) => reply.body), ["Fixture LD reply", "Beta follow-up"]);
});

test("SME pins are visible to LD/DCD", () => {
  const backend = new StatefulCommentBackend();
  backend.setViewer({ role: "sme", userId: "sme-1", email: "sme@example.test" });
  backend.create({ page_url: pageUrl, page_title: "Fixture", body: "SME pin", category: "general", anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: 0.5, relative_y: 0.5 });
  backend.setViewer({ role: "ld_dcd", userId: "ld-1", email: "ld@example.test" });

  assert.deepEqual(backend.list(pageUrl).map((comment) => comment.body), ["SME pin"]);
});

test("all approved SMEs see SME-authored threads regardless of author", () => {
  const backend = new StatefulCommentBackend();
  backend.setViewer({ role: "sme", userId: "sme-a", email: "a@example.test", displayName: "SME A" });
  backend.create({ page_url: pageUrl, page_title: "Fixture", body: "SME A thread", category: "general", anchor_type: "visual_pin", selected_quote: null, prefix: null, suffix: null, css_selector: "#target", dom_selector: null, relative_x: 0.5, relative_y: 0.5 });
  backend.setViewer({ role: "sme", userId: "sme-b", email: "b@example.test", displayName: "SME B" });
  assert.deepEqual(backend.list(pageUrl).map((comment) => comment.body), ["SME A thread"]);
});

test("dashboard share transitions a beta comment from hidden to selected-SME-only", () => {
  const backend = new StatefulCommentBackend();
  backend.setViewer({ role: "beta_tester", userId: "beta-1", email: "beta@example.test" });
  const created = backend.create({ page_url: pageUrl, page_title: "Fixture", body: "Selective", category: "general", anchor_type: "text_highlight", selected_quote: "important phrase", prefix: "An ", suffix: " here", css_selector: null, dom_selector: null, relative_x: null, relative_y: null });

  backend.setViewer({ role: "sme", userId: "sme-selected", email: "selected@example.test" });
  assert.equal(backend.list(pageUrl).length, 0);
  backend.share(created.id, "sme-selected"); // Production performs this transition in the dashboard/server.
  assert.equal(backend.list(pageUrl).length, 1);
  backend.setViewer({ role: "sme", userId: "sme-other", email: "other@example.test" });
  assert.equal(backend.list(pageUrl).length, 0);
});
