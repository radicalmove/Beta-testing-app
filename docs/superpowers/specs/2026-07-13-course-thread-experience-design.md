# Course Thread Experience Design

## Purpose

Refine the Moodle review extension so commenting behaves like a coherent contextual review tool. The changes cover thread interaction, persistent identity, course-wide discovery, resolution, navigation, marker mode, help, and visual consistency.

## Course boundary

“Course-wide” means every Moodle page and activity belonging to the current Moodle course ID. For example, the CRJU150 list includes comments from all pages and activities whose stored course ID is `896`. It must never include comments from another Moodle course.

The server remains the authority for course membership and visibility. Role visibility rules continue to apply within the course-wide result set.

## Thread popover

Each marker or highlighted-text anchor controls one thread popover. Clicking its marker opens the popover; clicking the same marker again closes it. Opening another thread closes the previous one.

The popover is positioned relative to the marker or highlighted text rather than fixed to the viewport. It moves with that anchor while scrolling and repositions beside, above, or below it to remain visible near viewport edges. It closes if the anchor is removed or navigation invalidates the page context.

Positioning prefers the right side, then left, below, and above, with an 8-pixel viewport margin and no overlap with the marker where space permits. If scrolling moves the anchor fully offscreen, the popover closes and focus returns to the marker. Marker buttons support Enter/Space, expose `aria-expanded` and `aria-controls`, and receive focus again for marker toggle, Escape, outside-click, and programmatic close paths. Opening focuses the popover heading; clicks inside the popover are not outside-clicks.

Highlighted comments retain a visible yellow background for the original selected text and display a turquoise speech-bubble marker beside it.

## Thread presentation

The header displays `Comment x of y`, using the thread's status group: Open for non-resolved threads and Resolved for resolved threads. `y` is the server-provided total visible count for that filter, and `x` is the server-provided rank under the course-list ordering. Thread detail therefore includes `{filter, visible_rank, visible_total}` so numbering does not depend on which paginated results the client has loaded. It uses a compact Review360-inspired identity block:

- an initial avatar derived from the first Unicode letter of display name, otherwise the first letter of the email local part, otherwise `?`;
- display name, falling back to email;
- role mapped as `admin` → `Administrator`, `ld_dcd` → `Learning Designer / Digital Course Developer`, `sme` → `Subject Matter Expert`, and `beta_tester` → `Beta Tester`;
- relative creation time.

Internal identifiers must not produce labels such as `admin admin`.

The original comment and each reply appear as readable message cards. Only one editor or reply composer may be active within a popover at a time.

## Editing, replies, and deletion

The edit control is a square icon button matching the delete control in size, with a larger pencil icon. Editing message text remains author-only. An authenticated Administrator or LD/DCD may delete a thread but may not rewrite another person's words.

Edit is a toggle. The first click replaces the message body with one editor. Clicking Edit again, Cancel, or closing the popover abandons editing and restores the saved message. The active edit button changes appearance. Save updates the existing message in place and does not duplicate controls.

Reply is a text-link action. Clicking it reveals one reply box and Save/Cancel actions. Saving adds the reply to the thread immediately, refreshes the canonical thread state, and closes the composer. Clicking Reply again or Cancel closes it without saving.

Delete is a compact rubbish-bin button in the top-right. It requires confirmation and is available to the comment author, an Administrator, or an LD/DCD, as enforced by the server.

## Resolution and SME visibility

Administrators and LD/DCDs can resolve or reopen a thread. The Open filter contains `open`, `in_progress`, `awaiting_sme`, and `deferred`; the Resolved filter contains `resolved`. Resolve changes any Open status to `resolved`; reopen changes `resolved` to `open`. The server returns `allowed_statuses` for each thread and is authoritative for transitions.

The existing Administrator/LD/DCD control for exposing a Beta Tester thread to an SME remains available in the thread. `GET /api/comments/{thread_id}/sme-recipients` returns `{version, recipients}` with selected approved same-course SME membership IDs plus display identity. `PUT` replaces the selection atomically using `{version, membership_ids: [...]}` and returns the incremented version; an empty list removes exposure, duplicate IDs are normalised, and at most 50 recipients are accepted. A version mismatch returns `409` with the current version; the extension refreshes the selection and asks the user to retry rather than silently overwriting it. Unknown, unrelated, or invisible memberships/threads receive nondisclosing `404`.

All thread operations first establish that the authenticated user has an approved membership for the thread's course and can see the thread under role-visibility rules. Invisible and cross-course resources return nondisclosing `404`. Visible but disallowed actions return `403`. Reply follows visibility rules; author edit, author/Administrator/LD/DCD delete, Administrator/LD/DCD resolve/reopen, and Administrator/LD/DCD SME exposure are enforced from the authenticated course membership, never client-supplied roles.

## Course-wide comments panel

The Comments button opens a course-wide list instead of a page-only list. The panel has Open and Resolved filters, defaults to Open, and shows only threads visible to the signed-in user.

The extension requests `GET /api/courses/{course_id}/comments?filter=open|resolved&cursor=<opaque>&limit=50`. The server caps `limit` at 100 and returns `{items, next_cursor}`. Items contain thread ID, status, created/updated timestamps, author display identity and role, excerpt, page/activity title, canonical Moodle URL, anchor type and restoration data, and server-computed capabilities (`can_edit`, `can_delete`, `can_reply`, `allowed_statuses`, `can_manage_sme`). Ordering is `updated_at DESC, id DESC`, encoded in the opaque cursor. Course membership and visibility are applied before pagination.

Opening an item requests `GET /api/comments/{thread_id}`. It returns the canonical thread: full original message, ordered replies with author identity/role and timestamps, status, page/activity and anchor data, SME recipients visible to managers, and the same server-computed capabilities. Reply ordering is `created_at ASC, id ASC`. Course and visibility checks use the nondisclosing rules above.

Each item includes enough context to identify the comment: author, short comment excerpt, page/activity title, and status. Selecting an item on the current page scrolls to the anchor and opens its popover. Selecting an item on another page navigates the current tab to its stored Moodle URL. After the extension loads on the destination, it scrolls to the anchor and automatically opens the requested thread. Each newly created anchor also stores an independent normalised document position (`document_y / document_height`, clamped 0–1). If selector or text restoration fails, navigation scrolls to that fallback position, opens the thread in a location-unavailable popover associated with the list selection, and explains that the original element could not be found.

The navigation hand-off is stored in `chrome.storage.session`, keyed by tab ID, and contains the target thread ID, course ID, canonical URL, creation time, and a random nonce. It expires after five minutes and is consumed once after successful validation. The background worker accepts only configured HTTPS Moodle origins and URLs supplied by the server, strips fragments, and binds the request to the initiating tab/course. Destination content verifies detected course ID and canonical origin before consuming it. Mismatches, expiry, failed navigation, tab closure, and explicit cancellation clear it; browser back/forward does not replay a consumed request. A duplicate tab has a different tab ID and cannot consume it. Session storage surviving a worker restart allows the hand-off to complete.

## Marker mode and primary action

When text is selected, the primary action reads `Add comment to highlighted text` and opens the comment composer immediately. Without a selection it reads `Add comment marker`.

Activating marker mode changes the button to a clear active state with a comment symbol and cancellation wording or indication. The pointer becomes a turquoise speech-bubble/comment cursor over eligible page content. Clicking eligible content places the marker and opens the composer. Escape, clicking the active button again, navigation, or completing/cancelling the operation exits marker mode and restores the normal pointer.

The primary button visually belongs to the overlay: turquoise `#28c4c2` background, dark teal text/icon, subtle darker border and shadow, matching radius and typography. It does not use a stark white border. Active marker mode uses a dark teal background with a turquoise icon/text treatment.

## Persistent identity

The same browser profile should retain the selected reviewer identity until the user explicitly switches or signs out. Background-worker suspension and ordinary access-token expiry must not erase it.

The trusted background context first calls `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`; only after success may it read or write the durable rotating device credential and reviewer identity. Failure disables durable sign-in and reports a safe error. Content scripts access identity and authenticated requests only through validated runtime messages and can neither read nor mutate credential records. Short-lived access tokens remain in session storage.

On startup or renewal, the background silently exchanges the durable credential for a fresh access token and rotated credential. It coalesces all in-process renewals into one promise. The server atomically accepts only the current credential generation, rotates it once, and returns the successor only in that response; stale generations return nonterminal `RENEWAL_SUPERSEDED` and never revoke or reveal the successor. Local replacement is compare-before-replace, so an older response cannot overwrite a newer generation.

Initial device approval and every successful renewal also return a separate random recovery handle, stored alongside the credential in trusted local storage and retained until replaced or explicit sign-out. The server stores only its hash, family binding, generation, and a 30-day expiry. If a worker restart loses an uncertain renewal response, `POST /api/auth/device/recover` accepts `{credential_family_id, recovery_handle}`. In one transaction, a valid unexpired family-bound handle invalidates any uncertain current credential generation, issues a wholly new credential/access token/recovery handle, stores their hashes, advances the family generation, and consumes the submitted handle; it never retrieves or stores a plaintext successor from the lost response. The response is `{access_token, expires_in, device_credential, credential_generation, recovery_handle, recovery_expires_at, credential_family_id}`.

Only one concurrent recovery succeeds. Later uses of the consumed handle return `409 RECOVERY_SUPERSEDED` without revoking the winner. The background coalesces in-process recovery and applies the response only when both the stored family ID and submitted recovery handle still match; credential and handle are replaced together in one storage write. Stale responses cannot overwrite newer state. Terminal invalid/revoked/expired recovery outcomes use the authenticated terminal envelope below; transient failures retain both local values.

Network errors, timeouts, `429`, and `5xx` are transient and retain the durable credential. An expired short-lived access token triggers renewal. Renewal errors use JSON `{error: {code, message, credential_family_id}}`. Terminal codes map as follows: `DEVICE_REVOKED` and `DEVICE_EXPIRED` → `401`; `COURSE_ACCESS_REMOVED` and `COURSE_MISMATCH` → `403`. Only a valid HTTPS response from the configured service whose family ID matches the locally stored family and whose code is one of those four clears the matching credential after compare-before-remove. `RENEWAL_SUPERSEDED` is `409` and triggers recovery. Generic or malformed `401/403`, redirects to an unconfigured origin, and mismatched family IDs are retained and surfaced for retry. Explicit sign-out always clears the local records.

The overlay always shows the current user’s display name/email and role, with an explicit switch/sign-out affordance.

## Help

Help is rewritten to match the delivered interface and explains:

1. commenting on highlighted text;
2. placing and cancelling a marker;
3. opening and closing a thread;
4. editing, replying, and deleting;
5. resolving and viewing resolved threads;
6. asking an SME where permitted;
7. using the course-wide Comments list and cross-page navigation;
8. identifying or switching the signed-in reviewer.

Instructions vary where role permissions differ and avoid obsolete terminology.

## Error handling

Mutations show an inline, human-readable error without destroying the current editor text. Failed replies and edits remain available for retry. Authentication renewal distinguishes offline/service failures from revoked access. Cross-page navigation failures leave the user on the destination page with the thread accessible from the course list.

## Verification

Automated tests cover:

- edit/reply toggle idempotence and cancellation;
- reply creation and immediate rendering;
- permission-dependent edit/delete/resolve/SME controls;
- open/resolved filtering;
- strict course-ID filtering and role visibility;
- current-page and cross-page navigation hand-off;
- marker-mode button and cursor states, including Escape;
- anchored popover repositioning during scroll and viewport-edge flipping;
- yellow highlight restoration;
- persistent identity across worker/browser restart, token expiry, and temporary server failure;
- identity formatting and updated help content.

Manual Chrome and Edge pilot checks cover Moodle course pages, activities, and embedded SCORM parent-page fallbacks.
