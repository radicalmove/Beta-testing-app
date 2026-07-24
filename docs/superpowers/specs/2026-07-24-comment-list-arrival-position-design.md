# Comment-list arrival position design

## Outcome

After a reviewer selects a comment or page heading on another Moodle or SCORM page, the reloaded course-comments list scrolls to that destination page group instead of returning to the top.

## Design

- Add a small storage helper dedicated to one-use comment-list arrival state. Its versioned record contains `course_url`, logical comment `page_url`, `comment_id`, `status`, `created_at`, and a unique record token. Required strings must be non-empty, status must be `open` or `resolved`, and records expire after five minutes.
- Use exact canonical values already supplied by `context.course_url`, the selected comment's `page_url`, and its ID. Do not normalize URLs or substitute `navigation.destination_url`; this preserves Rise hashes and SCORM logical page identities.
- Keep the existing navigation preparation and state machine unchanged. In the top-frame content controller, write the record only after `prepareCommentNavigationWithRetry` succeeds and returns a browser destination, immediately before `location.assign`.
- A newer cross-page selection overwrites an older record. If assignment throws, remove the record only when its token still matches, so cleanup cannot erase a newer selection. Storage errors never prevent navigation.
- Do not read arrival storage during overlay construction or startup. After an authoritative whole-course comment response has been rendered, peek without removing. Require an exact course match and an exact comment ID/page URL/status match in that response.
- If the record is valid but the matching group is not yet rendered, retain it for a later authoritative response until expiry. This covers delayed SCORM/Rise projection. Delete malformed, expired, or course-mismatched records.
- Restore `Whole course` scope and the stored Open/Resolved filter, expand the destination group, and calculate its heading position relative to `.comment-results`. Change only `.comment-results.scrollTop`, clamped between zero and `scrollHeight - clientHeight`; do not call `scrollIntoView`, so the Moodle document cannot move.
- Clear the record only after the matching group has been positioned successfully.
- Same-page comment navigation does not write arrival state. Ordinary comment refreshes with no matching arrival retain their existing scroll position.

## Verification

- Prove the storage helper safely overwrites, peeks, token-clears, expires, rejects malformed data, and tolerates unavailable or throwing storage.
- Prove navigation preparation messages and destination assignment remain unchanged; both a cross-page row and a cross-page heading write after successful preparation, while same-page actions do not write.
- Cover Moodle and SCORM logical destinations, including retaining the record through an initial response without the target and restoring it after a later matching response.
- Simulate a fresh overlay with non-zero list and heading rectangles. Verify the rebuilt list restores the stored Open/Resolved filter, expands the group, clamps and changes only `.comment-results.scrollTop`, consumes the record, and does not scroll the outer document.
- Prove overlay mount/startup never reads or consumes arrival state, storage exceptions never block navigation or rendering, and ordinary refreshes preserve the existing list scroll position when no matching record exists.
- Run the complete extension tests, type-check, production build, server tests, deployment-package tests, and release checksum verification.
