# Comment Controls and SCORM Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved comment-list controls and reliably open embedded Rise comments through Moodle’s SCORM player rather than a raw package URL.

**Architecture:** Keep the existing overlay, content-script bridge, trusted background boundary, and embedded navigation state machine. Add small focused UI helpers for the Jump to disclosure/listbox and row icons, separate status mutation from delayed list refresh, and strengthen the existing navigation boundary so raw SCORM content can never become a top-level destination.

**Tech Stack:** TypeScript, Web Components/Shadow DOM, Chrome Manifest V3, Node test runner with happy-dom, Vite, Python deployment tests.

---

## File map

- Modify `extension/src/overlay/root.ts`: construct stateful toolbar controls, equal-sized semantic filters, Jump to listbox, grouped results, accessible row actions, confirmation, and transient resolve/reopen states.
- Modify `extension/src/overlay/styles.css`: shared base rules only if required by the existing overlay.
- Modify `extension/src/content.ts`: expose mutation and refresh as separate callbacks and preserve navigation errors.
- Modify `extension/src/embedded-comment-navigation.ts`: classify raw package URLs, validate SCORM-player parents, and enforce Moodle-first navigation.
- Modify `extension/src/background.ts` only if the existing navigation dependencies need a narrow validation or callback adjustment.
- Modify `extension/tests/overlay.test.ts`: UI state, keyboard, grouping, scrolling, confirmation, timer, icon, and accessibility tests.
- Modify `extension/tests/content.test.ts`: mutation-versus-refresh integration and navigation-error presentation tests.
- Modify `extension/e2e/version-layout.spec.ts`: computed dimensions, borders, colours, no-wrap labels, and independently scrolling result region.
- Modify `extension/tests/background.test.ts`: trusted-boundary and navigation-state tests.
- Modify `extension/tests/embedded-comment-navigation.test.ts` if state-machine cases are already isolated there; otherwise keep them in `background.test.ts`.
- Modify `extension/package.json`, `extension/package-lock.json`, `extension/tests/build-config.test.ts`, and `tests/test_deployment_package.py` for the next canonical pilot version. `extension/src/build-config.ts` is unchanged unless a failing test proves otherwise.
- Modify `docs/pilot-test-script.md`: manual regression steps for the updated controls and SCORM navigation.

### Task 1: Lock the toolbar and filter state contract

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] **Step 1: Write failing toolbar-state tests**

Add assertions that Add comment marker, Comments, and Help expose state through `aria-pressed` or `aria-expanded`; inactive controls are outlined; active controls receive the solid-state selector; and activating marker mode does not falsely mark Comments or Help active.

```ts
const add = shadow.querySelector<HTMLButtonElement>('[data-action="add-comment"]')!;
const comments = shadow.querySelector<HTMLButtonElement>('[data-action="panel"]')!;
const help = shadow.querySelector<HTMLButtonElement>('[data-action="help"]')!;
assert.equal(add.getAttribute("aria-pressed"), "false");
assert.equal(comments.getAttribute("aria-expanded"), "false");
add.click();
assert.equal(add.getAttribute("aria-pressed"), "true");
comments.click();
assert.equal(comments.getAttribute("aria-expanded"), "true");
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd extension && node --test --test-name-pattern="toolbar state" tests/overlay.test.ts`

Expected: FAIL because Add comment marker and Help do not yet expose the approved state contract.

- [ ] **Step 3: Implement minimal state wiring**

In `root.ts`, initialize Add comment marker with `aria-pressed="false"`, flip it only while marker interaction is active, use Comments `aria-expanded`, and use Help `aria-expanded`. Close/reset each state from its existing cancel/close path. Do not introduce a second source of truth.

- [ ] **Step 4: Add failing filter-style tests**

Assert all five controls use a shared sizing class, labels do not wrap, scope buttons have the orange class, status buttons have the dark-green class, and Jump to has its own blue disclosure class. Assert the shell uses the exact 3 px dark-teal border, inactive toolbar controls use 2 px borders and white fills, the Help glyph has the approved larger size, every icon-only control has an accessible name, and DOM/focus order matches visual order.

- [ ] **Step 5: Implement approved visual tokens**

Replace the old all-teal filter overrides with named custom properties and classes:

```css
:host {
  --review-dark-teal: #043e42;
  --review-scope: #a84f12;
  --review-status: #176b43;
  --review-jump: #356f9f;
}
.comment-control { box-sizing:border-box; width:104px; height:38px; white-space:nowrap; border:2px solid currentColor; }
.comment-control[aria-pressed="true"], .comment-control[aria-expanded="true"] { color:#fff; }
```

Use state-specific selectors to fill with the semantic colour; invert fill/text on hover only without changing ARIA state. Preserve a high-contrast `:focus-visible` outline without changing selected/unselected fill. Set the shell border to 3 px dark teal and retain the existing bright-teal header.

- [ ] **Step 6: Run focused tests**

Run: `cd extension && node --test --test-name-pattern="toolbar state|semantic filter controls" tests/overlay.test.ts`

Expected: PASS.

- [ ] **Step 7: Add a failing Playwright computed-layout test**

In `extension/e2e/version-layout.spec.ts`, mount the connected overlay and compare `getBoundingClientRect()` widths/heights for all five controls. Assert computed border widths/colours, one-line labels, and active/inactive fills because happy-dom cannot prove computed layout.

- [ ] **Step 8: Implement any CSS corrections and run the E2E test**

Run: `cd extension && npm run build && npx playwright test e2e/version-layout.spec.ts`

Expected: PASS with equal control bounds and approved computed styles.

- [ ] **Step 9: Commit**

```bash
git add extension/src/overlay/root.ts extension/src/overlay/styles.css extension/tests/overlay.test.ts extension/e2e/version-layout.spec.ts
git commit -m "feat: apply semantic comment control states"
```

### Task 2: Replace the page select with an accessible Jump to listbox

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] **Step 1: Write failing disclosure/listbox tests**

Cover the stable `Jump to` label, `aria-expanded`, `aria-controls` referencing a real unique listbox ID, exactly one `aria-selected=true` option, listbox ownership, current selection, click-outside close, Escape close/focus restoration, Enter/Space open/select, arrow navigation, Tab close, scope-change reset, and refresh removal of a stale selected page.

```ts
const jump = shadow.querySelector<HTMLButtonElement>('[data-comment-jump]')!;
jump.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
assert.equal(jump.getAttribute("aria-expanded"), "true");
const listbox = shadow.querySelector<HTMLElement>('[role="listbox"]')!;
assert.equal(listbox.hidden, false);
listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
assert.equal(shadow.activeElement, jump);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `cd extension && node --test --test-name-pattern="Jump to" tests/overlay.test.ts`

Expected: FAIL because the implementation still uses a native labelled select.

- [ ] **Step 3: Implement a focused listbox helper inside the overlay module**

Build a button plus hidden listbox from the existing page map. Keep `commentListPage` as the single selected-value state. Provide All pages as the first option, set `aria-selected` on exactly one option, and call the existing `applyFilter()` after selection.

- [ ] **Step 4: Implement dismissal and reconciliation**

Close on Escape, Tab, or outside pointer action; restore focus only for Escape. When Current page is selected, close and clear `commentListPage`. During `setCommentList`, clear a selected URL no longer present before rendering.

- [ ] **Step 5: Run tests**

Run: `cd extension && node --test --test-name-pattern="Jump to" tests/overlay.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay.test.ts
git commit -m "feat: add accessible comment page jump menu"
```

### Task 3: Group and constrain the whole-course comment list

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] **Step 1: Write failing grouping and scrolling tests**

Provide comments from two Moodle pages and two Rise lessons. Assert stable loaded-course numbering, ordered group headings, one heading per page/lesson, concise links, and a dedicated results region with bounded height and `overflow-y:auto` while the toolbar/filter region stays outside it.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `cd extension && node --test --test-name-pattern="grouped comment list|bounded comment list" tests/overlay.test.ts`

Expected: FAIL because results are currently flat.

- [ ] **Step 3: Render groups without changing filter truth**

Derive visible groups after applying scope, status, and Jump to values. Use the stored page/lesson title as a group heading. Keep the original comment index in `data-comment-index`; do not renumber filtered results.

- [ ] **Step 4: Add the approved layout styles**

Use a slightly smaller single-line panel title, compact 13 px comment links, group labels, 8 px row-action gaps, and a results maximum height based on viewport space with a safe fixed cap. Ensure only `.comment-results` scrolls.

- [ ] **Step 5: Add computed scrolling coverage**

Extend `extension/e2e/version-layout.spec.ts` with enough comments to overflow. Assert `.comment-results` has `scrollHeight > clientHeight`, its `scrollTop` changes independently, and the toolbar/filter bounding boxes remain fixed relative to the overlay.

- [ ] **Step 6: Run tests**

Run: `cd extension && node --test --test-name-pattern="grouped comment list|bounded comment list" tests/overlay.test.ts`

Expected: PASS.

Run: `cd extension && npm run build && npx playwright test e2e/version-layout.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay.test.ts extension/e2e/version-layout.spec.ts
git commit -m "feat: group and constrain course comments"
```

### Task 4: Implement accessible resolve, reopen, and delete row actions

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/tests/content.test.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/content.ts`

- [ ] **Step 1: Write failing icon and capability tests**

Assert Delete uses an inline SVG filled-bin glyph with `aria-label="Delete comment N"` and no emoji. Assert unresolved status controls are 34 px white square checkboxes with 2 px black outlines. Assert resolved controls contain an irregular green SVG tick. Controls remain capability-gated.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `cd extension && node --test --test-name-pattern="row action icons" tests/overlay.test.ts`

Expected: FAIL on emoji and status glyphs.

- [ ] **Step 3: Implement SVG factories and row spacing**

Create small local helpers returning SVG nodes; avoid `innerHTML` for dynamic data. Use the approved filled-bin silhouette and a two-stroke loose green tick. Preserve accessible labels/titles and visible focus.

- [ ] **Step 4: Write failing shared-dialog and timer tests**

Implement a test contract for a shared confirmation dialog created in `root.ts`; do not assume an existing row-dialog helper because current Delete uses `window.confirm`. Cover its focus trap, Escape/cancel, confirmation, and focus restoration. Stub the happy-dom window’s `setTimeout` and `clearTimeout` using the same captured-handler pattern already used in `overlay.test.ts`; do not rely on a nonexistent generic `clock`.

```ts
status.click();
assert.equal(confirmDialog.hidden, false);
confirmDialog.querySelector<HTMLButtonElement>('[data-confirm]')!.click();
await tick();
assert.equal(row.dataset.transientStatus, "resolved");
assert.equal(delay, 3000);
overlay.setCommentList([]);
assert.ok(shadow.querySelector(`[data-comment-row="${comment.id}"]`));
delayed!();
assert.equal(refreshCalls, 1);
```

Test both Resolve and Reopen for per-row duplicate prevention, cancel, failure, exact polite announcements, timer replacement, cleanup during overlay destruction, ordinary `setCommentList()` omitting or changing the transient comment, and exactly one refresh after 3000 ms.

- [ ] **Step 5: Separate mutation from refresh**

Change the overlay option contract so `changeStatus` only saves the mutation. Add a dedicated `refreshComments` callback. On successful Resolve, set transient resolved state, announce `Comment resolved. Moving to Resolved.`, retain the row for three seconds, then refresh. On successful Reopen, remove the tick, announce `Comment reopened. Moving to Open.`, retain the row for three seconds, then refresh. Preserve transient rows across `setCommentList` calls until their timers expire.

- [ ] **Step 6: Add content integration tests**

In `extension/tests/content.test.ts`, prove `UPDATE_COMMENT_STATUS` completes without issuing `LIST_COURSE_COMMENTS`, while the new `refreshComments` callback issues the list request exactly once. Also prove mutation failure leaves the list unchanged.

- [ ] **Step 7: Add Delete and Resolve/Reopen confirmations**

Implement one local shared confirmation-dialog helper in `root.ts` and use it for Delete, Resolve, and Reopen. Delete keeps its current warning. Resolve and Reopen use the exact approved messages. Trap focus, support Escape/cancel, and restore focus if the row still exists.

- [ ] **Step 8: Run tests**

Run: `cd extension && node --test --test-name-pattern="row action icons|resolve confirmation|reopen confirmation|transient status" tests/overlay.test.ts`

Expected: PASS.

- [ ] **Step 9: Run content integration tests**

Run: `cd extension && node --test --test-name-pattern="status mutation refresh" tests/content.test.ts`

Expected: PASS.

- [ ] **Step 10: Run full overlay and content tests**

Run: `cd extension && node --test tests/overlay.test.ts tests/content.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add extension/src/overlay/root.ts extension/src/content.ts extension/tests/overlay.test.ts extension/tests/content.test.ts
git commit -m "feat: refine comment row actions"
```

### Task 5: Prevent raw SCORM package navigation

**Files:**
- Modify: `extension/tests/background.test.ts`
- Modify: `extension/src/embedded-comment-navigation.ts`
- Modify: `extension/src/background.ts` only if needed

- [ ] **Step 1: Write failing raw-package safety tests**

Create a same-origin comment whose `page_url` is a Moodle `pluginfile.php/.../mod_scorm/.../scormcontent/...` URL and whose embedded metadata is null. Assert PREPARE rejects with the approved missing-location message, does not return `destination_url`, and does not call parent/tab navigation.

Add parent-only and locator-only records for both raw-package and ordinary same-origin page URLs. Assert each pair mismatch is rejected before every direct/normal branch with no storage write, `destination_url`, `navigateParent`, or top-level/tab assignment.

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd extension && node --test --test-name-pattern="raw SCORM|metadata pair" tests/background.test.ts`

Expected: FAIL because the current same-origin branch returns the package URL.

- [ ] **Step 3: Classify raw package URLs before the normal-page branch**

Add a pure helper in `embedded-comment-navigation.ts` that recognizes the configured Moodle origin plus `pluginfile.php` paths containing both `mod_scorm` and `scormcontent`. After loading and matching the trusted comment, reject every parent/locator pair mismatch, then reject incomplete raw-package records before considering a same-origin direct destination.

- [ ] **Step 4: Write failing parent-player validation tests**

Cover HTTPS, no credentials, same origin, exact `/mod/scorm/player.php` path, query preservation, allowed fragment, and arbitrary same-origin path rejection.

- [ ] **Step 5: Implement strict parent validation**

Validate the parent immediately before `navigation.prepare`. Preserve query/fragment but never treat the fragment as the embedded locator. Keep the existing paired metadata validation.

- [ ] **Step 6: Run focused tests**

Run: `cd extension && node --test --test-name-pattern="raw SCORM|embedded parent" tests/background.test.ts`

Expected: PASS.

- [ ] **Step 7: Write failing navigation-error presentation tests**

In `extension/tests/content.test.ts`, make PREPARE reject with `This SCORM comment cannot be opened because its Moodle activity location is missing.` Activate the comment link and assert the exact concise status appears in the comments panel and `targetWindow.location.assign` is not called.

- [ ] **Step 8: Preserve trusted navigation errors in the overlay**

Ensure the content callback rejects with the background error and the existing overlay catch path displays it without navigation.

- [ ] **Step 9: Run navigation integration tests**

Run: `cd extension && node --test --test-name-pattern="comment navigation error" tests/content.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add extension/src/embedded-comment-navigation.ts extension/src/background.ts extension/src/content.ts extension/tests/background.test.ts extension/tests/content.test.ts
git commit -m "fix: route SCORM comments through Moodle player"
```

### Task 6: Prove pending SCORM navigation survives only until consumption

**Files:**
- Modify: `extension/tests/background.test.ts`
- Modify: `extension/src/embedded-comment-navigation.ts` only if tests expose a gap

- [ ] **Step 1: Add state-machine restart tests**

At each persisted state, discard the original navigation object and construct a new `EmbeddedCommentNavigation` over the same `NavigationStorage`. Cover reconstruction before player load, after locator-applying/identity-waiting, before context opening, and after successful one-time consumption. Assert required locator replay, exactly-once context opening, and exactly-once record removal; the consumed case must do nothing.

- [ ] **Step 2: Run and observe current behaviour**

Run: `cd extension && node --test --test-name-pattern="navigation restart" tests/background.test.ts`

Expected: PASS if the existing persisted state machine already meets the contract; otherwise FAIL at the exact missing transition.

- [ ] **Step 3: Make only the minimal state-machine correction if required**

Retain the existing stored states and expiry. Do not add a second completed-target record. Ensure context opening removes the pending record exactly once.

- [ ] **Step 4: Run focused and full background tests**

Run: `cd extension && node --test tests/background.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/embedded-comment-navigation.ts extension/tests/background.test.ts
git commit -m "test: cover SCORM navigation reload states"
```

### Task 7: Full verification, version commit, and pilot release

**Files:**
- Modify: `docs/pilot-test-script.md`
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `tests/test_deployment_package.py`
- Delivery only (outside Git): release artefacts produced by `deploy/scripts/release-pilot-extension.sh`

- [ ] **Step 1: Update the pilot test script**

Add checks for all solid/outlined states, hover inversion, keyboard Jump to, grouped independent scrolling, resolve/reopen feedback, Moodle-page navigation, multiple lessons in one Rise package, pending reload resume, completed reload non-reopen, and absence of raw `pluginfile.php` launches.

- [ ] **Step 2: Write the failing canonical-version assertions**

Bump the expected next patch version in `extension/tests/build-config.test.ts` and `tests/test_deployment_package.py` before changing package metadata.

Run: `cd extension && node --test tests/build-config.test.ts`

Expected: FAIL on the old package version.

- [ ] **Step 3: Update all canonical tracked version locations**

Update `extension/package.json`, `extension/package-lock.json`, relevant pilot/version text in `docs/pilot-test-script.md`, and the hard-coded deployment assertion. Do not change `extension/src/build-config.ts` unless its tests require it.

- [ ] **Step 4: Run extension verification**

```bash
cd extension
npm test
npm run typecheck
npm run build
```

Expected: all tests pass, TypeScript exits 0, and Vite build succeeds.

- [ ] **Step 5: Run the exact server and deployment gates**

```bash
(cd server && python3 -m pytest -q)
python3 -m unittest tests/test_deployment_package.py
python3 -m pytest tests/test_release_artifacts.py -q
```

Expected: all server and deployment/release tests pass.

- [ ] **Step 6: Perform Chrome and Edge live checks before releasing**

Reload the unpacked feature build in Chrome and Edge. In each browser test a normal Moodle section and CRJU150 SCORM. Confirm exactly one overlay, no extension errors, correct signed-in identity, correct list scrolling/grouping, and successful cross-page/SCORM navigation.

- [ ] **Step 7: Commit every tracked source, test, documentation, and version change**

```bash
git add extension docs tests
git commit -m "release: prepare pilot comment controls update"
git status --short
```

Expected: commit succeeds and status is clean. The release script refuses a dirty tree and derives its build identity from this HEAD.

- [ ] **Step 8: Build the signed pilot release from the clean commit**

Use the existing release script rather than manually copying files:

```bash
PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' \
REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' \
deploy/scripts/release-pilot-extension.sh
```

Expected: a new versioned release directory, updated current/stable pilot build, verified hashes, and matching visible extension version/build label.

- [ ] **Step 9: Verify the external delivery artefacts and record hashes**

The script already checks `SHA256SUMS`, stable/versioned ZIP equality, and `extension/dist` against the stable delivery directory. Record the emitted release path, `RELEASE.json`, current/stable version, build commit, and SHA-256 values. Do not commit these external delivery artefacts.

- [ ] **Step 10: Confirm service impact and live health**

No server schema or service code is planned, so no Mac mini service deployment is required. Run `curl -fsS https://fld-mini.tail4ccaba.ts.net/health` after the signed extension release and require the response `{"status":"ok"}`. If implementation unexpectedly changes server files, stop and add the project’s established service deployment/health process before releasing.

- [ ] **Step 11: Hand off the exact test version**

Report the pilot version, build commit, stable unpacked-extension folder, and the concise manual checks the user should perform first.
