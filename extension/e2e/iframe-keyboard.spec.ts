import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const contentScript = fileURLToPath(new URL("../dist/content.js", import.meta.url));

async function openFixture(page: Page, inaccessible = false) {
  await page.addInitScript(() => {
    (globalThis as any).chrome = {
      runtime: {
        id: "fixture-extension",
        sendMessage(message: any, callback: (response: any) => void) {
          callback(message.type === "RESOLVE_COURSE" ? { ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } } : { ok: true, data: {} });
        },
      },
    };
  });
  await page.route("https://moodle.example.invalid/**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><title>Week 2</title><h1>Week 2</h1><nav aria-label="Breadcrumb"><a href="/course/view.php?id=7">Law course</a></nav><p id="lesson">Select this review sentence for a comment.</p>${inaccessible ? '<iframe title="External activity" src="https://rise.example.invalid/activity"></iframe>' : '<iframe title="Course activity" srcdoc="<!doctype html><p id=inside>Accessible activity content</p>"></iframe>'}`,
  }));
  await page.route("https://rise.example.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><p>External content</p>" }));
  await page.goto("https://moodle.example.invalid/mod/page/view.php?id=9");
  await page.addScriptTag({ path: contentScript });
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("#moodle-course-review-overlay")?.shadowRoot))).toBe(true);
}

test("accessible iframe mounts the overlay and keyboard dialog focuses and closes", async ({ page }) => {
  await openFixture(page);
  expect(await page.frameLocator('iframe[title="Course activity"]').locator("#inside").textContent()).toBe("Accessible activity content");
  await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.textContent?.includes("frame access unavailable"))).toBe(false);
  await page.evaluate(() => {
    const text = document.querySelector("#lesson")!.firstChild!;
    const range = document.createRange(); range.selectNodeContents(text);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    (document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.querySelector('[data-action="highlight"]') as HTMLElement).click();
  });
  await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.activeElement?.tagName)).toBe("TEXTAREA");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.querySelector('[role="dialog"]')))).toBe(false);
  await expect.poll(() => page.evaluate(() => (document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.activeElement as HTMLElement)?.dataset.action)).toBe("highlight");
});

test("inaccessible cross-origin iframe shows the exact parent-page fallback", async ({ page }) => {
  await openFixture(page, true);
  await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.textContent)).toContain("embedded content—frame access unavailable");
  await expect.poll(() => page.evaluate(() => document.querySelector("#moodle-course-review-overlay")!.shadowRoot!.textContent)).toContain("Place a pin on the embedded content instead.");
});
