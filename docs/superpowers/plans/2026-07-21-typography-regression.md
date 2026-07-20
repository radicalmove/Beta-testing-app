# Typography Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore consistent Poppins SCORM typography, established button weight, and compact list-comment text while retaining larger group headings.

**Architecture:** Correct the renderer host’s inline typography reset at its source, remove the later control shorthand that overrides button weight, and scope list typography independently to headings and comment links. Preserve all existing behaviour and layout.

**Tech Stack:** TypeScript, Shadow DOM CSS, Node test runner, Playwright, Vite.

---

### Task 1: Lock the typography contract with regression tests

**Files:**
- Modify: `extension/tests/comment-renderer.test.ts`
- Modify: `extension/tests/overlay.test.ts`

- [ ] Replace the existing `embedded composer controls use the Poppins-first review font stack` test (which asserts the obsolete late shorthand) with this named renderer regression test:

```ts
test("standalone SCORM threads use the established Poppins typography and button weight", () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const renderer = createCommentRenderer(document, "https://learn.example/scorm/page");
  const host = document.querySelector<HTMLElement>("[data-moodle-review-renderer-root]")!;
  const css = host.shadowRoot!.querySelector<HTMLStyleElement>("style[data-comment-renderer-styles]")!.textContent!;
  assert.match(host.style.cssText, /font:\s*16px\s*\/\s*1\.5\s+Poppins,\s*Arial,\s*sans-serif/);
  assert.match(css, /button,textarea,input\{box-sizing:border-box;font:inherit\}/);
  assert.match(css, /button\{[^}]*font-weight:650/);
  assert.doesNotMatch(css, /button,textarea,input\{font:16px\/1\.5 Poppins,Arial,sans-serif\}/);
  renderer.destroy();
});
```

- [ ] Add this named overlay regression test beside the existing group-heading test:

```ts
test("comment rows stay compact while course-page headings remain prominent", () => {
  assert.match(approvedControlStyles, /\.comment-group-heading\{[^}]*font-size:13px/);
  assert.match(tealOverlayOverrides + approvedControlStyles, /\.comment-index-link\{[^}]*font-size:12px[^}]*line-height:1\.3/);
});
```
- [ ] From `extension/`, run `node --test --test-concurrency=1 tests/comment-renderer.test.ts tests/overlay.test.ts`. Expected: FAIL only on the new host, late-shorthand, and compact-link assertions.

### Task 2: Apply the minimal typography corrections

**Files:**
- Modify: `extension/src/comment-renderer.ts`
- Modify: `extension/src/overlay/root.ts`

- [ ] In `createThreadRoot`, change the host style to `all:initial;...;font:16px/1.5 Poppins,Arial,sans-serif;color:#102f38` without modifying positioning declarations.
- [ ] Delete `rendererControlFontStyles` and inject only `rendererStyles` in both renderer-root paths; retain the existing `button,textarea,input{...font:inherit}` and button `font-weight:650` declarations.
- [ ] Add `font-size:12px;line-height:1.3` to `.comment-index-link`; do not alter `.comment-group-heading`, dimensions, colours, spacing, states, or navigation code.
- [ ] From `extension/`, rerun `node --test --test-concurrency=1 tests/comment-renderer.test.ts tests/overlay.test.ts`. Expected: all targeted tests PASS.
- [ ] Run `git diff --check` and `git diff -- extension/src/comment-renderer.ts extension/src/overlay/root.ts extension/tests/comment-renderer.test.ts extension/tests/overlay.test.ts`. Confirm the source diffs contain only the three typography changes and the test diffs contain only their regression coverage.

### Task 3: Version, verify, merge, and publish

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `tests/test_deployment_package.py`
- Modify: `docs/pilot-test-script.md`

- [ ] From `extension/`, run `npm version 0.4.69 --no-git-tag-version`, then update exact version assertions and the pilot test script from 0.4.68 to 0.4.69.
- [ ] From `extension/`, run `npm run typecheck && npm test && npm run test:e2e`. Expected: typecheck succeeds, 384 unit tests pass, and 7 Playwright flows pass.
- [ ] From repository root, run `python3 -m pytest tests -q`. Expected: 40 packaging/release tests pass.
- [ ] Run `git diff --check`, then `git add docs/pilot-test-script.md docs/superpowers/specs/2026-07-21-typography-regression-design.md docs/superpowers/plans/2026-07-21-typography-regression.md extension/e2e/version-layout.spec.ts extension/package-lock.json extension/package.json extension/src/comment-renderer.ts extension/src/overlay/root.ts extension/tests/build-config.test.ts extension/tests/comment-renderer.test.ts extension/tests/overlay.test.ts tests/test_deployment_package.py` and `git commit -m 'fix: restore compact review typography'`. Leave the unrelated root `package-lock.json` untracked.
- [ ] From repository root, run `git worktree add --detach .worktrees/release-0.4.69 main`, then from `.worktrees/release-0.4.69/extension` run `npm ci`.
- [ ] From `.worktrees/release-0.4.69/`, run `PRIVATE_KEY_PATH='/Users/rcd58/.config/moodle-review/pilot-extension.pem' REVIEW_SERVICE_ORIGIN='https://fld-mini.tail4ccaba.ts.net' deploy/scripts/release-pilot-extension.sh`. Expected: its internal 384 extension, 170 server, and 21 deployment tests pass and signed 0.4.69 checksums verify.
- [ ] Run `python3 -c 'import json,subprocess; from pathlib import Path; p=Path("/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension/RELEASE.json"); d=json.loads(p.read_text()); assert d["version"]=="0.4.69"; assert d["commit"]==subprocess.check_output(["git","rev-parse","main"],text=True).strip()'`, `(cd '/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds' && shasum -a 256 -c SHA256SUMS)`, and `curl -fsS https://fld-mini.tail4ccaba.ts.net/health`. Expected: metadata assertions succeed, every checksum reports `OK`, and health returns `{"status":"ok"}`.
- [ ] Run `git worktree remove .worktrees/release-0.4.69` from repository root.
