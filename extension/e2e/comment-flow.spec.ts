import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const contentScript = fileURLToPath(new URL("../dist/content.js", import.meta.url));

async function installRuntime(page: Page, role = "beta_tester") {
  await page.addInitScript((fixtureRole) => {
    (globalThis as any).__fixtureRole = fixtureRole;
    const makeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    (globalThis as any).__makeFixture = (anchor: string, url: string, currentRole: string) => currentRole === "sme-unselected" ? [] : [{ id: makeId(anchor === "text_highlight" ? 1 : 2), body: anchor === "text_highlight" ? "Stored top feedback" : "Stored embedded feedback", category: "general", status: "open", author_user_id: makeId(3), author_role: "beta_tester", author_email: "beta@example.test", page_url: url, page_title: "Fixture", anchor_type: anchor, selected_quote: anchor === "text_highlight" ? "important phrase" : null, prefix: anchor === "text_highlight" ? "An " : null, suffix: anchor === "text_highlight" ? " here" : null, css_selector: anchor === "visual_pin" ? "#inside" : null, dom_selector: null, relative_x: anchor === "visual_pin" ? 0.5 : null, relative_y: anchor === "visual_pin" ? 0.5 : null, replies: currentRole === "beta_tester" ? [{ id: makeId(4), body: "Visible LD reply", author_user_id: makeId(5), author_role: "ld_dcd", author_email: "ld@example.test" }] : [{ id: makeId(6), body: "Selected SME view", author_user_id: makeId(7), author_role: "sme", author_email: "selected@example.test" }], status_history: [] }];
    (globalThis as any).chrome = { runtime: { id: "fixture-extension", sendMessage(message: any, callback: (response: any) => void) {
      if (message.type === "RESOLVE_COURSE") return callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
      if (message.type === "GET_REVIEW_CONTEXT") return callback({ ok: true, data: { course_id: "123e4567-e89b-12d3-a456-426614174000", course_title: "Law course", parent_activity_url: "https://moodle.example.invalid/page/one" } });
      if (message.type === "LIST_PAGE_COMMENTS") {
        const make = (globalThis as any).__makeFixture;
        return callback({ ok: true, data: make ? make(location.href.includes("embedded") ? "visual_pin" : "text_highlight", message.page_url, fixtureRole) : [] });
      }
      callback({ ok: true, data: {} });
    } } };
  }, role);
}

async function serve(page: Page) {
  await page.route("https://moodle.example.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: route.request().url().includes("embedded") ? "<!doctype html><title>Embedded</title><div id=inside>Embedded target</div>" : "<!doctype html><title>Fixture</title><h1>Fixture</h1><p>An important phrase here</p><iframe title=Activity src=https://moodle.example.invalid/embedded></iframe>" }));
}

test("stored top highlight survives reload, opens its filtered thread, and clears on navigation", async ({ page }) => {
  await serve(page); await installRuntime(page, "beta_tester");
  for (let load = 0; load < 2; load += 1) {
    await page.goto("https://moodle.example.invalid/page/one"); await page.addScriptTag({ path: contentScript });
    await expect(page.locator("[data-moodle-review-stored-highlight]")).toBeVisible();
    await page.locator("[data-moodle-review-stored-highlight]").click();
    await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.textContent)).toContain("Visible LD reply");
  }
  await page.evaluate(() => history.pushState({}, "", "/page/two"));
  await expect(page.locator("[data-moodle-review-stored-highlight]")).toHaveCount(0);
});

test("stored embedded pin is accessible and role fixtures distinguish selected and unselected SME views", async ({ page }) => {
  await serve(page); await installRuntime(page, "sme-selected"); await page.goto("https://moodle.example.invalid/page/one"); await page.addScriptTag({ path: contentScript });
  const embedded = page.frames().find((candidate) => candidate.url().includes("/embedded"))!; await embedded.addScriptTag({ path: contentScript });
  const frame = page.frameLocator('iframe[title="Activity"]');
  await expect(frame.locator("[data-moodle-review-stored-pin]")).toHaveAttribute("aria-label", /Stored embedded feedback/);
  await frame.locator("[data-moodle-review-stored-pin]").click();
  await expect.poll(() => frame.locator("#moodle-course-review-overlay").evaluate((host: any) => host.shadowRoot.textContent)).toContain("Selected SME view");

  const unselected = await page.context().newPage(); await serve(unselected); await installRuntime(unselected, "sme-unselected"); await unselected.goto("https://moodle.example.invalid/page/one"); await unselected.addScriptTag({ path: contentScript });
  await expect(unselected.locator("[data-moodle-review-stored-highlight]")).toHaveCount(0);
});
