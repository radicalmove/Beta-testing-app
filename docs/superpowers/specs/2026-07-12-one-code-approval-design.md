# One-code reviewer approval

## Goal

Make the invitation code the only code a reviewer ever enters. After a reviewer redeems an invitation for a course, the same Chrome or Edge profile must remember the pending access privately, detect administrator approval automatically, and connect without further user input.

## Reviewer journey

The first-use form asks for name, email, role, and the course invitation code. It no longer offers **New reviewer** and **Existing reviewer** modes and never displays or requests a reconnect code.

Beta testers continue to connect immediately. Roles requiring approval see **Waiting for approval — you can leave this page open or return later.** The extension checks automatically while the course page remains open and whenever the reviewer returns to that course. A secondary **Check approval** action is available as a manual fallback, but it never opens another credential form.

When approval is detected, the overlay changes to **Connected** without a page reload and loads the page's comments. The same browser profile reconnects automatically on later visits. A different browser requires a fresh course invitation during this pilot; it still exposes only one invitation code and never a second code.

## Credential architecture

The server may continue issuing the current high-entropy reconnect credential when an invitation is redeemed. It remains an internal protocol detail. The extension background worker stores it in `chrome.storage.local`, keyed by the immutable course handle and normalized email, along with the pending membership role. It is never returned to the overlay for display and is never included in page DOM, logs, errors, or accessible text.

The pending credential can only resume the same course membership after that membership becomes approved. Email alone cannot claim access. The original invitation remains one-time and is not retained or reused.

On successful resume, the background worker stores the normal device/session credentials using the existing mechanism and removes the pending credential. It also removes the pending credential when the server reports a terminal rejected or revoked state. Transient network failures retain it so checking can resume later.

Storage records are schema-validated and bounded. Course navigation never sends a pending credential to a different course, and content scripts cannot read `chrome.storage.local` directly.

## Automatic approval checking

The content controller asks the background worker to resume pending access for the current resolved course:

- immediately after the initial pending redemption;
- when the course page initializes or regains visibility;
- on a bounded interval while the page is visible and still pending; and
- when the reviewer activates **Check approval**.

Use a 10-second interval, with only one request in flight at a time. Stop polling on connection, terminal rejection/revocation, course navigation, overlay destruction, or page hiding. Restart immediately when the page becomes visible. Network failures keep the waiting state and retry on the next scheduled check; they do not change the message to service unavailable unless no pending credential exists.

The background response distinguishes `pending`, `connected`, `terminal`, and `none`. A connected response supplies no secret to the content script; it reports only the state needed to refresh the overlay. Existing session/device renewal remains authoritative after connection.

## Interface and accessibility

Pending state uses the textual message **Waiting for approval — you can leave this page open or return later.** It includes one 44-pixel **Check approval** button. The status remains an `aria-live="polite"` region. Automatic checks do not repeatedly announce unchanged text. Successful approval announces **Approved — connected** once, moves to the normal connected controls, and loads current comments.

Remove all reviewer-facing occurrences of **reconnect code**, **personal reconnect code**, **save your reconnect code**, **new reviewer**, and **existing reviewer**. Admin screens may continue to call the first credential an invitation code.

## Existing pending users and migration

Pending credentials saved by the new version resume automatically. The currently approved Richard Davies membership was created under the older version, whose reconnect credential was shown but not stored, so it cannot be recovered from its hash. For that one pilot record, create a fresh invitation/membership only with explicit owner approval or provide a one-time administrative reset; do not weaken credential validation or attempt to recover the old secret.

Existing connected browser sessions and device credentials remain valid. No server database migration is required for the one-code flow.

## Failure handling

- Invalid or expired invitation: show the existing generic verification error and do not store pending state.
- Pending approval: retain the hidden credential and waiting state.
- Temporary network error: retain pending state and retry later.
- Rejected or revoked membership: delete the hidden credential and show **Access was not approved — ask the course team for a new invitation.**
- Missing/corrupt local pending record: delete it and return to the first-use invitation form.
- Course mismatch: do not send the credential and discard a malformed mismatched record.

## Testing and release

Tests must prove:

- one invitation redemption stores a hidden pending credential without exposing it to the overlay;
- no second-code or existing-user interface remains;
- pending access resumes automatically after approval and removes the pending credential;
- checks are course-scoped, single-flight, visibility-aware, and stop after connection/destruction;
- reload in the same browser resumes checking;
- transient errors retain pending state while terminal states clear it;
- beta testers still connect immediately;
- existing connected sessions continue to renew normally; and
- extension security, API validation, overlay accessibility, production build, signing, and release suites remain green.

Publish as the next immutable signed Chrome/Edge patch version.
