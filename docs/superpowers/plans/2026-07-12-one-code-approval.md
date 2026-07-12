# One-Code Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the invitation code the only reviewer-entered code and connect an approved reviewer automatically in the same browser.

**Architecture:** Keep the existing server contract. On pending redemption, the trusted background stores the server-issued reconnect credential privately. The Moodle content controller asks the background to retry that stored credential every 10 seconds and on visibility/initialization; successful resume installs the existing session/device credentials and refreshes the overlay. Remove the visible existing-user/reconnect-code branch.

**Tech Stack:** TypeScript, Chrome Manifest V3 storage/runtime APIs, Node test runner, Python/FastAPI server (unchanged), Vite release build.

---

### Task 1: Private pending-access storage

**Files:**
- Create: `extension/src/pending-access.ts`
- Create: `extension/tests/pending-access.test.ts`

- [ ] Write tests for exact course-scoped records, malformed-record rejection, saving/retrieving/removing, and storage access restriction.
- [ ] Run `node --test tests/pending-access.test.ts` and confirm failure because the module is absent.
- [ ] Implement a small `PendingAccessStore` over `chrome.storage.local`; store course handle, normalized email, role, and reconnect credential under a course-derived key.
- [ ] Run the focused test and typecheck; commit.

### Task 2: Background redemption and automatic resume

**Files:**
- Modify: `extension/src/background.ts`
- Modify: `extension/src/api.ts`
- Modify: `extension/tests/api.test.ts`
- Modify: `extension/tests/build-config.test.ts`

- [ ] Add failing tests proving pending API responses retain the internal credential while public background responses do not expose it.
- [ ] Add `CHECK_PENDING_REVIEW_ACCESS` handling that accepts only a course handle from an authorized Moodle sender.
- [ ] On pending redemption, persist the hidden credential and return only `{state, role}`.
- [ ] On check, resume with stored email/credential; treat generic 403 as still pending, and on success store session/device credentials and remove pending state.
- [ ] Coalesce checks per course so multiple tabs cannot race.
- [ ] Run API/background/build tests and typecheck; commit.

### Task 3: One-form overlay and automatic polling

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/tests/overlay-focus.test.ts`
- Modify: `extension/tests/content.test.ts`

- [ ] Add failing tests proving the form has only name, email, role, and invitation code; forbidden reconnect/existing-user wording is absent.
- [ ] Add failing content tests for immediate check after pending redemption, 10-second visible polling, successful automatic connection, single-flight behavior, and teardown.
- [ ] Simplify `ReviewerAccessInput` to the new-reviewer shape and remove mode tabs/reconnect-code output.
- [ ] Show **Waiting for approval — you can leave this page open or return later.** with **Check approval**.
- [ ] Implement the visibility-aware timer and refresh existing comments after a connected check.
- [ ] Run focused overlay/content tests and typecheck; commit.

### Task 4: Verify and publish

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `tests/test_release_artifacts.py`

- [ ] Bump to the next unused patch version.
- [ ] Run `npm --prefix extension run typecheck` and `npm --prefix extension test`.
- [ ] Run `python3 -m pytest -q` from `server/` and `python3 -m pytest tests -q` from the repository root after the production build gate.
- [ ] Build and publish with `deploy/scripts/release-pilot-extension.sh` using the existing signing key and service origin.
- [ ] Verify `RELEASE.json`, SHA-256 checksums, manifest version/key/hosts, push the branch, and provide the one-step reload instructions.
