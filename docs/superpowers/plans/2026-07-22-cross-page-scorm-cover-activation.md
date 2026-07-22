# Cross-page SCORM Cover Activation Implementation Plan

> **Amendment after browser verification:** `SCORM_ACTIVATE_COVER` must never call `element.click()`. It arms an exact Rise Start listener and returns `USER_ACTION_REQUIRED`. A new generation-bound `SCORM_COVER_ACTIVATED` event is emitted only for a trusted mouse/keyboard-generated click; the background confirms the pending cover phase from that event and resumes navigation. Tests must prove untrusted clicks are ignored, trusted Start activation resumes the pending request, already-current SCORM skips the handoff, and the top panel reports the required arrow/Tab+Enter action while waiting.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make comment navigation entering a target Rise SCORM confirm its Start cover once before applying the saved locator, while navigation already inside that same SCORM skips cover activation.

**Architecture:** Add a distinct, strictly validated `SCORM_ACTIVATE_COVER` worker command. The background navigation record remembers whether it performed a top-level transition into a different SCORM and whether that cover phase has been confirmed. Only that transition path invokes cover activation; after confirmation, retries apply the locator even though Rise keeps the Start link in the DOM.

**Tech Stack:** TypeScript, Chrome Manifest V3 messaging, Node test runner, linkedom fixtures, Vite.

---

## File map

- `extension/src/scorm-protocol.ts`: declare and validate the distinct cover command and acknowledgement.
- `extension/src/scorm-worker.ts`: handle exact Rise cover activation without coupling it to locator application.
- `extension/src/background.ts`: route the new command and expose it to the navigation state machine.
- `extension/src/embedded-comment-navigation.ts`: persist target-player transition and confirmed-cover state.
- `extension/tests/scorm-protocol.test.ts`: cover exact protocol acceptance and rejection.
- `extension/tests/scorm-worker.test.ts`: reproduce the persistent Start link and cover readiness outcomes.
- `extension/tests/background.test.ts`: prove all three navigation origins and retry/worker boundaries.
- Version/release expectation files: bump browser package from `0.5.9` to `0.5.10`.

### Task 1: Define the cover command boundary

**Files:**
- Modify: `extension/src/scorm-protocol.ts`
- Test: `extension/tests/scorm-protocol.test.ts`

- [ ] Add `SCORM_ACTIVATE_COVER` with an exact empty payload to the protocol tests, command discriminator list, and acknowledgement expectations.
- [ ] Run `node --test --test-name-pattern='SCORM message|command and event|post-election|payload keys|acknowledgement' tests/scorm-protocol.test.ts` from `extension/`; expect failure because the command is unknown.
- [ ] Add the command to `SCORM_MESSAGE_TYPES`, `SCORM_ACK_TYPES`, `ScormCommand`, and the empty-payload validation branch.
- [ ] Re-run the focused protocol tests; expect pass.

### Task 2: Separate cover activation from locator navigation

**Files:**
- Modify: `extension/src/scorm-worker.ts`
- Test: `extension/tests/scorm-worker.test.ts`

- [ ] Replace the existing regression fixture with one that leaves the Rise Start link connected after activation.
- [ ] Add assertions that `SCORM_ACTIVATE_COVER` clicks one exact valid Start link and returns the standard successful `SCORM_ACTIVATE_COVER_ACK`, a later `SCORM_APPLY_LOCATOR` navigates despite the persistent link, and zero/multiple/invalid Start links return a failed `SCORM_ACTIVATE_COVER_ACK` with `COVER_NOT_READY` without navigation.
- [ ] Run `node --test --test-name-pattern='Rise cover|apply-locator opens' tests/scorm-worker.test.ts`; expect failure because the distinct command is not handled and the persistent link traps locator application.
- [ ] Move `activateRiseCover(document)` into the `SCORM_ACTIVATE_COVER` case, return `COVER_NOT_READY` when it cannot activate, and make `SCORM_APPLY_LOCATOR` only validate/apply the locator.
- [ ] Re-run the focused worker tests; expect pass.

### Task 3: Persist the target-player cover phase

**Files:**
- Modify: `extension/src/embedded-comment-navigation.ts`
- Modify: `extension/src/background.ts`
- Test: `extension/tests/background.test.ts`

- [ ] Add failing state-machine tests for: normal page to SCORM activates cover; different SCORM to target SCORM activates cover; already-current target SCORM skips cover; `COVER_NOT_READY` retains the activation phase; acknowledgement loss retains the unconfirmed phase; worker replacement before confirmation retries activation; confirmed activation survives worker replacement and proceeds to locator.
- [ ] Run `node --test --test-name-pattern='cover|slow SCORM|worker replaced' tests/background.test.ts`; expect failures showing no distinct cover phase.
- [ ] Extend the stored navigation record with `targetPlayerNavigationRequested` and `coverConfirmed` booleans. Set the transition flag only when `current.topUrl !== parentActivityUrl` causes `navigateParent`.
- [ ] Add an `activateCover(tabId)` dependency. When the target worker is ready and the transition flag is true but cover confirmation is false, save the activation state, send `SCORM_ACTIVATE_COVER`, and persist confirmation only after receiving its successful acknowledgement; command timeout, lost acknowledgement, and worker replacement before success must leave the phase unconfirmed.
- [ ] Route `SCORM_ACTIVATE_COVER` through `navigationCommand`; translate `COVER_NOT_READY` into a recoverable error so the existing bounded retry scheduler retains the navigation record.
- [ ] Ensure already-current SCORM navigation proceeds directly to `SCORM_APPLY_LOCATOR`, and ensure confirmed cover state is record-scoped rather than worker-scoped.
- [ ] Re-run the focused background tests; expect pass.

### Task 4: Run regression verification

**Files:**
- Verify only.

- [ ] Run `npm test` from `extension/`; expect all tests pass with zero failures.
- [ ] Run `npm run typecheck`; expect exit 0.
- [ ] Run `npm run build`; expect exit 0.
- [ ] Inspect `git diff --check` and `git status --short`; expect no whitespace errors and only intended files plus the user's pre-existing unrelated files.

### Task 5: Version, commit, and publish 0.5.10

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `tests/test_deployment_package.py`
- Modify: `docs/pilot-test-script.md`

- [ ] Update all canonical and asserted versions from `0.5.9` to `0.5.10`.
- [ ] Run `npm test && npm run typecheck && npm run build` from `extension/`; expect all tests and build checks pass.
- [ ] Commit only the intended implementation, test, version, and pilot-script files with `fix: complete cross-page SCORM navigation`.
- [ ] Build in production mode using the approved Moodle pattern, review-service origin, committed SHA, and the stable public extension key from the current released manifest.
- [ ] Publish with `deploy/scripts/release_artifacts.py` from a clean detached worktree into `/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds` as `0.5.10`.
- [ ] Verify release `SHA256SUMS`, manifest version/key equality, current unpacked folder equality, and current/release ZIP hash equality.
