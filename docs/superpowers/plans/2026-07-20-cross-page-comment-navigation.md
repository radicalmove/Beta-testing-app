# Cross-page Comment Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Next and Previous cross course-page boundaries using the visible open-comment order and automatically open the destination in context.

**Architecture:** Keep ordering in the renderer and reuse its existing `navigateToComment` boundary. Strengthen the regression test at the exact anchor-ordered page boundary; make the smallest production correction identified by that failure. The existing background navigation record remains responsible for Moodle/SCORM arrival and restoration.

**Tech Stack:** TypeScript, Node test runner, Happy DOM, Chrome MV3, Playwright.

---

### Task 1: Reproduce the page-boundary failure

**Files:**
- Modify: `extension/tests/comment-renderer.test.ts`
- Inspect: `extension/src/comment-renderer.ts`

- [ ] Add a test with two current-page anchors supplied out of DOM order and one comment on the following course page.
- [ ] Open the final anchor-ordered current-page comment and click Next.
- [ ] Assert `navigateToComment` receives the following page's comment ID and URL.
- [ ] Run the focused test and confirm it fails for the reported boundary behaviour.

### Task 2: Correct the unified sequence

**Files:**
- Modify: `extension/src/comment-renderer.ts`
- Test: `extension/tests/comment-renderer.test.ts`

- [ ] Make the smallest change needed so the anchor-sorted current-page group remains in its course-group position and its final item advances to the next group.
- [ ] Ensure same-page targets still scroll/open locally and cross-page targets still use `navigateToComment`.
- [ ] Run the focused test and confirm it passes.
- [ ] Run all extension unit tests and type checking.

### Task 3: Release a testable pilot

**Files:**
- Modify the canonical version references in the established release files.

- [ ] Bump the extension patch version.
- [ ] Run extension unit, type-check, E2E, server, deployment, and release-artifact tests.
- [ ] Commit and fast-forward merge to `main`, preserving the user's untracked root `package-lock.json`.
- [ ] Build and verify the signed pilot package, check service health, and report the version ready for testing.
