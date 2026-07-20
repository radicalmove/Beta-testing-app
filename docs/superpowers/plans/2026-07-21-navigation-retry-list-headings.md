# Navigation Recovery and Comment-List Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cross-page Previous/Next navigation retry one transient extension-channel failure, expose persistent failures, and simplify comment-list headings.

**Architecture:** Add a focused navigation helper in the content layer that prepares navigation, refreshes the trusted course binding only after a transient channel failure, and retries once. The renderer owns accessible popover error presentation. The overlay reuses `coursePageJumpLabel` for visible group headings and removes its redundant panel title.

**Tech Stack:** TypeScript, Chrome Manifest V3 messaging, Happy DOM, Node test runner, Playwright.

---

### Task 1: Recover one transient navigation-channel failure

**Files:**
- Modify: `extension/src/content.ts`
- Test: `extension/tests/content.test.ts`

- [ ] Add a failing test that simulates a closed response channel on the first `PREPARE_COMMENT_NAVIGATION`, verifies one `RESOLVE_COURSE`, and verifies the second prepare succeeds.
- [ ] Run the focused test and confirm it fails because navigation is not retried.
- [ ] Add a small exported helper that performs prepare, recognizes only the transient channel failure, refreshes the course binding, and retries once.
- [ ] Wire `navigateToComment` through the helper without changing successful Moodle or SCORM destination handling.
- [ ] Run the focused content tests and confirm they pass.

### Task 2: Show Previous/Next navigation failures

**Files:**
- Modify: `extension/src/comment-renderer.ts`
- Test: `extension/tests/comment-renderer.test.ts`

- [ ] Add a failing test whose cross-page callback rejects and assert that the thread remains open with an accessible error status.
- [ ] Run the focused test and confirm the rejection is currently silent.
- [ ] Catch navigation rejection in the contextual thread and render one concise status message; clear an older message before another attempt.
- [ ] Run the renderer tests and confirm they pass.

### Task 3: Simplify and strengthen page/activity headings

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] Add failing assertions that the connected comment panel has no duplicate `.panel-title`, that group headings show cleaned labels, and that approved styles use 13px group headings.
- [ ] Run the focused overlay tests and confirm the new assertions fail.
- [ ] Remove the redundant panel title from overlay markup and its update path.
- [ ] Set visible group headings with `coursePageJumpLabel(group.title)`.
- [ ] Increase `.comment-group-heading` to 13px without changing filtering or visibility rules.
- [ ] Run focused overlay and ordering tests and confirm they pass.

### Task 4: Verify and release pilot 0.4.66

**Files:**
- Modify the established canonical version references in `extension/package.json`, lockfile, version tests, deployment tests, and pilot documentation.

- [ ] Update all canonical version references from 0.4.65 to 0.4.66.
- [ ] Run extension type checking and the complete unit suite.
- [ ] Run Playwright browser tests.
- [ ] Run server and deployment/package tests.
- [ ] Commit the implementation and fast-forward it into `main`, preserving the user-owned root `package-lock.json`.
- [ ] Produce and verify the signed pilot folder at `pilot-builds/moodle-review-extension`.
