# Shared Comment Composer Design

## Goal

Make initial comment creation, editing, and replying use the same visual composition pattern while retaining the controls unique to each context.

## Design

- Use the supplied solid floppy-disk silhouette for Save. Render it as a code-native SVG so its colour follows the existing green Save button and remains sharp at every display scale.
- Save is a 34 × 34 icon button, matching Delete, with an accessible label and delayed native tooltip.
- The textarea and Save button share one row. Save's right edge aligns with the right edge of the bottom-right Cancel button.
- The attachment field sits immediately below the editing row in Create, Edit, and Reply modes.
- Cancel uses the established red outlined/solid interaction style and sits on its own bottom row at the right.
- Edit and Reply retain Previous, Reply, and Next navigation above Cancel. Initial creation retains its heading and context preview but uses the same textarea, Save, attachment, and Cancel layout.

## Implementation Boundary

Create a shared composer layout/style contract rather than three visually similar but independent implementations. The overlay creation dialog may use its existing modal structure, but its composer controls must use the same dimensions, alignment, icon, colours, hover behaviour, tooltip behaviour, and ordering as the contextual Edit and Reply composers.

## Behaviour and Accessibility

- Saving, cancelling, attachment validation, mutation error display, and focus restoration retain their existing behaviour.
- Save buttons expose context-specific accessible labels: `Save comment`, `Save edited comment`, and `Save reply`.
- Icon-only Save buttons use matching `title` text for the delayed browser tooltip.
- Cancel remains a text button and uses consistent font, size, height, and centring in every mode.

## Verification

- Renderer tests verify identical Edit and Reply composer structure, dimensions, button ordering, tooltip labels, and alignment hooks.
- Overlay tests verify that initial creation follows the same composer structure and control styling.
- Existing attachment, save, cancel, focus, Moodle, and SCORM tests must remain green.
