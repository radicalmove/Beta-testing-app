# SCORM Reload Binding Race Design

## Goal

Ensure an embedded SCORM review worker connects after a fresh Moodle activity reload, even when the embedded frame starts before the top Moodle document has bound its course context to the tab.

## Root cause

Embedded workers already retry the temporary `Review context unavailable` response. In the live reload race, the background instead returns `Course is not bound to tab`. The worker treats that wording as permanent and stops registering, leaving the toolbar on the parent-page fallback.

## Decision

Classify both responses as temporary review-context startup conditions. Use the same classification in initial frame registration and active-worker context acquisition. Retain the existing attempt limit, delay, security checks, and all permanent-error behaviour.

## Verification

- A regression test must first fail when the initial context response is `Course is not bound to tab`.
- The focused content tests must pass after the minimal retry change.
- The full extension unit and build checks must remain green.
- A fresh live SCORM reload must reach `Add comment marker`, allow a real click inside Rise to open the comment composer, and show only one toolbar.
