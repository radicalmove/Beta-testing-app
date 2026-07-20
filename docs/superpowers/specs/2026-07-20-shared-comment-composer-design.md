# Shared Comment Composer Design

## Goal

Make initial comment creation, editing, and replying use the same visual composition pattern while retaining the controls unique to each context.

## Design

- Use the supplied solid floppy-disk silhouette for Save through one shared icon helper. The approved SVG contract is `viewBox="0 0 24 24"` with a single even-odd path: `M5 2h12l5 5v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm2 1v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4.4L16.6 3H7Zm1 13v6h8v-6H8Zm3-13v5h4V3h-4Z` and `fill-rule="evenodd"`. This captures the rounded solid silhouette, top label recess, small upper notch, and lower label opening shown in the supplied reference.
- Save is a 34 × 34 icon button, matching contextual `.thread-delete` (not the 40 × 40 course-list Delete), with an accessible label and delayed native tooltip.
- The textarea and Save button share one row. Save's right edge aligns with the right edge of the bottom-right Cancel button.
- The attachment field sits immediately below the editing row in Create, Edit, and Reply modes.
- Cancel uses the established red outlined/solid interaction style and sits on its own bottom row at the right.
- The exact active-mode sequence is: textarea + Save row → attachment → contextual navigation slot → Cancel row. Edit and Reply populate the navigation slot with Previous, Reply, and Next. Create omits that slot. Initial creation retains its heading and context preview around this sequence.
- In initial creation only, the context preview and composer are separated by 10px of white space. This spacing is scoped to a composer immediately following `.preview` so Edit and Reply layouts do not change.

## Implementation Boundary

Create a shared composer layout/style contract rather than three visually similar but independent implementations. A shared icon module provides the approved SVG to both `comment-renderer.ts` and `overlay/root.ts`. Shared class names and grid geometry define the textarea/Save row and right-aligned Cancel row in both Shadow DOM style contexts. The overlay creation dialog may retain its modal structure, but its composer controls use the same dimensions, alignment, icon, colours, hover behaviour, tooltip behaviour, and ordering as contextual Edit and Reply.

The composer has a single 34px right-hand action column. Save occupies this column in the first row. The Cancel row spans the full composer width and right-aligns Cancel to the same outer boundary, so their right edges remain identical at normal and narrow viewport widths.

## Behaviour and Accessibility

- Saving, cancelling, attachment validation, mutation error display, and focus restoration retain their existing behaviour.
- Save buttons expose context-specific accessible labels: `Save comment`, `Save edited comment`, and `Save reply`.
- Icon-only Save buttons use matching `title` text for the delayed browser tooltip.
- Cancel remains a text button and uses consistent font, size, height, and centring in every mode.

## Verification

- Renderer tests verify Edit and Reply child order, shared classes, 34px dimensions, button ordering, tooltip labels, and use of the approved icon path.
- Overlay tests verify that initial creation uses the same child order/classes and approved icon helper.
- Overlay style tests verify the targeted 10px gap between the creation context preview and composer.
- Structural assertions verify the shared 34px action column and common right-alignment boundary for Save and Cancel, including the existing narrow responsive layout.
- Existing attachment, save, cancel, focus, Moodle, and SCORM tests must remain green.
