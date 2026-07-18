# Comment List Navigation Design

## Goal

Keep a long course comment list usable without allowing the review toolbox to extend beyond the browser viewport. Make course-wide feedback easier to narrow by page and expose common status and deletion actions directly in each list row.

## Interaction design

- The review shell remains within the viewport. Its toolbar and list controls stay visible while only the comment results area scrolls.
- Comment rows use a slightly smaller 14px type size and compact spacing.
- `Whole course` view shows an `All pages` select control populated from the pages represented in the loaded course comments. Options are identified by stored page URL, so pages with the same title remain distinct. Choosing a page filters the visible rows to that page.
- `Current page` view hides the page select because its scope is already limited to one page.
- The existing `Open` and `Resolved` filters continue to combine with the scope and page filters.
- Each row shows its stable course comment number and a shortened comment excerpt. The page title is not repeated when a specific page is selected.
- Clicking the row navigates to the stored page and anchor and opens the thread in context.
- A resolve/reopen icon and a delete icon appear at the right of a row when the comment capabilities allow those actions. Activating either icon does not navigate to the comment.
- Delete retains a confirmation prompt. Resolve or reopen refreshes the list immediately after the server accepts the change.

## Layout and accessibility

- The shell uses a viewport-relative maximum height and a column layout. The comment results region uses `overflow-y: auto` and a bounded height.
- Row actions have visible hover and focus states, accessible labels, and sufficiently large click targets despite their compact icon presentation.
- Page dropdown labels use the complete Moodle or SCORM page title. Long visible labels may be truncated by the browser, but their accessible name remains complete.
- An empty state explains when no comments match the selected scope, page, and status.

## Data and architecture

- No database or API changes are required. The page dropdown is derived from the existing course comment response (`page_url`, `page_title`, and embedded navigation metadata).
- The overlay owns list filtering and row rendering. Existing background messages for status changes and thread deletion are reused.
- The list refresh callback remains the single source of truth after a mutation so Moodle and SCORM use identical behavior.

## Error handling

- Failed resolve/reopen or deletion requests leave the row in place and show a concise inline error.
- A page selection that no longer has matching comments resets to `All pages` during refresh.
- Comments without a usable page title are grouped under `Untitled page` while retaining their stored URL for navigation.

## Verification

- Automated overlay tests cover viewport-bounded scrolling, dropdown visibility and filtering, combined status/page filters, action permissions, navigation suppression for row actions, successful status/deletion refresh, and mutation failures.
- Existing extension tests, type checking, and production build must pass.
- Manual browser verification checks a long Whole course list on Moodle and a SCORM page, including selecting a page, scrolling, resolving, deleting, and navigating to a comment.
