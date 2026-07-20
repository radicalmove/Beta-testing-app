# Keep Open Comments Visible During Marker Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep an already-expanded course comment list visible while the reviewer places a comment marker.

**Architecture:** Reuse the temporary marker instruction banner introduced in 0.4.61, but only hide comment content when the panel was collapsed before marker mode. Preserve the existing shared cleanup and saved per-course panel state.

**Tech Stack:** TypeScript, Shadow DOM, Happy DOM, Node test runner

---

### Task 1: Correct marker-mode list visibility

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay-focus.test.ts`

- [ ] Add a failing regression test proving an open list remains visible under the marker instruction banner.
- [ ] Run the focused overlay test and verify it fails because marker mode sets `panelContent.hidden = true` unconditionally.
- [ ] Change marker entry so content is hidden only when the panel was collapsed before marker mode.
- [ ] Verify open-panel, collapsed-panel, Cancel, Escape, refresh, and successful-placement tests.
- [ ] Commit the tested behavior.

### Task 2: Version, verify, and publish

**Files:**
- Modify the six established active version references from `0.4.61` to `0.4.62`.

- [ ] Run extension unit/type/browser tests, server tests, and deployment/release tests.
- [ ] Commit the release preparation, fast-forward to `main`, and rerun verification.
- [ ] Publish the signed `0.4.62` pilot build and verify its manifest, metadata, checksums, and service health.
