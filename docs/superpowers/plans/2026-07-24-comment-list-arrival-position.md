# Comment List Arrival Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the destination page group visible in the course comments list after cross-page Moodle or SCORM navigation reloads the document.

**Architecture:** A new fail-safe session-storage helper owns the versioned, expiring arrival record. The top-frame content controller records it only after navigation preparation succeeds and restores it only after an authoritative course-comment response has rendered; the overlay exposes one narrow method that positions its own scroll region without touching document scroll or startup.

**Tech Stack:** TypeScript, Chrome MV3 content script, DOM `sessionStorage`, Happy DOM, Node test runner, Vite.

---

### Task 1: One-use arrival storage

**Files:**
- Create: `extension/src/comment-list-arrival.ts`
- Create: `extension/tests/comment-list-arrival.test.ts`

- [ ] **Step 1: Write failing storage tests**

Cover a versioned record containing `course_url`, `page_url`, `comment_id`, `status`, `created_at`, and `token`; overwrite behavior; non-destructive peek; token-checked clear; five-minute expiry; malformed data; and throwing storage.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/comment-list-arrival.test.ts`

Expected: FAIL because `comment-list-arrival.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

Expose:

```ts
export type CommentListArrival = {
  version: 1;
  course_url: string;
  page_url: string;
  comment_id: string;
  status: "open" | "resolved";
  created_at: number;
  token: string;
};

export function writeCommentListArrival(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  input: Omit<CommentListArrival, "version" | "created_at" | "token">,
  options?: { now?: () => number; token?: () => string },
): CommentListArrival | undefined;

export function peekCommentListArrival(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  now?: () => number,
): CommentListArrival | undefined;

export function clearCommentListArrival(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  token: string,
): void;
```

All operations catch storage/JSON failures. `peek` removes malformed or expired records but never removes a valid record.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/comment-list-arrival.test.ts`

Expected: all arrival-storage tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/comment-list-arrival.ts extension/tests/comment-list-arrival.test.ts
git commit -m "feat: store one-use comment list arrivals"
```

### Task 2: Isolated overlay positioning

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing overlay tests**

Add tests for `restoreCommentListGroup(pageUrl, status)` that:

- mount successfully before restoration is requested;
- switch to Whole course and the stored Open/Resolved filter;
- expand the matching group;
- use non-zero mocked list/heading rectangles;
- clamp and change only `.comment-results.scrollTop`;
- never call document or element `scrollIntoView`;
- return `false` when the group is absent;
- preserve the existing scroll position during ordinary refreshes.

- [ ] **Step 2: Run the focused overlay test and verify RED**

Run: `npm test -- --test-name-pattern="restores the comment list arrival"`

Expected: FAIL because `ReviewOverlay.restoreCommentListGroup` does not exist.

- [ ] **Step 3: Implement the minimal overlay method**

Add to `ReviewOverlay`:

```ts
restoreCommentListGroup(pageUrl: string, status: "open" | "resolved"): boolean;
```

Inside the controller, locate the current rendered group and its heading, set course scope and status, apply the existing filter, expand the group, compute:

```ts
const desired = results.scrollTop
  + heading.getBoundingClientRect().top
  - results.getBoundingClientRect().top;
results.scrollTop = Math.max(0, Math.min(desired, results.scrollHeight - results.clientHeight));
```

Return `true` only after positioning succeeds. Do not access arrival storage here.

- [ ] **Step 4: Run the focused overlay test and verify GREEN**

Run: `npm test -- --test-name-pattern="restores the comment list arrival|ordinary comment refresh"`

Expected: focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/overlay/root.ts extension/tests/overlay.test.ts
git commit -m "feat: restore a rendered comment page group"
```

### Task 3: Record after preparation and restore after authoritative comments

**Files:**
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/content.test.ts`

- [ ] **Step 1: Write failing integration tests**

Test the top-frame controller with injected/Happy DOM session storage:

- a cross-page comment row and page heading keep the existing `PREPARE_COMMENT_NAVIGATION` payload, then write the logical page URL/status immediately before the unchanged destination assignment;
- preparation failure writes nothing;
- assignment failure token-clears only that record;
- same-page navigation writes nothing;
- a fresh controller retains a matching SCORM/Rise record through an initial authoritative response without the target, then restores and consumes it after a later response contains the exact comment/page/status;
- storage exceptions do not block navigation, overlay mounting, or comment rendering.

- [ ] **Step 2: Run focused content tests and verify RED**

Run: `npm test -- --test-name-pattern="comment list arrival"`

Expected: FAIL because content navigation does not write or restore arrival records.

- [ ] **Step 3: Implement the minimal content integration**

Create the session-storage dependency with a guarded getter. In `navigateToComment`, locate the selected comment in `latestComments`, await `prepareCommentNavigationWithRetry`, and, only when it returns `destination_url`, write the record and call `location.assign`. If assignment throws, token-clear and rethrow.

After every authoritative `LIST_COURSE_COMMENTS` response is rendered, peek at the record. Remove invalid course records. For exact comment/page/status matches, call `overlay.restoreCommentListGroup`; token-clear only when it returns `true`. Leave valid missing-target records for a later response.

- [ ] **Step 4: Run focused content and overlay tests and verify GREEN**

Run: `npm test -- --test-name-pattern="comment list arrival|whole-course page groups|ordinary comment refresh"`

Expected: focused tests pass with navigation message and assignment assertions unchanged.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content.ts extension/tests/content.test.ts
git commit -m "feat: restore comment list position after navigation"
```

### Task 4: Release and browser-test handoff

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`

- [ ] **Step 1: Bump the pilot version**

Advance the canonical extension version from `0.5.23` to `0.5.24` in package metadata and the build-config assertion.

- [ ] **Step 2: Run complete verification**

Run from `extension/`:

```bash
npm test
npm run typecheck
npm run build
```

Expected: zero failures.

Run from the repository root:

```bash
python3 -m pytest server/tests -q
python3 -m unittest tests/test_deployment_package.py
git diff --check
```

Expected: zero failures and no whitespace errors.

- [ ] **Step 3: Commit and push**

```bash
git add extension/package.json extension/package-lock.json extension/tests/build-config.test.ts
git commit -m "release: prepare pilot 0.5.24"
git push
```

- [ ] **Step 4: Publish the signed pilot**

Run the existing `deploy/scripts/release-pilot-extension.sh` with the approved external key path and service origin. Verify every entry in the published `SHA256SUMS`.

- [ ] **Step 5: Confirm the browser-test package**

Verify that `Beta Testing App-pilot-builds/moodle-review-extension-v0.5.24-chrome-edge.zip` exists, the unpacked compatibility link resolves to the same release, and the worktree is clean.
