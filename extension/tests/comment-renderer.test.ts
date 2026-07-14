import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { createCommentRenderer } from "../src/comment-renderer.ts";
import type { PageComment } from "../src/background-bridge.ts";

const pageUrl = "https://learn.example/mod/page/view.php?id=2";
const otherPageUrl = "https://learn.example/mod/page/view.php?id=3";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const comment = (overrides: Partial<PageComment> = {}): PageComment => ({
  id: "00000000-0000-4000-8000-000000000001",
  body: "Move this card",
  category: "general",
  status: "open",
  author: { display_name: "Reviewer", role: "beta_tester" },
  page_url: pageUrl,
  page_title: "Week 2",
  anchor_type: "visual_pin",
  selected_quote: null,
  prefix: null,
  suffix: null,
  css_selector: "#target",
  dom_selector: null,
  relative_x: 0.5,
  relative_y: 0.5,
  replies: [],
  status_history: [],
  capabilities: { can_reply: true, can_edit: true, can_change_status: true, can_share_with_sme: false, can_delete: true },
  ...overrides,
});

function setup() {
  const window = new Window({ url: pageUrl });
  const document = window.document as unknown as Document;
  const target = document.createElement("div");
  target.id = "target";
  target.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100, toJSON() {} });
  document.body.append(target);
  return { window, document };
}

test("renders and restores only comments for the renderer's exact page URL", () => {
  const { document } = setup();
  const renderer = createCommentRenderer(document, pageUrl);
  renderer.setComments([comment(), comment({ id: "00000000-0000-4000-8000-000000000002", page_url: otherPageUrl })]);

  assert.equal(document.querySelectorAll("[data-moodle-review-stored-pin]").length, 1);
  assert.equal(document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")?.dataset.moodleReviewStoredPin, comment().id);
  assert.equal(document.getElementById("moodle-course-review-overlay"), null);

  renderer.setComments([]);
  assert.equal(document.querySelector("[data-moodle-review-stored-pin]"), null);
});

test("opens a contextual thread beside its marker and toggles it closed", () => {
  const { document } = setup();
  const renderer = createCommentRenderer(document, pageUrl);
  renderer.setComments([comment()]);
  const marker = document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!;

  marker.click();
  const rendererHost = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!;
  assert.ok(rendererHost.shadowRoot?.querySelector("[data-thread-popover]"));
  assert.equal(marker.getAttribute("aria-expanded"), "true");

  marker.click();
  assert.equal(rendererHost.shadowRoot?.querySelector("[data-thread-popover]"), null);
  assert.equal(marker.getAttribute("aria-expanded"), "false");
});

test("contextual threads preserve edit, reply, delete, and status callbacks", async () => {
  const { document } = setup();
  const calls: string[] = [];
  const renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => { calls.push("edit"); },
    replyThread: async () => { calls.push("reply"); },
    deleteThread: async () => { calls.push("delete"); },
    changeStatus: async () => { calls.push("status"); },
  });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;

  root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')!.click();
  const editor = root.querySelector<HTMLTextAreaElement>("[data-edit-composer] textarea")!;
  editor.value = "Updated";
  root.querySelector<HTMLElement>("[data-edit-composer] button")!.click();
  await Promise.resolve();

  root.querySelector<HTMLElement>("[data-reply-toggle]")!.click();
  root.querySelector<HTMLTextAreaElement>("[data-reply-composer] textarea")!.value = "Reply";
  root.querySelector<HTMLElement>("[data-save-reply]")!.click();
  await Promise.resolve();

  root.querySelector<HTMLElement>('[aria-label="Resolve this comment"]')!.click();
  await Promise.resolve();
  root.querySelector<HTMLElement>('[aria-label="Delete thread"]')!.click();
  await Promise.resolve();

  assert.deepEqual(calls, ["edit", "reply", "status", "delete"]);
});

test("projection refreshes inside edit and reply callbacks keep the active thread visible", async () => {
  const { document } = setup();
  let renderer: ReturnType<typeof createCommentRenderer>;
  const updated = comment({ body: "Updated" });
  const replied = comment({ body: "Updated", replies: [{ id: "00000000-0000-4000-8000-000000000011", body: "Reply", author: { display_name: "LD", role: "ld_dcd" } }] });
  renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => { renderer.setComments([updated]); },
    replyThread: async () => { renderer.setComments([replied]); },
  });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;

  root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')!.click();
  root.querySelector<HTMLTextAreaElement>("[data-edit-composer] textarea")!.value = "Updated";
  root.querySelector<HTMLElement>("[data-edit-composer] button")!.click();
  await settle();
  assert.ok(root.querySelector("[data-thread-popover]"), "edit refresh must not detach the active thread");
  assert.match(root.querySelector<HTMLElement>("[data-thread-popover]")!.textContent!, /Updated/);

  root.querySelector<HTMLElement>("[data-reply-toggle]")!.click();
  root.querySelector<HTMLTextAreaElement>("[data-reply-composer] textarea")!.value = "Reply";
  root.querySelector<HTMLElement>("[data-save-reply]")!.click();
  await settle();
  assert.ok(root.querySelector("[data-thread-popover]"), "reply refresh must not detach the active thread");
  assert.match(root.querySelector<HTMLElement>("[data-thread-popover]")!.textContent!, /Reply/);
});

test("switching threads flushes a queued mutation projection before opening the requested thread", async () => {
  const { document } = setup();
  const first = comment({ body: "First" });
  const second = comment({ id: "00000000-0000-4000-8000-000000000012", body: "Old second" });
  const freshSecond = { ...second, body: "Fresh second" };
  let renderer: ReturnType<typeof createCommentRenderer>;
  renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => { renderer.setComments([{ ...first, body: "First updated" }, freshSecond]); },
  });
  renderer.setComments([first, second]);
  document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${first.id}"]`)!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;
  root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')!.click();
  root.querySelector<HTMLTextAreaElement>("[data-edit-composer] textarea")!.value = "First updated";
  root.querySelector<HTMLElement>("[data-edit-composer] button")!.click();
  await settle();

  const staleSecondMarker = document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${second.id}"]`)!;
  staleSecondMarker.click();

  assert.equal(staleSecondMarker.isConnected, false, "switching threads must replace stale markers from the queued projection");
  assert.match(root.querySelector<HTMLElement>("[data-thread-popover]")!.textContent!, /Fresh second/);
  const freshMarker = document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${second.id}"]`)!;
  assert.match(freshMarker.getAttribute("aria-label")!, /Fresh second/);
  assert.equal(freshMarker.getAttribute("aria-expanded"), "true");
});

test("resolved confirmation survives a callback projection refresh until its three-second timeout", async () => {
  const { window, document } = setup();
  let delayed: (() => void) | undefined;
  window.setTimeout = ((callback: TimerHandler, delay?: number) => { assert.equal(delay, 3000); delayed = callback as () => void; return 1; }) as unknown as typeof window.setTimeout;
  let renderer: ReturnType<typeof createCommentRenderer>;
  renderer = createCommentRenderer(document, pageUrl, {
    changeStatus: async () => { renderer.setComments([comment({ status: "resolved" })]); },
  });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;

  root.querySelector<HTMLElement>('[aria-label="Resolve this comment"]')!.click();
  await settle();
  assert.equal(root.querySelector<HTMLElement>('[aria-label="Resolve this comment"]')?.textContent, "☑ Resolved");
  assert.ok(root.querySelector("[data-thread-popover]"));

  delayed?.();
  assert.equal(root.querySelector("[data-thread-popover]"), null);
  assert.ok(document.querySelector("[data-moodle-review-stored-pin]"), "resolved projection must be applied after confirmation closes");
});

test("delete refresh closes the thread and removes stale renderer artifacts", async () => {
  const { document } = setup();
  let renderer: ReturnType<typeof createCommentRenderer>;
  renderer = createCommentRenderer(document, pageUrl, { deleteThread: async () => { renderer.setComments([]); } });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;

  root.querySelector<HTMLElement>('[aria-label="Delete thread"]')!.click();
  await settle();
  assert.equal(root.querySelector("[data-thread-popover]"), null);
  assert.equal(document.querySelector("[data-moodle-review-stored-pin]"), null);
});

test("takeToContext opens the matching anchored thread and destroy removes renderer artifacts", () => {
  const { document } = setup();
  const renderer = createCommentRenderer(document, pageUrl);
  renderer.setComments([comment()]);

  assert.equal(renderer.takeToContext(comment().id), true);
  assert.ok(document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot?.querySelector("[data-thread-popover]"));
  assert.equal(renderer.takeToContext("00000000-0000-4000-8000-000000000099"), false);

  renderer.destroy();
  assert.equal(document.querySelector("[data-moodle-review-stored-pin]"), null);
  assert.equal(document.querySelector("[data-moodle-review-renderer-root]"), null);
});
