# Typography Regression Design

## Goal

Restore the established compact review-tool typography without changing layout, colours, controls, or behaviour.

## Design

- Give the standalone SCORM comment-renderer host an explicit Poppins-first font declaration so its inline reset cannot fall back to a serif browser default.
- Remove the late control-wide font shorthand that resets the established button typography. Renderer buttons remain 16 px with weight 650; textareas and inputs continue to inherit the renderer typography.
- Keep course-page group headings at their newer 13 px size while setting individual `.comment-index-link` text explicitly to compact 12 px with a 1.3 line height.
- Preserve all existing button dimensions, colours, spacing, interaction states, and navigation behaviour.

## Verification

- Regression tests assert the SCORM host typography and the established 16 px/650 button typography.
- Overlay style tests assert larger group headings and smaller comment-link text independently.
- Run type checking, the complete extension unit suite, browser-flow tests, and packaging tests before release.
