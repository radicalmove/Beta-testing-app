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

## Stored anchors and threads

- Saved text comments restore both the yellow text highlight and adjacent speech-bubble marker when the page loads.
- Saved point comments restore their speech-bubble marker using the existing selector and relative-coordinate anchor.
- Clicking or keyboard-activating a marker opens its complete thread in a compact popover positioned beside the marker. The popover contains the original comment, author and role, replies, status controls already permitted for that viewer, and thread actions.
- Only one thread popover is open at a time. Escape and outside click close it and return focus to the marker.
- If the exact anchor cannot be restored, the thread remains available in the overlay's Comments list with its existing context-recovery behaviour.

## Identity treatment

When connected, the overlay shows a compact secondary identity area containing the reviewer's display name or email, human-readable role, and **Sign out / switch user** action. A typical rendering is `Richard Davies · Learning Designer`. The identity treatment must remain readable at narrow widths without competing with the primary Add comment action.

The extension receives the current viewer's public identity from a token-authenticated endpoint or an existing authenticated response. It does not decode or trust client-controlled identity fields. Signing out clears the extension session and returns the overlay to its course-scoped sign-in state.

## Thread deletion

- **Delete thread** is available only to the thread's original author or an LD/DCD. Administrators retain equivalent administrative permission where the existing role model requires it.
- Deletion requires an explicit confirmation that the original comment, every reply, and associated screenshots will be removed.
- The server performs the authorization check; hiding the control in the extension is only a presentation convenience.
- Successful deletion removes the complete thread and its attachments transactionally, then removes its marker/highlight and refreshes the page comment count.
- A failed deletion leaves the marker and thread visible and presents a concise retryable error.
- Deletion is permanent for this pilot; no recycle-bin workflow is introduced.

## Components and data flow

1. Selection and placement controllers expose a single normalized draft anchor to the composer.
2. The overlay derives the adaptive button label from whether an eligible selection exists.
3. Saving uses the existing trusted course-binding refresh, creates the comment, and replaces the temporary anchor with the stored comment marker.
4. Page-comment responses include sufficient current-viewer capability data to render deletion without reproducing authorization rules in the extension.
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
