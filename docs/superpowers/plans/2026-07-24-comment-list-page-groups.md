# Comment-list page groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Jump to with accessible heading links and group disclosure controls while preserving safe Moodle/SCORM navigation.

**Architecture:** `projectCourseComments()` remains the one ordering source. `setCommentList()` replaces the Jump-to menu with locally-rendered disclosure state; page heading navigation reuses the existing comment navigation callback.

**Tech Stack:** TypeScript, Happy DOM, Node test runner, Playwright.

---

### Task 1: Write failing page-group tests

**Files:**
- Modify: `extension/tests/overlay.test.ts`

- [ ] Add tests asserting that recovered current-page anchor ranks order group rows, the old `[data-comment-jump]` is absent, and `[data-collapse-groups]` initially reads `Collapse all` in the same 104px control footprint.
- [ ] Add tests for a separate heading navigation button and chevron: heading navigation uses the first status/scope-matching comment even when rows are collapsed; the chevron toggles only its group and maintains `aria-expanded`/`aria-controls`.
- [ ] Add tests proving individual chevrons never change the main label; only the main button changes `Collapse all` to `Expand all` and back. Assert the main control is disabled in Current page scope and with zero visible whole-course groups.
- [ ] Run `npm test -- --test-name-pattern="page groups|Collapse all|heading navigation|chevron"`; confirm red failures.
- [ ] Commit: `git add extension/tests/overlay.test.ts && git commit -m "test: cover comment-list page groups"`.

### Task 2: Replace Jump to with collapsible page groups

**Files:**
- Modify: `extension/src/overlay/root.ts:557-704`
- Modify: `extension/src/overlay/root.ts:18-29`
- Test: `extension/tests/overlay.test.ts`

- [ ] Delete the Jump-to listbox, page selector, geometry, keyboard/outside-click handling, and `jumpOutsideListener` lifecycle. Leave course projection, renderer ordering, and `navigateToComment` unchanged.
- [ ] Render each `projection.groups` entry as a heading container with a `comment-group-link` button plus a separate `comment-group-toggle` button. Give the chevron an exact controlled row-container id, `aria-expanded`, and a label such as `Collapse 1.2.1 Participants and power comments`.
- [ ] Heading clicks choose the first comment matching status/scope filters before considering collapse state. For the current page call `renderer.takeToContext(comment.id)`; otherwise call `options.navigateToComment(comment.id, group.pageUrl)`, preserving the current error/status treatment.
- [ ] Add local `expandedGroups` state initialised to true on every list render. Main button starts `Collapse all`; clicking it sets all currently visible groups closed then changes its label to `Expand all`; the next click expands them then restores `Collapse all`. Chevron clicks do not mutate the main mode.
- [ ] Refactor `applyFilter()` to calculate filter visibility before collapse visibility. Hide empty headings, render headings only in Whole course scope, preserve the empty message based on filter matches rather than collapsed rows, and disable the main button in Current page scope or when no whole-course group matches.
- [ ] Replace obsolete Jump-to CSS with `.comment-group-heading`, `.comment-group-link`, `.comment-group-toggle`, and `.comment-collapse-groups` styles. Keep the main button width/height at `104px`/`38px`, use a smaller `12px` label if required, and keep the filter row unchanged.
- [ ] Run `npm test -- --test-name-pattern="page groups|Collapse all|heading navigation|chevron|whole-course list"`; confirm green.
- [ ] Commit: `git add extension/src/overlay/root.ts extension/tests/overlay.test.ts && git commit -m "feat: group and collapse course comments"`.

### Task 3: Regression and release verification

**Files:**
- Modify only established release-version files if publishing requires a version bump.

- [ ] Run `npm test`, `npm run typecheck`, and `npm run test:e2e`; all must pass.
- [ ] Run `git diff --check` and `git status --short`; confirm only intended changes.
- [ ] If releasing, use the established signed `deploy/scripts/release-pilot-extension.sh` with the known configured key path; do not search for keys. Verify the pilot manifest, `RELEASE.json`, and `SHA256SUMS` in `/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds`.
- [ ] Commit release metadata if changed, then push the branch.
