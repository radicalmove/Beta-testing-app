import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { StatefulCommentBackend, type FixtureViewer } from "./stateful-comment-backend.ts";

const contentScript = fileURLToPath(new URL("../dist/content.js", import.meta.url));
const courseId = "123e4567-e89b-12d3-a456-426614174000";
const viewers = {
  beta: { role: "beta_tester", userId: "beta-1", email: "beta@example.test" },
  sme: { role: "sme", userId: "sme-author", email: "author@example.test" },
  selectedSme: { role: "sme", userId: "sme-selected", email: "selected@example.test" },
  otherSme: { role: "sme", userId: "sme-other", email: "other@example.test" },
  ld: { role: "ld_dcd", userId: "ld-1", email: "ld@example.test" },
} satisfies Record<string, FixtureViewer>;

async function installRuntime(page: Page, backend: StatefulCommentBackend) {
  await page.exposeFunction("__fixtureRuntime", (message: any) => {
    if (message.type === "RESOLVE_COURSE") return { ok: true, data: { id: courseId } };
    if (message.type === "GET_REVIEW_CONTEXT") return { ok: true, data: { course_id: courseId, course_title: "Law course", parent_activity_url: "https://moodle.example.invalid/page/one" } };
    if (message.type === "LIST_PAGE_COMMENTS") return { ok: true, data: backend.list(message.page_url) };
    if (message.type === "CREATE_COMMENT") return { ok: true, data: backend.create(message.payload) };
    return { ok: true, data: {} };
  });
  await page.addInitScript(() => {
    (globalThis as any).chrome = { runtime: { id: "fixture-extension", sendMessage(message: unknown, callback: (response: unknown) => void) {
      (globalThis as any).__fixtureRuntime(message).then(callback);
    } } };
  });
}

async function serve(page: Page) {
  await page.route("https://moodle.example.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture</title><h1>Fixture</h1><p id=copy>An important phrase here</p><div id=target style='position:absolute;left:100px;top:180px;width:240px;height:120px'>Pin target</div>" }));
}

async function load(page: Page) {
  await page.goto("https://moodle.example.invalid/page/one");
  await page.addScriptTag({ path: contentScript });
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("#moodle-course-review-overlay")?.shadowRoot))).toBe(true);
}

async function compose(page: Page, action: "highlight" | "pin", body: string, category = "general") {
  const host = page.locator("#moodle-course-review-overlay");
  if (action === "highlight") {
    await page.locator("#copy").evaluate((node) => {
      const text = node.firstChild!; const value = text.textContent!; const start = value.indexOf("important phrase");
      const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + "important phrase".length);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await host.evaluate((node: any) => node.shadowRoot.querySelector('[data-action="highlight"]').click());
  } else {
    await host.evaluate((node: any) => node.shadowRoot.querySelector('[data-action="pin"]').click());
    await page.locator("#target").click({ position: { x: 120, y: 60 } });
  }
  await host.evaluate((node: any, values) => { node.shadowRoot.querySelector("textarea").value = values.body; node.shadowRoot.querySelector("select").value = values.category; }, { body, category });
  await host.evaluate((node: any) => node.shadowRoot.querySelector("[data-save]").click());
  await expect.poll(() => host.evaluate((node: any) => Boolean(node.shadowRoot.querySelector('[role="dialog"]')))).toBe(false);
}

async function openThreadText(page: Page, marker: string) {
  await page.locator(marker).click();
  return page.locator("#moodle-course-review-overlay").evaluate((host: any) => host.shadowRoot.textContent as string);
}

test("beta creates a real highlight; reload recovers its beta/LD-only thread and navigation clears it", async ({ page }) => {
  const backend = new StatefulCommentBackend(); backend.setViewer(viewers.beta);
  await serve(page); await installRuntime(page, backend); await load(page);
  await compose(page, "highlight", "Beta highlighted feedback", "learning_design_content_flow");
  const created = backend.list("https://moodle.example.invalid/page/one")[0]!;
  backend.reply(created.id, viewers.sme, "SME reply must stay hidden");

  await page.reload(); await page.addScriptTag({ path: contentScript });
  await expect(page.locator("[data-moodle-review-stored-highlight]")).toBeVisible();
  const thread = await openThreadText(page, "[data-moodle-review-stored-highlight]");
  expect(thread).toContain("Beta highlighted feedback"); expect(thread).toContain("Fixture LD reply"); expect(thread).not.toContain("SME reply must stay hidden");
  await page.evaluate(() => history.pushState({}, "", "/page/two"));
  await expect(page.locator("[data-moodle-review-stored-highlight]")).toHaveCount(0);
});

test("SME creates a real geometric pin and LD/DCD sees its recovered thread after viewer refresh", async ({ page }) => {
  const backend = new StatefulCommentBackend(); backend.setViewer(viewers.sme);
  await serve(page); await installRuntime(page, backend); await load(page);
  await compose(page, "pin", "SME geometric pin");
  expect(backend.list("https://moodle.example.invalid/page/one")[0]?.author.role).toBe("sme");

  backend.setViewer(viewers.ld); await page.reload(); await page.addScriptTag({ path: contentScript });
  await expect(page.locator("[data-moodle-review-stored-pin]")).toHaveAttribute("aria-label", /SME geometric pin/);
  expect(await openThreadText(page, "[data-moodle-review-stored-pin]")).toContain("SME geometric pin");
});

test("dashboard/server selective share transitions an unshared beta comment to selected-SME-only", async ({ page, context }) => {
  const backend = new StatefulCommentBackend(); backend.setViewer(viewers.beta);
  await serve(page); await installRuntime(page, backend); await load(page); await compose(page, "highlight", "Share only with selected SME");
  const commentId = backend.list("https://moodle.example.invalid/page/one")[0]!.id;

  backend.setViewer(viewers.selectedSme);
  const before = await context.newPage(); await serve(before); await installRuntime(before, backend); await load(before);
  await expect(before.locator("[data-moodle-review-stored-highlight]")).toHaveCount(0); await before.close();

  backend.setViewer(viewers.ld);
  backend.share(commentId, viewers.selectedSme.userId); // In production the dashboard calls the server; the extension deliberately has no sharing UI.
  backend.setViewer(viewers.selectedSme);
  const selected = await context.newPage(); await serve(selected); await installRuntime(selected, backend); await load(selected);
  await expect(selected.locator("[data-moodle-review-stored-highlight]")).toBeVisible();
  expect(await openThreadText(selected, "[data-moodle-review-stored-highlight]")).toContain("Share only with selected SME");

  backend.setViewer(viewers.otherSme);
  const unselected = await context.newPage(); await serve(unselected); await installRuntime(unselected, backend); await load(unselected);
  await expect(unselected.locator("[data-moodle-review-stored-highlight]")).toHaveCount(0);
});
