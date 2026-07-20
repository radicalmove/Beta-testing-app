# Existing Icon Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the extension's existing Save, Edit, Delete, and Help symbols with one original, local outline-SVG family while preserving every existing button contract and leaving Resolve and text-only controls unchanged.

**Architecture:** A focused `icon-family.ts` module owns the four approved SVG geometries and exposes both DOM and markup constructors. The contextual renderer and main overlay consume this shared module; button CSS continues to own semantic colour, sizing, and hover inversion through `currentColor`. Existing handwritten Resolve geometry remains local and unchanged.

**Tech Stack:** TypeScript, inline SVG, Shadow DOM, Happy DOM/node:test, Vite, Playwright.

---

## File map

- Create `extension/src/ui/icon-family.ts`: typed icon names, exact geometry, DOM and string-markup constructors.
- Delete `extension/src/ui/save-icon.ts`: superseded single-purpose helper.
- Create `extension/tests/icon-family.test.ts`: family geometry, local-only rendering, and accessibility-neutral SVG tests.
- Modify `extension/src/comment-renderer.ts`: shared Save/Edit/Delete icons and family-compatible CSS.
- Modify `extension/tests/comment-renderer.test.ts`: all contextual surfaces, selectors, labels, state, Resolve exclusion, and text-only exclusions.
- Modify `extension/src/overlay/root.ts`: shared initial Save, course-row Delete, and toolbar Help icons and family-compatible CSS.
- Modify `extension/tests/overlay-focus.test.ts`: initial Save and toolbar Help contracts.
- Modify `extension/tests/overlay.test.ts`: toolbar Help, course-row Delete, Resolve, and text-only exclusions.
- Modify version/pilot files after behavior is green.

### Task 1: Shared original icon-family module

**Files:**
- Create: `extension/src/ui/icon-family.ts`
- Create: `extension/tests/icon-family.test.ts`
- Delete after migration: `extension/src/ui/save-icon.ts`

- [ ] **Step 1: Write failing family tests**

Test the wished-for API:

```ts
import { Window } from "happy-dom";
import { createReviewIcon, reviewIconMarkup } from "../src/ui/icon-family.ts";

const expected = {
  save: ['M5 3h11l3 3v15H5z', 'M8 3v6h8V3', 'M8 21v-7h8v7'],
  edit: ['M4 20l4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10z', 'm14.5 7.5 3 3M5.5 16l3 3'],
  delete: ['M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6'],
  help: ['circle', 'M9.75 9a2.4 2.4 0 1 1 3.38 2.2c-.75.36-1.13.9-1.13 1.8', 'circle'],
};

test("review icons use the approved local outline family", () => {
  const document = new Window().document as unknown as Document;
  for (const name of ["save", "edit", "delete", "help"] as const) {
    const icon = createReviewIcon(document, name);
    assert.equal(icon.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(icon.dataset.reviewIcon, name);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.equal(icon.querySelector("image, mask, use"), null);
    assert.doesNotMatch(icon.outerHTML, /(?:href|url\(|data:image|font-family)/);
    assert.match(icon.outerHTML, /currentColor/);
    assert.match(reviewIconMarkup(name), new RegExp(`data-review-icon="${name}"`));
  }
});
```

Add exact primitive/path assertions for each entry in `expected`.

- [ ] **Step 2: Run the new test and verify RED**

Run: `cd extension && node --test --test-concurrency=1 tests/icon-family.test.ts`

Expected: FAIL because `src/ui/icon-family.ts` does not exist.

- [ ] **Step 3: Implement the minimal family module**

Use this public contract:

```ts
export type ReviewIconName = "save" | "edit" | "delete" | "help";
export function reviewIconMarkup(name: ReviewIconName): string;
export function createReviewIcon(document: Document, name: ReviewIconName): SVGSVGElement;
```

Every SVG must have `viewBox="0 0 24 24"`, `aria-hidden="true"`, `data-review-icon="{name}"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, and `stroke-linejoin="round"`. Use the exact primitives from `docs/superpowers/specs/2026-07-20-icon-family-design.md`. Help's dot alone uses `fill="currentColor"` and `stroke="none"`.

- [ ] **Step 4: Run the family test and verify GREEN**

Run: `cd extension && node --test --test-concurrency=1 tests/icon-family.test.ts && npm run typecheck`

Expected: the new family test and typecheck pass.

- [ ] **Step 5: Commit the isolated family**

```bash
git add extension/src/ui/icon-family.ts extension/tests/icon-family.test.ts
git commit -m "feat: add shared review icon family"
```

### Task 2: Contextual comment controls

**Files:**
- Modify: `extension/src/comment-renderer.ts`
- Modify: `extension/tests/comment-renderer.test.ts`

- [ ] **Step 1: Extend contextual tests before production changes**

Add assertions that:

- Edit and Reply composer Save buttons contain `[data-review-icon="save"]` and preserve `data-save-edit`/`data-save-reply`, their distinct `aria-label` and `title` values.
- `.thread-edit` contains `[data-review-icon="edit"]`, has no Unicode pencil text, preserves `aria-label="Edit original comment"` and `title="Edit comment"`, and follows absent → `"true"` → `"false"` for `aria-pressed`.
- `.thread-delete` contains `[data-review-icon="delete"]` and preserves `aria-label="Delete thread"` and `title="Delete comment thread"`.
- `.resolve-toggle` still contains its existing `.status-hover-tick`/`.status-resolved-tick` path and does not contain `[data-review-icon]`.
- `.thread-previous`, `.thread-reply`, and `.thread-next` have no SVG descendants.

- [ ] **Step 2: Run contextual tests and verify RED**

Run: `cd extension && node --test --test-concurrency=1 tests/comment-renderer.test.ts`

Expected: FAIL because Edit/Delete still use independent glyph/path implementations.

- [ ] **Step 3: Migrate the renderer to the shared module**

Replace the `createSaveIcon` import and local `deleteIcon` helper with `createReviewIcon`. Append `createReviewIcon(document, "save")`, `createReviewIcon(document, "edit")`, and `createReviewIcon(document, "delete")` at the specified sites. Remove `edit.textContent = "✎"`.

Update only icon-dependent CSS:

```css
.thread-edit svg,.thread-delete svg,.resolve-toggle svg{display:block;width:100%;height:100%}
.thread-delete:hover{border-color:#d73b3d;background:#fff;color:#d73b3d}
```

Do not change button dimensions, colours, selectors, tooltips, labels, state transitions, navigation, or Resolve SVG code.

- [ ] **Step 4: Run contextual tests and verify GREEN**

Run: `cd extension && node --test --test-concurrency=1 tests/comment-renderer.test.ts && npm run typecheck`

Expected: contextual tests and typecheck pass.

- [ ] **Step 5: Commit renderer migration**

```bash
git add extension/src/comment-renderer.ts extension/tests/comment-renderer.test.ts
git commit -m "feat: apply icon family to comment threads"
```

### Task 3: Main overlay controls

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay-focus.test.ts`
- Modify: `extension/tests/overlay.test.ts`
- Delete: `extension/src/ui/save-icon.ts`

- [ ] **Step 1: Extend overlay tests before production changes**

Assert that:

- Initial creation `[data-save]` contains `[data-review-icon="save"]` and preserves `aria-label="Save comment"` and `title="Save comment"`.
- `[data-action="help"]` contains `[data-review-icon="help"]`, has no literal `?` text, preserves its label/title, and transitions `aria-expanded` `"false"` → `"true"` → `"false"`.
- Every `[data-comment-action="delete"].delete-action` contains `[data-review-icon="delete"]` and retains matching dynamic `Delete comment {course index}` label/title.
- Comments, Add comment marker, Whole course, Current page, Open, Resolved, Jump to, Close help, and Cancel have no SVG descendants.
- Status/Resolve controls retain the existing handwritten tick and do not use `[data-review-icon]`.

- [ ] **Step 2: Run overlay tests and verify RED**

Run: `cd extension && node --test --test-concurrency=1 tests/overlay-focus.test.ts tests/overlay.test.ts`

Expected: FAIL because toolbar Help and course-row Delete still use old symbols.

- [ ] **Step 3: Migrate overlay controls**

Import `reviewIconMarkup` and `createReviewIcon` from `../ui/icon-family.ts`. Use markup for initial Save and toolbar Help; use the DOM constructor for dynamic course-row Delete. Remove the local `deleteIcon` helper and the obsolete `save-icon.ts` import/file.

Apply these exact icon-dependent CSS contracts:

```css
.toolbar-actions [data-action="help"] svg{display:block;width:24px;height:24px}
.comment-row-action svg{display:block;width:100%;height:100%}
.comment-row-action.delete-action{border:2px solid var(--review-red);background:var(--review-red);color:#fff}
.comment-row-action.delete-action:hover{background:#fff;border-color:var(--review-red);color:var(--review-red)}
```

The existing `inline-flex`, centring, zero-padding, and `44 × 44px` Help-button rules remain unchanged. Remove all obsolete `.delete-body` and `.delete-lines` selectors because the family icon inherits `currentColor`. Preserve every other button dimension and semantic state.

- [ ] **Step 4: Run overlay tests and verify GREEN**

Run: `cd extension && node --test --test-concurrency=1 tests/icon-family.test.ts tests/overlay-focus.test.ts tests/overlay.test.ts && npm run typecheck`

Expected: shared-family, overlay, and typecheck checks pass.

- [ ] **Step 5: Commit overlay migration**

```bash
git add extension/src/overlay/root.ts extension/src/ui/save-icon.ts extension/tests/overlay-focus.test.ts extension/tests/overlay.test.ts
git commit -m "feat: apply icon family to review overlay"
```

### Task 4: Version, regression verification, and pilot release

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `tests/test_deployment_package.py`
- Modify: `docs/pilot-test-script.md`

- [ ] **Step 1: Bump the canonical pilot version**

Change all established version assertions and documentation from `0.4.58` to `0.4.59`.

- [ ] **Step 2: Run the complete verification gate**

```bash
cd extension
npm test
npm run typecheck
npm run test:e2e
cd ../server
python3 -m pytest -q
cd ..
python3 -m unittest tests.test_deployment_package
git diff --check
```

Expected: 0 failures in the extension, typecheck, seven Playwright scenarios, server tests, deployment-package tests, and whitespace check.

- [ ] **Step 3: Commit the versioned implementation**

```bash
git add docs/pilot-test-script.md extension/e2e/version-layout.spec.ts extension/package-lock.json extension/package.json extension/tests/build-config.test.ts tests/test_deployment_package.py
git commit -m "release: prepare icon family pilot"
```

- [ ] **Step 4: Publish the production pilot package**

```bash
PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' \
REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' \
deploy/scripts/release-pilot-extension.sh

cd '/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds'
shasum -a 256 -c SHA256SUMS
```

Expected: release exits zero, manifest and `RELEASE.json` report `0.4.59` and the committed revision, every checksum is `OK`, and the source tree is clean.

- [ ] **Step 5: Inspect the exact delivered bundle contract**

Run this against the signed production artifact created by Step 4:

```bash
python3 - <<'PY'
from pathlib import Path

content = Path('/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension/content.js').read_text()
for name in ('save', 'edit', 'delete', 'help'):
    assert name in content, f'missing icon family member: {name}'
assert 'data-review-icon' in content
for forbidden in ('data:image', 'review-save-mask', 'delete-body', 'delete-lines'):
    assert forbidden not in content, f'forbidden legacy icon artifact: {forbidden}'
print('Delivered icon family bundle verified')
PY

git status --short
```

Expected: `Delivered icon family bundle verified`, no assertion failure, and no `git status` output.
