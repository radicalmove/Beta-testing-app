# Comment-list page groups design

## Goal

Make a long whole-course comment list easier to scan without changing comment
data, filters, anchor recovery, or Moodle/SCORM navigation.

## Behaviour

- Within each page or SCORM group, comments appear in their saved physical
  anchor order. Existing deterministic fallbacks apply when an anchor rank is
  unavailable.
- Each group heading contains a page-navigation link. It opens the group’s
  first currently visible comment through the existing navigation callback,
  preserving the established Moodle and SCORM recovery path.
- A separate chevron button expands or collapses that group. Its accessible
  label and `aria-expanded` state describe the group it controls.
- Groups start expanded whenever the list is freshly rendered; collapsed state
  is intentionally not persisted.
- The former `Jump to` control becomes `Collapse all`. It collapses all
  visible groups and changes its label to `Expand all`; using it again expands
  all visible groups. It occupies the same control position and dimensions.

## Filtering and navigation

- Status and scope filters continue to decide which comment rows are visible.
  A group with no visible rows remains hidden.
- Collapsing is a presentation state only: it never alters filters, comment
  ordering, selected page state, or stored comments.
- Heading navigation uses the group page URL plus the first visible comment id,
  rather than direct URL assignment, so an SCORM activity can still launch,
  restore Rise state, and scroll to the saved context.

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
