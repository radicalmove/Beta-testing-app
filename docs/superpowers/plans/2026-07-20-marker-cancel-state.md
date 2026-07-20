# Marker Cancellation State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every exit from marker placement restores the usable Comments panel and never leaves stale placement instructions behind.

**Architecture:** Keep the rendered comment list in `[data-panel-content]` intact and add a temporary sibling instruction region only while marker mode is active. Centralize marker cleanup so Cancel, Escape, successful placement, repeated entry, and destruction all remove temporary UI and restore the panel's pre-marker open state without persisting a new course preference.

**Tech Stack:** TypeScript, Shadow DOM, Happy DOM, Node test runner

---

### Task 1: Preserve and restore Comments panel content

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay-focus.test.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing cancellation regression tests**

Add tests proving that marker mode uses a separate instruction region, preserves `[data-panel-content]`, and restores the original content and prior open/collapsed state after both Cancel marker and Escape.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-concurrency=1 tests/overlay-focus.test.ts tests/overlay.test.ts`

Expected: FAIL because marker placement currently overwrites `[data-panel-content]` and cancellation always closes the panel.

- [ ] **Step 3: Implement minimal temporary marker instructions**

In `root.ts`, record the pre-marker `panelOpen` state, hide rather than mutate `[data-panel-content]`, append a temporary live instruction region, and make `clearAreaSelection()` idempotently remove that region, reveal comments, and restore the prior state non-persistently.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test --test-concurrency=1 tests/overlay-focus.test.ts tests/overlay.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay-focus.test.ts extension/tests/overlay.test.ts
git commit -m "fix: restore comments after marker cancellation"
```

### Task 2: Cover all marker exit paths and passive focus

**Files:**
- Modify: `extension/src/overlay/root.ts` only if tests expose a gap
- Test: `extension/tests/overlay-focus.test.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Add coverage for successful placement, destruction, comment-list refresh during marker mode, repeated cleanup, and mounting with saved-open state without automatically focusing Comments.

- [ ] **Step 2: Run focused tests and verify RED where behavior is missing**

Run: `node --test --test-concurrency=1 tests/overlay-focus.test.ts tests/overlay.test.ts`

- [ ] **Step 3: Apply only the lifecycle fixes required by the tests**

Route every exit through the shared cleanup without removing the yellow `:focus-visible` accessibility treatment.

- [ ] **Step 4: Verify focused and full extension suites**

Run: `node --test --test-concurrency=1 tests/overlay-focus.test.ts tests/overlay.test.ts`

Run: `npm test`

Expected: all extension tests pass with zero failures.

- [ ] **Step 5: Commit**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay-focus.test.ts extension/tests/overlay.test.ts
git commit -m "test: cover marker cleanup lifecycle"
```

### Task 3: Package and integrate the regression fix

**Files:**
- Modify: canonical version and generated pilot build files according to the existing release scripts

- [ ] **Step 1: Increment the patch version**

Advance the extension from `0.4.60` to `0.4.61` using the repository's established version workflow.

- [ ] **Step 2: Run all required build and release verification**

Run the extension, browser, server, deployment, packaging, and release checks required by the existing project scripts.

- [ ] **Step 3: Commit release metadata and merge to main**

Fast-forward the verified branch into `main`, preserving the user's untracked root `package-lock.json`, then rebuild the pilot folder used by Chrome.
