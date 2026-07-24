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

Cover a versioned record containing `course_url`, `page_url`, `comment_id`, `status`, `created_at`, and `token`; overwrite behavior; non-destructive peek; token-checked clear; and five-minute expiry. Validate `undefined` and throwing storage, exact `version: 1`, non-empty string fields, finite numeric `created_at`, only `open`/`resolved`, a non-empty unique default token, and exact URL preservation without normalization.

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

All operations catch storage/JSON failures. `peek` removes malformed or expired records but never removes a valid record. The default token source uses `crypto.randomUUID()` and is dependency-injected in tests.

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

Add a controller-level `restoreRenderedCommentListGroup` callback. Replace it on every `setCommentList` render with a closure over that render's `applyFilter`, `setGroupExpanded`, group maps, and results element; clear it during destroy. The public method delegates to the current callback and returns `false` when no current rendered group exists.

Inside the render-scoped callback, locate the group and heading, set course scope and status, apply the existing filter, expand the group, compute:

```ts
const desired = results.scrollTop
  + heading.getBoundingClientRect().top
  - results.getBoundingClientRect().top;
results.scrollTop = Math.max(0, Math.min(desired, results.scrollHeight - results.clientHeight));
```

Return `true` only after positioning succeeds. Clamp safely to zero when `scrollHeight < clientHeight`. Do not access arrival storage here.

- [ ] **Step 4: Run the focused overlay test and verify GREEN**

Run: `npm test -- --test-name-pattern="restores the comment list arrival|ordinary comment refresh"`

Expected: focused tests pass. Assertions cover both clamp boundaries, including content shorter than the list viewport, and prove the outer document/window scroll coordinates remain unchanged.

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
- overlay mount/startup calls `sessionStorage.getItem` and `removeItem` zero times and leaves storage untouched until the first authoritative `LIST_COURSE_COMMENTS` response has rendered;
- Moodle logical page URLs restore independently;
- Rise hash/SCORM logical page URLs restore when `page_url !== navigation.destination_url`;
- exact comment-ID, page-URL, and status mismatches are each rejected;
- a course mismatch is token-cleared;
- a valid exact-course record is retained when the comment tuple or rendered group is absent, including through an initial SCORM response without the target, then restored and consumed after a later exact response;
- malformed and expired records are removed;
- storage exceptions do not block navigation, overlay mounting, or comment rendering.

- [ ] **Step 2: Run focused content tests and verify RED**

Run: `npm test -- --test-name-pattern="comment list arrival"`

Expected: FAIL because content navigation does not write or restore arrival records.

- [ ] **Step 3: Implement the minimal content integration**

Create the session-storage dependency with a guarded getter. In `navigateToComment`, before awaiting preparation, snapshot the selected comment by exact `id + pageUrl` from `latestComments` and snapshot `context.course_url`. Await `prepareCommentNavigationWithRetry`; only when it returns `destination_url`, write those exact snapshotted values and call `location.assign`. Never use a later mutable context or substitute `navigation.destination_url` for the logical page URL. If the tuple/status is invalid or storage fails, navigation continues without a record. If assignment throws, token-clear only that record and rethrow.

After every authoritative `LIST_COURSE_COMMENTS` response is rendered, peek at the record. `peek` removes malformed or expired data. Token-clear an exact `course_url` mismatch. For an exact-course record, require an exact comment ID/page URL/status match before calling `overlay.restoreCommentListGroup`; token-clear only when it returns `true`. Retain every valid exact-course record when its tuple or rendered group is absent. Every explicit clear is token-checked.

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

Run the existing `deploy/scripts/release-pilot-extension.sh` with the approved external key path and service origin. This script is the required production build; the earlier `npm run build` is development verification only. Require the script's internal:

```bash
(cd "$DELIVERY_ROOT" && shasum -a 256 -c SHA256SUMS)
```

to report every published entry `OK`.

- [ ] **Step 5: Confirm the browser-test package**

Verify that `Beta Testing App-pilot-builds/moodle-review-extension-v0.5.24-chrome-edge.zip` exists, the unpacked compatibility link resolves to the same release, and the worktree is clean.
