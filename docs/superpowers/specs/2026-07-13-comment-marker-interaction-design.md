# Comment Marker Interaction Design

## Goal

Make course feedback visually distinct from Moodle and reduce comment creation to one context-sensitive action. Reviewers can highlight text or place a comment marker, then open the associated thread beside its course context. The overlay also clearly identifies the signed-in reviewer.

## Visual language

- Use `#28c4c2` as the review application's primary turquoise across the extension overlay and server-rendered application UI.
- The overlay must have a strong turquoise boundary and remain visibly separate from UC Online's black, white, and red Moodle interface.
- Use accessible darker turquoise variants for text and borders where `#28c4c2` does not provide sufficient contrast.
- Anchored text uses a persistent yellow highlight. A turquoise speech-bubble marker appears beside its rendered text range.
- Point comments use the same speech-bubble marker. Markers are larger than the current pins, keyboard focusable, and include a useful accessible name.

## Adaptive creation flow

The overlay exposes one primary creation action rather than a menu or two competing actions.

- With a non-empty eligible text selection, the button reads **Add comment to highlighted text**. Activating it immediately opens the composer for that selection.
- Without an eligible selection, the button reads **Add comment marker**. Activating it enters marker-placement mode.
- In placement mode, the pointer displays a small turquoise speech-bubble cursor. The next eligible page click places a temporary marker and opens the composer beside it.
- Escape and a visible Cancel action leave placement mode. Cancelling the composer removes the temporary marker or temporary text highlight.
- Extension controls, browser chrome, inaccessible iframe contents, and other ineligible targets cannot receive a marker.
- An inaccessible embedded activity retains a plain explanation directing the reviewer to place a marker on the surrounding parent page; it does not introduce another comment-creation button.

An eligible text selection is a non-collapsed, non-whitespace selection wholly inside the current accessible document. It may span ordinary visible text nodes and inline/block elements, but it must not begin or end inside the extension shadow root, Moodle navigation or controls, a form control, editable/contenteditable content, hidden/inert content, script/style content, media, or a cross-origin/inaccessible frame. A selection crossing an iframe, shadow-root, or document boundary is ineligible. Links may be highlighted when their visible text is selected; the extension prevents navigation only for the Add comment activation, not for normal page use.

An eligible marker target is the nearest visible page-content element at the pointer/focus location that is outside the extension UI, Moodle navigation/control regions, form/editable controls, hidden/inert content, scripts/styles, and inaccessible frames. Images and accessible embedded-media containers are eligible; their marker is anchored to the container. If no eligible ancestor exists, placement remains active and announces that the location cannot receive a comment.

Keyboard placement uses normal document focus order. On entering placement mode, the controller builds a bounded list of visible eligible content blocks/media and temporarily gives otherwise non-focusable candidates `tabindex="0"` plus an extension-owned marker attribute. Existing tabindex values are recorded exactly. Focus returns to the most recently focused eligible page element, or the first candidate after Moodle navigation. Tab and Shift+Tab move through these candidates and existing focusable content normally. A turquoise preview marker follows the currently focused eligible target; Enter or Space prevents the underlying Moodle link/button action and places the marker at that element's logical top-right inset. Escape cancels. On placement, cancellation, navigation, or teardown, every temporary attribute is removed and each original tabindex is restored exactly. Placement instructions and target changes are announced through the overlay status region.

## Stored anchors and threads

- Saved text comments restore both the yellow text highlight and adjacent speech-bubble marker when the page loads.
- Saved point comments restore their speech-bubble marker using the existing selector and relative-coordinate anchor.
- Clicking or keyboard-activating a marker opens its complete thread in a compact popover positioned beside the marker. The popover contains the original comment, author and role, replies, status controls already permitted for that viewer, and thread actions.
- Only one thread popover is open at a time. Escape and outside click close it and return focus to the marker.
- If the exact anchor cannot be restored, the thread remains available in the overlay's Comments list with its existing context-recovery behaviour.

The popover exposes the original comment, chronological replies, reply composer where permitted, status and status history where permitted, share-with-SME control where permitted, **Take to context**, and **Delete thread** where permitted. These controls remain available in the Comments list during the pilot; the marker popover is an additional contextual entry point, not a removal of the summary interface. Capabilities supplied by the server determine which mutation controls render.

The popover prefers the marker's right side, flips left when required, and then clamps within an 8px viewport inset. It appears above or below when neither horizontal side fits. It recalculates on scroll, resize, and zoom-related viewport changes. `aria-expanded` and `aria-controls` connect marker and popover. Marker activation opens the non-modal popover and moves focus to its heading; Escape/outside click closes it and restores marker focus. Clicking another marker switches popovers. Interaction inside the popover or main overlay does not count as an outside click.

## Identity treatment

When connected, the overlay shows a compact secondary identity area containing the reviewer's display name or email, human-readable role, and **Sign out / switch user** action. A typical rendering is `Richard Davies · Learning Designer`. The identity treatment must remain readable at narrow widths without competing with the primary Add comment action.

The extension obtains identity from token-authenticated `GET /api/me?course_id=<uuid>`. Its exact response is `{ "user": { "id": <uuid>, "display_name": <non-empty string or null>, "email": <email>, "role": "beta_tester" | "sme" | "ld_dcd" | "admin" }, "course_id": <uuid> }`. The server derives the identity and role from the authenticated user and an approved membership for that course; the extension rejects responses for a different course. Display uses non-empty `display_name`, otherwise email. It does not decode or trust client-controlled identity fields.

**Sign out / switch user** clears the active API token, expiry, device credential, pending approval/reconnect credential for the current identity, trusted in-memory course binding, open drafts, and popovers. It intentionally retains the non-secret, course-scoped saved-reviewer list. The overlay immediately opens that course's existing-user chooser, with the previous user identified but not authenticated, and moves focus to the chooser heading/first reviewer option. Selecting a reviewer follows the existing approved-member sign-in flow; creating a different reviewer follows the existing new-user flow. Users from other courses are never shown.

## Thread deletion

- **Delete thread** is available only to the thread's original author or a viewer with an approved LD/DCD or admin membership in the same course. Permission never comes from a role belonging only to another course.
- Deletion requires an explicit confirmation that the original comment, every reply, and associated screenshots will be removed.
- The server performs the authorization check; hiding the control in the extension is only a presentation convenience.
- `DELETE /api/comments/<comment-id>` requires the authenticated viewer to be able to see the thread and belong to its course before checking author/LD-DCD/admin deletion capability. A missing, deleted, cross-course, or otherwise invisible thread returns the same nondisclosing `404`; a visible thread without delete permission returns `403`; success returns `204`.
- Successful deletion transactionally removes the comment, replies, status events, shares, read state, and attachment database records. The page-location record is removed only if no other comment uses it. Attachment file paths are collected before commit and deleted after commit; a file failure is logged for orphan cleanup but cannot restore access because its database record is gone.
- The database uses foreign-key cascades/restrict rules to prevent partial thread deletion. Concurrent reply, share, status, or upload operations serialize against the thread and either complete before deletion or fail with `404` after deletion.
- Repeating deletion returns `404`. Other open tabs remove stale markers on their next comments refresh; an attempted action from a stale popover receives `404`, closes the popover, refreshes comments/counts, and announces that the thread was removed. No real-time cross-tab channel is added.
- A failed deletion leaves the marker and thread visible and presents a concise retryable error.
- Deletion is permanent for this pilot; no recycle-bin workflow is introduced.

## Components and data flow

1. Selection and placement controllers expose a single normalized draft anchor to the composer.
2. The overlay derives the adaptive button label from whether an eligible selection exists.
3. Saving uses the existing trusted course-binding refresh, creates the comment, and replaces the temporary anchor with the stored comment marker.
4. Each page-comment object includes authoritative `capabilities: { can_reply: boolean, can_change_status: boolean, can_share_with_sme: boolean, can_delete: boolean }`. Capability values are computed from the authenticated approved course membership and thread visibility. Existing comment/author fields remain authoritative; no client-supplied role or author id is accepted for mutations.
5. A token-authenticated delete request removes the thread on the server and returns success. The overlay then updates its local list and markers.
6. Marker activation passes the thread and marker geometry to a focused popover component.

## Accessibility and responsive behaviour

- All creation, marker activation, popover, confirmation, cancellation, reply, and deletion flows work by keyboard.
- Placement mode announces its instructions and cancellation method through an accessible status region.
- Yellow highlights do not convey comment presence alone; the speech-bubble marker and accessible label provide the interactive affordance.
- Focus is trapped only inside modal composer and confirmation dialogs. A non-modal thread popover closes predictably and restores focus.
- At 320 CSS pixels, identity may wrap below the course line, while the adaptive primary action remains fully labelled and usable.

## Testing

- Unit tests cover adaptive labels, eligible selection changes, marker-placement activation/cancellation, temporary-anchor cleanup, yellow highlight rendering, marker appearance, popover positioning/focus, and identity rendering.
- API and service tests cover author/LD-DCD deletion authorization, unauthorized deletion, cascading replies and screenshots, and course visibility boundaries.
- Bridge validation tests cover exact delete and identity message/response envelopes.
- End-to-end browser tests cover both creation paths, reopening threads from markers, deleting a complete thread, switching users, keyboard operation, responsive layout, and colour/contrast requirements.
- The release is versioned as the next pilot build and verified in both Chrome and Edge-compatible Chromium packaging.

## Out of scope

- Deleting individual replies independently.
- Undo or recovery of deleted threads.
- Dragging existing markers to new locations.
- Email notifications or changes to current visibility rules.
