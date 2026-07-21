# Moodle Course Review 0.5.0 release-candidate test report

**Date:** 22 July 2026  
**Branch:** `codex/stabilisation-0.5.0`  
**Purpose:** verify the 0.5.0 stabilisation build before the focused CRJU150 pilot retest.

## Automated verification

| Gate | Result |
| --- | --- |
| Extension unit/integration suite | **Pass — 389 tests** |
| Extension TypeScript type-check | **Pass** |
| FastAPI/server suite | **Pass — 172 tests** (one upstream Starlette deprecation warning) |
| Deployment and immutable-release suite | **Pass — 40 tests** |
| Playwright Moodle/SCORM fixture suite | **Pass — 7 tests** |
| Production Vite build | **Pass** |

The Playwright suite covered Moodle highlights, SCORM geometric markers, selective SME sharing, mixed iframe handling, the single-toolbar SCORM rule, compact/zoomed layout, and equal-height comment controls.

## Stabilised areas

- Course-specific roles now remain authoritative in comment authorship, replies, permissions, and labels.
- Shared Beta Tester threads allow the selected SME to reply privately to LD/DCD/Admin without exposing the SME reply to the Beta Tester.
- Status changes are idempotent and Open/Resolved filters control list entries, markers, highlights, and open popovers together.
- JPEG, PNG, PDF, and Word attachments use the correct course/thread context, enforce the 10 MB limit, and clear transient errors after cancel or success.
- Course ordering, Previous/Next, list counters, and refresh reconciliation use one viewer-specific comment projection.
- Moodle navigation and Rise/SCORM recovery use bounded retries. When a changed Rise activity prevents exact anchor recovery, the correct activity remains open with a manual-location message.
- Popovers avoid the open course panel, the active marker is visually distinct, highlights remain readable, and confirmation dialogs are app-native.
- Conversations have stable participant styling and course-first administration and sign-out are available.

## Retest decision

The build is ready for the focused manual retest in `docs/retest-checklist-0.5.0.md`. Exact Rise recovery remains intentionally best effort because Rise can replace or reorganise rendered content without changing Moodle's outer URL; failure must degrade to the documented manual-location message, not an incorrect page or silent no-op.
