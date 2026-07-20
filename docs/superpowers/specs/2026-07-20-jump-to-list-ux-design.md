# Jump-to and comment-list UX refinement

## Goal

Make the whole-course comment index and Jump-to menu easier to scan, consistently interactive, correctly ordered, and usable when the review panel occupies most of the viewport.

## Scope

This change affects only the course comment panel, Jump-to menu, Help button colour, Help dialog width, and persistence of the panel's expanded state. It must not alter stored comment data, comment visibility, status changes, SCORM launch/navigation targets, or contextual Previous/Next behaviour.

## Visual behaviour

### Help controls

- Jump to retains its existing blue colour and outlined/solid inversion states.
- Help uses a distinct plum colour with the same interaction convention: outlined with a white interior when closed, solid plum when open, and inverted on hover or keyboard focus.
- The Help dialog widens from its current narrow layout to `min(720px, calc(100vw - 32px))`. Existing small-screen constraints remain, and the dialog retains its viewport-bounded vertical scrolling.

### Comment and Jump-to links

- Whole-course comment entries no longer display dynamic `#1`, `#2`, and similar prefixes.
- Contextual threads retain `Comment x of y`; this remains the orientation cue for Previous and Next navigation across open course comments.
- Comment entries and Jump-to options have no text underline at rest.
- Both become underlined on hover and `:focus-visible` while retaining the established accessible focus outline.
- The comment body remains the concise visible label. Existing accessible names may retain fuller page, author, status, and comment context, but must not announce a removed list number.

### Course-specific panel state and animation

- Expanding or collapsing the comments panel stores that state in browser-local storage under a key derived from the canonical course URL.
- A newly mounted overlay restores the saved state for its current course. Moodle pages and SCORM activities belonging to the same course therefore retain the same panel state across navigation and browser restarts.
- Different courses use independent keys and do not inherit each other's panel state.
- Missing, malformed, or inaccessible browser storage falls back safely to the existing collapsed default and must not prevent the overlay from loading.
- User-triggered expansion and collapse animate height and opacity over approximately 180ms. The animation applies only to the comments panel, not to comment markers or contextual threads.
- The panel's `aria-expanded`, accessible label, focus behaviour, and hidden/inert state remain synchronized with the visible state throughout the transition.
- Under `prefers-reduced-motion: reduce`, the transition duration is removed and the state changes immediately.

## Jump-to labels and ordering

- The visible prefix `Embedded activity · ` is removed from Jump-to labels only. The full stored `page_title`, URL, and navigation metadata remain unchanged.
- Whitespace is normalized before display and comparison.
- Pages are grouped by their exact page URL, preserving separate destinations even when their visible titles match.
- Unnumbered course pages appear before numbered course content.
- Numbered titles are ordered hierarchically by their leading dotted number. For example: `1`, `1.1.1`, `1.1.2`, `1.2.1`, `2`, `2.1.1`.
- Within the unnumbered section, titles sort naturally and case-insensitively, with URL and first-seen position as deterministic tie-breakers.
- Number extraction for ordering uses the normalized visible label, so an embedded title such as `Embedded activity · 1.1.2 Sources of law` participates as `1.1.2 Sources of law`.
- `All pages` remains the first Jump-to option regardless of course-page ordering.

## Viewport-safe Jump-to menu

- Opening Jump to measures the trigger and viewport.
- The menu uses viewport-relative positioning while open rather than extending blindly above the review panel.
- Its top and bottom are clamped to an 8px viewport margin.
- The menu prefers opening above the trigger. If the available space above is insufficient, it uses the larger available side while remaining fully visible.
- The menu has its own vertical scrolling region. The first option and the selected option remain reachable, and opening focuses the selected option or `All pages` as it does now.
- Positioning is recalculated each time the menu opens. Existing click-outside, Escape, Tab, arrow-key, and selection behaviour remains unchanged.

## Testing

Regression tests must demonstrate:

1. Help uses plum while Jump to remains blue, and the Help dialog uses the wider responsive width.
2. Comment-list entries contain no dynamic number and are underlined only on hover/focus.
3. Contextual `Comment x of y` behaviour remains covered by the existing comment-renderer tests.
4. Jump-to labels omit `Embedded activity · ` without changing stored URLs.
5. `All pages` stays first, unnumbered pages precede numbered pages, and dotted numbers sort hierarchically.
6. Duplicate visible titles with different URLs remain separate options.
7. Opening Jump to applies viewport-clamped positioning and a scrollable maximum height, without breaking keyboard or outside-click closure.
8. Panel state is saved and restored independently by course, survives remounting, and fails safely when storage is unavailable or malformed.
9. Expansion and collapse expose synchronized accessibility state, use the short transition normally, and disable it under reduced-motion preferences.
