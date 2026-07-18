# Comment Index and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the course comment index/navigation and marker UX, and replace screenshots with secure top-level comment attachments.

**Architecture:** Keep course/thread authorization and upload capabilities server-authoritative. Use trusted MV3 background/session state for navigation and upload binding, a focused offscreen document for downloads, and small overlay helpers for filtering, labels, and cancellation.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic, pytest, TypeScript, Chrome MV3, happy-dom/node:test, Playwright.

---

### Task 1: Fix toolbar, filters, compact links, and Cancel Marker

**Files:** `extension/src/overlay/root.ts`, new `extension/src/overlay/context-label.ts`, `extension/tests/overlay.test.ts`

- [ ] Write failing tests for white hover/focus text, spaced matching filter buttons, immediate Open/Resolved rendering and empty states, compact accessible links, and button-based marker cancellation before page capture.
- [ ] Run tests and confirm expected failures.
- [ ] Implement minimal styling/rendering/state fixes and meaningful context-label fallback order while keeping selectors hidden.
- [ ] Run focused and full extension tests; commit.

### Task 2: Implement exact current/cross-page anchored navigation

**Files:** new `extension/src/navigation-handoff.ts`, `extension/src/background.ts`, `extension/src/background-bridge.ts`, `extension/src/content.ts`, `extension/src/overlay/root.ts`, associated tests.

- [ ] Write failing tests for current-page close/scroll/focus/open and tab/course/nonce/origin/expiry-bound cross-page one-time hand-off.
- [ ] Implement trusted session storage, navigation, destination consumption, anchor opening, failure messaging, and cleanup.
- [ ] Run focused/full extension tests; commit.

### Task 3: Add server attachment capability and deterministic validation

**Files:** `server/app/models.py`, `server/app/schemas.py`, `server/app/routers/attachments.py`, `server/app/services/attachments.py`, `server/app/services/comments.py`, `server/app/routers/comments.py`, `server/app/main.py`, `server/alembic/versions/20260713_11_attachment_capabilities.py`, attachment tests.

- [ ] Write failing tests for author/course-bound hashed five-minute capability, retry/cancel/consume semantics, 10 MiB streaming limit, exact PDF/PNG/JPEG/DOC/DOCX validation, DOCX bomb/path protections, filename rules, metadata visibility, download authorization, and deletion/orphan cleanup.
- [ ] Define create request `attachment_requested:boolean` and background-only response `{comment fields,upload_capability?:{token,expires_at}}`; strict bridge validation strips the token before responding to content and stores it by tab/course/comment in trusted session storage.
- [ ] Implement migration with hashed upload capabilities plus an `attachment_orphan_cleanup` table (`object_name`, attempts, last_error, next_attempt_at, created_at); application startup and post-delete bounded workers retry due rows with backoff and delete successful rows.
- [ ] Implement capability issuance, multipart upload/cancel, metadata projection, authenticated download, and durable orphan cleanup.
- [ ] Run migration and full server tests; commit.

### Task 4: Replace screenshot UI with attachment upload/download

**Files:** `extension/public/manifest.json`, new `extension/public/offscreen.html`, new `extension/src/offscreen.ts`, `extension/vite.config.ts`, `extension/src/api.ts`, `extension/src/background.ts`, `extension/src/background-bridge.ts`, `extension/src/content.ts`, `extension/src/overlay/root.ts`, `extension/tests/build-config.test.ts`, related tests.

- [ ] Define and test bounded transfer: content encodes the selected file into ordered base64 chunks of at most 256 KiB decoded bytes with `{transfer_id,index,total,decoded_size,data}`, never exceeding 10 MiB; background validates UUID/order/count/base64/aggregate size, buffers only one tab-bound transfer, accepts cancellation, expires partial transfers after five minutes, and loses/requires reselection after worker restart. Background-to-offscreen download uses the same validated chunk envelope; malformed/out-of-order/duplicate/overflow chunks abort and clean state.
- [ ] Define and test the offscreen state machine: exact extension-only `OFFSCREEN_DOWNLOAD_BEGIN/CHUNK/COMMIT/CANCEL/REGISTER/REVOKE` envelopes; one coalesced `chrome.offscreen.createDocument` promise using `BLOBS`. COMMIT returns a transfer-bound object URL to background; after `chrome.downloads.download()` returns, background sends REGISTER `{transfer_id,download_id,created_at}` so offscreen associatesates it with its URL. Background persists `{download_id,transfer_id,created_at}` in trusted session storage. On worker startup it first uses `chrome.runtime.getContexts` to reuse a surviving offscreen document and re-register/check live records there. If no offscreen context survives, prior object URLs/bytes are irrecoverable: remove persisted records, cancel any still-active affected downloads through `chrome.downloads.cancel`, and create a fresh offscreen document only for future transfers. Revoke surviving records older than 15 minutes. Cleanup occurs on complete/interrupted `downloads.onChanged`, every failure, explicit cancel, and startup sweep. Test both surviving-context and lost-context branches. The offscreen document alone owns blob URLs; the background alone invokes downloads.
- [ ] Write failing tests for file picker types/size, filename/removal/progress/error, exact-resource retry, screenshot removal, secure background upload/token stripping, chunk transport, singleton offscreen document, downloads permission, build packaging of offscreen HTML/JS, artifact assertions, and Help.
- [ ] Implement one-file top-level composer flow, capability persistence/retry/cancel, attachment cards, chunked transfer, authenticated download via offscreen document, Vite multi-entry/copy output, and lifecycle cleanup.
- [ ] Run focused/full extension tests and Playwright; commit.

### Task 5: Verify, version, package, deploy, and browser-test

**Files:** extension package/lock/version test, pilot test script as needed.

- [ ] Run full server/extension/typecheck/Playwright/migration/release-artifact suites.
- [ ] Bump pilot version and commit. Build/verify the signed artifact into a staging delivery directory that cannot update production `current`; verify checksums and immutable contents.
- [ ] Sync while preserving `.env`, `.venv-prod`, and data; apply backward-compatible migrations, restart user service, and verify local/Tailscale health plus old-extension compatibility.
- [ ] Publish the already verified staged artifact into immutable production releases and atomically switch `current`; reverify checksum and manifest version after the switch.
- [ ] Reload and smoke-test Chrome; repeat core install/load flow in Edge where available; report exact testing steps and any browser-session limitation.
