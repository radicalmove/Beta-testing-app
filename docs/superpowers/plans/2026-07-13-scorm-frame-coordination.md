# SCORM Frame Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show exactly one review overlay inside the deepest accessible SCORM/Rise lesson and support direct markers, highlights, and multi-lesson identity.

**Architecture:** Add a background-owned tab/frame coordinator fed by authoritative `webNavigation` data and authorized content-script capability registrations. Content scripts remain dormant until they receive a renewable activation lease; strict acknowledged handover prevents duplicate overlays. Optional-origin permission and Rise lesson identity are isolated in focused modules.

**Tech Stack:** TypeScript, Chrome Manifest V3 (`webNavigation`, `scripting`, `permissions`, `storage.session`), Vite, Node test runner, happy-dom, Playwright.

---

## File structure

- Create `extension/src/frame-coordinator.ts`: hierarchy registry, deterministic election, generations, leases, and handover state machine.
- Create `extension/src/frame-capabilities.ts`: deterministic DOM capability and owner-frame visibility measurements.
- Create `extension/src/rise-identity.ts`: canonical publication/route/heading identity and stable transition logic.
- Create matching unit tests for each module.
- Modify `extension/src/review-context.ts`: trusted course binding plus validated coordinator message contracts.
- Modify `extension/src/background.ts`: webNavigation registry, session rehydration, message routing, activation delivery, and optional permission/injection flow.
- Modify `extension/src/content.ts`: dormant embedded startup, registration/lease lifecycle, activation/deactivation teardown, and Rise navigation.
- Modify `extension/src/optional-content-scripts.ts`: already-loaded-frame injection support contract.
- Modify `extension/public/manifest.json` and manifest/build tests: add `webNavigation` and retain declared optional hosts.
- Modify overlay only where needed to present the single plain-language enable/reload action.

### Task 1: Deterministic frame election

**Files:**
- Create: `extension/src/frame-coordinator.ts`
- Create: `extension/tests/frame-coordinator.test.ts`

- [ ] **Step 1: Write `elects_deepest_stable_content_frame`, `breaks_sibling_ties_by_area_then_id`, and `never_reports_two_active_frames`** against `FrameCoordinator.registerFrame()`, `advanceElection()`, and `snapshot()`.
- [ ] **Step 2: Run `cd extension && node --test tests/frame-coordinator.test.ts`** and confirm failure because the module does not exist.
- [ ] **Step 3: Implement the minimal pure APIs** `bindCourse`, `registerNavigation`, `registerCapabilities`, `registerChildOwnerReports`, `advanceElection`, `acknowledgeDormant`, `renewActivation`, `removeFrame`, `snapshot`, and `restore`, with no Chrome globals. `registerChildOwnerReports(parentFrameId, reports)` joins each authorized ancestor's immediate iframe visibility/size/origin report to authoritative `webNavigation` parentage; a descendant is eligible only when every owner in its chain is displayed and non-zero-sized.
- [ ] **Step 4: Add `blocks_replacement_until_old_frame_confirms_dormant` and `removal_or_authoritative_hiding_allows_replacement`**. The first must show that lease expiry alone leaves the candidate pending while a present old frame has not re-registered dormant.
- [ ] **Step 5: Run the test and confirm the new handover test fails**, then implement acknowledged dormancy/removal/hiding gates and rerun to PASS.
- [ ] **Step 6: Add and pass transition-by-transition invariant tests** for lost deactivate, stale generation, rapid sibling replacement, capability/visibility change, and lease expiry plus dormancy confirmation. Include `hidden_owner_chain_makes_large_child_ineligible` and `owner_visibility_change_reelects_child`: the child document itself is large/content-bearing, but an ancestor-reported owning iframe is first hidden or zero-sized and later visible.
- [ ] **Step 7: Commit** with `git commit -m "feat(review): add deterministic frame coordinator"`.

### Task 2: Frame capability measurement

**Files:**
- Create: `extension/src/frame-capabilities.ts`
- Create: `extension/tests/frame-capabilities.test.ts`

- [ ] **Step 1: Write failing happy-dom tests** named `detects_content_bearing_document`, `classifies_iframe_only_wrapper`, `ignores_review_overlay_content`, `rejects_small_or_hidden_frame`, and `reports_immediate_iframe_origins`.
- [ ] **Step 2: Run `cd extension && node --test tests/frame-capabilities.test.ts`** and confirm the missing-module failure.
- [ ] **Step 3: Implement `measureFrameCapabilities(document, window)`** using visible non-overlay text/interactive content, 200×150 minimum dimensions, child-frame metadata, and conservative unsupported-frame classification.
- [ ] **Step 4: Run the focused tests** and confirm they pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(review): measure SCORM frame capabilities"`.

### Task 3: Trusted coordinator protocol and persistence

**Files:**
- Modify: `extension/src/review-context.ts`
- Modify: `extension/tests/review-context.test.ts`
- Modify: `extension/src/background.ts`
- Create: `extension/tests/background-frame-coordination.test.ts`

- [ ] **Step 1: Add exact-validation tests** `accepts_frame_register`, `accepts_lease_renewal`, `accepts_dormant_ack`, and `rejects_extra_or_wrongly_typed_fields` in `review-context.test.ts`.
- [ ] **Step 2: Run `cd extension && node --test tests/review-context.test.ts`**; expect FAIL on unsupported message types.
- [ ] **Step 3: Add minimal discriminated message types and validators**, then rerun the command to PASS.
- [ ] **Step 4: Add background tests** `only_top_moodle_frame_binds_course`, `uses_webnavigation_parentage_not_child_claim`, `rejects_wrong_origin_and_lineage`, `restores_session_snapshot_after_worker_restart`, and `cleans_tab_and_top_navigation`.
- [ ] **Step 5: Run `cd extension && node --test tests/background-frame-coordination.test.ts`**; expect FAIL because the background coordinator adapter is absent.
- [ ] **Step 6: Implement the minimal background adapter** around `FrameCoordinator`, `chrome.webNavigation.getAllFrames`, navigation events, and `chrome.storage.session`; rerun to PASS.
- [ ] **Step 7: Add tests** `deactivates_then_waits_for_ack`, `does_not_activate_on_timeout_or_expiry_alone`, `activates_after_expiry_and_dormant_reregistration`, `activates_after_authoritative_removal`, and `ignores_reordered_stale_ack`.
- [ ] **Step 8: Run the focused background test**; expect the handover cases to FAIL.
- [ ] **Step 9: Implement generation-stamped delivery and strict gates**, then rerun both background and coordinator tests to PASS.
- [ ] **Step 10: Add and pass recovery tests** for worker suspension/rehydration, BFCache/prerender navigation, tab close, rapid sibling removal, lost activation/deactivation messages, and exact-one-active snapshots at every transition.
- [ ] **Step 11: Commit** with `git commit -m "feat(review): coordinate trusted SCORM frames"`.

### Task 4: Dormant content scripts and activation leases

**Files:**
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/content.test.ts`

- [ ] **Step 1: Add tests** `embedded_starts_dormant`, `activation_mounts_once`, `deactivation_cleans_dom_before_ack`, and `lease_loss_self_deactivates`.
- [ ] **Step 2: Run `cd extension && node --test tests/content.test.ts`**; expect failures because embedded review currently mounts immediately.
- [ ] **Step 3: Implement `createFrameActivationController`** with `register`, `activate(generation)`, `deactivate(generation)`, and content-side lease renewal; rerun those tests to PASS.
- [ ] **Step 4: Add failing tests** for duplicate activation, stale generation, late comment-load completion, active marker teardown, worker restart, and dormant re-registration confirmation.
- [ ] **Step 5: Implement generation guards and synchronous centralized cleanup**, then rerun `node --test tests/content.test.ts tests/frame-coordinator.test.ts` to PASS.
- [ ] **Step 6: Add `top_frame_mounts_only_when_elected` and `removes_ready_origin_postmessage_heuristic`**, confirm they fail, route the Moodle top frame through the same controller, and rerun to PASS.
- [ ] **Step 7: Commit** with `git commit -m "feat(review): activate one leased review surface"`.

### Task 5: Seamless optional-origin enablement

**Files:**
- Modify: `extension/public/manifest.json`
- Modify: `extension/tests/manifest.test.ts`
- Modify: `extension/src/optional-content-scripts.ts`
- Modify: `extension/tests/optional-content-scripts.test.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Add manifest tests** for `webNavigation` and optional-host declarations; run `cd extension && node --test tests/manifest.test.ts tests/build-config.test.ts` and expect FAIL on the missing permission.
- [ ] **Step 2: Add `webNavigation` to the manifest/build output** and rerun to PASS.
- [ ] **Step 3: Add background tests** `cta_payload_uses_prevalidated_origin`, `permission_request_is_first_call_in_click_handler`, `deduplicates_concurrent_clicks`, `stores_denial_by_activity_and_origin`, `manual_retry_requests_again`, and `revocation_deactivates_origin`.
- [ ] **Step 4: Run `cd extension && node --test tests/background-frame-coordination.test.ts`** and expect the permission tests to FAIL.
- [ ] **Step 5: Implement a precomputed `EnableCandidate` in coordinator state.** In the runtime message listener, call `chrome.permissions.request({origins:[candidate.pattern]})` immediately before any `await`; reject candidates not derived from authoritative navigation and manifest-declared patterns. Rerun permission tests to PASS.
- [ ] **Step 6: Add optional-script tests** `registers_persistent_pattern`, `injects_only_authoritative_matching_loaded_frames`, and `returns_reload_required_on_injection_rejection`; run `node --test tests/optional-content-scripts.test.ts` and expect FAIL.
- [ ] **Step 7: Implement registration followed by `chrome.scripting.executeScript({target:{tabId, frameIds}})`**, then rerun to PASS.
- [ ] **Step 8: Add overlay tests** for one **Enable reviewing inside this activity**, manual retry, and reload action; run `node --test tests/overlay.test.ts`, implement the minimal CTA, and rerun to PASS.
- [ ] **Step 9: Add and pass permission-revoked-while-active, sandboxed/about/blob/srcdoc fallback, inaccessible descendant, and same-origin-child-preference integration tests.**
- [ ] **Step 10: Commit** with `git commit -m "feat(review): enable SCORM review permissions"`.

### Task 6: Rise publication and lesson identity

**Files:**
- Create: `extension/src/rise-identity.ts`
- Create: `extension/tests/rise-identity.test.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/content.test.ts`

- [ ] **Step 1: Add tests** `derives_package_key_from_activity_and_origin`, `fingerprints_launch_build_metadata_and_stable_assets`, `canonicalizes_route`, `removes_volatile_query`, and `adds_duplicate_heading_ordinal`.
- [ ] **Step 2: Run `cd extension && node --test tests/rise-identity.test.ts`**; expect the missing-module failure.
- [ ] **Step 3: Implement `derivePackageKey`, `derivePublicationKey`, `canonicalRouteKey`, and `deriveHeadingKey`**, then rerun to PASS.
- [ ] **Step 4: Add tests** `full_tuple_changes_when_heading_changes_on_same_route`, `retains_last_identity_during_transient_blank`, `accepts_candidate_after_250ms`, `publication_change_invalidates_old_anchors`, and `unreliable_updated_fingerprint_requires_remapping`.
- [ ] **Step 5: Implement `RiseIdentityTracker` returning the full `(packageKey, publicationKey, routeKey, headingKey)` tuple and remapping state**, then rerun to PASS.
- [ ] **Step 6: Add content tests** for hash/pushState/replaceState/back/forward, route-only and heading-only transitions, stored-route navigation, waiting for the stable full tuple before anchor restore, duplicate titles, and graceful missing-context failure.
- [ ] **Step 7: Run `node --test tests/content.test.ts`**; expect navigation tests to FAIL, then integrate the tracker and route navigation and rerun to PASS.
- [ ] **Step 8: Commit** with `git commit -m "feat(review): track Rise lesson identity"`.

### Task 7: Browser integration and release verification

**Files:**
- Create: `extension/e2e/scorm-frame-coordination.spec.ts`
- Create: `extension/e2e/scorm-frame-fixtures.ts`
- Modify: `extension/playwright.config.ts` only if the new fixture needs an additional local origin
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`

- [ ] **Step 1: Add browser fixtures/tests** for same-origin nesting, cross-origin optional permission, delayed nested Rise content, wrapper replacement, BFCache-like restoration, rapid sibling replacement, one overlay during every sampled transition, direct marker/highlight creation, and lesson switching.
- [ ] **Step 2: Run `cd extension && npm run test:e2e`** and fix only integration defects found.
- [ ] **Step 3: Run `cd extension && npm test && npm run typecheck && npm run build`** and require a clean pass.
- [ ] **Step 4: Run `cd server && python3 -m pytest -q`** and require a clean pass.
- [ ] **Step 5: Increment the pilot version in `extension/package.json`, `extension/package-lock.json`, and `extension/tests/build-config.test.ts`; run build-config tests, then commit all implementation/E2E/version files.**
- [ ] **Step 6: Confirm `git status --short` is empty.** Remove only an accidental `.DS_Store` from pilot release directories if validation reports one.
- [ ] **Step 7: Run root packaging suites:** `python3 -m pytest -q tests/test_release_artifacts.py tests/test_deployment_package.py`.
- [ ] **Step 8: Run the signed release exactly:** `PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' deploy/scripts/release-pilot-extension.sh`.
- [ ] **Step 9: Verify the immutable versioned release, `current` copy, ZIP and unpacked-artifact checksums, embedded service origin, manifest permissions, and matching version. The release script must not modify the clean Git tree.**
- [ ] **Step 10: Manually test CRJU150 in Chrome**: one overlay, marker and highlight inside Rise, comment restore, multi-lesson switch, no wrapper click leak, and permission wording if prompted.
