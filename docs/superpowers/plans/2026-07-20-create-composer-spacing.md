# Creation Composer Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clear 10px gap between the creation context preview and comment-entry field without changing Edit or Reply layouts.

**Architecture:** Add one adjacent-sibling style rule to the overlay creation dialog only and protect it with a focused structural style test.

**Tech Stack:** TypeScript, Shadow DOM, Happy DOM, Node test runner

---

### Task 1: Add targeted creation spacing

**Files:**
- Modify: `extension/src/overlay/root.ts`
- Test: `extension/tests/overlay-focus.test.ts`

- [ ] Add a failing assertion for `.preview + .comment-composer { margin-top: 10px; }`.
- [ ] Run the focused test and confirm it fails for the missing rule.
- [ ] Add the minimal scoped CSS rule.
- [ ] Run focused and full extension verification.

### Task 2: Version and publish

- [ ] Bump the six active version references from `0.4.62` to `0.4.63`.
- [ ] Run browser, server, and deployment/release verification.
- [ ] Fast-forward to `main`, publish the signed pilot build, verify metadata/checksums/health, and clean up the worktree.
