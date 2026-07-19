import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { createCommentRenderer } from "../src/comment-renderer.ts";
import type { PageComment } from "../src/background-bridge.ts";

const pageUrl = "https://learn.example/mod/page/view.php?id=2";
const otherPageUrl = "https://learn.example/mod/page/view.php?id=3";
const thirdPageUrl = "https://learn.example/mod/page/view.php?id=4";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const comment = (overrides: Partial<PageComment> = {}): PageComment => ({
  id: "00000000-0000-4000-8000-000000000001",
  body: "Move this card",
  category: "general",
  status: "open",
  author: { display_name: "Reviewer", role: "beta_tester" },
  page_url: pageUrl,
  page_title: "Week 2",
  parent_activity_url: null,
  embedded_locator: null,
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

test("contextual thread controls use the established button styles", () => {
  const { document } = setup();
  const renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => {}, replyThread: async () => {},
    deleteThread: async () => {}, changeStatus: async () => {},
  });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;

  assert.ok(root.querySelector('[aria-label="Edit original comment"]')?.classList.contains("thread-edit"));
  assert.equal(root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')?.title, "Edit comment");
  assert.ok(root.querySelector("[data-reply-toggle]")?.classList.contains("thread-reply"));
  assert.equal(root.querySelector<HTMLElement>('[aria-label="Resolve this comment"]')?.textContent, "");
  assert.ok(root.querySelector('[aria-label="Resolve this comment"] svg'));
  assert.ok(root.querySelector('[aria-label="Resolve this comment"] .status-hover-tick'));
  assert.ok(root.querySelector('[aria-label="Delete thread"]')?.classList.contains("thread-delete"));
  assert.equal(root.querySelector<HTMLElement>('[aria-label="Delete thread"]')?.title, "Delete comment thread");
  assert.ok(root.querySelector('[aria-label="Delete thread"] svg'), "delete uses the same white bin artwork as the course list");
  assert.match(root.querySelector("style")!.textContent!, /\.thread-delete\{[^}]*background:#d73b3d/);
  assert.match(root.querySelector("style")!.textContent!, /\.thread-delete:hover\{border-color:#d73b3d;background:#fff\}/);
  assert.match(root.querySelector("style")!.textContent!, /\.resolve-toggle\{right:50px;margin:0;border:2px solid #111;border-radius:2px;background:#fff\}/);
  assert.match(root.querySelector("style")!.textContent!, /\.resolve-toggle:hover \.status-hover-tick\{opacity:\.28\}/);
  assert.match(document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")?.title ?? "", /Open comment/);
});

test("contextual thread uses whole-course open numbering and the requested action layout", () => {
  const { document } = setup();
  const renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => {}, replyThread: async () => {},
    deleteThread: async () => {}, changeStatus: async () => {},
  });
  renderer.setComments([
    comment({ id: "00000000-0000-4000-8000-000000000010", page_url: otherPageUrl, page_title: "Week 1", body: "Earlier" }),
    comment({ id: "00000000-0000-4000-8000-000000000011", status: "resolved", body: "Resolved" }),
    comment({ id: "00000000-0000-4000-8000-000000000012", body: "Current" }),
    comment({ id: "00000000-0000-4000-8000-000000000013", page_url: thirdPageUrl, page_title: "Week 3", body: "Later" }),
  ]);
  document.querySelector<HTMLElement>('[data-moodle-review-stored-pin="00000000-0000-4000-8000-000000000012"]')!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;

  assert.equal(root.querySelector<HTMLElement>("[data-thread-position]")?.textContent, "Comment 2 of 3");
  assert.deepEqual(
    Array.from(root.querySelectorAll<HTMLElement>("[data-thread-top-actions] > button")).map((button) => button.getAttribute("aria-label")),
    ["Edit original comment", "Resolve this comment", "Delete thread"],
  );
  assert.deepEqual(
    Array.from(root.querySelectorAll<HTMLElement>("[data-thread-navigation] > button")).map((button) => button.textContent),
    ["Previous", "Reply", "Next"],
  );
  assert.match(root.querySelector("style")!.textContent!, /\.thread-edit\{[^}]*right:92px[^}]*border:2px solid #a84f12/);
  assert.match(root.querySelector("style")!.textContent!, /\.thread-navigation\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test("previous and next navigate through open comments across the whole course", async () => {
  const { document } = setup();
  const navigations: Array<[string, string]> = [];
  const current = comment({ id: "00000000-0000-4000-8000-000000000022", page_title: "Week 2", body: "Current" });
  const renderer = createCommentRenderer(document, pageUrl, {
    replyThread: async () => {},
    navigateToComment: async (id, url) => { navigations.push([id, url]); },
  });
  renderer.setComments([
    comment({ id: "00000000-0000-4000-8000-000000000021", page_url: otherPageUrl, page_title: "Week 1", body: "Previous" }),
    current,
    comment({ id: "00000000-0000-4000-8000-000000000023", status: "resolved", page_title: "Week 2", body: "Skip me" }),
    comment({ id: "00000000-0000-4000-8000-000000000024", page_url: thirdPageUrl, page_title: "Week 3", body: "Next" }),
  ]);
  document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${current.id}"]`)!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;

  root.querySelector<HTMLButtonElement>('[data-thread-navigation] [data-direction="previous"]')!.click();
  await settle();
  root.querySelector<HTMLButtonElement>('[data-thread-navigation] [data-direction="next"]')!.click();
  await settle();

  assert.deepEqual(navigations, [
    ["00000000-0000-4000-8000-000000000021", otherPageUrl],
    ["00000000-0000-4000-8000-000000000024", thirdPageUrl],
  ]);
});

test("editing uploads the selected attachment after saving the text", async () => {
  const { window, document } = setup();
  const calls: string[] = [];
  const renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => { calls.push("edit"); },
    uploadAttachment: async (_id, dataUrl) => { calls.push(`upload:${dataUrl}`); },
  });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;
  root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')!.click();
  root.querySelector<HTMLTextAreaElement>("[data-edit-composer] textarea")!.value = "Updated";
  const attachment = root.querySelector<HTMLInputElement>("[data-edit-composer] [data-attachment]")!;
  Object.defineProperty(attachment, "files", { value: [new window.File(["notes"], "notes.pdf", { type: "application/pdf" })] });
  root.querySelector<HTMLElement>("[data-edit-composer] [data-save-edit]")!.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(calls[0], "edit");
  assert.match(calls[1] ?? "", /^upload:data:application\/pdf;base64,/);
});

test("edit composer presents separated semantic save and cancel buttons", () => {
  const { document } = setup();
  const renderer = createCommentRenderer(document, pageUrl, { editThread: async () => {} });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;
  root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')!.click();

  const actions = root.querySelector<HTMLElement>("[data-edit-actions]")!;
  assert.deepEqual(Array.from(actions.children).map((node) => node.textContent), ["Save", "Cancel"]);
  assert.equal(actions.querySelector("[data-cancel-edit]")?.className, "edit-cancel");
  assert.equal(actions.querySelector("[data-save-edit]")?.className, "edit-save");
  assert.match(root.querySelector("style")!.textContent!, /\.edit-actions\{display:flex;justify-content:flex-end;gap:8px/);
  assert.match(root.querySelector("style")!.textContent!, /\.edit-save\{border-color:#073f3e;background:#073f3e;color:#fff\}/);
  assert.match(root.querySelector("style")!.textContent!, /\.edit-cancel\{border-color:#a84f12;background:#fff;color:#a84f12\}/);
});

test("replying uploads the selected attachment after saving the reply", async () => {
  const { window, document } = setup();
  const calls: string[] = [];
  const renderer = createCommentRenderer(document, pageUrl, {
    replyThread: async () => { calls.push("reply"); },
    uploadAttachment: async (_id, dataUrl) => { calls.push(`upload:${dataUrl}`); },
  });
  renderer.setComments([comment()]);
  document.querySelector<HTMLElement>("[data-moodle-review-stored-pin]")!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;
  root.querySelector<HTMLElement>("[data-reply-toggle]")!.click();
  root.querySelector<HTMLTextAreaElement>("[data-reply-composer] textarea")!.value = "Reply";
  const attachment = root.querySelector<HTMLInputElement>("[data-reply-composer] [data-attachment]")!;
  Object.defineProperty(attachment, "files", { value: [new window.File(["image"], "image.png", { type: "image/png" })] });
  root.querySelector<HTMLElement>("[data-save-reply]")!.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(calls[0], "reply");
  assert.match(calls[1] ?? "", /^upload:data:image\/png;base64,/);
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

test("switching threads survives an intermediate empty mutation projection", async () => {
  const { document } = setup();
  const first = comment({ body: "First" });
  const second = comment({ id: "00000000-0000-4000-8000-000000000012", body: "Old second" });
  const freshSecond = { ...second, body: "Fresh second" };
  let releaseFetch!: () => void;
  const fetchFinished = new Promise<void>((resolve) => { releaseFetch = resolve; });
  let renderer: ReturnType<typeof createCommentRenderer>;
  renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => {
      renderer.setComments([]);
      await fetchFinished;
      renderer.setComments([{ ...first, body: "First updated" }, freshSecond]);
    },
  });
  renderer.setComments([first, second]);
  document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${first.id}"]`)!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;
  root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')!.click();
  root.querySelector<HTMLTextAreaElement>("[data-edit-composer] textarea")!.value = "First updated";
  root.querySelector<HTMLElement>("[data-edit-composer] button")!.click();
  await settle();

  document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${second.id}"]`)!.click();
  assert.equal(root.querySelector("[data-thread-popover]"), null, "the stale thread must not open while the empty projection is current");

  releaseFetch();
  await settle();

  assert.equal(root.querySelectorAll("[data-thread-popover]").length, 1);
  assert.match(root.querySelector<HTMLElement>("[data-thread-popover]")!.textContent!, /Fresh second/);
  const freshMarker = document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${second.id}"]`)!;
  assert.match(freshMarker.getAttribute("aria-label")!, /Fresh second/);
  assert.equal(freshMarker.getAttribute("aria-expanded"), "true");
});

test("a deferred thread request is cleared when the mutation confirms that thread disappeared", async () => {
  const { document } = setup();
  const first = comment({ body: "First" });
  const second = comment({ id: "00000000-0000-4000-8000-000000000012", body: "Second" });
  let releaseFetch!: () => void;
  const fetchFinished = new Promise<void>((resolve) => { releaseFetch = resolve; });
  let renderer: ReturnType<typeof createCommentRenderer>;
  renderer = createCommentRenderer(document, pageUrl, {
    editThread: async () => {
      renderer.setComments([]);
      await fetchFinished;
      renderer.setComments([{ ...first, body: "First updated" }]);
    },
  });
  renderer.setComments([first, second]);
  document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${first.id}"]`)!.click();
  const root = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!.shadowRoot!;
  root.querySelector<HTMLElement>('[aria-label="Edit original comment"]')!.click();
  root.querySelector<HTMLTextAreaElement>("[data-edit-composer] textarea")!.value = "First updated";
  root.querySelector<HTMLElement>("[data-edit-composer] button")!.click();
  await settle();
  document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${second.id}"]`)!.click();

  releaseFetch();
  await settle();
  assert.equal(root.querySelector("[data-thread-popover]"), null);

  renderer.setComments([{ ...first, body: "First updated" }, { ...second, body: "Unrelated later refresh" }]);
  assert.equal(root.querySelector("[data-thread-popover]"), null, "a later projection must not revive a request for a removed thread");
  assert.equal(document.querySelector<HTMLElement>(`[data-moodle-review-stored-pin="${second.id}"]`)!.getAttribute("aria-expanded"), "false");
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
  assert.ok(root.querySelector<HTMLElement>('[aria-label="Resolve this comment"] svg path'), "resolved confirmation uses the green pen tick");
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
