# Moodle Course Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, Tailscale-hosted Moodle course review service with a Chrome/Edge extension for location-aware feedback and a role-safe LD/DCD dashboard.

**Architecture:** A FastAPI application owns authentication, RBAC, audit events, PostgreSQL persistence, attachments, and server-rendered dashboard pages. A Manifest V3 TypeScript browser extension injects a Shadow-DOM review overlay into Moodle and accessible SCORM/Rise frames, persists anchors through the API, and observes course/page changes. The extension is intentionally independent of Moodle and communicates only with the review API over Tailscale HTTPS.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, Jinja2, vanilla TypeScript, Vite, Manifest V3, Playwright, pytest, Docker Compose, nginx, systemd.

---

## Proposed file structure

```text
server/
  app/
    main.py                 # application factory and routes
    config.py               # typed environment configuration
    db.py                   # database engine/session lifecycle
    models.py               # focused SQLAlchemy persistence models
    schemas.py              # request/response validation models
    security.py             # password/session/cookie helpers
    dependencies.py         # current-user and role guards
    services/
      accounts.py           # registration, approval and session use cases
      courses.py            # course detection confirmation/mapping
      comments.py           # comments, threads, sharing, status, audit
      attachments.py        # validated optional screenshot storage
    routers/
      auth.py               # registration, login, logout endpoints
      courses.py            # extension-facing course/page endpoints
      comments.py           # comment, reply, share and status endpoints
      dashboard.py          # LD/DCD and role-safe dashboard pages
      admin.py              # user approval and role management
    templates/              # original UCO/RADsuite-inspired dashboard templates
    static/                 # dashboard CSS and small browser JS
  tests/
extension/
  src/
    background.ts           # session/API coordination and tab capture request
    content.ts              # top-frame and accessible-frame injection
    overlay/                # Shadow DOM UI, focus handling, styling
    anchors/                # text quote and visual-pin anchoring/recovery
    api.ts                  # typed authenticated API client
    course-context.ts       # Moodle course/page identity detection
  public/manifest.json
  tests/
deploy/
  docker-compose.yml        # local/dev Postgres and application services
  nginx/moodle-review.conf  # private reverse proxy configuration
  systemd/moodle-review.service
  scripts/backup-postgres.sh
docs/
  operations.md             # Tailscale deployment, backups, restore, pilot install
  pilot-test-script.md      # manual Moodle/Rise acceptance procedure
```

### Task 1: Create a runnable, testable service skeleton

**Files:**
- Create: `server/pyproject.toml`, `server/app/main.py`, `server/app/config.py`, `server/app/db.py`, `server/tests/test_health.py`
- Create: `deploy/docker-compose.yml`, `.env.example`, `README.md`

- [ ] **Step 1: Write the failing health test.**

```python
def test_health_returns_ok(client):
    assert client.get("/health").json() == {"status": "ok"}
```

- [ ] **Step 2: Run `cd server && pytest tests/test_health.py -q`; verify it fails because the app fixture/route does not exist.**
- [ ] **Step 3: Add FastAPI app factory, `/health`, pytest client fixture, typed environment config, and SQLAlchemy session placeholder. Keep configuration in environment variables; do not embed secrets.**
- [ ] **Step 4: Run `cd server && pytest tests/test_health.py -q`; verify PASS.**
- [ ] **Step 5: Add Docker Compose services for PostgreSQL and the API, then run `docker compose -f deploy/docker-compose.yml config`; verify configuration parses.**
- [ ] **Step 6: Commit: `chore: scaffold course review service`.**

### Task 2: Model accounts, roles, sessions, and audit events

**Files:**
- Create: `server/app/models.py`, `server/app/security.py`, `server/app/dependencies.py`, `server/app/services/accounts.py`
- Create: `server/tests/test_accounts.py`, `server/tests/test_authorization.py`
- Modify: `server/app/db.py`, `server/app/main.py`

- [ ] **Step 1: Write tests covering pending registration, password hashing, rejection of an unapproved account, expiry/revocation of dashboard sessions, single-use/expiry/revocation/replay rejection for extension login codes and API sessions, and admin-only role changes.**
- [ ] **Step 2: Run `cd server && pytest tests/test_accounts.py tests/test_authorization.py -q`; verify failure.**
- [ ] **Step 3: Implement `User`, `Session`, `ExtensionLoginCode`, and `AuditEvent` models; define `beta_tester`, `sme`, `ld_dcd`, and `admin` roles. Create database migration with indexes on email, role, session token hash, login-code hash, expiry, and audit entity/time.**
- [ ] **Step 4: Implement Argon2 password hashes, opaque server-side sessions stored hashed, secure HTTP-only same-site dashboard cookies, and expiring/revocable extension API session tokens. A dashboard-authenticated user can create a short-lived single-use extension login code bound to the exact Chrome extension redirect URI; the code exchanges once for a session token stored only in `chrome.storage.session` and checked by `require_roles()` on every API request.**
- [ ] **Step 5: Run the two test files and `alembic upgrade head`; verify all tests pass and migration applies to an empty database.**
- [ ] **Step 6: Commit: `feat: add approved accounts and role authorization`.**

### Task 3: Add registration, login, approval, and role management UI/API

**Files:**
- Create: `server/app/routers/auth.py`, `server/app/routers/admin.py`, `server/app/templates/auth/*.html`, `server/app/templates/admin/users.html`
- Create: `server/tests/test_auth_routes.py`, `server/tests/test_admin_routes.py`
- Modify: `server/app/main.py`, `server/app/schemas.py`, `server/app/static/app.css`

- [ ] **Step 1: Write route tests for registration creating a pending account, login refusing a pending account, approved login issuing a cookie, logout revoking it, and admin approval/role changes creating audit events. Add extension-auth route tests: `/extension/authorize` accepts only a redirect URI from the `EXTENSION_REDIRECT_URIS` environment allow-list (one stable URI per Chrome/Edge pilot build), creates a short-lived one-time code after dashboard login, redirects with that code, and `/extension/token` exchanges it only once.**
- [ ] **Step 2: Run the two test files; verify failure.**
- [ ] **Step 3: Implement form and JSON routes with CSRF protection for browser forms, generic login failure messages, password length validation, and an admin approval page.**
- [ ] **Step 4: Apply the original UCO/RADsuite-inspired dashboard tokens (light surface, blue/teal accent, readable type, compact status chips) in CSS; do not copy external assets or layouts.**
- [ ] **Step 5: Run `pytest tests/test_auth_routes.py tests/test_admin_routes.py -q`; verify PASS.**
- [ ] **Step 6: Commit: `feat: add registration and account approval`.**

### Task 4: Model courses, locations, comments, and thread history

**Files:**
- Create: `server/app/services/courses.py`, `server/app/services/comments.py`, `server/app/routers/courses.py`, `server/app/routers/comments.py`
- Create: `server/tests/test_course_identity.py`, `server/tests/test_comment_creation.py`, `server/tests/test_comment_status.py`
- Modify: `server/app/models.py`, `server/app/schemas.py`, `server/app/main.py`

- [ ] **Step 1: Write failing tests for Moodle numeric course ID creation, temporary unconfirmed course identity, mapping a temporary record to an existing/new course without duplication, and preserving its comments.**
- [ ] **Step 2: Write failing tests for a text highlight or visual pin comment containing course/page/location data, category, initial status `open`, and an immutable audit event.**
- [ ] **Step 3: Run the three tests; verify failure.**
- [ ] **Step 4: Implement `Course`, `PageLocation`, `Comment`, `CommentReply`, `CommentShare`, and `CommentStatusEvent` models. Persist text quote, prefix/suffix context, CSS/DOM pin selector and relative coordinates as nullable, validated fields.**
- [ ] **Step 5: Implement course upsert/mapping and comment creation/status APIs with Pydantic validation and ownership checks.**
- [ ] **Step 6: Run the three tests; verify PASS.**
- [ ] **Step 7: Commit: `feat: add courses and anchored feedback records`.**

### Task 5: Enforce thread visibility, replies, selective SME sharing, and statuses

**Files:**
- Create: `server/tests/test_comment_visibility.py`, `server/tests/test_comment_threads.py`
- Modify: `server/app/services/comments.py`, `server/app/routers/comments.py`, `server/app/dependencies.py`

- [ ] **Step 1: Write parameterised visibility tests for all four roles. Include: beta testers only see their own comments and LD/DCD replies; all SMEs see SME-created course threads; only individually selected SME accounts see a shared beta thread; LD/DCD sees all course threads.**
- [ ] **Step 2: Write tests for replies, `open → in_progress → awaiting_sme → resolved/deferred` transitions, thread audit history, and status changes rejected for unauthorised roles.**
- [ ] **Step 3: Run both files; verify failure.**
- [ ] **Step 4: Implement one central `visible_comments_for(user, course)` query and reuse it in all list/detail/reply endpoints. Implement explicit per-user share records rather than a role-wide sharing flag.**
- [ ] **Step 5: Run both files and full server suite; verify PASS.**
- [ ] **Step 6: Commit: `feat: add role-safe discussion workflows`.**

### Task 6: Add optional screenshot attachments safely

**Files:**
- Create: `server/app/services/attachments.py`, `server/app/routers/attachments.py`, `server/tests/test_attachments.py`
- Modify: `server/app/models.py`, `server/app/config.py`, `server/app/main.py`

- [ ] **Step 1: Write tests accepting a small PNG/JPEG attachment for an authorised comment creator and rejecting unsupported media type, oversized file, and a requester without thread visibility.**
- [ ] **Step 2: Run `cd server && pytest tests/test_attachments.py -q`; verify failure.**
- [ ] **Step 3: Implement random object names outside static source directories, allow-list MIME/type sniffing, size limits, ownership checks, and protected download route. Add migration for attachment metadata only.**
- [ ] **Step 4: Run the attachment test and full server suite; verify PASS.**
- [ ] **Step 5: Commit: `feat: add protected optional screenshots`.**

### Task 7: Build the LD/DCD dashboard and role-safe reviewer views

**Files:**
- Create: `server/app/routers/dashboard.py`, `server/app/templates/dashboard/index.html`, `server/app/templates/dashboard/thread.html`, `server/app/static/dashboard.js`
- Create: `server/tests/test_dashboard.py`, `server/tests/test_dashboard_accessibility.py`
- Modify: `server/app/main.py`, `server/app/static/app.css`

- [ ] **Step 1: Write route/render tests for course grouping, filters (page/module, category, role, status, unread), status totals, unconfirmed-course mapping controls, and a “take me there” Moodle link.**
- [ ] **Step 2: Write accessibility checks for named controls, visible keyboard focus, labelled filters, accessible status changes, and a thread that can be read/replied to with a keyboard.**
- [ ] **Step 3: Run the dashboard tests; verify failure.**
- [ ] **Step 4: Implement dashboard queries using the same central visibility service. Show course cards, status chips, thread audit history, comment sharing controls for LD/DCD, and unread-reply markers.**
- [ ] **Step 5: Run the dashboard tests and a Playwright keyboard smoke test; verify PASS.**
- [ ] **Step 6: Commit: `feat: add UCO-styled review dashboard`.**

### Task 8: Scaffold the Manifest V3 extension and authenticated API client

**Files:**
- Create: `extension/package.json`, `extension/vite.config.ts`, `extension/tsconfig.json`, `extension/public/manifest.json`, `extension/src/background.ts`, `extension/src/api.ts`, `extension/src/content.ts`
- Create: `extension/tests/api.test.ts`, `extension/tests/content.test.ts`

- [ ] **Step 1: Write tests for API requests carrying the configured private review-service origin, expired-session handling, and content script activation only on configured Moodle host patterns and accessible frames.**
- [ ] **Step 2: Run `cd extension && npm test`; verify failure.**
- [ ] **Step 3: Configure Manifest V3 with a build-owned public manifest key so the unpacked Chrome build has a stable extension ID. Record the corresponding Chromium redirect URI in `EXTENSION_REDIRECT_URIS`; generate/record the Edge build's distinct stable ID if required and allow-list it separately. Add `all_frames: true`, a separate background service worker, `identity`, `tabs`, `scripting`, `storage`, and `tabCapture` permissions. Give Moodle host patterns as required host permissions; list approved Rise/SCORM origins as optional host permissions and request them only when the reviewer opens embedded content. Do not commit the private signing key.**
- [ ] **Step 4: Implement a typed API client and the extension-auth handoff with `chrome.identity.launchWebAuthFlow()`: open `/extension/authorize?redirect_uri=https://<extension-id>.chromiumapp.org/`, require the user to log in via the server page, receive the one-time code at the Chromium redirect, exchange it at `/extension/token`, and store only the resulting expiring API session token in `chrome.storage.session`. Never use dashboard cookies from the extension or inject duplicate overlays.**
- [ ] **Step 5: Run `npm test` and `npm run build`; verify PASS and a loadable unpacked extension directory is produced.**
- [ ] **Step 6: Commit: `feat: scaffold Moodle review extension`.**

### Task 9: Detect Moodle course/page context and render the overlay

**Files:**
- Create: `extension/src/course-context.ts`, `extension/src/overlay/root.ts`, `extension/src/overlay/styles.css`, `extension/tests/course-context.test.ts`, `extension/tests/overlay-focus.test.ts`
- Modify: `extension/src/content.ts`

- [ ] **Step 1: Write tests for extracting Moodle's numeric `course` parameter, title and normalized page URL; test temporary identity when no numeric ID is present.**
- [ ] **Step 2: Write DOM tests for a Shadow-DOM overlay with accessible toolbar/button names, focus trapping in the comment dialog, Escape to close, and non-interference with Moodle styles.**
- [ ] **Step 3: Run the tests; verify failure.**
- [ ] **Step 4: Implement course detection and `POST /courses/resolve` on navigation/load. Render a compact overlay using the approved UCO/RADsuite-inspired tokens.**
- [ ] **Step 5: Run tests, build, then manually install the versioned extension folder in Chrome/Edge developer mode on a non-production Moodle course page; verify context is detected and keyboard flow works.**
- [ ] **Step 6: Commit: `feat: add course-aware review overlay`.**

### Task 10: Implement text anchors, visual pins, recovery, and inaccessible-frame fallback

**Files:**
- Create: `extension/src/anchors/text.ts`, `extension/src/anchors/pin.ts`, `extension/src/anchors/recover.ts`, `extension/tests/text-anchor.test.ts`, `extension/tests/pin-anchor.test.ts`, `extension/tests/recovery.test.ts`
- Modify: `extension/src/overlay/root.ts`, `extension/src/content.ts`, `extension/src/background.ts`

- [ ] **Step 1: Write tests capturing selected text with prefix/suffix context, restoring it after a small DOM change, and returning an unresolved result when the quote cannot be found.**
- [ ] **Step 2: Write tests recording a pin's element selector plus relative coordinates, restoring it after layout resize, and rendering a page-list fallback when its target no longer exists.**
- [ ] **Step 3: Write a test for frame-access failure that offers a parent-page pin and labels the created comment `embedded content—frame access unavailable`.**
- [ ] **Step 4: Run the anchor test suite; verify failure.**
- [ ] **Step 5: Implement the anchor modules and composer. Capture an optional screenshot only after an explicit reviewer action and use the extension tab-capture API through the background worker.**
- [ ] **Step 6: Run anchor tests and an end-to-end Playwright fixture with an accessible iframe plus an inaccessible iframe simulation; verify PASS.**
- [ ] **Step 7: Commit: `feat: add resilient highlights and pins`.**

### Task 11: Connect extension feedback and page-specific comment display

**Files:**
- Create: `extension/tests/comment-flow.spec.ts`
- Modify: `extension/src/api.ts`, `extension/src/overlay/root.ts`, `extension/src/content.ts`, `server/app/routers/comments.py`

- [ ] **Step 1: Write an end-to-end test that logs in a beta tester, creates a highlighted comment, reloads the matching page, and sees only that comment and its LD/DCD reply.**
- [ ] **Step 2: Write an end-to-end test that creates an SME pin, verifies LD/DCD sees it, then shares a beta thread only with selected SME account.**
- [ ] **Step 3: Run the end-to-end tests; verify failure.**
- [ ] **Step 4: Implement page/location list endpoints and overlay rendering of visible highlights/pins; show unresolved anchors in a compact page list. Keep unsaved draft text locally until the API confirms success.**
- [ ] **Step 5: Run end-to-end tests and all server/extension tests; verify PASS.**
- [ ] **Step 6: Commit: `feat: show course feedback in Moodle pages`.**

### Task 12: Package private deployment, backups, and pilot verification

**Files:**
- Create: `deploy/nginx/moodle-review.conf`, `deploy/systemd/moodle-review.service`, `deploy/scripts/backup-postgres.sh`, `docs/operations.md`, `docs/pilot-test-script.md`
- Modify: `deploy/docker-compose.yml`, `README.md`, `.env.example`

- [ ] **Step 1: Write a smoke script that checks `/health`, rejects unauthenticated API access, and verifies a database backup can be restored into a disposable database.**
- [ ] **Step 2: Run the script before deployment setup; verify expected failures for missing production configuration.**
- [ ] **Step 3: Define systemd, nginx, environment file, private Tailscale hostname configuration, PostgreSQL volume, nightly backup retention, and restore procedure. Ensure no public listener or credentials are documented in source.**
- [ ] **Step 4: Write concise pilot install instructions: install unpacked extension, enter the private service URL, register, wait for approval, create/reply/resolve a test comment, and report a failed anchor.**
- [ ] **Step 5: On the Mac mini, deploy to a non-production port over Tailscale only; run health, login, role-visibility, backup, and extension smoke checks. Record actual commands/results in deployment notes without secrets.**
- [ ] **Step 6: Commit: `docs: add private pilot deployment and test guide`.**

### Task 13: Run release verification and prepare the pilot hand-off

**Files:**
- Modify: `README.md`, `docs/pilot-test-script.md`

- [ ] **Step 1: Run `cd server && pytest -q` and `cd extension && npm test && npm run build`; require zero failures.**
- [ ] **Step 2: Run the Playwright suite against the local service, including keyboard-only flow and role-isolation scenarios; require zero failures.**
- [ ] **Step 3: Execute every item in `docs/pilot-test-script.md` against a representative Moodle course and an embedded Rise/SCORM activity. Record pass/fail and any expected frame fallback.**
- [ ] **Step 4: Verify extension package contains no development API URL, service credentials, signing private key, or unrestricted host permissions; confirm screenshot capture and Rise/SCORM optional permissions are requested only at the action/page that needs them. Confirm the installed Chrome/Edge extension IDs produce redirect URIs present in `EXTENSION_REDIRECT_URIS` before pilot sign-in testing.**
- [ ] **Step 5: Update the README with exact pilot limitations: manual dashboard checking, Tailscale-only access, no Moodle write-back, and frame fallback behaviour.**
- [ ] **Step 6: Commit: `chore: verify Moodle review pilot release`.**
