# Moodle Course Review — Design Specification

## Purpose

Replace the UC Online beta-testing Word form with a location-aware review service. Reviewers work directly in Moodle and embedded Rise/SCORM lessons; Learning Designers (LDs) and Digital Course Developers (DCDs) manage feedback centrally while retaining a clear record of decisions and responses.

The service remains external to Moodle. It does not alter Moodle course data or SCORM/Rise packages.

## First-release scope

The first release is a private pilot hosted on the FLD Mac mini and reached through Tailscale. It comprises:

- a Chrome/Edge browser extension used on UC Online Moodle;
- a web dashboard and API hosted on the Mac mini;
- a database for users, courses, comments, locations, conversations, status, and audit events; and
- manual checking of the dashboard for replies and new feedback.

Automated email, public internet access, Moodle write-back, and any modification of Rise/SCORM content are out of scope for this release.

## Users and access rules

Users register with a name, email address, password, and requested role. The service stores only a secure password hash. Registration creates a pending account; an administrator approves it before it can access shared course data. Sign-in creates a time-limited, revocable server session. Requested roles do not grant elevated access. An administrator approves elevated roles and changes roles when required.

| Role | Can create feedback | Can see | Can reply / act |
| --- | --- | --- | --- |
| Beta Tester | Yes | Their own feedback and LD/DCD replies in those threads | Reply only in their own threads |
| SME | Yes | All SME-created feedback and discussion in a course; beta-test feedback explicitly shared with their account by an LD/DCD | Reply in visible threads |
| LD / DCD | Yes | All course feedback and discussions | Reply, share with SME, set status, resolve/defer |
| Administrator | As needed | All data | Approve users and manage roles |

LDs/DCDs can selectively share a beta-tester comment with one or more specifically chosen SME accounts when clarification is needed. A share never makes the thread visible to all SME-role users. The beta tester continues to see only their own thread and LD/DCD replies; they do not see the SME discussion unless this policy is explicitly extended in a later release.

## Review experience in Moodle

The extension detects the active Moodle course from Moodle's stable numeric course ID in the address/page data and uses that course's review stream automatically. If it cannot obtain a course ID, it uses a normalised course URL plus the detected course title as a temporary course identity. The dashboard lists this as **Unconfirmed course** until an LD/DCD either maps it to an existing course record or confirms it as a new course record; all attached comments move with that mapping and the temporary record is retired.

It offers two feedback actions:

1. **Highlight text:** stores the selected text, surrounding context, and a location reference; restores a visible highlight when possible.
2. **Add pin:** attaches a pin to a visual element or position for non-selectable text, images, layout, controls, video, or interactions.

The comment form includes a free-text message and an optional category:

- language, spelling, or grammar;
- learning design or content flow;
- accessibility;
- technical, link, media, or interaction;
- assessment; or
- general.

Every item stores the course identity, page URL, page title, anchor type and data, creator, timestamps, category, and current status. Routine screenshots are not required. A reviewer may attach a screenshot when a pin/highlight is not enough to make the issue clear.

The extension shows only location-relevant feedback on the active page, as persistent highlights and pins. It provides a compact list fallback when an anchor cannot be restored after a page update.

### Rise and SCORM

The extension functions as a browser-level overlay. It will use extension content scripts in relevant embedded frames when browser permissions allow. It must not modify the package. If a cross-origin embedded frame cannot be accessed, the reviewer can add a parent-page pin and optional screenshot; the item is explicitly labelled **embedded content—frame access unavailable**. For interactive, canvas-based, or otherwise non-selectable content, pins and optional screenshots are the primary location mechanism.

## Dashboard and workflow

The LD/DCD dashboard groups comments by detected course. It provides filters for module/page, category, author role, status, and unread replies. A selected comment opens its thread and a link back to the referenced Moodle page.

Statuses are:

- Open
- In progress
- Awaiting SME
- Resolved
- Deferred

Threads retain the original feedback, replies, sharing actions, status history, author role, time, and anchor reference. These events form the audit trail; no content is silently overwritten.

The dashboard is the shared source of truth. During the pilot, people manually visit it to check for updates; no email notification is sent.

## Technical architecture

```text
Chrome / Edge extension
  ├─ Moodle and SCORM/Rise content scripts
  ├─ Reviewer overlay, highlights, pins, and comment composer
  └─ authenticated HTTPS API client
                         │ Tailscale private network
                         ▼
Mac mini review service
  ├─ API and role/visibility enforcement
  ├─ LD/DCD dashboard
  ├─ attachment storage (optional screenshots)
  └─ database and scheduled backups
```

The service is API-first and deliberately separate from Moodle and the Course Development Platform. It may later integrate with the CDP using course identifiers and links, without making the pilot dependent on the CDP.

Use PostgreSQL for shared pilot data. A short-lived local development database may use SQLite. Store secrets outside source control; use HTTPS over Tailscale, server-side authorization on every API request, input validation, rate limiting, and backups from the outset.

## Extension distribution

For the pilot, distribute a versioned extension folder for Chrome/Edge developer-mode installation with short installation instructions. This supports a small invited group without a browser-store submission; it is a deliberately temporary installation method, not the long-term reviewer experience. A later release can use enterprise browser management or a store listing for smoother wider distribution.

## Reliability and accessibility

- Anchor restoration must tolerate minor page edits; otherwise show the comment in the page list with its quoted selected text/context.
- Server-side permissions must be the source of truth; the extension's UI must never be trusted to restrict access.
- The extension overlay and dashboard must support keyboard navigation, focus management, readable contrast, and clear status/error messages.
- Failed saves must remain visibly recoverable and must not discard a drafted comment without warning.

## Visual direction

The extension and dashboard use a shared UC Online/RADsuite-inspired visual language: calm, professional, and compact, with a light canvas, strong readable type, measured blue/teal accents, rounded controls, clear status chips, and generous whitespace. The extension should feel unobtrusive over course content, while the dashboard should make scanning courses and actions easy. The implementation must use an original interface and component styling rather than copying existing product screens or assets.

## Test and acceptance criteria

The implementation plan must cover automated and manual checks for:

1. Role visibility: each role sees only the records permitted above.
2. Selective SME sharing: a beta comment remains hidden until an LD/DCD shares it, remains hidden from SME accounts that were not selected, and remains hidden from other beta testers.
3. Highlight and pin creation, persistence, and anchor recovery on Moodle pages.
4. Pin fallback in an embedded Rise/SCORM context.
5. Thread replies, status transitions, and audit history.
6. Course detection and dashboard filtering by course and current page.
7. Temporary course mapping: a LD/DCD can map an unconfirmed course to an existing or new course record without losing or duplicating feedback.
8. Session security, invalid-input handling, and failed-save recovery.
9. Keyboard-only flows for adding, reading, replying to, and resolving a comment.

## Deferred decisions

These are intentionally excluded from the pilot and must be designed separately before adoption:

- transactional email provider, domain, and notification preferences;
- public internet hosting and formal UC Digital Services governance;
- SSO/Microsoft 365 integration;
- Moodle-side plug-in or write-back integration;
- CDP integration beyond optional links/course identifiers; and
- organisation-wide extension distribution.
