# Comment-list page groups design

## Goal

Make a long whole-course comment list easier to scan without changing comment
data, filters, anchor recovery, or Moodle/SCORM navigation.

## Behaviour

- Within each page or SCORM group, comments appear in their saved physical
  anchor order. A group is exactly one `page_url`; a Moodle-hosted SCORM
  activity is therefore one group, not a separate group per Rise lesson/tab.
  The currently loaded page uses recovered renderer anchor ranks. Other pages
  retain the server's stable source order until they are opened and their local
  ranks are available; existing deterministic fallbacks apply when a rank is
  unavailable.
- Each group heading contains a page-navigation link. It opens the group’s
  first currently visible comment through the existing navigation callback,
  preserving the established Moodle and SCORM recovery path.
- A separate chevron button expands or collapses that group. Its accessible
  label and `aria-expanded` state describe the group it controls.
- Groups start expanded whenever the list is freshly rendered; collapsed state
  is intentionally not persisted.
- The former `Jump to` control initially reads `Collapse all`. Pressing it
  collapses all visible groups and changes its label to `Expand all`; pressing
  `Expand all` expands all visible groups and returns the label to `Collapse
  all`. It occupies the same control position and dimensions.
- Individual group chevrons never change the main control’s label or mode. The
  control is disabled in Current page scope and when no Whole course groups
  match the current filters.

## Filtering and navigation

- Status and scope filters continue to decide which comment rows are visible.
  A group with no visible rows remains hidden.
- Group headings and their chevrons remain a Whole course presentation. Current
  page scope keeps its existing flat list with no redundant heading.
- Collapsing is a presentation state only: it never alters filters, comment
  ordering, selected page state, or stored comments.
- Heading navigation uses the group page URL plus the first visible comment id,
  rather than direct URL assignment, so an SCORM activity can still launch,
  restore Rise state, and scroll to the saved context.
- The heading destination is selected from status/scope-filter matching comments
  before collapse state is applied, so a collapsed group remains navigable.

## Implementation boundaries

- Keep sorting in the existing course-comment projection path so list order,
  contextual Previous/Next ordering, and filters share one deterministic
  ordering source.
- Keep group disclosure state local to the rendered overlay list.
- Remove the Jump-to menu, its outside-click handling, and its associated
  styles/tests as part of this replacement; no page selector remains.

## Verification

Add focused overlay tests for physical order, heading navigation, per-group
disclosure, Collapse all/Expand all labelling, filtering interaction, and
accessible button state. Run the extension unit/typecheck suite and browser
E2E suite before release.
