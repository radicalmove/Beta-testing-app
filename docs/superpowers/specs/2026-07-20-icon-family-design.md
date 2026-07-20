# Existing Icon Controls: Family Design

## Goal

Make the extension's existing icon-only controls feel like one coherent family without adding icons to controls that currently use text.

The supplied Shutterstock image is visual inspiration only. Its artwork will not be copied or distributed.

## Scope

Replace the existing Save, Edit, Delete, and Help symbols with original local SVG icons. Retain the existing hand-drawn green Resolve tick unchanged. Do not add icons to Comments, Reply, Previous, Next, course/status filters, Jump to, or other text controls.

## Visual system

Each new icon uses:

- a `24 × 24` view box;
- `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, and `stroke-linejoin="round"` unless a primitive below explicitly sets `fill="currentColor"`;
- rounded line caps and joins;
- simple, recognisable geometry;
- `currentColor` for every visible stroke or fill;
- no embedded bitmap, SVG mask, external resource, icon font, or runtime dependency.

The approved geometry is:

- **Save:** `<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>`;
- **Edit:** `<path d="M4 20l4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10z"/><path d="m14.5 7.5 3 3M5.5 16l3 3"/>`;
- **Delete:** `<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>`;
- **Help:** `<circle cx="12" cy="12" r="9"/><path d="M9.75 9a2.4 2.4 0 1 1 3.38 2.2c-.75.36-1.13.9-1.13 1.8"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>`;
- **Resolve:** the current hand-drawn green tick, unchanged.

The `24 × 24` view box supplies at least three coordinate units of optical padding around the primary silhouette. The paths above are the implementation contract; they are not to be replaced with traced Shutterstock paths or approximate Unicode glyphs.

The icon must remain legible at the existing `34 × 34px` button size. Button dimensions, semantic colours, selected states, hover inversion, delayed tooltip text, accessible names, focus behaviour, and action behaviour remain unchanged.

## Architecture

Create one focused UI icon module that exposes typed constructors or markup helpers for the four family members. Both the main overlay and contextual comment renderer consume that module instead of maintaining separate inline path definitions. SVG elements remain fully local to the extension's Shadow DOM.

The module owns geometry only. Button classes continue to own colour, sizing, hover, focus, and disabled states through `currentColor`.

## Accessibility and error handling

Icons are decorative because their containing buttons already have accessible names and tooltips. Every SVG therefore receives `aria-hidden="true"`. No text label is removed and no icon is the sole programmatic name of an action.

The exact replacement sites and preserved button contracts are:

| Surface | Icon | Preserved contract |
| --- | --- | --- |
| Initial comment creation | Save | `aria-label="Save comment"`, `title="Save comment"`, existing `data-save` selector |
| Edit composer | Save | `aria-label="Save edited comment"`, `title="Save edited comment"`, existing `data-save-edit` selector |
| Reply composer | Save | `aria-label="Save reply"`, `title="Save reply"`, existing `data-save-reply` selector |
| Contextual thread | Edit | `aria-label="Edit original comment"`, `title="Edit comment"`, existing `aria-pressed` false/true editing state |
| Contextual thread | Delete | `aria-label="Delete thread"`, `title="Delete comment thread"` |
| Whole-course comment row | Delete | dynamic `aria-label` and `title` of `Delete comment {course index}` |
| Toolbar | Help | `aria-label="Help and instructions"`, `title="Help and instructions"`, existing `aria-expanded` false/true dialog state |

Resolve controls are deliberately excluded from replacement and keep their current hand-drawn tick geometry and labels.

Because the icons are inline vector paths, rendering does not depend on page CSP rules, extension URLs, image decoding, masks, network access, or installed fonts.

## Verification

Tests will verify:

- all seven replacement sites use the shared icon family: three Save modes, contextual Edit, contextual Delete, whole-course-row Delete, and toolbar Help;
- each icon uses the common view box and `currentColor`;
- no icon uses an image, mask, external URL, or icon font;
- Resolve retains its existing hand-drawn tick;
- accessible names and tooltip text remain present;
- Edit and Help retain their existing `aria-pressed` and `aria-expanded` state transitions;
- Comments, Reply, Previous, Next, filters, Jump to, and other text-only controls do not gain SVG children;
- existing hover, focus, creation, editing, reply, deletion, Help, Moodle, and SCORM behaviours remain intact.

The production extension, end-to-end Moodle/SCORM suite, server suite, and pilot-package checks must pass before release.
