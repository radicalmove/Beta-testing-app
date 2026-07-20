# Navigation Recovery and Comment-List Headings Design

## Goal

Make Previous and Next visibly succeed or fail when crossing course-page boundaries, and simplify the whole-course comment list headings.

## Navigation behaviour

- Keep the existing whole-course, open-comment order and the existing Moodle/SCORM destination preparation.
- When a cross-page navigation request loses its extension response channel, refresh the current course binding and retry that navigation once.
- Do not retry validation, permission, missing-SCORM-location, or other substantive failures.
- If the retry also fails, keep the current comment open and show the error inside its contextual comment box. Previous and Next must never fail silently.
- Successful arrival continues to scroll to and open the requested comment using the existing pending-navigation record.

## Comment-list presentation

- Remove the duplicated current-page title above the Whole course, Current page, Open, Resolved, and Jump to controls.
- Keep page/activity group headings in whole-course view because they separate the comments by destination.
- Display each group heading through `coursePageJumpLabel`, which removes only a leading `Embedded activity ·` prefix while preserving the meaningful lesson name.
- Increase group headings from 11px to 13px while retaining their existing colour, uppercase treatment, spacing, and hidden-state rules.

## Error handling

The content script distinguishes a transient closed-message-channel failure from an application error. Only the transient case receives one rebind-and-retry attempt. The comment renderer catches a rejected cross-page callback and renders an accessible status message in the open popover.

## Verification

- A content-level test proves a closed navigation channel triggers one course rebind and one retry.
- A renderer test proves rejected Previous/Next navigation keeps the thread open and exposes an error status.
- Overlay tests prove the duplicate panel title is absent, group headings use cleaned labels, and the approved 13px styling is present.
- Existing Moodle/SCORM navigation, ordering, filter, and browser tests remain green.
