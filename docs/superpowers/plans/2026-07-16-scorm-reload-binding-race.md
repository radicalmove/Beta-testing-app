# SCORM Reload Binding Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make embedded SCORM workers recover when they start before Moodle binds the course to the tab.

**Architecture:** Keep the existing top-toolbar and elected-worker design. Add one narrow transient-error classifier and use it in both context retry paths.

**Tech Stack:** TypeScript, Node test runner, Happy DOM, Manifest V3 extension.

---

### Task 1: Reproduce and fix the context-binding race

**Files:**
- Modify: `extension/tests/content.test.ts`
- Modify: `extension/src/content.ts`

- [ ] Add a regression test where `GET_REVIEW_CONTEXT` first returns `Course is not bound to tab`, then succeeds.
- [ ] Run the focused content test and confirm it fails because only one context request occurs.
- [ ] Add a small shared predicate that recognises both temporary startup messages.
- [ ] Use the predicate in frame registration and active-worker acquisition.
- [ ] Run the focused test and full extension unit, typecheck, and build checks.
- [ ] Build the pilot extension and retest a fresh live SCORM reload, marker click, cancellation, single toolbar, and browser errors.
