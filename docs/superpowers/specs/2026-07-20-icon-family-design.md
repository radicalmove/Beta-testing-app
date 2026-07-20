# Existing Icon Controls: Family Design

## Goal

Make the extension's existing icon-only controls feel like one coherent family without adding icons to controls that currently use text.

The supplied Shutterstock image is visual inspiration only. Its artwork will not be copied or distributed.

## Scope

Replace the existing Save, Edit, Delete, and Help symbols with original local SVG icons. Retain the existing hand-drawn green Resolve tick unchanged. Do not add icons to Comments, Reply, Previous, Next, course/status filters, Jump to, or other text controls.

## Visual system

Each new icon uses:

- a `24 × 24` view box;
- an approximately `2px` outline;
- rounded line caps and joins;
- simple, recognisable geometry;
- `currentColor` for every visible stroke or fill;
- no embedded bitmap, SVG mask, external resource, icon font, or runtime dependency.

The family consists of:

- **Save:** an outlined floppy disk with a top label/notch and lower inset panel;
- **Edit:** an outlined diagonal pencil;
- **Delete:** an outlined lidded rubbish bin with three internal vertical lines;
- **Help:** an outlined circle containing a question mark;
- **Resolve:** the current hand-drawn green tick, unchanged.

The icon must remain legible at the existing `34 × 34px` button size. Button dimensions, semantic colours, selected states, hover inversion, delayed tooltip text, accessible names, focus behaviour, and action behaviour remain unchanged.

## Architecture

Create one focused UI icon module that exposes typed constructors or markup helpers for the four family members. Both the main overlay and contextual comment renderer consume that module instead of maintaining separate inline path definitions. SVG elements remain fully local to the extension's Shadow DOM.

The module owns geometry only. Button classes continue to own colour, sizing, hover, focus, and disabled states through `currentColor`.

## Accessibility and error handling

Icons are decorative because their containing buttons already have accessible names and tooltips. Every SVG therefore receives `aria-hidden="true"`. No text label is removed and no icon is the sole programmatic name of an action.

Because the icons are inline vector paths, rendering does not depend on page CSP rules, extension URLs, image decoding, masks, network access, or installed fonts.

## Verification

Tests will verify:

- all four controls use the shared icon family;
- each icon uses the common view box and `currentColor`;
- no icon uses an image, mask, external URL, or icon font;
- Resolve retains its existing hand-drawn tick;
- accessible names and tooltip text remain present;
- existing hover, focus, creation, editing, reply, deletion, Help, Moodle, and SCORM behaviours remain intact.

The production extension, end-to-end Moodle/SCORM suite, server suite, and pilot-package checks must pass before release.
