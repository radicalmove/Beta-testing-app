# Course-specific passwordless access design

## Goal

Let reviewers join a Moodle course with minimal friction while preserving course-specific roles, privacy boundaries, automatic browser reconnection, and an LD/DCD course summary.

## Identity and membership model

`User` remains the global person record identified by normalized email and display name. Authorization moves to a course membership record containing `user_id`, `course_id`, `role`, approval state, approver, and timestamps. Existing global roles are migrated into memberships for existing courses; administrator remains a global operational role only.

LD/DCD or admin creates cryptographically random, one-time reviewer invitation codes for a confirmed course and allowed role. The service stores only a slow password hash. Each invitation is also bound to the intended reviewer's normalized-email hash, may be redeemed once, expires after 30 days, and records its creator and redemption. Its raw value is displayed only at creation time. Revoking an unused invitation does not affect existing memberships or browser sessions.

## First-use and returning-browser flow

The extension already detects the Moodle course before authentication. **New reviewer** requests name, email, one-time invitation code, and role. The code must belong to the detected course, match the normalized email, and permit the selected role. Redemption and membership creation occur atomically. Beta tester membership is approved immediately. SME membership is created pending and must be approved by an LD/DCD for that course or an admin. LD/DCD membership is pending until approved by an admin. Admin cannot be self-requested. If the email already belongs to a global user, redemption links that exact user without changing their global name or role; otherwise it creates the user. An existing `(user, course)` membership is never overwritten and returns the generic existing-user path.

**Existing user on another browser** requests email and a personal reconnect code issued when that course membership was first created or explicitly regenerated. The reconnect code is user-and-course-bound, is shown once, and is stored only as an Argon2 hash. This flow may only resume an already existing membership for that detected course. It never creates a membership, changes role/name, or inherits a global/other-course role. A missing membership returns the same generic failure as unknown email/course/wrong reconnect code. No public names or emails are listed. If the membership is pending, the extension clearly reports that state. A person may hold different roles in different courses. LD/DCD or admin can regenerate a reconnect code after verifying the reviewer outside the app; regeneration revokes that membership's device families and previous reconnect code.

Successful access creates an eight-hour revocable, course-bound extension session stored only in `chrome.storage.session`. A separate opaque device credential is stored in extension-local storage and is scoped to user+course; it permits automatic session renewal in the same browser. The server stores only its hash and credential-family identifier. It expires after 90 days. The service worker serializes renewal per credential family. Each renewal carries a fresh 128-bit operation ID that is persisted before sending and reused for every retry. The server transaction atomically claims the current credential, creates its replacement, and stores an encrypted replacement-result envelope keyed by family+operation ID for a five-minute idempotency window. A repeat of the same credential and operation ID during that window returns the identical replacement result; a used credential with a different operation ID is treated as replay and revokes the family and its sessions. The result envelope is deleted after the window and cannot be used without the presented credential. Clearing browser data or changing browser requires email + personal reconnect code. Moodle pages cannot read any credential.

Invitation revocation does not revoke approved memberships/devices after redemption. Membership rejection, revocation, or demotion revokes that membership's sessions and device families immediately. Invitation and reconnect-code attempts are rate-limited and errors do not reveal whether an email exists. Sessions and device credentials cannot be replayed against another course.

## Course bootstrap and lookup

Passwordless access is available only for a pre-provisioned, confirmed course with exact normalized Moodle origin and numeric Moodle course ID. Admin provisions the course and reviewer invitations before reviewers join. The unauthenticated extension lookup accepts only the configured Moodle origin plus detected numeric course ID, returns a non-secret opaque course handle/title, and never creates, merges, confirms, or remaps courses. Unknown, temporary, title-only, unconfirmed, mismatched-origin, and ambiguous contexts show **Course not enabled for review**. Invitation verification uses the resolved course directly and never scans code hashes.

## Approval and visibility

Membership states are `pending`, `approved`, `rejected`, and `revoked`, unique on `(user_id, course_id)`. New beta transitions directly to approved. New SME/LD-DCD begins pending. Rejected membership may be re-requested with the code and returns to pending; revoked membership requires an admin to reopen. Admin approves/rejects/revokes/changes LD/DCD membership. Only an admin or a currently approved LD/DCD membership in that same course may approve/reject SME; course LD/DCD cannot promote to LD/DCD. Every transition is audited and invalidates sessions/devices when authority or access decreases.

Existing comment visibility rules are evaluated against an active approved membership in the comment's course. Beta sees only own threads and only LD/DCD replies inside them—SME replies remain filtered. SME sees all SME-authored course threads plus beta threads shared to that exact SME membership. LD/DCD sees all feedback in their approved course. Admin may see all courses. Every comment, reply, status, share, attachment, read-state, page-list, and summary endpoint checks active membership and exact course equality before querying or mutating.

## Course summary

An approved LD/DCD membership for that course or admin can open a course summary from the extension panel or dashboard. Authorization and course equality are checked before any aggregate query. Counts and facets are computed only from the exact caller-visible comment/reply set. Unread means a visible thread whose newest visible comment/reply/status event is later than that caller's read timestamp. The API accepts bounded status/category/page/author filters, stable cursor pagination (maximum 100 rows), and returns facets only for visible data. It shows total/open/in-progress/awaiting-SME/resolved/deferred counts, counts by category and Moodle page, unread count, and comments with author display name/course role, page, category, status, and last visible activity. No hidden course, recipient, author, page, category, reply, or count leaks through totals or facets.

## Visual treatment

The external tool uses deep teal `#0f4c5c` for header and boundary, pale blue-grey `#f3f7f8` panels, and UCO red `#d73b3d` only for primary actions and small accents. Poppins, the thick external boundary, responsive layout, contrast, keyboard operation, and visible version/build diagnostics remain.

## Migration and compatibility

Add new tables/columns through expand/contract Alembic migrations without dropping data. Backfill only evidence-based memberships: a user receives membership in a course if they authored a course comment/reply/status event, are an explicit share recipient, or have an existing audited course action. Role starts from the immutable authored role/audited action; conflicts choose least privilege and are flagged for admin review. Approved global admins remain admins without automatic memberships. Pending/no-evidence users receive no membership. Unconfirmed/duplicate courses are excluded and reported. Unique constraints and idempotent inserts make reruns safe; immutable `author_role` history is unchanged. Existing password/dashboard login remains available to administrators during the pilot. API responses expose display name and course role, never email or user UUID to Moodle content.

## Code and credential security

Invitation and personal reconnect codes each contain 20 random Crockford Base32 characters (100 bits), displayed as four groups of five, case-insensitive with hyphens/spaces removed before hashing. Raw codes are shown once after create/regeneration, copied only by explicit user action, never placed in URLs, logs, analytics, backups, HTML history, or API responses afterward. Argon2 hashes are stored. An invitation is bound to one course, normalized-email hash, and allowed role; a reconnect code is bound to exactly one user+course membership. Neither can authenticate another membership or course.

Rate limits use persistent server-side buckets: source-IP+course (10/15 minutes), normalized email+course (5/15 minutes), course-global (100/hour), and service-global protection. Trusted source IP is accepted only from the loopback Tailscale proxy; untrusted forwarding headers are ignored. Unknown course/email, wrong code, and missing membership use normalized response bodies/statuses and a bounded minimum response time with a dummy Argon2 check. Failures, rotations, approvals, reuse detection, and throttling are audited; repeated attacks raise an operator-visible alert without logging secrets.

Only the service worker can read/write the device credential. `chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"})` is used where supported. Content scripts/page messages receive only session state and public display/course-role data, never API/device tokens. Credentials are excluded from sync, release artifacts, screenshots, logs, and backups, and cleared on sign-out/revocation.

## Deployment and rollback

Deployment order: database backup and disposable restore rehearsal; expand migration; provision/confirm CRJU150 and create its pilot reviewer invitations; deploy backward-compatible server; transactionally revoke all old unbound extension sessions; publish/require extension `0.3.0`; verify mixed `0.2.x` clients receive **Upgrade required** and cannot create unbound sessions; run migration/backfill report; then enable passwordless access. Rollback keeps new tables, disables passwordless endpoints, revokes `0.3.0` sessions/devices, and never reactivates old unbound sessions. Contract cleanup waits until pilot sign-off.

## Acceptance testing

Tests cover invitation/reconnect-code creation, single redemption, email/course/role binding, hash, revocation/regeneration, rate limiting, and timing normalization; authoritative course bootstrap/unknown contexts; new beta immediate access and one-time reconnect-code display; SME and LD/DCD lifecycle/authority; existing-user resume requiring the user-bound reconnect code; atomic device rotation, same-operation idempotency, different-operation replay-family revocation, and expiry; sign-out cleanup and trusted-context storage; negative cross-course/cross-role checks on every endpoint; evidence-only idempotent migration; reply-level visibility; summary authorization/isolation/counts/facets/pagination; accessible extension forms/states; teal design tokens; forced-upgrade behavior; Chrome and Edge persistence; backup/restore and rollback; and live CRJU150 sign-in, temporary comment persistence, role views, dashboard summary, and SCORM fallback. The release becomes pilot `0.3.0`.
