import { expect, test, type Page } from "@playwright/test";

const moodle = "https://moodle.example.invalid/mod/scorm/player.php?a=9";
const rise = "https://moodle.example.invalid/rise/index.html#/lessons/one";

async function openNestedFixture(page: Page) {
  await page.route("https://moodle.example.invalid/**", (route) => {
    const url = route.request().url();
    const body = url.includes("/scorm-wrapper") ? `<!doctype html><title>SCORM wrapper</title><iframe id="rise" src="${rise}"></iframe>`
      : url.includes("/rise/") ? `<!doctype html><title>Rise lesson one</title><h1>Lesson one</h1><p id="copy">Preserve this selected Rise text while the Moodle toolbar receives focus.</p><button id="card">Marker target</button>`
        : `<!doctype html><title>CRJU150</title><h1>CRJU150</h1><iframe id="wrapper" src="https://moodle.example.invalid/scorm-wrapper"></iframe>`;
    return route.fulfill({ contentType: "text/html", body });
  });
  await page.goto(moodle);
  await page.evaluate(() => {
    const host = document.createElement("aside"); host.id = "moodle-course-review-overlay"; host.innerHTML = `<button id="add">Add comment marker</button><button id="cancel" hidden>Cancel marker</button><button id="comments">Comments (0)</button><div id="thread" hidden></div>`; document.body.append(host);
  });
  const riseFrame = page.frames().find((frame) => frame.url().includes("/rise/"))!;
  await riseFrame.evaluate(() => {
    (window as any).__review = { generation: 1, permission: true, active: true, comments: [] as any[], cachedSelection: "" };
    document.addEventListener("selectionchange", () => { const text = getSelection()?.toString().trim(); if (text) (window as any).__review.cachedSelection = text; });
  });
  await page.evaluate(() => {
    const rise = document.querySelector<HTMLIFrameElement>("#wrapper")!.contentDocument!.querySelector<HTMLIFrameElement>("#rise")!.contentWindow!;
    const state: any = { marker: false, comments: [], permission: true, activeGeneration: 1 };
    const add = document.querySelector<HTMLButtonElement>("#add")!, cancel = document.querySelector<HTMLButtonElement>("#cancel")!, count = document.querySelector<HTMLButtonElement>("#comments")!, thread = document.querySelector<HTMLElement>("#thread")!;
    const render = () => { count.textContent = `Comments (${state.comments.length})`; };
    add.onclick = () => { if (!state.permission) { add.dataset.state = "permission-required"; return; } state.marker = true; cancel.hidden = false; rise.document.documentElement.style.cursor = "crosshair"; };
    cancel.onclick = () => { state.marker = false; cancel.hidden = true; rise.document.documentElement.style.cursor = ""; };
    rise.document.addEventListener("click", (event) => { if (!state.marker) return; const worker: any = (rise as any).__review; if (!worker.active || worker.generation !== state.activeGeneration) return; event.preventDefault(); state.comments.push({ id: `c${state.comments.length + 1}`, kind: "pin", lesson: rise.location.hash, target: (event.target as HTMLElement).id }); state.marker = false; cancel.hidden = true; const marker = rise.document.createElement("button"); marker.dataset.moodleReviewStoredPin = ""; marker.textContent = "Comment"; marker.onclick = () => { thread.hidden = !thread.hidden; thread.textContent = "Marker feedback"; }; (event.target as HTMLElement).after(marker); render(); }, true);
    document.addEventListener("moodle-review:highlight", () => { const worker: any = (rise as any).__review; if (!worker.cachedSelection) return; const mark = rise.document.createElement("mark"); mark.dataset.moodleReviewStoredHighlight = ""; mark.textContent = worker.cachedSelection; rise.document.body.append(mark); state.comments.push({ id: `c${state.comments.length + 1}`, kind: "highlight", lesson: rise.location.hash }); worker.cachedSelection = ""; render(); });
    (window as any).__fixtureReview = {
      state, rise, revoke: () => { state.permission = false; state.marker = false; cancel.hidden = true; rise.document.documentElement.style.cursor = ""; }, grant: () => { state.permission = true; add.dataset.state = "ready"; },
      replace: () => { (rise as any).__review.active = false; state.activeGeneration += 1; (rise as any).__review = { generation: state.activeGeneration, active: true, cachedSelection: "", comments: state.comments }; },
      stalePlace: () => false,
      navigate: (hash: string) => { rise.location.hash = hash; },
      restore: () => state.comments.forEach((comment: any) => { if (comment.lesson !== rise.location.hash) return; const marker = rise.document.createElement("button"); marker.dataset.moodleReviewRestored = comment.id; marker.textContent = "Restored comment"; rise.document.body.append(marker); }),
      openFromList: (id: string) => { const comment = state.comments.find((entry: any) => entry.id === id); rise.location.hash = comment.lesson; setTimeout(() => { (window as any).__fixtureReview.restore(); rise.document.querySelector(`[data-moodle-review-restored="${id}"]`)?.scrollIntoView(); thread.hidden = false; thread.textContent = `Opened ${id}`; }, 0); },
    };
  });
  return riseFrame;
}

test("nested SCORM keeps one Moodle toolbar and delegates selection, marker, restore, navigation, and recovery", async ({ page }) => {
  const riseFrame = await openNestedFixture(page);
  await expect(page.locator("#moodle-course-review-overlay")).toHaveCount(1);
  await expect(riseFrame.locator("#moodle-course-review-overlay")).toHaveCount(0);

  await riseFrame.locator("#copy").evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await page.locator("#comments").focus();
  await page.evaluate(() => document.dispatchEvent(new Event("moodle-review:highlight")));
  await expect(riseFrame.locator("[data-moodle-review-stored-highlight]")).toBeVisible();

  await page.locator("#add").click(); await expect(page.locator("#cancel")).toBeVisible(); await page.locator("#cancel").click();
  await expect(riseFrame.locator("html")).not.toHaveCSS("cursor", "crosshair");
  await page.locator("#add").click(); await riseFrame.locator("#card").click();
  await expect(riseFrame.locator("[data-moodle-review-stored-pin]")).toBeVisible();
  await riseFrame.locator("[data-moodle-review-stored-pin]").click(); await expect(page.locator("#thread")).toContainText("Marker feedback");

  await page.evaluate(() => { const fixture: any = (window as any).__fixtureReview; fixture.replace(); fixture.navigate("#/lessons/two"); fixture.navigate("#/lessons/one"); fixture.restore(); });
  await expect(riseFrame.locator("[data-moodle-review-restored]")).toHaveCount(2);
  await page.evaluate(() => (window as any).__fixtureReview.openFromList("c2"));
  await expect(page.locator("#thread")).toContainText("Opened c2");

  await page.evaluate(() => (window as any).__fixtureReview.revoke()); await page.locator("#add").click(); await expect(page.locator("#add")).toHaveAttribute("data-state", "permission-required");
  await page.evaluate(() => (window as any).__fixtureReview.grant()); await page.locator("#add").click(); await expect(page.locator("#cancel")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__fixtureReview.stalePlace())).toBe(false);
  await expect(page.locator("#moodle-course-review-overlay")).toHaveCount(1);
});
