# Review Overlay UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded review toolbar with a larger, plain-language Add comment flow, comments count, contextual embedded-content guidance, and accessible Help dialog.

**Architecture:** Keep the existing Shadow DOM overlay controller and anchoring/submission services. Add small rendering/state helpers inside `overlay/root.ts` for the toolbar, choice panel, Help dialog, and area-selection navigator; expose comment-count updates through the existing `ReviewOverlay.setPageComments` path. No server or data contract changes are required.

**Tech Stack:** TypeScript, Shadow DOM, Happy DOM unit tests, Playwright layout tests, Vite MV3 build, existing signed release scripts.

---

### Task 1: Specify the compact toolbar contract

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] Add failing tests named `compact toolbar exposes one primary action and calm metadata` and `responsive toolbar keeps three actions in one row at 600 and 360 pixels`, asserting **Add comment**, **Comments (0)**, accessible **Help and instructions**, no visible page/version prefixes, 16px host type, 44px controls, teal boundary, `minmax(0,1fr) auto 44px` at ≤600px, and the **0 comments** short label/no-overflow contract at ≤360px.
- [ ] Run `node --test --test-name-pattern="compact toolbar|responsive toolbar" tests/overlay.test.ts`; expect failures because markup still contains `Highlight text`/`Add pin` and the stylesheet still has 14px/36px controls.
- [ ] Replace `createStateActions` and `createOverlayMarkup` with identity/status and action groups; retain signed-out controls; add full-title attributes and move page/build details into panel/help destinations.
- [ ] Consolidate the legacy teal override into the final scoped stylesheet so tests and runtime use one authoritative style string.
- [ ] Run the overlay tests and commit `feat: simplify review overlay toolbar`.

### Task 2: Add the contextual Add comment chooser

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] Add failing tests named `Add comment chooser preserves page selection`, `text choice without selection announces and returns to page`, and `chooser dismissal returns focus`, covering plain-language labels, absence of retired terminology, outside-click/Escape, and focus moving from a successful choice into the composer or instruction strip.
- [ ] Run `node --test --test-name-pattern="Add comment chooser|text choice without|chooser dismissal" tests/overlay.test.ts`; expect zero chooser matches.
- [ ] Add chooser state to the controller; capture a valid page range before focusing the chooser; route **Comment on text** into the existing text composer and **Comment on an area** into area mode.
- [ ] Ensure navigation/disconnection/controller teardown removes the chooser and returns focus safely.
- [ ] Run focused and full overlay tests; commit `feat: add contextual comment chooser`.

### Task 3: Make area selection understandable and keyboard operable

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`
- Existing dependency: `extension/src/anchors/pin.ts`

- [ ] Add failing tests named `area mode intercepts one placement click`, `area keyboard navigator retains and cycles targets`, and `area mode cancellation returns to Add comment`, covering instruction text, bounded discovery, last-focus retention, outline, Enter, empty-target fallback, and exact Escape focus restoration.
- [ ] Run `node --test --test-name-pattern="area mode|area keyboard" tests/overlay.test.ts`; expect failures because the old pin listener has no strip or keyboard navigator.
- [ ] Implement an area-mode controller that reuses `capturePinAnchor`, excludes extension UI, tracks at most 200 visible eligible targets, and owns all pointer/keyboard listeners and outline cleanup.
- [ ] Preserve the existing composer anchor payload and fallback page-title marker.
- [ ] Run pin, overlay, and content tests; commit `feat: add accessible area selection flow`.

### Task 4: Clarify embedded activity fallback

**Files:**
- Modify: `extension/tests/overlay-focus.test.ts`
- Modify: `extension/tests/content.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] Add failing tests named `embedded fallback is passive and uses the single Add comment flow` and `embedded chooser uses plain contextual wording`, asserting the passive **Embedded activity detected** notice, absence of a duplicate fallback button and retired terms, and contextual **Comment on embedded content** chooser label.
- [ ] Run `node --test --test-name-pattern="embedded fallback is passive|embedded chooser" tests/overlay-focus.test.ts tests/content.test.ts`; expect failures because the current fallback renders **Place parent-page pin** and a duplicate button.
- [ ] Replace `showFrameFallback` content with the passive notice and make the single Add comment chooser read fallback state.
- [ ] Verify accessible and inaccessible frame flows remain distinct; commit `feat: clarify embedded activity feedback`.

### Task 5: Add comments count and Help dialog

**Files:**
- Modify: `extension/tests/overlay.test.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] Add failing tests named `comments count follows visible top-level threads`, `Help dialog provides complete instructions and metadata`, and `Help dialog is modal and restores focus`, covering reset/update behavior, full page title, all five Help sections, version/build footer, ARIA relationships, inert background, heading-first DOM/tab order, absence of `title`-only/hover-only help, focus trap, Escape/Close restoration, and missing-trigger fallback.
- [ ] Run `node --test --test-name-pattern="comments count|Help dialog" tests/overlay.test.ts`; expect missing Help/count UI failures.
- [ ] Update `setPageComments` to maintain the count and panel title without counting replies; reset count on disconnected updates.
- [ ] Implement the Help modal with the five approved instruction sections and shared dialog focus helper.
- [ ] Run overlay tests and commit `feat: add review help and comment count`.

### Task 6: Verify layout, version, and signed release

**Files:**
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `tests/test_release_artifacts.py`
- Verify: `deploy/scripts/release-pilot-extension.sh`

- [ ] Update the layout E2E expectations for the one-row desktop and two-row ≤600px toolbar with non-overlapping 44px controls.
- [ ] Bump the patch version consistently from `0.3.1` to `0.3.2`.
- [ ] Run `npm --prefix extension run typecheck` and `npm --prefix extension test`.
- [ ] Run `npm --prefix extension run test:e2e` outside the sandbox when needed; expect all layout, comment-flow, and iframe keyboard scenarios to pass against a fresh test build.
- [ ] Run `python3 -m pytest -q` from `server/` and `python3 -m pytest tests -q` from the repository root.
- [ ] Commit `release: prepare pilot 0.3.2` locally.
- [ ] Run the signed release script with the existing external key and Tailscale service origin; verify production manifest hosts, classic content bundle, versioned ZIP, and SHA256 checksums. If verification fails, fix, retest, and amend with a new commit before publication.
- [ ] Push the verified feature branch only after the signed production gate succeeds.
- [ ] Confirm the stable unpacked delivery folder reports `0.3.2`, then provide the user with reload-and-test steps.
