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

Comments within a group retain their server order. Canonical display numbers are assigned after the complete authoritative course projection is grouped and sorted. Those numbers remain stable when page or status filters change, so a filtered view may contain gaps. Numbers are recalculated only when authoritative course comments are added, removed, or move to a different course location.

## SCORM navigation

The current failure occurs because a bare `/mod/scorm/player.php` URL is not a complete launch target. Live inspection of CRJU150 confirmed that Moodle launches the player from `/mod/scorm/view.php?id=<cmid>` using a same-origin POST form containing `scoid`, `cm`, `currentorg`, and `mode`. An embedded comment must therefore retain or reconstruct a complete Moodle launch destination.

- The trusted top-frame document supplies the positive-integer Moodle course-module id from its `cmid-<number>` body class or existing explicit activity-id contract. The content script fetches the same-origin authenticated `/mod/scorm/view.php?id=<cmid>` document and accepts exactly one POST form whose action has the exact `/mod/scorm/player.php` pathname and no credentials.
- The accepted form must contain a positive-integer `scoid`, a positive-integer `cm` equal to the trusted cmid, a bounded non-empty `currentorg`, and an allowed bounded `mode`. These values are encoded as the complete player query while preserving the exact configured Moodle origin. No arbitrary form fields or destinations are accepted.
- At embedded comment creation, the complete player URL is stored in the existing `parent_activity_url`; `embedded_locator` remains its required pair. There is no server schema change.
- The extension also stores a bounded trusted mapping from course id plus embedded package identity to the complete player URL. Visiting a SCORM activity refreshes that mapping, allowing older comments with the same package identity and a bare player parent to be upgraded locally before navigation.
- Navigation retains the previously approved security and state-machine rules: exact same-origin HTTPS `/mod/scorm/player.php` path, no credentials, current configured Moodle origin and course checks, required `parent_activity_url`/`embedded_locator` pairing, background API reload reconstruction, one-time pending navigation, elected-worker wait, locator application, exact projection, and contextual thread opening.
- A bare player URL is never assigned to the top-level window. If a legacy comment lacks both a complete parent URL and a trusted local mapping, navigation stays on the current page and reports exactly `This SCORM comment cannot be opened because its Moodle activity location is missing.` No top-level assignment, tab navigation, or raw-package navigation occurs.
- Raw `pluginfile.php` package content remains prohibited as a top-level destination.

## Testing

- Computed-layout tests verify the approved colours, centred text, equal control dimensions, square Help control, and active/inactive states.
- List tests verify the fixed heading/filter region, scroll reset, natural course ordering, unnumbered-first behaviour, canonical numbering recalculation after authoritative additions, and stable numbering with allowed gaps across filters.
- Interaction tests verify Add comment marker toggles only with marker mode.
- SCORM tests reproduce the missing-`scoid` failure; validate the exact trusted view-page form contract; reject mismatched, incomplete, cross-origin, credentialed, or ambiguous forms; preserve the complete launch query through background restart; upgrade a legacy bare parent only from the bounded trusted package mapping; and confirm unrecoverable legacy records show the exact message without any navigation.
- The full extension, server, packaging, and browser-layout suites run before producing the next numbered pilot build.
