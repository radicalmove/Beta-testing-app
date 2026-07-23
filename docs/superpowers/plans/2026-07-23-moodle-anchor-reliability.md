# Moodle Anchor Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make whole-element Moodle highlights save successfully and make ordinary Moodle visual-pin navigation center the exact saved location.

**Architecture:** Extend captured text anchors with a bounded stable selector derived from the selection's common ancestor, while keeping SCORM protocol payloads unchanged. For visual pins, use recovered viewport coordinates for top-level Moodle scrolling and preserve element-based scrolling inside embedded documents.

**Tech Stack:** TypeScript, Chrome Manifest V3, Happy DOM, Node test runner, Vite, Python deployment tests.

---

### Task 1: Capture and validate a stable selector for Moodle highlights

**Files:**
- Modify: `extension/src/anchors/text.ts`
- Modify: `extension/src/scorm-worker.ts`
- Modify: `extension/src/background-bridge.ts`
- Test: `extension/tests/text-anchor.test.ts`
- Test: `extension/tests/background-bridge.test.ts`
- Test: `extension/tests/scorm-worker.test.ts`

- [ ] **Step 1: Write the failing capture regression**

Add a test that selects all text in a paragraph surrounded only by whitespace text nodes. Assert that `captureTextAnchor` returns the quote, whitespace prefix/suffix, and `css_selector: "#intro"` without changing the DOM. Add a spanning-selection case asserting that the nearest common eligible element is selected.

- [ ] **Step 2: Run the capture regression and verify RED**

Run: `node --test --test-name-pattern='stable selector|common eligible' tests/text-anchor.test.ts`

Expected: FAIL because captured text anchors do not include `css_selector`.

- [ ] **Step 3: Implement selector capture**

Import `selectorFor` from `anchors/pin.ts`. Derive the candidate from `range.commonAncestorContainer` when it is an element, otherwise its parent element. Reject candidates inside extension UI. Fail capture by returning `null` unless the selector is non-empty and no longer than 4,000 characters; otherwise return the existing quote/context plus required `css_selector`. Keep the recovery input type separate or make only its selector field optional so previously stored text highlights remain recoverable, while every newly captured anchor is saveable.

- [ ] **Step 4: Keep the SCORM protocol unchanged**

Change SCORM anchor emission to construct `{ anchor_type, selected_quote, prefix, suffix }` explicitly rather than spreading the captured object. Add or adjust a worker test proving a valid SCORM text selection is still captured and its emitted protocol message has no `css_selector`.

- [ ] **Step 5: Run capture and SCORM tests and verify GREEN**

Run: `node --test tests/text-anchor.test.ts tests/scorm-worker.test.ts`

Expected: PASS.

- [ ] **Step 6: Write the failing create-message regression**

Update the ordinary Moodle highlight fixture to include `css_selector`. Assert the exact shape is accepted, and assert missing, empty, overlong, non-string, or unexpected selector fields are rejected.

- [ ] **Step 7: Run the bridge regression and verify RED**

Run: `node --test --test-name-pattern='create comment bridge|text anchor shape' tests/background-bridge.test.ts`

Expected: FAIL because the bridge currently rejects a selector on text highlights.

- [ ] **Step 8: Implement the exact bridge shape**

Require the existing `CreateCommentPayload.css_selector` field in the exact ordinary text-highlight payload shape alongside `selected_quote`, `prefix`, and `suffix`; trim and bound the selector to 4,000 characters. Leave embedded-capability validation unchanged.

- [ ] **Step 9: Run bridge tests and verify GREEN**

Run: `node --test tests/background-bridge.test.ts`

Expected: PASS.

### Task 2: Scroll ordinary Moodle pages to the exact visual-pin coordinate

**Files:**
- Modify: `extension/src/comment-renderer.ts`
- Test: `extension/tests/comment-renderer.test.ts`

- [ ] **Step 1: Write the failing Moodle scrolling regression**

Create a large top-level target whose element spans the viewport while its recovered relative pin is above the viewport. Stub `window.scrollBy` and assert clicking the comment list/context navigation requests `{ top: recoveredY - innerHeight / 2, behavior: "smooth" }`, rather than calling the element's `scrollIntoView`.

- [ ] **Step 2: Run the regression and verify RED**

Run: `node --test --test-name-pattern='exact visual-pin coordinate' tests/comment-renderer.test.ts`

Expected: FAIL because visual-pin scrolling currently calls only `element.scrollIntoView`.

- [ ] **Step 3: Implement exact top-level scrolling**

In `scrollCommentIntoView`, when a visual pin resolves in a top-level document, call `window.scrollBy` with the recovered viewport `y` minus half the viewport height and smooth behavior. In embedded documents, retain the existing centered element `scrollIntoView` behavior.

- [ ] **Step 4: Verify Moodle and embedded scrolling**

Run: `node --test --test-name-pattern='exact visual-pin coordinate|nested SCORM|highlight' tests/comment-renderer.test.ts`

Expected: PASS, including the existing nested-SCORM regression.

### Task 3: Verify, version, and publish the patch release

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `tests/test_deployment_package.py`
- Modify: `docs/pilot-test-script.md`

- [ ] **Step 1: Run focused integration verification**

Run from `extension/`:

`node --test tests/text-anchor.test.ts tests/background-bridge.test.ts tests/comment-renderer.test.ts tests/scorm-worker.test.ts`

Expected: all focused tests pass.

- [ ] **Step 2: Bump the canonical patch version**

Update all canonical and asserted versions from `0.5.11` to `0.5.12`.

- [ ] **Step 3: Run complete verification**

Run from `extension/`: `npm test && npm run typecheck && npm run build`

Run from repository root: `python3 -m pytest tests/test_deployment_package.py` and `git diff --check`.

Expected: 400 or more extension tests pass, 21 deployment tests pass, typecheck/build exit 0, and no whitespace errors.

- [ ] **Step 4: Commit the implementation**

Stage only the intended implementation, tests, version, pilot documentation, spec, and plan. Commit with `fix: make Moodle comment anchors reliable`.

- [ ] **Step 5: Build and publish production artifacts**

Build with `MOODLE_HOST_PATTERNS='https://my.uconline.ac.nz/*'`, `OPTIONAL_FRAME_PATTERNS=''`, `REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net'`, `BUILD_MODE=production`, the committed 40-character `BUILD_COMMIT`, and the stable public `EXTENSION_PUBLIC_KEY` read from the current released manifest. Publish from the clean isolated worktree with:

`python3 deploy/scripts/release_artifacts.py --root '<isolated-worktree>' --dist '<isolated-worktree>/extension/dist' --delivery '/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds' --version 0.5.12`

- [ ] **Step 6: Verify the release**

Verify `SHA256SUMS`, manifest version and public-key equality, current unpacked/release directory equality, and current/release ZIP SHA-256 equality. Fast-forward the main branch while preserving unrelated user files.
