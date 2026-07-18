# Overlay Course Order and SCORM Launch Design

## Goal

Correct the regressions found in pilot 0.4.32 without redesigning the review workflow. The overlay must match the previously approved button system, keep its heading and first comment visible, list course locations in learning order, and open SCORM comments through a valid Moodle launch URL.

## Approved interface

- Keep the 3 px dark-teal outer border and bright-teal header.
- Add comment marker, Comments, and Help are square-cornered flat controls with 2 px dark-teal borders, white inactive interiors, and solid dark-teal active states. Hover inverts the current state.
- Add comment marker is solid only while marker placement is active. Comments is solid only while its list is open. Help is a square 44 px control with a centred, enlarged question mark and is solid only while Help is open.
- Whole course and Current page use dark orange `#a84f12`; Open and Resolved use dark green `#176b43`; Jump to uses blue `#356f9f`. All five controls are equal height, vertically and horizontally centred, and never wrap.
- The panel heading and filter row remain outside the independently scrolling `.comment-results` region. Opening or refreshing the list starts at its top, making the heading and comment `#1` visible.

## Course ordering and numbering

Whole-course comments are projected into course location groups before rendering. A natural numeric key is derived from the first visible section or lesson number in the page title, including dotted forms such as `1.1.1` and `1.3.1`. Numbered groups sort by their numeric components, not as strings. Unnumbered course-level locations such as Course information sort before Module 1. Stable URL/title fallbacks break ties.

Comments within a group retain their server order. Display numbers are assigned after course grouping and sorting, so numbering follows the visible course sequence and is recalculated whenever authoritative comments change. Filtering never introduces gaps in the currently displayed list.

## SCORM navigation

The current failure occurs because a bare `/mod/scorm/player.php` URL is not a complete launch target; Moodle requires launch state such as `scoid` and may also require other query parameters. An embedded comment must therefore retain or reconstruct a complete Moodle launch destination.

- At comment creation, capture the complete trusted Moodle SCORM launch URL when available, preserving its query and fragment.
- If the visible top URL is queryless, derive a supported launch destination from trusted Moodle activity metadata rather than storing the bare player path as navigable.
- Navigation validation permits only same-origin HTTPS Moodle SCORM launch routes and preserves all required query parameters.
- A bare player URL is never assigned to the top-level window. If a legacy comment lacks enough launch metadata, navigation stays on the current page and reports a precise recovery message.
- Raw `pluginfile.php` package content remains prohibited as a top-level destination.

## Testing

- Computed-layout tests verify the approved colours, centred text, equal control dimensions, square Help control, and active/inactive states.
- List tests verify the fixed heading/filter region, scroll reset, natural course ordering, unnumbered-first behaviour, and recalculated contiguous numbering.
- Interaction tests verify Add comment marker toggles only with marker mode.
- SCORM tests reproduce the missing-`scoid` failure, reject bare player URLs, preserve complete launch queries, and confirm legacy records fail safely without navigation.
- The full extension, server, packaging, and browser-layout suites run before producing the next numbered pilot build.
