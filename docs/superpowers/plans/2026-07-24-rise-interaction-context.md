# Rise Interaction Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new comment created inside a supported Rise Tabs or Process interaction remember, display, and safely restore its exact tab or step before locating and scrolling to the comment.

**Architecture:** Add one shared, exact-keyed TypeScript interaction-context contract and a matching Pydantic/JSON database contract. The elected SCORM worker captures context with the anchor, the existing one-use capability cryptographically binds it through comment creation, and comment navigation adds a bounded interaction-restoration phase before ordinary renderer recovery. Existing comments remain nullable and unchanged.

**Tech Stack:** TypeScript, Chrome Manifest V3, DOM/ARIA semantics, Happy DOM, Node test runner, Python 3.12, FastAPI, Pydantic, SQLAlchemy, Alembic, PostgreSQL/SQLite tests, Playwright, Vite.

---

## File map

- Create `extension/src/rise-interaction-context.ts`: exact v1 types, validation, normalisation, Tabs/Process capture, and safe restoration.
- Create `extension/tests/rise-interaction-context.test.ts`: focused DOM fixtures for capture, validation, duplicate/mismatch rejection, activation, and delayed rendering.
- Modify `extension/src/scorm-protocol.ts`: transport nullable interaction context with captured anchors and add a restore-interaction command.
- Modify `extension/src/scorm-worker.ts`: cache selection context, capture marker context, restore projected-comment context, and clear stale state.
- Modify `extension/src/embedded-anchor-capabilities.ts`: bind interaction context into the issued capability and canonical digest.
- Modify `extension/src/background-bridge.ts`: include context in create/list contracts and preserve worker authority during embedded creation.
- Modify `extension/src/background.ts`: send the new restoration command from the navigation state machine.
- Modify `extension/src/embedded-comment-navigation.ts`: insert an interaction-restoring retry phase between projection readiness and context opening.
- Modify `extension/src/overlay/root.ts`: display tab/step metadata beneath new comment excerpts.
- Modify `extension/src/overlay/styles.css`: style the secondary interaction label.
- Modify associated extension tests under `extension/tests/`.
- Create `server/alembic/versions/20260724_12_rise_interaction_context.py`: nullable JSON column with no backfill.
- Modify `server/app/models.py`: map `PageLocation.interaction_context`.
- Modify `server/app/schemas.py`: exact discriminated v1 models and 4096-byte canonical limit.
- Modify `server/app/services/comments.py`: persist validated context.
- Modify `server/app/routers/comments.py`: accept and project context.
- Modify server comment tests under `server/tests/`.
- Modify extension version files and release expectations for pilot `0.5.13`.
- Verify and publish through the existing `deploy/scripts/release-pilot-extension.sh` workflow into the external pilot-builds delivery folder.

### Task 1: Define and persist the server interaction-context contract

**Files:**
- Create: `server/alembic/versions/20260724_12_rise_interaction_context.py`
- Modify: `server/app/models.py`
- Modify: `server/app/schemas.py`
- Modify: `server/app/services/comments.py`
- Modify: `server/app/routers/comments.py`
- Test: `server/tests/test_comment_creation.py`
- Test: `server/tests/test_course_comment_routes.py`

- [ ] **Step 1: Write failing schema tests**

Add tests that submit valid `tabs` and `process` v1 objects and assert exact preservation. Add parametrized rejection tests for extra keys, unknown versions/kinds, blank or overlong strings, invalid ordinal/count ranges, `item.ordinal > item.count`, and canonical JSON larger than 4096 bytes. Assert `interaction_context=None` remains valid for ordinary and legacy comments.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd server
python3 -m pytest tests/test_comment_creation.py tests/test_course_comment_routes.py -q
```

Expected: FAIL because `interaction_context` is not accepted, persisted, or projected.

- [ ] **Step 3: Implement exact Pydantic v1 models**

In `server/app/schemas.py`, add exact-forbid models for:

```python
class RiseInteractionContainer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    block_id: str | None = Field(default=None, max_length=200)
    ordinal: int = Field(ge=1, le=100)
    fingerprint: str = Field(min_length=1, max_length=300)

class RiseInteractionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ordinal: int = Field(ge=1, le=100)
    count: int = Field(ge=1, le=100)
    label: str = Field(min_length=1, max_length=300)
    control_key: str | None = Field(default=None, max_length=200)

class RiseInteractionContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    kind: Literal["tabs", "process"]
    container: RiseInteractionContainer
    item: RiseInteractionItem
```

Validate normalised nonblank strings, `item.ordinal <= item.count`, kind-specific `control_key` requirements, and canonical compact UTF-8 JSON length `<= 4096`. Add nullable `interaction_context` to `CommentCreateRequest`.

- [ ] **Step 4: Add the nullable JSON database column**

Create Alembic revision `20260724_12` with `down_revision = "20260715_11"` and:

```python
op.add_column("page_locations", sa.Column("interaction_context", sa.JSON(), nullable=True))
```

Downgrade drops only that column. Map it in `PageLocation` as `Mapped[dict | None] = mapped_column(JSON)`.

- [ ] **Step 5: Persist and project the validated value**

Thread `interaction_context: dict | None` through `create_comment`, copy the validated Pydantic value using `model_dump(mode="json")`, store it on `PageLocation`, and include it in `_page_comment_json`. Do not infer or backfill context for existing records.

- [ ] **Step 6: Validate stored JSON again at the response boundary**

Use the same exact `RiseInteractionContext` model to validate and serialize
non-null stored JSON inside `_page_comment_json`. Add a route test that inserts
malformed or stale JSON directly into `PageLocation.interaction_context` and
asserts the response fails closed instead of returning unvalidated interaction
data. Valid stored values return the canonical model dump; null remains null.

- [ ] **Step 7: Run focused and complete server tests**

Run:

```bash
cd server
python3 -m pytest tests/test_comment_creation.py tests/test_course_comment_routes.py -q
python3 -m pytest -q
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/alembic/versions/20260724_12_rise_interaction_context.py server/app/models.py server/app/schemas.py server/app/services/comments.py server/app/routers/comments.py server/tests/test_comment_creation.py server/tests/test_course_comment_routes.py
git commit -m "feat: persist Rise interaction context"
```

### Task 2: Build the isolated Rise interaction adapter

**Files:**
- Create: `extension/src/rise-interaction-context.ts`
- Create: `extension/tests/rise-interaction-context.test.ts`

- [ ] **Step 1: Write failing contract-validation tests**

Test exact keys and bounds matching the server models. Include nullable handling, Unicode whitespace normalisation, canonical serialized size, and rejection of extra keys and unsafe control identities.

- [ ] **Step 2: Write failing Tabs capture tests**

Build a fixture with a supported Rise tabs container, two tab controls, two owned panels, a stable `data-block-id`, an accessible/heading fingerprint, and a target in the second panel. Assert capture returns:

```ts
{
  version: 1,
  kind: "tabs",
  container: { block_id: "tabs-1", ordinal: 1, fingerprint: "Constitution types" },
  item: { ordinal: 2, count: 2, label: "Unwritten (uncodified)", control_key: "panel-unwritten" },
}
```

Also test fingerprint precedence and omission when no valid fingerprint exists.

- [ ] **Step 3: Write failing Process capture tests**

Model the observed Rise markup: `[role=region][aria-label=Carousel]`, `.carousel-slide[role=group]`, and `.carousel-controls-item-btn[aria-label="Go to slide N"]`. Assert a target in slide 3 captures its block identity, `3 of 5`, heading label, and control key.

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
cd extension
node --test tests/rise-interaction-context.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 5: Implement minimal capture and validation**

Export:

```ts
export type RiseInteractionContext = /* exact v1 shape */;
export function validateRiseInteractionContext(value: unknown): RiseInteractionContext | null;
export function captureRiseInteractionContext(target: Node, document: Document): RiseInteractionContext | null;
export function interactionContextLabel(context: RiseInteractionContext): string;
```

Use semantic control/panel ownership and the deterministic fingerprint sources from the spec. Do not use arbitrary selector strings or search outside the nearest supported Rise block.

- [ ] **Step 6: Run adapter tests**

Run:

```bash
cd extension
node --test tests/rise-interaction-context.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/rise-interaction-context.ts extension/tests/rise-interaction-context.test.ts
git commit -m "feat: capture Rise interaction context"
```

### Task 3: Bind context securely through SCORM comment creation

**Files:**
- Modify: `extension/src/scorm-protocol.ts`
- Modify: `extension/src/scorm-worker.ts`
- Modify: `extension/src/embedded-anchor-capabilities.ts`
- Modify: `extension/src/background-bridge.ts`
- Test: `extension/tests/scorm-protocol.test.ts`
- Test: `extension/tests/scorm-worker.test.ts`
- Test: `extension/tests/embedded-anchor-capabilities.test.ts`
- Test: `extension/tests/background-bridge.test.ts`
- Test: `extension/tests/background.test.ts`

- [ ] **Step 1: Write failing protocol and worker tests**

Assert `SCORM_ANCHOR_CAPTURED` accepts exactly one nullable `interaction_context` key for both anchor types. Test marker capture from a Tabs panel and highlight capture from Process step 3. Test that highlight context is captured during `selectionchange`, survives until `SCORM_START_SELECTION`, and clears with selection collapse, page identity change, or worker destruction.

- [ ] **Step 2: Write failing capability integrity tests**

Issue a capability with context, mutate any context field in stored state, and assert claim fails. Assert a successful claim returns the originally captured context and that storage contains no comment body.

- [ ] **Step 3: Write failing bridge tests**

Assert `handleCreateEmbeddedCommentBridge` adds only `claim.interactionContext` to `interaction_context`; the frame-zero message cannot supply or overwrite it. Assert null remains null for comments outside supported interactions.

- [ ] **Step 4: Run focused tests and verify failure**

Run:

```bash
cd extension
node --test tests/scorm-protocol.test.ts tests/scorm-worker.test.ts tests/embedded-anchor-capabilities.test.ts tests/background-bridge.test.ts tests/background.test.ts
```

Expected: FAIL on the new context assertions.

- [ ] **Step 5: Extend the protocol and worker**

Add `interaction_context: RiseInteractionContext | null` to both captured-anchor payload shapes and exact-key validation. Change cached selection state to:

```ts
type CachedSelection = {
  anchor: TextAnchor;
  interactionContext: RiseInteractionContext | null;
};
```

Capture context from `range.commonAncestorContainer` while the Range is live. Capture marker context from `event.target`. Emit both only through the elected worker event.

- [ ] **Step 6: Bind context into the one-use capability**

Add `interactionContext` to `EmbeddedAnchorBinding`, validate it with the shared validator, and include a canonical exact-shape serialization in `canonicalBinding`. In `issueEmbeddedAnchorFromWorker`, remove the context from the anchor spread and store it as its own binding member.

- [ ] **Step 7: Preserve authority at the create bridge**

Add optional `interaction_context` to `EmbeddedCreateCommentPayload` and create/list types. In `handleCreateEmbeddedCommentBridge`, construct it exclusively from `claim.interactionContext`; continue accepting only capability, body, category, and screenshot intent from frame zero.

- [ ] **Step 8: Run focused tests and type checking**

Run:

```bash
cd extension
node --test tests/scorm-protocol.test.ts tests/scorm-worker.test.ts tests/embedded-anchor-capabilities.test.ts tests/background-bridge.test.ts tests/background.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add extension/src/scorm-protocol.ts extension/src/scorm-worker.ts extension/src/embedded-anchor-capabilities.ts extension/src/background-bridge.ts extension/tests/scorm-protocol.test.ts extension/tests/scorm-worker.test.ts extension/tests/embedded-anchor-capabilities.test.ts extension/tests/background-bridge.test.ts extension/tests/background.test.ts
git commit -m "feat: bind Rise context to embedded comments"
```

### Task 4: Restore Tabs and Process state safely

**Files:**
- Modify: `extension/src/rise-interaction-context.ts`
- Modify: `extension/src/scorm-protocol.ts`
- Modify: `extension/src/scorm-worker.ts`
- Test: `extension/tests/rise-interaction-context.test.ts`
- Test: `extension/tests/scorm-protocol.test.ts`
- Test: `extension/tests/scorm-worker.test.ts`

- [ ] **Step 1: Write failing safe-restoration tests**

For Tabs, assert restoration resolves the exact container, verifies fingerprint/count/ordinal/label/ownership, clicks the exact tab control once, and reports ready only after the owned panel is active and visible. For Process, assert the same against slide 3 and `Go to slide 3`.

- [ ] **Step 2: Write failing rejection and retry tests**

Cover duplicate block IDs, wrong fingerprints, changed item counts, reordered or relabelled items, missing controls, duplicate controls, arbitrary `control_key` values, and content not yet rendered. Mismatches must never click. Not-yet-rendered valid context must return `INTERACTION_NOT_READY` so navigation can retry.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
cd extension
node --test tests/rise-interaction-context.test.ts tests/scorm-protocol.test.ts tests/scorm-worker.test.ts
```

Expected: FAIL because restoration and its command are absent.

- [ ] **Step 4: Implement restoration**

Export:

```ts
export type RestoreRiseInteractionResult = "ready" | "not-ready" | "mismatch";
export function restoreRiseInteractionContext(
  context: RiseInteractionContext,
  document: Document,
): RestoreRiseInteractionResult;
```

Follow the spec’s strict resolution order. Use the exact supported control’s `.click()` only after every relationship check. Verify active state using `aria-selected`/owned-panel visibility for Tabs and `aria-current`/slide `hidden` state for Process.

- [ ] **Step 5: Add `SCORM_RESTORE_INTERACTION`**

Add a command with payload `{ comment_id: string }`. The worker must look up that ID only in its validated projected `PageComment` map, return success immediately for `interaction_context === null`, call the adapter for new comments, and return distinct `INTERACTION_NOT_READY` or `INTERACTION_MISMATCH` errors without opening the comment.

- [ ] **Step 6: Run focused tests and type checking**

Run:

```bash
cd extension
node --test tests/rise-interaction-context.test.ts tests/scorm-protocol.test.ts tests/scorm-worker.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/rise-interaction-context.ts extension/src/scorm-protocol.ts extension/src/scorm-worker.ts extension/tests/rise-interaction-context.test.ts extension/tests/scorm-protocol.test.ts extension/tests/scorm-worker.test.ts
git commit -m "feat: restore Rise tabs and process steps"
```

### Task 5: Add interaction restoration to comment navigation

**Files:**
- Modify: `extension/src/embedded-comment-navigation.ts`
- Modify: `extension/src/background.ts`
- Test: `extension/tests/background.test.ts`
- Test: `extension/tests/background-frame-coordination.test.ts`
- Test: `extension/tests/content.test.ts`

- [ ] **Step 1: Write failing navigation-state tests**

Add `interaction-restoring` to `EmbeddedNavigationState`. Assert the order:

```text
parent/cover → locator → identity → projection → interaction restoration → takeToContext
```

Test same-SCORM, normal-page-to-SCORM, and SCORM-to-different-SCORM navigation. Assert delayed `INTERACTION_NOT_READY` retains the record and retries. Assert a newer navigation cancels stale retries. Assert null context succeeds without clicking.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd extension
node --test tests/background.test.ts tests/background-frame-coordination.test.ts tests/content.test.ts
```

Expected: FAIL because navigation currently goes directly from projection to context opening.

- [ ] **Step 3: Add the restoration dependency and state**

Extend `EmbeddedCommentNavigation` dependencies with:

```ts
restoreInteraction(tabId: number, commentId: string): Promise<void>;
```

In `openWhenProjected`, persist `interaction-restoring`, call it, and only then persist `context-opening` and call `takeToContext`. Let the existing bounded exponential retry handle not-ready errors. Treat mismatch as a safe unresolved/manual-location outcome, never as permission for a generic click.

Only `INTERACTION_NOT_READY` is retryable. Add a distinct terminal mismatch
path in `advance`: on `INTERACTION_MISMATCH`, cancel the retry timer, remove the
pending navigation record, make no further restoration or context-opening calls
for that navigation generation, and surface the manual-location message to
frame zero. Test that advancing again finds no pending navigation. Do not
classify generic transport or worker-loading failures as a mismatch.

- [ ] **Step 4: Wire the background command**

Extend `navigationCommand` and the frame coordinator to support `SCORM_RESTORE_INTERACTION`, map `INTERACTION_NOT_READY` to a retryable error, and keep `INTERACTION_MISMATCH` visible as a precise manual-location failure.

- [ ] **Step 5: Run focused tests, all extension unit tests, and type checking**

Run:

```bash
cd extension
node --test tests/background.test.ts tests/background-frame-coordination.test.ts tests/content.test.ts
npm test
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/embedded-comment-navigation.ts extension/src/background.ts extension/tests/background.test.ts extension/tests/background-frame-coordination.test.ts extension/tests/content.test.ts
git commit -m "feat: restore Rise state before comment scrolling"
```

### Task 6: Show tab and process labels in the comment list

**Files:**
- Modify: `extension/src/background-bridge.ts`
- Modify: `extension/src/overlay/root.ts`
- Modify: `extension/src/overlay/styles.css`
- Test: `extension/tests/background-bridge.test.ts`
- Test: `extension/tests/overlay.test.ts`

- [ ] **Step 1: Write failing response and overlay tests**

Assert page-comment validation accepts only null or exact valid context. Render new comments and expect:

```text
Tab: Unwritten (uncodified)
Step 3 of 5: Criminal justice agencies
```

Assert old/null comments have no secondary line, labels wrap, and accessible button names include the interaction label without changing controls or ordering.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd extension
node --test tests/background-bridge.test.ts tests/overlay.test.ts
```

Expected: FAIL because the response contract and list metadata do not exist.

- [ ] **Step 3: Implement response validation and rendering**

Add `interaction_context: RiseInteractionContext | null` to the exact `PageComment` keys and validate it with the shared validator. In `setCommentList`, append a dedicated `.comment-interaction-label` span inside the comment button when context exists and include the same label in `aria-label`.

- [ ] **Step 4: Add minimal styles**

Give the secondary label a block layout, smaller readable size, current teal-family contrast, and normal wrapping. Do not truncate the label or alter row action alignment.

- [ ] **Step 5: Run focused and complete extension tests**

Run:

```bash
cd extension
node --test tests/background-bridge.test.ts tests/overlay.test.ts
npm test
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background-bridge.ts extension/src/overlay/root.ts extension/src/overlay/styles.css extension/tests/background-bridge.test.ts extension/tests/overlay.test.ts
git commit -m "feat: label Rise interaction comments"
```

### Task 7: Add end-to-end regression coverage

**Files:**
- Modify: `extension/e2e/stateful-comment-backend.ts`
- Modify: `extension/e2e/comment-flow.spec.ts`
- Modify: `extension/tests/fixtures/uco/scorm-player.html`

- [ ] **Step 1: Extend the stateful fixture**

Make the fixture persist and return `interaction_context`. Add representative Tabs and Process markup with hidden inactive panels/slides and delayed rendering hooks.

- [ ] **Step 2: Write failing E2E scenarios**

Cover:

- create highlight comment in Tabs tab 2, switch to tab 1, select from list, verify tab 2 activates and comment scrolls into view;
- create marker comment on Process step 3, return to step 1, select from list, verify step 3 activates and marker/context opens;
- delay the interaction block after lesson load and verify retries eventually restore it;
- create a comment outside an interaction and verify unchanged navigation;
- feed a mismatched context and verify no unrelated control is clicked.

- [ ] **Step 3: Run E2E and verify failure**

Run:

```bash
cd extension
npm run test:e2e -- --grep "Rise interaction context"
```

Expected: FAIL on restoration and/or fixture persistence before implementation adjustments.

- [ ] **Step 4: Complete fixture and integration adjustments**

Make only the smallest production or fixture corrections needed for the scenarios. Do not add legacy-comment discovery.

- [ ] **Step 5: Run targeted and complete E2E**

Run:

```bash
cd extension
npm run test:e2e -- --grep "Rise interaction context"
npm run test:e2e
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/e2e/stateful-comment-backend.ts extension/e2e/comment-flow.spec.ts extension/tests/fixtures/uco/scorm-player.html
git commit -m "test: cover Rise interaction navigation"
```

### Task 8: Prepare, verify, and publish pilot 0.5.13

**Files:**
- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/tests/build-config.test.ts`
- Modify: `extension/e2e/version-layout.spec.ts`
- Modify: `tests/test_deployment_package.py`
- Generated externally: `/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/`

- [ ] **Step 1: Update version expectations to 0.5.13**

Change `extension/package.json`, both version fields in
`extension/package-lock.json`, and the build/E2E/deployment expectations from
`0.5.12` to `0.5.13`. Leave `extension/public/manifest.json` at its intentional
`0.0.0` source placeholder; the production build derives the real version from
the package. Do not change the stable manifest public key.

- [ ] **Step 2: Run the complete automated gate**

Run:

```bash
cd extension
npm test
npm run typecheck
npm run build
npm run test:e2e
cd ..
python3 -m pytest server/tests -q
python3 -m pytest tests/test_deployment_package.py tests/test_release_artifacts.py -q
git diff --check
```

Expected: all tests PASS, type checking succeeds, and the production build completes.

- [ ] **Step 3: Inspect the release diff and commit**

Confirm only intended source, tests, migration, already committed plan/spec,
and version files are included; preserve unrelated user files and changes.

```bash
git add extension/package.json extension/package-lock.json extension/tests/build-config.test.ts extension/e2e/version-layout.spec.ts tests/test_deployment_package.py
git commit -m "release: prepare pilot 0.5.13"
```

- [ ] **Step 4: Re-run verification from the committed source**

Run the complete automated gate again and confirm `git status --short` contains no implementation changes. The release publisher derives identity from `HEAD`.

- [ ] **Step 5: Publish with the existing signed release workflow**

From the repository root, run `deploy/scripts/release-pilot-extension.sh` with the existing approved `PRIVATE_KEY_PATH` and `REVIEW_SERVICE_ORIGIN` environment supplied by the operator. This is the only step that writes outside the repository.

Expected: a new immutable `v0.5.13-*` directory, refreshed `current` link, unpacked extension, stable ZIP alias, versioned ZIP, `RELEASE.json`, and `SHA256SUMS` under `/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds`.

- [ ] **Step 6: Verify release identity and artifact equality**

Verify:

- unpacked and ZIP manifests report `0.5.13`;
- manifest key equals the previous release key;
- `RELEASE.json` commit equals tested `HEAD`;
- every `SHA256SUMS` entry verifies;
- current unpacked files equal the immutable release copy;
- stable and versioned ZIP hashes are identical.

- [ ] **Step 7: Perform the short browser acceptance check**

Reload `/Users/rcd58/OpenAI Projects/Beta Testing App-pilot-builds/moodle-review-extension` in Chrome, then verify one new Tabs comment and one new Process step-3 comment show their labels, reactivate the correct item, and scroll/open correctly. Confirm an ordinary Moodle comment and a non-interaction Rise comment still navigate normally.
