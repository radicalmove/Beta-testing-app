import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const contentScript = fileURLToPath(new URL("../dist/content.js", import.meta.url));

async function openFixture(page: Page, inaccessible = false) {
  await page.addInitScript(() => {
    (globalThis as any).chrome = {
      runtime: {
        id: "fixture-extension",
        sendMessage(message: any, callback: (response: any) => void) {
          if (message.type === "RESOLVE_COURSE") { callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } }); return; }
          if (message.type === "GET_REVIEW_CONTEXT") { callback({ ok: true, data: { course_id: "123e4567-e89b-12d3-a456-426614174000", course_title: "Law course", parent_activity_url: "https://moodle.example.invalid/mod/page/view.php?id=9" } }); return; }
          if (message.type === "GET_REVIEW_FRAME_STATUS") { callback({ ok: true, data: { ready: !document.querySelector('iframe[title="External activity"]') } }); return; }
          callback({ ok: true, data: {} });
        },
      },
    };
  });
  await page.route("https://moodle.example.invalid/**", (route) => route.fulfill({
    contentType: "text/html",
    body: route.request().url().includes("embedded")
      ? "<!doctype html><title>Embedded lesson</title><p id=inside>Select accessible activity content for review.</p>"
      : `<!doctype html><title>Week 2</title><h1>Week 2</h1><nav aria-label="Breadcrumb"><a href="/course/view.php?id=7">Law course</a></nav>${inaccessible ? '<iframe title="External activity" src="https://rise.example.invalid/activity"></iframe>' : '<iframe title="Course activity" src="https://moodle.example.invalid/embedded#/lesson/1"></iframe>'}`,
  }));
  await page.route("https://rise.example.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><p>External content</p>" }));
  await page.goto("https://moodle.example.invalid/mod/page/view.php?id=9");
  await page.addScriptTag({ path: contentScript });
  if (!inaccessible) await page.frames().find((frame) => frame !== page.mainFrame())!.addScriptTag({ path: contentScript });
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("#moodle-course-review-overlay")?.shadowRoot))).toBe(true);
}

test("accessible iframe mounts the overlay and keyboard dialog focuses and closes", async ({ page }) => {
  await openFixture(page);
  const activity = page.frameLocator('iframe[title="Course activity"]');
  await expect(activity.locator("#moodle-course-review-overlay")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.textContent?.includes("frame access unavailable"))).toBe(false);
  await activity.locator("#inside").evaluate((node) => {
    const text = node.firstChild!;
    const range = document.createRange(); range.selectNodeContents(text);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    (document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.querySelector('[data-action="highlight"]') as HTMLElement).click();
  });
  await expect.poll(() => activity.locator("#moodle-course-review-overlay").evaluate((host: any) => host.shadowRoot.activeElement?.tagName)).toBe("TEXTAREA");
  await activity.locator("body").press("Escape");
  await expect.poll(() => activity.locator("#moodle-course-review-overlay").evaluate((host: any) => Boolean(host.shadowRoot.querySelector('[role="dialog"]')))).toBe(false);
  await expect.poll(() => activity.locator("#moodle-course-review-overlay").evaluate((host: any) => host.shadowRoot.activeElement?.dataset.action)).toBe("highlight");
});

test("inaccessible cross-origin iframe shows the exact parent-page fallback", async ({ page }) => {
  await openFixture(page, true);
  await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.textContent)).toContain("embedded content—frame access unavailable");
  await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.textContent)).toContain("Place a pin on the embedded content instead.");
});
