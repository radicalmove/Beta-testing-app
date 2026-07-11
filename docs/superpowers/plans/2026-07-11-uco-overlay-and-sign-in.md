# UCO Overlay and Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Moodle overlay a UCO visual treatment and a complete, accessible extension authentication flow.

**Architecture:** Keep authentication orchestration in the existing background worker and expose it through a strict content-script bridge. Extend the Shadow DOM overlay controller with deterministic authentication states and callbacks, then refresh course resolution after success. Preserve the classic self-contained production content script and existing server endpoints.

**Tech Stack:** TypeScript, Chrome/Edge MV3, Vite, Shadow DOM, Node test runner, live Chrome pilot, FastAPI service over Tailscale.

---

## File structure

- `extension/src/overlay/root.ts`: UCO visual tokens, auth state markup, focus/live-region behavior.
- `extension/src/content.ts`: sign-in callback wiring and post-auth course refresh.
- `extension/src/background.ts`: enforce strict authenticated-message and trusted-sender checks before launching web auth.
- `extension/src/background-bridge.ts`: exact authenticate-message schema and trusted top-frame sender authorization boundary.
- `extension/tests/overlay.test.ts`: markup, styling, keyboard, busy and focus behavior.
- `extension/tests/content.test.ts`: auth message, duplicate prevention, success refresh and error-state integration.
- `extension/tests/api.test.ts`: exact callback, one-time exchange behavior, session-only persistence, and credential omission.
- `extension/tests/background-bridge.test.ts`: trusted sender and strict auth-message validation.
- `server/tests/test_auth_routes.py` and `server/tests/test_accounts.py`: exact allow-list and single-use code enforcement.
- `extension/tests/build-config.test.ts` and `tests/test_deployment_package.py`: packaged classic-script and production-manifest regressions.
- `pilot-builds/moodle-review-extension/`: regenerated delivered pilot artifact after all mutating tests finish.

### Task 1: Accessible authentication states

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] Write failing tests asserting signed-out/pending/offline controls, textual status plus live region, one unique Sign in/Retry action, disabled `Signing in…` state, and focus restoration/movement.
- [ ] Run `cd extension && node --test --test-name-pattern='sign|auth|status' tests/overlay.test.ts`; expect the new assertions to fail.
- [ ] Add an overlay auth callback, deterministic state/message rendering, duplicate-click lock, live announcements, and focus behavior without changing comment controls.
- [ ] Run the focused tests; expect PASS.
- [ ] Commit with `git commit -m 'feat: add accessible extension sign-in states'`.

### Task 2: Content/background authentication integration

**Files:**
- Modify: `extension/src/content.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background-bridge.ts`
- Test: `extension/tests/content.test.ts`

- [ ] Write failing integration tests proving initial resolution maps to connected/signed out; one `AUTHENTICATE` message per activation; retry starts exactly one fresh flow; success triggers a fresh `RESOLVE_COURSE` and page-comment load; cancellation and rejected callback map to **Sign-in cancelled**; exchange failure maps to **Sign-in failed—try again**; pending/offline map exactly; and API expiry maps to **Session expired—sign in again**.
- [ ] Add security tests proving an exact callback origin/path, single-use code consumption, strict trusted `AUTHENTICATE` sender validation, tokens stored only in `chrome.storage.session`, API `credentials: "omit"`, and no credentials/codes/tokens in DOM, page events, URLs, or logs. The `AUTHENTICATE` schema must reject extra keys/payloads, and its sender must be this extension's trusted top-level configured Moodle frame before `launchWebAuthFlow` is called.
- [ ] Run `cd extension && node --test --test-name-pattern='authenticate|sign|session|callback|sender' tests/content.test.ts tests/api.test.ts tests/background-bridge.test.ts`; run `cd server && python3 -m pytest -q tests/test_auth_routes.py tests/test_accounts.py`; expect new tests to FAIL.
- [ ] Implement the exact authenticate-message validator and top-frame Moodle sender authorization in `background-bridge.ts`; require both in `background.ts` before `launchWebAuthFlow`. Wire the overlay callback to that operation and reuse the existing course refresh boundary after success.
- [ ] Re-run both exact focused commands; expect PASS.
- [ ] Commit with `git commit -m 'feat: connect overlay authentication flow'`.

### Task 3: UCO visual system and responsive accessibility

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] Write failing tests for Poppins fallback stack, UCO red `#d73b3d`, black header, white panels, visible focus tokens, connected text status, responsive rules, and computed WCAG AA contrast ratios for deterministic colour pairs.
- [ ] Run `cd extension && node --test --test-name-pattern='UCO|contrast|responsive|focus' tests/overlay.test.ts`; expect FAIL.
- [ ] Replace navy/teal styling with UCO tokens while retaining Shadow DOM isolation, keyboard behavior, and Moodle non-interference.
- [ ] Run `cd extension && node --test --test-name-pattern='UCO|contrast|responsive|focus' tests/overlay.test.ts && npm run typecheck`; expect PASS.
- [ ] Commit with `git commit -m 'style: align review overlay with UCO'`.

### Task 4: Full regression and production artifact

**Files:**
- Modify if necessary: `tests/test_deployment_package.py`
- Generate: `extension/dist/*`
- Deliver: `pilot-builds/moodle-review-extension/*`

- [ ] Strengthen the packaging regression to reject top-level ESM syntax/runtime chunks and assert the real UC Online/Tailscale hosts. Test the rejection helper against isolated strings/temp files rather than overwriting `extension/dist`.
- [ ] Run all potentially mutating suites first: `cd extension && npm test && npm run typecheck`; then `cd ../server && python3 -m pytest -q`; expect 107+ extension and 116+ server tests PASS.
- [ ] From the repository root run `PRIVATE_KEY_PATH=/Users/rcd58/.config/moodle-review/pilot-extension.pem REVIEW_SERVICE_ORIGIN=https://fld-mini.tail4ccaba.ts.net deploy/scripts/build-pilot-extension.sh` as the final build-producing command.
- [ ] Run `python3 -m unittest tests/test_deployment_package.py`; then explicitly parse `extension/dist/manifest.json` for only `https://my.uconline.ac.nz/*` and `https://fld-mini.tail4ccaba.ts.net/*`, and assert `content.js` has no ESM syntax, runtime chunk imports, or external dependency URLs.
- [ ] Execute the just-built production `content.js` as a classic script in a DOM/browser stub harness and assert it sets `data-moodle-review-extension="active"` without syntax, module-resolution, or external-dependency errors.
- [ ] Replace `pilot-builds/moodle-review-extension` and its ZIP only after those read-only production checks; compare manifest/content hashes between `extension/dist` and the delivered folder.
- [ ] Commit source/test changes; never commit private keys or generated secrets.

### Task 5: Live Chrome functional verification

**Files:**
- Reference: `docs/pilot-test-script.md`

- [ ] Before auth, calculate the production manifest ID from its embedded key, confirm it equals the installed Chrome and Edge unpacked IDs, and confirm `https://<exact-id>.chromiumapp.org/` is in the server allow-list; abort on mismatch.
- [ ] Reload the unpacked extension and CRJU150 course page; verify course `896`, UCO styling, textual signed-out state, keyboard order, live announcements, visible focus, no clipping/overlap at 200% zoom and 320 CSS px, cancellation/failure focus restoration, and success focus movement.
- [ ] Activate Sign in, complete the existing authorization page, and verify Connected without a Moodle reload.
- [ ] Using the admin/LD view create `[PILOT TEST — DELETE] highlight` and `[PILOT TEST — DELETE] pin`, refresh, and verify both recover; verify visibility using the seeded LD, SME, selected/unselected SME as applicable, and two beta-account views.
- [ ] Verify both comments in the dashboard, mark them resolved, then delete them only if an existing safe admin cleanup action exists; otherwise leave them clearly labelled and record them for cleanup.
- [ ] Test `/mod/scorm/view.php?id=146308` and the queryless player; record the actual Rise origin or verify parent-page fallback.
- [ ] Run `ssh fldadmin@100.76.46.77 'systemctl --user is-active moodle-review.service moodle-review-backup.timer; tailscale serve status; cd /home/fldadmin/beta-testing-app/server && .venv-prod/bin/alembic current'`; validate the newest backup with its `SHA256SUMS`, `pg_restore --list`, and `tar -tzf` commands from the operations guide.
- [ ] Commit any final regression fix separately and report observed limitations.
