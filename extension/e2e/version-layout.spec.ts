import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const contentScript = fileURLToPath(new URL("../dist/content.js", import.meta.url));

test("version remains accessible without overlapping review controls at 320 CSS pixels and 200% zoom", async ({ page }) => {
  // At 200% browser zoom a 640px-wide device viewport exposes a 320 CSS px layout viewport.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route("https://moodle.example.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture</title><h1>Law</h1>" }));
  await page.addInitScript(() => {
    (globalThis as any).chrome = { runtime: { id: "fixture-extension", sendMessage(message: any, callback: (response: unknown) => void) {
      if (message.type === "RESOLVE_COURSE") callback({ ok: true, data: { id: "123e4567-e89b-12d3-a456-426614174000" } });
      else if (message.type === "GET_CURRENT_VIEWER") callback({ ok: true, data: { id: "123e4567-e89b-42d3-a456-426614174001", email: "ld@example.test", display_name: "Fixture LD", role: "ld_dcd" } });
      else callback({ ok: true, data: [] });
    } } };
  });
  await page.goto("https://moodle.example.invalid/course/view.php?id=1");
  await page.addScriptTag({ path: contentScript });
  const host = page.locator("#moodle-course-review-overlay");
  await expect.poll(() => host.evaluate((node: any) => Boolean(node.shadowRoot))).toBe(true);

  const layout = await host.evaluate((node: any) => {
    const box = (selector: string) => node.shadowRoot.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      boxes: [box(".shell"), box("[data-auth-status]"), box("[data-review-controls]")],
    };
  });
  const boxes = layout.boxes.slice(1);
  for (const box of layout.boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(layout.viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(layout.viewport.height);
  }
  const intersects = (a: any, b: any) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(intersects(boxes[0], boxes[1])).toBe(false);

  await host.locator('[data-action="help"]').click();
  await expect(host.getByText("Pilot 0.4.21 · build 0000000")).toBeVisible();
});
