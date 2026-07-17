# Comment Controls and SCORM Navigation Design

Date: 18 July 2026  
Status: Approved design

## Purpose

Improve the whole-course comment list so it remains usable with many comments, communicates control state consistently, and opens comments inside Moodle-hosted SCORM packages without launching raw package files outside Moodle.

This is a targeted enhancement to the existing overlay and embedded-comment navigation system. It does not replace the overlay architecture or change role visibility rules.

## Approved visual design

The approved reference is the complete overlay mockup at:

`/Users/rcd58/OpenAI Projects/Beta Testing App/.superpowers/brainstorm/82512-1784237244/full-overlay.html`

The implementation must preserve Poppins and the existing UC Online overlay shell while applying these rules.

### Overlay shell and primary controls

- The overlay outer border is dark teal `#043e42` at 3 px.
- The overlay header remains the existing bright teal.
- Add comment marker, Comments, and Help use dark teal `#043e42` with 2 px borders.
- Inactive Add comment marker and Help controls have white interiors and dark-teal text or icon.
- Add comment marker becomes solid dark teal with white text only while marker-placement mode is active.
- Comments becomes solid dark teal with white text only while the comments panel is open.
- Help becomes solid dark teal with a white question mark only while Help is open.
- Hover temporarily inverts solid and outlined states without changing the actual selected state.
- The question mark is visually larger than its current version while remaining inside the existing square control.

### Filter controls

- Whole course, Current page, Open, Resolved, and Jump to have equal dimensions and never wrap onto two lines.
- Whole course and Current page use dark orange `#a84f12`.
- Open and Resolved use dark green `#176b43`.
- Solid with white text means selected.
- White with a 2 px semantic-colour border and semantic-colour text means unselected.
- Hover temporarily inverts the current presentation.
- Whole course and Current page remain a mutually exclusive pair.
- Open and Resolved remain a mutually exclusive pair.
- Jump to uses its existing blue family, is outlined while closed, and becomes solid only while its page menu is open.
- The separate `Page` label, native `All pages` presentation, and visible chevron are removed. The control label is `Jump to`.

Jump to is an accessible disclosure button with `aria-expanded` and `aria-controls`, followed by a single-select listbox. The button label always remains `Jump to`; the selected page is indicated inside the list. Enter, Space, or Arrow Down opens the list and focuses the current selection or first option. Arrow keys move through options, Enter or Space selects, Escape closes without changing the selection, and Tab closes while continuing normal focus order. Clicking outside closes the list and focus returns to the button when the menu is dismissed with Escape. Switching to Current page clears the page selection and closes the list. If refreshed course data no longer contains the selected page, selection returns to All pages.

### Comment-list layout

- The current course-section heading uses a slightly smaller size and a single-line ellipsis where required.
- The list has a bounded height and scrolls independently. The overlay header and filter controls remain visible.
- Whole-course results are visually grouped by Moodle page or embedded Rise lesson.
- Comment text is slightly smaller than the current list and remains a concise numbered link.
- Loaded-course numbering remains stable when filters change.
- Row spacing clearly separates adjacent action controls.

### Row actions

- Delete is a 34 px square red button using a large, unmistakable white filled-bin glyph. It is not an emoji.
- Delete hover and accessible labelling communicate `Delete comment`.
- Unresolved comments use a 34 px square checkbox: white interior, black 2 px outline, minimal corner radius, and no nested decorative box.
- Resolving requires confirmation: `Resolve this comment? It will move to the Resolved list.`
- After confirmation and a successful server response, the checkbox displays a loose, pen-drawn green tick for approximately three seconds before the row leaves the Open result set.
- To support that feedback, `changeStatus` performs and confirms the server mutation without refreshing the list. The overlay owns a transient row state, waits approximately three seconds, and then invokes a separate comments-refresh callback. Ordinary list updates during the interval must preserve the transient row until its timer completes.
- In the Resolved result set, the same checkbox displays the pen-drawn green tick and remains an actionable `Reopen comment` control when `capabilities.can_change_status` is true.
- Reopening requires confirmation: `Reopen this comment? It will move to the Open list.` After a successful response, the tick is removed, the unchecked row remains in the Resolved result set for approximately three seconds, and a polite status announcement says `Comment reopened. Moving to Open.` The overlay then refreshes and the row moves to Open. Pending and failure behaviour matches Resolve; cancellation makes no change.
- Resolve and Delete actions retain their current capability checks: controls appear only when the server says the current user may perform that action.

## Interaction and accessibility

- All stateful buttons expose `aria-pressed` or `aria-expanded` as appropriate.
- Button state is communicated by semantics as well as colour.
- Every icon-only control has an accessible name and a visible hover/focus indication.
- Keyboard focus remains visible and follows the same logical order as the visual layout.
- Confirmation can be cancelled without changing the comment.
- While a row mutation is pending, its action is disabled to prevent duplicate requests.
- Mutation failures leave the row in its prior state and show a concise status message beside that row.

## SCORM comment navigation

### Problem

Embedded Rise comments store the package content URL in `page_url`. Opening that URL directly launches `pluginfile.php/.../scormcontent/index.html` outside Moodle and produces `Content launched outside of a supported LMS environment.`

The stored comment also contains the information needed for safe navigation:

- `parent_activity_url`: the Moodle `/mod/scorm/player.php` URL
- `embedded_locator`: the Rise hash or root-relative lesson route
- comment ID and the anchor data required to reopen the thread in context

### Required navigation path

When a whole-course comment link is activated:

1. The overlay sends only the comment ID and stored page URL to the trusted extension background boundary.
2. The background reloads the course comment from the API and validates its course, origin, and navigation metadata.
3. For a normal Moodle page, navigation continues to the validated Moodle page URL.
4. For an embedded SCORM comment, the top-level tab navigates to `parent_activity_url`, never directly to the package `page_url`.
5. The navigation state machine waits for the elected SCORM worker in the newly loaded player.
6. The worker applies `embedded_locator` inside Rise.
7. Once the target lesson projection contains the comment, the marker/highlight is located, scrolled into view with fixed-header clearance, and its thread is opened.
8. The pending navigation record is consumed once and removed. Timeouts or stale course context fail safely without opening an untrusted or raw package URL.

The overlay remains open when the destination is already on the current page. Cross-page navigation may reload Moodle, after which the overlay automatically reopens the target thread from the pending navigation record.

### Boundary rules

- Raw `pluginfile.php` SCORM content URLs must never be assigned to the top-level Moodle window.
- Raw-package classification occurs before the normal same-origin page branch. A URL is treated as raw SCORM content when its path is under Moodle `pluginfile.php` and contains a `mod_scorm`/`scormcontent` package path. If an older comment has such a page URL but lacks the required `parent_activity_url` and `embedded_locator` pair, navigation stops with `This SCORM comment cannot be opened because its Moodle activity location is missing.` No top-level assignment or tab navigation occurs.
- Embedded navigation is accepted only from frame zero of a configured Moodle origin and for the currently bound course.
- `parent_activity_url` and `embedded_locator` remain a required pair.
- An embedded parent URL must be canonical HTTPS without credentials, share the configured Moodle origin, and have the exact pathname `/mod/scorm/player.php`. Query parameters are preserved because Moodle deployments may use them for activity/session identity. A fragment is permitted but does not replace or alter `embedded_locator`; it is treated only as part of the player URL. Any other same-origin pathname is rejected as an invalid embedded parent.
- Existing single-toolbar frame election remains unchanged.

Pending navigation survives extension worker restart or page reload only until context opening completes. The persisted states before player load, before locator application, and before context opening resume on reload. Once the target thread has opened, the pending record is consumed and removed; later reloads do not reopen it automatically.

## Implementation boundaries

The work should remain within the existing units:

- overlay rendering and CSS for control states and list layout;
- comment-row mutation handlers for resolve confirmation and temporary resolved feedback;
- the existing background comment-navigation boundary and embedded navigation state machine;
- tests and pilot version/release artefacts.

No server schema change is expected because embedded navigation metadata already exists. No unrelated refactor is included.

## Testing

### Automated

- Overlay tests for all active, inactive, hover-independent, expanded, and accessible states.
- Equal-size/no-wrap tests for the five filter controls.
- List grouping and bounded scrolling tests.
- Resolve/reopen confirmation tests for cancel, success, pending duplicate prevention, temporary tick, resolved-list persistence, failure recovery, and a fake-timer assertion that refreshes cannot remove the transient row before three seconds.
- Delete glyph/accessibility and row-spacing assertions.
- Navigation tests proving embedded comments choose `parent_activity_url` and never return the raw package URL as `destination_url`.
- Navigation tests proving legacy raw-package comments with incomplete metadata neither return `destination_url` nor trigger parent/tab navigation.
- Parent URL validation tests for the exact SCORM player pathname, origin, credentials, query preservation, fragment treatment, and rejection of arbitrary same-origin paths.
- State-machine tests for parent navigation, worker readiness, locator application, context opening, timeout, stale course, and one-time consumption.
- Restart/reload state tests before player load, before locator application, before context opening, and after one-time consumption.
- Existing extension, server, and deployment suites remain green.

### Manual Chrome and Edge pilot checks

- Verify all button states, hover inversion, focus indication, and non-wrapping labels at typical overlay widths.
- Open enough comments to prove only the comment-results region scrolls.
- Resolve and delete comments from both Current page and Whole course views.
- Navigate to Moodle-page comments and multiple Rise lessons within the same SCORM package.
- Confirm no direct `pluginfile.php` launch and no duplicate overlay/toolbox.
- Reload the SCORM player while navigation is still pending and confirm the pending state resumes and opens the correct comment.
- Reload after the target thread has opened and the pending record has been consumed; confirm the comment is not reopened automatically.

## Release

- Increment the extension pilot version and visible build/version label.
- Build the unpacked Chrome/Edge pilot folder and signed release artefacts using the existing release process.
- Publish to the existing Mac mini service only after automated verification passes.
- Record the release hash and provide the user with the exact version to reload for testing.
