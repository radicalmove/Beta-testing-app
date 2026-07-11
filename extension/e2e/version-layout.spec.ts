import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const contentScript = fileURLToPath(new URL("../dist/content.js", import.meta.url));

test("version remains accessible without overlapping review controls at 320 CSS pixels and 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await page.route("https://moodle.example.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture</title><h1>Law</h1>" }));
  await page.addInitScript(() => {
    (globalThis as any).chrome = { runtime: { id: "fixture-extension", sendMessage(message: any, callback: (response: unknown) => void) {
      callback(message.type === "RESOLVE_COURSE" ? { ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } } : { ok: true, data: [] });
    } } };
  });
  await page.goto("https://moodle.example.invalid/course/view.php?id=1");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await page.addScriptTag({ path: contentScript });
  const host = page.locator("#moodle-course-review-overlay");
  await expect.poll(() => host.evaluate((node: any) => Boolean(node.shadowRoot))).toBe(true);

  const boxes = await host.evaluate((node: any) => {
    const box = (selector: string) => node.shadowRoot.querySelector(selector).getBoundingClientRect().toJSON();
    return [box("[data-pilot-version]"), box("[data-auth-status]"), box("[data-review-controls]")];
  });
  const intersects = (a: any, b: any) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(intersects(boxes[0], boxes[1])).toBe(false);
  expect(intersects(boxes[0], boxes[2])).toBe(false);
  expect(intersects(boxes[1], boxes[2])).toBe(false);
  await expect(host.getByLabel("Pilot version 0.2.0")).toBeVisible();

  await host.locator('[data-action="panel"]').click();
  await host.locator('[data-action="panel"]').focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => host.evaluate((node: any) => node.shadowRoot.activeElement?.hasAttribute("data-build-diagnostic"))).toBe(true);
  await expect(host.locator("[data-build-diagnostic]")).toHaveAccessibleName("Version 0.2.0 · build 0000000");
});
