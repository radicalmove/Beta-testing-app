# Course-specific passwordless access implementation plan

**Goal:** Ship pilot 0.3.0 with invitation-based onboarding, automatic same-browser reconnection, course membership authorization, LD/DCD summaries, and teal extension styling.

## Task 1: Expand the database safely

**Files:** `server/app/models.py`, `server/alembic/versions/20260712_09_course_memberships.py`, `server/tests/test_membership_migration.py`

Write failing migration/model tests, then add membership state, course memberships, invitations, reconnect credentials, device credential families/rotations, course-bound sessions, and persistent rate-limit/audit support. Preserve existing data and create only evidence-backed memberships. Verify upgrade, idempotent backfill, and downgrade-safe expand behavior.

## Task 2: Centralize course membership authorization

**Files:** `server/app/dependencies.py`, `server/app/services/comments.py`, `server/app/routers/comments.py`, `server/app/routers/attachments.py`, authorization and visibility tests

Add failing cross-course tests for every read/mutation route. Resolve the active approved membership from the course-bound session, retain immutable author roles, preserve beta reply filtering and exact-SME sharing, then make every endpoint enforce course equality before querying.

## Task 3: Add bootstrap, invitations, and reconnect APIs

**Files:** `server/app/security.py`, `server/app/services/access.py`, `server/app/routers/access.py`, `server/app/schemas.py`, `server/tests/test_course_access.py`

Test and implement confirmed-course lookup, one-time email/course/role-bound invitations, atomic redemption, reconnect-code issue/regeneration, generic failures, Argon2 storage, and persistent throttling. Add admin/LD-DCD invitation and membership approval controls with audited transitions and immediate credential revocation on reduced access.

## Task 4: Add device renewal and forced upgrade

**Files:** access service/router/models plus `server/tests/test_device_credentials.py`

Test eight-hour course sessions, 90-day device credentials, serialized operation IDs, five-minute idempotent result replay, different-operation family revocation, expiry, sign-out, and 0.2.x upgrade-required behavior. Implement the transaction boundaries and cleanup.

## Task 5: Add the LD/DCD course summary

**Files:** `server/app/services/summary.py`, `server/app/routers/courses.py`, dashboard templates/static files, `server/tests/test_course_summary.py`

Start with authorization/isolation/count/facet/unread/pagination tests. Implement visible-set-first aggregation, bounded filters and cursor pagination, then add the course dashboard view.

## Task 6: Replace extension authentication UX

**Files:** `extension/src/api.ts`, `extension/src/background.ts`, bridge/content/overlay files, extension tests

Test unauthenticated course lookup, new-reviewer and existing-reviewer forms, one-time reconnect-code display, pending states, trusted-context local storage, automatic session renewal, sign-out cleanup, and secret non-disclosure to content scripts. Implement all credentials in the service worker only.

## Task 7: Apply teal visual separation and summary entry

**Files:** `extension/src/overlay/styles.css`, `extension/src/overlay/root.ts`, overlay/E2E tests

Add token/layout/accessibility tests, then apply `#0f4c5c` header/boundary, `#f3f7f8` panels, `#d73b3d` actions/accents, Poppins, clear version 0.3.0 diagnostics, responsive states, keyboard behavior, and LD/DCD summary access.

## Task 8: Verify, migrate, deploy, and release

**Files:** deployment scripts, operations/pilot docs, release tests

Run server, extension, release, and browser E2E suites. Back up Postgres and rehearse restore; deploy expand migration and compatible server; provision CRJU150 invitations; revoke unbound sessions; publish the signed Chrome/Edge 0.3.0 build atomically; verify health, upgrade-required behavior, onboarding, persistence, role visibility, course summary, SCORM fallback, and rollback procedure; then commit and push.
