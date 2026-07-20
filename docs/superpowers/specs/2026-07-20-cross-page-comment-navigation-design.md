# Cross-page comment navigation design

## Outcome

Previous and Next traverse the visible open-comment sequence for the whole course. When the adjacent comment is on another Moodle or SCORM page, the extension navigates there, restores the pending comment, scrolls to its anchor, and opens its thread.

## Behaviour

- The sequence contains only comments returned for the signed-in reviewer whose status is open.
- Course pages retain the established course ordering; comments on the loaded page retain recovered anchor order.
- Next from the final comment on a page selects the first comment on the following page. Previous is symmetric.
- Cross-page movement uses the same prepared-navigation path as a course comment link, including SCORM parent activity and embedded locator handling.
- Older SCORM comments that predate stored navigation metadata recover their previously observed Moodle player URL by package root. Their safe package entry path is used as the fallback locator; the raw SCORM file is never opened as a top-level page.
- Arrival consumes the pending comment once, then scrolls to and opens its recovered marker.
- A navigation failure leaves the current thread available and reports the existing navigation error.

## Verification

Add a regression test whose current page comments are deliberately supplied out of creation order. Open the last anchor-ordered comment, choose Next, and verify the next page/comment pair is prepared. Add recovery coverage for a legacy SCORM comment with a cached Moodle launch but no stored parent or locator. Retain the existing arrival tests that consume navigation and open the target in Moodle and SCORM.
