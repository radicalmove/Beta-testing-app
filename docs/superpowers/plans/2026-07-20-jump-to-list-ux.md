# Jump-to and Comment-list UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make course comments and Jump to consistently scannable, correctly ordered, viewport-safe, and persistent across navigation within a course.

**Architecture:** Keep comment projection and ordering in `course-comment-order.ts`, adding a pure visible-label normalizer used for ordering and Jump-to display. Keep course-specific panel persistence in a small storage helper, while `overlay/root.ts` owns DOM transitions and viewport measurements. Existing comment data, navigation URLs, SCORM routing, and contextual `Comment x of y` remain untouched.

**Tech Stack:** TypeScript, Shadow DOM, browser `localStorage`, CSS transitions, Node test runner with Happy DOM, Playwright, Vite.

---

## File structure

- Modify `extension/src/course-comment-order.ts`: normalize Jump-to labels and establish deterministic unnumbered-first/hierarchical ordering.
- Create `extension/src/ui/panel-state.ts`: safely read and write a Boolean panel state keyed by canonical course URL.
- Modify `extension/src/overlay/root.ts`: apply labels, link styling, viewport menu placement, Help styling/width, panel persistence, and animation.
- Modify `extension/tests/course-comment-order.test.ts`: pure ordering and normalization regression coverage.
- Create `extension/tests/panel-state.test.ts`: storage safety and course isolation coverage.
- Modify `extension/tests/overlay.test.ts`: DOM behaviour, accessibility, visual contract, and viewport placement coverage.
- Modify established version assertions and pilot documentation for `0.4.60`.

### Task 1: Normalize and order course destinations

**Files:**
- Modify: `extension/src/course-comment-order.ts`
- Modify: `extension/tests/course-comment-order.test.ts`

- [ ] **Step 1: Write failing label-normalization tests**

Add tests showing that the exported `coursePageJumpLabel` normalizes whitespace and removes only a leading `Embedded activity · ` prefix:

```ts
assert.equal(coursePageJumpLabel(" Embedded activity ·  1.1.2 Sources of law "), "1.1.2 Sources of law");
assert.equal(coursePageJumpLabel("Course information"), "Course information");
assert.equal(coursePageJumpLabel("Embedded activity planning"), "Embedded activity planning");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd extension && node --test --test-concurrency=1 tests/course-comment-order.test.ts`

Expected: FAIL because `coursePageJumpLabel` does not exist.

- [ ] **Step 3: Implement the minimal pure label helper**

In `course-comment-order.ts`, export a helper equivalent to:

```ts
const EMBEDDED_PREFIX = /^Embedded activity\s*·\s*/i;
export const coursePageJumpLabel = (title: string): string =>
  (normalize(title) || "Untitled page").replace(EMBEDDED_PREFIX, "").trim() || "Untitled page";
```

Do not mutate `comment.page_title` or `page_url`.

- [ ] **Step 4: Write failing hierarchical-order tests**

Cover a deliberately shuffled set containing `Course information`, `Support services`, `1 Introduction`, `Embedded activity · 1.1.2`, `Embedded activity · 1.1.1`, `2 Institutions`, and `Embedded activity · 2.1.1`. Assert unnumbered destinations first and numeric hierarchy `1`, `1.1.1`, `1.1.2`, `2`, `2.1.1`. Retain the duplicate-title/different-URL case.

- [ ] **Step 5: Run the focused test and verify RED**

Expected: FAIL because the existing sorter puts numbered pages after title-sorted pages without recognizing the embedded prefix.

- [ ] **Step 6: Update only the projection comparator**

Derive leading numbers from `coursePageJumpLabel(page.title)`. Keep unnumbered pages before numbered pages, natural title comparison within the unnumbered set, numeric component comparison within the numbered set, then URL and `firstSeen` tie-breakers. Keep group titles stored as the normalized original title so existing group headings do not change.

- [ ] **Step 7: Verify and commit**

Run:

```bash
cd extension
node --test --test-concurrency=1 tests/course-comment-order.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add extension/src/course-comment-order.ts extension/tests/course-comment-order.test.ts
git commit -m "fix: order course comment destinations"
```

### Task 2: Persist course-specific panel state

**Files:**
- Create: `extension/src/ui/panel-state.ts`
- Create: `extension/tests/panel-state.test.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing storage-helper tests**

Define a minimal `StorageLike` fake and cover:

```ts
writeCoursePanelState(storage, courseA, true);
assert.equal(readCoursePanelState(storage, courseA), true);
assert.equal(readCoursePanelState(storage, courseB), false);
```

Also assert malformed values and throwing `getItem`/`setItem` safely return or preserve the collapsed fallback.

- [ ] **Step 2: Run the new test and verify RED**

Run: `cd extension && node --test --test-concurrency=1 tests/panel-state.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the safe storage boundary**

Create `panel-state.ts` with:

```ts
export type PanelStateStorage = Pick<Storage, "getItem" | "setItem">;
const key = (courseUrl: string) => `moodle-course-review:panel:${courseUrl}`;
export function readCoursePanelState(storage: PanelStateStorage | undefined, courseUrl: string): boolean { /* true only for exact "open"; catch and return false */ }
export function writeCoursePanelState(storage: PanelStateStorage | undefined, courseUrl: string, open: boolean): void { /* write "open"/"closed" inside try/catch */ }
```

- [ ] **Step 4: Write failing overlay persistence tests**

Mount, open the panel, destroy/remount with the same course and assert it restores open. Mount another course and assert collapsed. Provide a `localStorage` implementation through Happy DOM or a narrow optional `panelStateStorage` dependency in `ReviewOverlayOptions` so tests do not depend on global state. Assert a throwing store does not prevent mounting.

- [ ] **Step 5: Verify RED**

Run the focused overlay tests and confirm the panel currently collapses after remount.

- [ ] **Step 6: Wire storage into the overlay**

At initial mount, read state using `context.course_url`. On user toggle, write it. If `update()` changes `course_url`, restore the new course's independent state. Do not persist programmatic temporary visibility used by marker-error messages or dialogs.

- [ ] **Step 7: Write failing transition/accessibility tests**

Assert the panel receives explicit opening/open/closing state attributes or classes; the Comments button's `aria-expanded` and label match; collapsed content is not keyboard-accessible after completion; and CSS includes a roughly 180ms height/opacity transition plus a `prefers-reduced-motion: reduce` override.

- [ ] **Step 8: Implement the transition state machine**

Add a single `setPanelOpen(open, { animate, persist })` path. Restored state opens immediately to avoid page-load animation. User toggles animate. Opening exposes content before the transition; closing makes it inert immediately and sets `hidden` after the transition duration. Cancel any pending close timer before reversing direction. Reduced-motion users take the immediate path. Keep `aria-expanded` synchronized at the start of each state change.

- [ ] **Step 9: Verify and commit**

Run:

```bash
cd extension
node --test --test-concurrency=1 tests/panel-state.test.ts tests/overlay.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add extension/src/ui/panel-state.ts extension/tests/panel-state.test.ts extension/src/overlay/root.ts extension/tests/overlay.test.ts
git commit -m "feat: retain course comment panel state"
```

### Task 3: Refine links, Help styling, and Jump-to placement

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing comment-link tests**

Assert visible comment entries omit `#<number>` and their accessible names do not announce a removed list number. Assert CSS has no underline at rest and adds underline for both `:hover` and `:focus-visible`. Do not modify contextual renderer tests or its `Comment x of y` text.

- [ ] **Step 2: Verify RED, then implement minimal comment-link changes**

Update both initial row text and `applyFilter()` text so the visible label is only the concise quoted body. Remove display numbering from the row accessible label and from Resolve/Reopen/Delete action labels while retaining page title, full body, author, status, and action meaning. Keep internal `displayIndex` available for ordering and contextual navigation only.

- [ ] **Step 3: Write failing Help visual tests**

Assert Jump to still uses `--review-jump:#356f9f`; add `--review-help` with the approved plum value; assert Help uses it for closed/open/hover states; and assert `.help-dialog{width:min(720px,calc(100vw - 32px))}` with the existing mobile constraint.

- [ ] **Step 4: Implement Help styling**

Use plum `#754668` as the distinct accessible Help colour. Preserve the current 44×44 size, shared Help SVG, labels, `aria-expanded`, and outlined/solid inversion convention. Widen only `.help-dialog`, not sign-in or comment dialogs.

- [ ] **Step 5: Write failing Jump-to label/link tests**

Assert options use `coursePageJumpLabel(group.title)`, stored `data-comment-page-option` URLs are unchanged, `All pages` is first, and the option order matches Task 1's projection. Assert options are not underlined at rest and become underlined for hover/focus.

- [ ] **Step 6: Implement Jump-to label/link changes**

Import the pure label helper. Use it only as option text. Preserve exact URL values, duplicate destinations, selection, keyboard commands, click-outside closure, and filtering.

- [ ] **Step 7: Write failing viewport-placement tests**

Mock `jumpButton.getBoundingClientRect()`, `pageList.scrollHeight`, and viewport dimensions. Cover a trigger near the top and near the bottom. Assert opening sets fixed `left`, `top`, and `max-height` values clamped to 8px margins, with `overflow-y:auto`; assert reopening recalculates after the geometry changes.

- [ ] **Step 8: Implement one positioning helper in `root.ts`**

On open:

1. Unhide the menu with fixed positioning and hidden visibility for measurement.
2. Measure trigger, desired menu height, and viewport.
3. Prefer above when it fits; otherwise use the side with more space.
4. Clamp top and left to 8px margins and set a positive viewport-bounded `maxHeight`.
5. Restore visibility and focus the selected option or `All pages`.

Reset transient inline geometry on close. Do not change option selection or navigation logic.

- [ ] **Step 9: Verify and commit**

Run:

```bash
cd extension
node --test --test-concurrency=1 tests/course-comment-order.test.ts tests/overlay.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add extension/src/overlay/root.ts extension/tests/overlay.test.ts
git commit -m "feat: refine course comment navigation UX"
```

### Task 4: Version, verify, merge, and publish

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `tests/test_deployment_package.py`
- Modify: `docs/pilot-test-script.md`

- [ ] **Step 1: Update established version references**

Change active `0.4.59` references to `0.4.60` in the six established version-bearing files only. Do not edit release history.

- [ ] **Step 2: Run full verification**

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

Expected: 0 failures. Existing dependency deprecation warnings are acceptable.

- [ ] **Step 3: Commit release preparation**

```bash
git add extension/package.json extension/package-lock.json extension/tests/build-config.test.ts extension/e2e/version-layout.spec.ts tests/test_deployment_package.py docs/pilot-test-script.md
git commit -m "release: prepare comment navigation pilot"
```

- [ ] **Step 4: Review, merge, and re-verify**

Review the full feature range against the approved design, merge the feature branch into `main`, then rerun extension, server, and deployment suites on merged `main`.

- [ ] **Step 5: Publish the signed pilot build from clean `main`**

```bash
PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' \
REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' \
deploy/scripts/release-pilot-extension.sh
```

Confirm release metadata and manifest report `0.4.60`, the release commit equals merged `main`, checksums pass, and the pilot folder contains the rebuilt shared icon/UX bundle.
