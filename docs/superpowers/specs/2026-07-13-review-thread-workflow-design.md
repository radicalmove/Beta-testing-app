# Review Thread Workflow Design

## Goal

Make reviewing a course feel like a contextual learning-design conversation: identify the exact course content, record an observation, discuss it, ask an SME when needed, act, and resolve. Remove classification and diagnostic UI that distracts reviewers.

## Creation and anchors

- The overlay retains one adaptive action: **Add comment to highlighted text** for an eligible selection, otherwise **Add comment marker**.
- A saved text comment restores a clearly visible yellow background highlight over the selected text and a turquoise `#28c4c2` speech-bubble marker beside it.
- A point comment restores the same turquoise speech-bubble marker.
- Clicking a closed marker opens its thread beside the marker. Clicking the same marker again closes it. Clicking another marker switches directly to that thread.
- The Comments list remains the fallback for an anchor that cannot be restored. No separate unresolved-anchor section is shown; the list item says **Original location unavailable**.
- Remove the visible embedded-activity diagnostic panel. Parent-page marker creation remains available without presenting implementation details to reviewers.

## Thread popover

The popover uses the following order:

1. Small context line: **Comment x of y**, based on the ordered comments visible to this viewer on the current page.
2. Author display name and human-readable role.
3. Original comment in a bordered observation box.
4. Pencil icon for the original author to edit the original text. Editing does not change its anchor.
5. Compact status and LD/DCD status actions.
6. Chronological reply history.
7. **Add reply** textarea and submit action when server capabilities permit replying.
8. **Ask SME** action for LD/DCD users on Beta Tester threads.
9. Top-right rubbish-bin icon for the original author or same-course LD/DCD/admin.

The delete icon has an accessible name and still requires confirmation that the entire thread, replies and screenshots will be permanently deleted. The popover closes on Escape, outside click, the active marker, deletion, or navigation.

## Editing

- Add `PATCH /api/comments/{comment_id}` accepting the exact body-only request `{ "body": <trimmed 1..10000 character string> }`.
- Only the original thread author can edit. LD/DCD/admin users may delete but cannot rewrite another person's observation.
- Visibility and course access are checked before authorship, returning nondisclosing `404` for inaccessible/cross-course threads and `403` for a visible non-author.
- The update changes `body` and `updated_at`. It does not alter author, category, location, replies, status or shares.
- The pencil opens an inline textarea with Save and Cancel; failures retain the draft.

## Replies and status

- Existing reply and status services remain authoritative and course-membership scoped.
- The extension adds strict trusted-context background messages for reply and status mutations. A content script cannot supply a course id or role.
- After every successful mutation, the extension refreshes the page comments and keeps the relevant marker/thread open where possible.

## Ask SME

- **Ask SME** is available only to an approved LD/DCD in the thread's course and only for Beta Tester-authored threads.
- It opens a multi-select list of approved SME memberships in that course. Existing recipients are preselected.
- The LD/DCD can add or remove one or more SME recipients. Selected SMEs can see and reply to the thread under existing visibility rules; unselected SMEs cannot discover it.
- The server exposes an exact course-scoped recipient list and replaces thread recipients transactionally. Cross-course, unapproved or non-SME ids are rejected without disclosing unrelated users.
- The control displays selected SME names, not email addresses, after saving.

## Identity and persistent sign-in

- The overlay always shows the authenticated user's display name (email fallback) and human-readable course role when connected.
- Identity is fetched only after a trusted course context exists. If the Manifest V3 worker restarts, identity and every mutation first re-resolve the current course binding exactly as comment creation already does.
- Same-browser persistence uses the stored device credential to obtain a fresh API session automatically. Normal worker suspension or token expiry must not show the sign-in form.
- Device renewal failures distinguish transient service/network failures from terminal invalid/revoked credentials. Transient failures retain the device credential and retry; only authenticated terminal rejection removes it.
- **Switch user** explicitly clears the current session/device/pending identity, then opens the course-scoped saved-reviewer chooser.

## Comments list

- The Comments button opens an ordered compact list of every comment visible to the current viewer on the current page.
- Each item shows its sequence number, author, short body excerpt, status and anchor availability.
- Activating an anchored item scrolls to and focuses its marker, then opens the thread. Activating an unavailable anchor opens the thread from the list without attempting a page jump.
- The list does not show diagnostic terminology.

## Categories

- Remove category selection and display from the extension.
- Remove category filters and category emphasis from LD/DCD summary/dashboard UI.
- Preserve the database field and historic values for compatibility. New extension feedback sends the internal default `general`; category is not editable.

## Trusted context recovery

Before identity, delete, edit, reply, status or Ask SME operations, the top-frame content script sends `RESOLVE_COURSE` using its detected Moodle context and verifies that the returned id matches the composer/thread snapshot. The background worker then has a fresh trusted tab binding. Embedded-frame operations obtain their binding from the top frame and fail safely when it is unavailable.

## Accessibility

- Yellow background is accompanied by the interactive marker and never conveys comment presence alone.
- Icons have accessible names and at least 44px hit targets while remaining visually compact.
- Thread numbering is supplementary, not used as identity.
- Marker toggle state uses `aria-expanded`; popover and list focus return predictably.
- Inline editing, replies, status and Ask SME work by keyboard and announce success/failure.
- The 320px layout keeps identity, primary comment action and thread controls usable.

## Testing

- Reproduce and prevent course-context loss for delete/identity/other mutations after a worker restart.
- Test transient device renewal retention and terminal credential removal.
- Test yellow highlight persistence, marker toggle, comment numbering, list navigation, unavailable anchors, identity and responsive layout.
- Test author-only editing, body validation, nondisclosing boundaries and concurrent deletion.
- Test reply/status trusted messages and server membership authorization.
- Test Ask SME selection, replacement, removal and cross-course/non-SME rejection.
- Run full extension/server suites, production build, migration verification, signed Chrome/Edge packaging, Mac Mini deployment and live CRJU150 smoke testing.

## Out of scope

- Moving/re-anchoring an existing comment.
- Editing replies.
- Restoring deleted threads.
- Email notifications.
