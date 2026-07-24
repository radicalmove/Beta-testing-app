# Comment-list arrival position design

## Outcome

After a reviewer selects a comment or page heading on another Moodle or SCORM page, the reloaded course-comments list scrolls to that destination page group instead of returning to the top.

## Design

- Add a small storage helper dedicated to one-use comment-list arrival state.
- Before cross-page navigation begins, store only the course URL and destination page URL in `sessionStorage`.
- Do not change the existing comment-navigation state machine or overlay startup path.
- After the destination page has loaded and the course list has been rendered, consume the stored destination only when both its course URL and page URL match the current context.
- Expand the destination group if necessary and set the comments list's own `scrollTop` so its heading is visible.
- Clear the stored destination after successful restoration. Ignore malformed, mismatched, unavailable, or throwing storage without affecting the overlay.
- Same-page comment navigation and ordinary comment refreshes retain their existing behaviour.

## Verification

- Prove the storage helper safely writes, reads, consumes, rejects mismatches, and tolerates unavailable storage.
- Prove a cross-page comment click stores its destination before navigation.
- Simulate a fresh overlay on the destination page and verify the rebuilt comments list scrolls to that group and consumes the record.
- Prove ordinary refreshes still preserve the existing list scroll position.
- Run the complete extension tests, type-check, production build, server tests, deployment-package tests, and release checksum verification.
