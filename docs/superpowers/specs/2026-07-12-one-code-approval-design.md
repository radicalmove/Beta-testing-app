# One-code reviewer approval

## Goal

Make the invitation code the only code a reviewer ever enters. After a reviewer redeems an invitation for a course, the same Chrome or Edge profile must remember the pending access privately, detect administrator approval automatically, and connect without further user input.

## Reviewer journey

The first-use form asks for name, email, role, and the course invitation code. It no longer offers **New reviewer** and **Existing reviewer** modes and never displays or requests a reconnect code.

Beta testers continue to connect immediately. Roles requiring approval see **Waiting for approval — you can leave this page open or return later.** The extension checks automatically while the course page remains open and whenever the reviewer returns to that course. A secondary **Check approval** action is available as a manual fallback, but it never opens another credential form.

When approval is detected, the overlay changes to **Connected** without a page reload and loads the page's comments. The same browser profile reconnects automatically on later visits. A different browser requires a fresh course invitation during this pilot; it still exposes only one invitation code and never a second code.

## Credential architecture

The server may continue issuing the current high-entropy reconnect credential when an invitation is redeemed. It remains an internal protocol detail. Redemption occurs in the trusted background worker: the content script sends the user-entered invitation fields, the background calls the API, persists any returned reconnect credential, and returns only public `state` and `role` fields. No extension message response contains the reconnect credential. It is never included in page DOM, logs, errors, accessible text, or content-script-readable state.

Before any pending-record read or write, the background calls `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`. Pending access fails closed if this restriction cannot be established. Tests prove a content script cannot read the storage area or receive the secret through runtime messages.

There is at most one active pending identity per course per browser profile. Records are keyed by the immutable course handle alone, so page initialization can find one without asking for an email. The normalized email is stored inside the record and sent only by the trusted background to the server. A successfully redeemed newer invitation for the same course atomically replaces an older pending record; unsuccessful redemption never changes storage. This matches the pilot's single-reviewer-per-browser assumption and avoids ambiguous automatic identity selection.

The pending credential can only resume the same course membership after that membership becomes approved. Email alone cannot claim access. The original invitation remains one-time and is not retained or reused.

On successful resume, the background worker stores the normal device/session credentials using the existing mechanism and removes the pending credential. It also removes the pending credential when the server reports a terminal rejected or revoked state. Transient network failures retain it so checking can resume later.

The version-1 record schema is `{version: 1, courseHandle: UUID, email: normalized email, role: "sme" | "ld_dcd", reconnectCredential: 20–128 printable ASCII characters, createdAt: finite epoch milliseconds, generation: UUID}`. The storage key is `pending-review-access:<canonical lowercase course UUID>`. Field names and values are exact; extra fields, invalid UUIDs/emails/roles, oversize credentials, non-finite dates, mismatched key/course values, and legacy versions are deleted before use. Store no more than 50 records; before inserting the 51st, evict the oldest `createdAt` record, breaking ties by lexical key. A record is also removed after 30 days. Course navigation never sends a pending credential to a different course.

## Automatic approval checking

The content controller asks the background worker to resume pending access for the current resolved course:

- immediately after the initial pending redemption;
- when the course page initializes or regains visibility;
- on a bounded interval while the page is visible and still pending; and
- when the reviewer activates **Check approval**.

Use a 10-second interval, with only one request in flight at a time. Stop polling on connection, terminal rejection/revocation, course navigation, overlay destruction, or page hiding. Restart immediately when the page becomes visible. Network failures keep the waiting state and retry on the next scheduled check; they do not change the message to service unavailable unless no pending credential exists.

The background owns a single in-flight resume operation per course handle. Concurrent requests from multiple tabs share that promise. Each operation captures the record's `generation`; after the network response it mutates storage only if that generation is still current. Successful connection stores the normal session/device credentials and removes pending state before replying `connected` to every waiter. A late `pending` response cannot recreate or overwrite a record already consumed by another tab.

The content message `CHECK_PENDING_REVIEW_ACCESS` contains only the resolved course handle. Its background response is exactly `{state: "pending" | "connected" | "terminal" | "none"}` plus a public terminal reason of `rejected` or `revoked` when applicable. No response contains email or credentials. On `connected`, the normal session is already stored; the content controller immediately runs the existing course-resolution and `LIST_PAGE_COMMENTS` flow. A comment-load error leaves the reviewer connected and shows the existing empty/retryable comments state.

The server resume endpoint verifies in this order: find the course membership by normalized email and course, find its active reconnect credential, verify the submitted credential hash, then inspect membership state. Any missing course/email/membership/credential, invalid credential, or mismatch returns the same generic HTTP 403 response and discloses no state. Only after successful credential verification does it return HTTP 200 with `state: "pending"`, `"rejected"`, or `"revoked"`; approved returns HTTP 200 with `state: "approved"`, the normal session token, device credential, and expiry. Terminal responses therefore cannot be used as an email/membership oracle. Route and service tests cover every state and the validation order.

## Interface and accessibility

Pending state uses the textual message **Waiting for approval — you can leave this page open or return later.** It includes one 44-pixel **Check approval** button. The status remains an `aria-live="polite"` region. Automatic checks do not repeatedly announce unchanged text. Successful approval announces **Approved — connected** once, moves to the normal connected controls, and loads current comments.

Remove all reviewer-facing occurrences of **reconnect code**, **personal reconnect code**, **save your reconnect code**, **new reviewer**, and **existing reviewer**. Admin screens may continue to call the first credential an invitation code. Negative tests verify the forbidden wording is absent from rendered UI, the accessibility tree, content-script messages, and public error text after redemption, approval, reload, navigation away/back, transient failure, and terminal rejection.

## Existing pending users and migration

Pending credentials saved by the new version resume automatically. The currently approved Richard Davies membership was created under the older version, whose reconnect credential was shown but not stored, so it cannot be recovered from its hash. For that one pilot record, provide a one-time administrative reset and fresh invitation only with explicit owner approval; do not weaken credential validation or attempt to recover the old secret.

Existing connected browser sessions and device credentials remain valid. A different browser has no pending or device credential and therefore requires the administrator to reset that course membership and issue a fresh invitation during this pilot. This limitation is stated in Help; the reviewer still sees only one invitation code. No server database migration is required for the one-code flow.

## Failure handling

- Invalid or expired invitation: show the existing generic verification error and do not store pending state.
- Pending approval: retain the hidden credential and waiting state.
- Temporary network error: retain pending state and retry later.
- Rejected or revoked membership: delete the hidden credential and show **Access was not approved — ask the course team for a new invitation.**
- Missing/corrupt local pending record: delete it and return to the first-use invitation form.
- Course mismatch: do not send the credential and discard a malformed mismatched record.
- Explicit extension sign-out or reviewer reset: clear session, device, and pending records. Ordinary session expiry keeps a valid pending record only if approval has not completed.
- Extension uninstall or browser data clearing: browser-managed storage deletion is expected; access then requires an administrator reset and fresh invitation.
- Duplicate redemption for an existing membership: return the generic verification error and retain the currently valid pending record. Only a successful redemption after an administrative membership reset may replace it.

## Testing and release

Tests must prove:

- one invitation redemption stores a hidden pending credential without exposing it to the overlay;
- no second-code or existing-user interface remains;
- pending access resumes automatically after approval and removes the pending credential;
- checks are course-scoped, single-flight, visibility-aware, and stop after connection/destruction;
- background checks are coalesced across concurrent tabs, generation-safe, and ignore late stale responses;
- reload in the same browser resumes checking;
- transient errors retain pending state while terminal states clear it;
- server state is disclosed only after credential verification, with generic responses for all invalid/mismatched inputs;
- beta testers still connect immediately;
- existing connected sessions continue to renew normally; and
- no UI, accessibility text, public error, or content-script message displays or requests a reconnect credential in any lifecycle state; and
- extension security, API validation, overlay accessibility, production build, signing, and release suites remain green.

Publish as the next immutable signed Chrome/Edge patch version.
