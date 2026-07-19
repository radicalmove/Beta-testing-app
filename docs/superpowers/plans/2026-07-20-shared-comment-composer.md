# Shared Comment Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Create, Edit, and Reply use the approved shared composer layout, icon, alignment, and controls.

**Architecture:** Add one focused icon module that supplies the exact approved floppy SVG markup and DOM node. Use the same composer class contract in the overlay and contextual renderer while preserving submission, attachment, navigation, errors, cleanup, and focus behaviour.

**Tech Stack:** TypeScript, DOM/Shadow DOM, inline CSS, Node test runner, JSDOM, Playwright, Vite.

---

### Task 1: Shared Save Icon and Edit Adoption

**Files:**
- Create: `extension/src/ui/save-icon.ts`
- Modify: `extension/src/comment-renderer.ts`
- Test: `extension/tests/comment-renderer.test.ts`

- [ ] **Step 1: Write the failing icon test**

Extend the Edit composer test to assert:

```ts
const icon = fieldRow.querySelector("[data-save-edit] svg")!;
assert.equal(icon.getAttribute("viewBox"), "0 0 24 24");
assert.equal(icon.querySelector("path")?.getAttribute("d"), APPROVED_SAVE_ICON_PATH);
assert.equal(icon.querySelector("path")?.getAttribute("fill-rule"), "evenodd");
assert.equal(fieldRow.querySelector<HTMLElement>("[data-save-edit]")?.title, "Save edited comment");
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `node --test --test-concurrency=1 tests/comment-renderer.test.ts`

Expected: FAIL because the current local Edit icon uses different path data.

- [ ] **Step 3: Implement the shared icon helper**

Create `extension/src/ui/save-icon.ts` exporting:

```ts
export const APPROVED_SAVE_ICON_PATH = "M5 2h12l5 5v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm2 1v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4.4L16.6 3H7Zm1 13v6h8v-6H8Zm3-13v5h4V3h-4Z";
export function saveIconMarkup(): string;
export function createSaveIcon(document: Document): SVGSVGElement;
```

Both helpers use `viewBox="0 0 24 24"`, one `.save-silhouette` path, `fill-rule="evenodd"`, and `aria-hidden="true"`. Replace the renderer's local `saveIcon()` with `createSaveIcon()`.

- [ ] **Step 4: Run the renderer test and verify GREEN**

Run the command from Step 2 and expect all renderer tests to pass.

### Task 2: Contextual Edit and Reply Layout

**Files:**
- Modify: `extension/src/comment-renderer.ts`
- Test: `extension/tests/comment-renderer.test.ts`

- [ ] **Step 1: Write failing Reply structure tests**

Migrate the existing Edit test away from `.edit-field-row`, `.edit-save`, `.edit-cancel`, and `.edit-actions` to the shared class names, then open Reply and assert the same contract for both modes:

```ts
const row = root.querySelector<HTMLElement>('[data-reply-composer] [data-composer-field-row]')!;
assert.deepEqual(Array.from(row.children).map((node) => node.tagName), ["TEXTAREA", "BUTTON"]);
assert.equal(row.querySelector("[data-save-reply]")?.getAttribute("aria-label"), "Save reply");
assert.equal(row.querySelector<HTMLElement>("[data-save-reply]")?.title, "Save reply");
assert.equal(root.querySelector('[data-composer-actions]')?.previousElementSibling?.getAttribute('data-thread-navigation'), "true");
assert.deepEqual(Array.from(root.querySelector('[data-composer-actions]')!.children).map((node) => node.textContent), ["Cancel"]);
```

For both Edit and Reply, also assert that the attachment label is the field row's immediate sibling and that `[data-thread-navigation]` is the immediate previous sibling of `[data-composer-actions]`. This proves the exact field row → attachment → navigation → Cancel ordering rather than only checking that all controls exist.

Also assert shared CSS contains:

```css
.comment-composer-field-row{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:start}
.comment-composer-save{width:34px;height:34px;min-height:34px}
.comment-composer-actions{display:flex;justify-content:flex-end}
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `node --test --test-concurrency=1 tests/comment-renderer.test.ts`

Expected: FAIL because Reply currently uses text Save/Cancel buttons before the external navigation.

- [ ] **Step 3: Implement one contextual composer builder**

Add a local `createComposerControls(input)` helper returning `{ composer, textarea, attachment, save, actions, cancel }`. It creates:

1. `.comment-composer-field-row` containing textarea and icon Save.
2. The existing attachment label.
3. A detached `.comment-composer-actions` containing only Cancel.

Edit and Reply insert `composer` immediately after the comment body/replies, retain the existing `.thread-navigation`, then insert `actions` immediately after navigation. Their visible sequence is therefore field row → attachment → navigation → Cancel. Both close functions remove `composer` and `actions`, restore the original body where applicable, reset `aria-pressed`/`aria-expanded`, and restore focus to the initiating button. Switching between modes performs the same cleanup before opening the other mode.

Use the shared icon and these exact controls:

```css
.comment-composer-field-row{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:start}
.comment-composer-field-row textarea{min-width:0}
.comment-composer-save{box-sizing:border-box;width:34px;height:34px;min-height:34px;padding:2px;border:2px solid #176b43;border-radius:5px;background:#176b43;color:#fff}
.comment-composer-save:hover{background:#fff;color:#176b43}
.comment-composer-actions{display:flex;justify-content:flex-end;margin-top:8px}
.comment-composer-cancel{box-sizing:border-box;height:34px;min-height:34px;padding:3px 9px;border:2px solid #d73b3d;border-radius:5px;background:#d73b3d;color:#fff;font:inherit;font-weight:650;line-height:1}
.comment-composer-cancel:hover{background:#fff;color:#d73b3d}
```

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run the command from Step 2 and expect all renderer tests, including edit/reply attachments and focus restoration, to pass.

### Task 3: Initial Creation Layout

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay-focus.test.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing creation-dialog tests**

Assert `.comment-composer-field-row` contains textarea then `[data-save]`, Save has the approved SVG, `aria-label="Save comment"`, and `title="Save comment"`; attachment immediately follows the row; `.comment-composer-actions` is the final composer element and contains only Cancel. Assert there is no contextual navigation, the error alert is a sibling outside `.comment-composer`, and the CSS includes the shared 34px column.

At narrow width, assert the stylesheet contains:

```css
@media(max-width:420px){.comment-composer-actions button{flex:0 0 auto}}
```

This overrides the existing general `.actions button{flex:1 1 auto}` rule so Cancel remains its content width and aligned to the same right boundary as Save.

- [ ] **Step 2: Run overlay tests and verify RED**

Run: `node --test --test-concurrency=1 tests/overlay-focus.test.ts tests/overlay.test.ts`

Expected: FAIL because creation currently uses a text Save beside Cancel.

- [ ] **Step 3: Implement initial creation composer**

Import `saveIconMarkup()`. Preserve the heading and preview, then render this sequence:

```html
<div class="comment-composer">
  <div class="comment-composer-field-row"><textarea ...></textarea><button data-save ... aria-label="Save comment" title="Save comment">[shared SVG]</button></div>
  <label class="field">Attach a file ...</label>
  <div class="comment-composer-actions"><button data-cancel>Cancel</button></div>
</div>
<div class="error" role="alert" hidden></div>
```

Use the same CSS geometry and button styling from Task 2 in the overlay Shadow DOM, plus the narrow override. Keep the error outside the composer as its following sibling. Preserve initial focus, validation, upload, keyboard trap, error display, and cancellation callbacks.

- [ ] **Step 4: Run overlay tests and verify GREEN**

Run the command from Step 2 and expect all overlay tests to pass.

### Task 4: Regression Verification and Pilot Release

The user requested the change be packaged as the next testable pilot, consistent with the established project workflow.

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `tests/test_deployment_package.py`
- Modify: `docs/pilot-test-script.md`

- [ ] **Step 1: Bump the pilot version to 0.4.55**

Update every tested version reference together.

- [ ] **Step 2: Run full verification**

Run:

```bash
cd extension
npm test
npm run typecheck
npm run test:e2e
cd ..
python3 -m unittest tests.test_deployment_package
git diff --check
```

Expected: unit tests, Playwright tests, and deployment tests pass; TypeScript reports no errors; Vite builds successfully as part of `test:e2e`; `git diff --check` is silent.

- [ ] **Step 3: Commit implementation**

```bash
git add extension docs/pilot-test-script.md tests/test_deployment_package.py
git commit -m "style: unify comment composers"
```

The release requires a clean tracked worktree because the script fingerprints the committed source and refuses a changing HEAD.

- [ ] **Step 4: Release pilot 0.4.55**

Run exactly:

```bash
PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' \
REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' \
deploy/scripts/release-pilot-extension.sh
```

Expected output ends with `Released verified pilot extension to /Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds`.

- [ ] **Step 5: Verify canonical artifacts**

Confirm:

- `/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension/manifest.json` reports `0.4.55`.
- Its `RELEASE.json` reports `0.4.55` and the new commit.
- `moodle-review-extension-v0.4.55-chrome-edge.zip` and `moodle-review-extension-chrome-edge.zip` match.
- `shasum -a 256 -c SHA256SUMS` passes in the pilot-builds directory.
