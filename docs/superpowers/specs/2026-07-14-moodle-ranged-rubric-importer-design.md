# Moodle Ranged Rubric Importer Design

**Date:** 14 July 2026  
**Status:** Approved design

## Purpose

Build a Chrome and Microsoft Edge extension that imports an Excel rubric into Moodle's Ranged Rubric editor. The extension should reproduce the useful workflow of Moodle Rubric Importer while supporting the `gradingform_rubric_ranges` plugin instead of Moodle's standard fixed-score rubric.

The first release must work without a Moodle server installation. It will run only on Moodle sites for which the user has granted extension access.

## Scope

The first release will:

- Recognize supported Ranged Rubric definition pages.
- Add an **Import Excel** control to the editor.
- Accept `.xlsx` workbooks only.
- Parse a two-row-per-criterion spreadsheet layout.
- Show a complete preview and validation results before changing Moodle.
- Import only when the editor contains no user-created rubric content.
- Populate Moodle through its existing criterion and level controls.
- Support Chrome and Microsoft Edge with the same Manifest V3 package.
- Keep all workbook data in the browser.

The first release will not:

- Import into an existing user-created rubric.
- Accept CSV, pasted tables, or legacy `.xls` files.
- Install or call a Moodle server plugin.
- Submit or save the Moodle form automatically.
- Support fractional or negative range boundaries.
- Attempt to edit a page whose Ranged Rubric markup is not recognized.

## User Experience

When a supported Ranged Rubric definition page loads, the extension adds an **Import Excel** button beside the rubric controls. The button stays hidden on standard rubric pages and any page the extension cannot identify confidently.

Selecting a workbook opens an extension-owned dialog. The dialog displays:

- The workbook and first worksheet name.
- A header-row offset control.
- The number of detected criteria and levels.
- A preview table containing criterion descriptions, level descriptions, and score ranges.
- Validation errors tied to workbook rows and cells.
- **Cancel** and **Import into Moodle** actions.

The import action remains disabled until the workbook is valid and the Moodle editor is empty. The extension rechecks the editor immediately before making changes.

During import, the dialog reports progress criterion by criterion. On success, it tells the user to review the populated rubric and use Moodle's normal **Save as draft** or **Save rubric and make it ready** action. The extension never submits the grading form.

## Workbook Format

The first worksheet uses two rows for each criterion. Blank rows may precede the data, and the user can set the number of rows to skip.

| Column A | Column B | Column C | Column D |
| --- | --- | --- | --- |
| Legal analysis | Limited | Competent | Excellent |
|  | 0-2 | 3-4 | 5-6 |
| Use of authority | Inadequate | Effective | Exceptional |
|  | 0-2 | 3-4 | 5-6 |

For each criterion pair:

- The first cell of the upper row contains the criterion description.
- Subsequent cells in the upper row contain level descriptions.
- Cells in the lower row contain the corresponding inclusive score ranges.
- The first completely empty criterion pair ends the rubric.
- The first empty level-description cell ends that criterion's levels.

The parser will accept a hyphen or en dash between range boundaries and will ignore surrounding whitespace.

## Ranged Score Mapping

Ranged Rubric stores each level's upper score and derives the displayed lower boundary from the previous level. The importer therefore validates the full ranges from Excel but enters only their upper endpoints into Moodle.

For example:

| Excel range | Value entered into Moodle |
| --- | ---: |
| 0-2 | 2 |
| 3-4 | 4 |
| 5-6 | 6 |

The normalized model retains both boundaries so that the preview and errors match the workbook rather than Moodle's internal representation.

## Validation

Validation completes before Moodle is changed. A workbook is invalid when it contains any of the following:

- A missing criterion description.
- A missing level description or corresponding range.
- A nonnumeric, reversed, negative, or fractional boundary.
- Overlapping or gapped ranges.
- A first range whose lower boundary is not zero.
- A later range whose lower boundary is not one point above the preceding upper boundary.
- Fewer than two levels for a criterion.
- Duplicate upper scores within a criterion.
- Data after an empty level cell in the same criterion.
- No criteria after applying the header-row offset.

Validation messages identify the worksheet and relevant cell or row. The dialog presents all detected workbook errors together so the user can correct them in one pass.

## Architecture

The extension separates the workflow into four components with narrow interfaces.

### Workbook Reader

The workbook reader accepts a user-selected `.xlsx` file and returns worksheet cell values. It performs no Moodle operations and makes no network requests.

### Rubric Parser and Validator

The parser converts cell values and the selected row offset into a normalized rubric:

```text
Rubric
  criteria[]
    description
    sourceRow
    levels[]
      description
      minimum
      maximum
      sourceCells
```

It returns either this model or a collection of structured validation errors. It has no dependency on browser-extension APIs or Moodle markup.

### Moodle Page Adapter

The adapter is the only component that knows Moodle's page structure. It:

- Detects a supported `gradingform_rubric_ranges` definition editor.
- Distinguishes Moodle's automatic blank starter controls from user-created content.
- Snapshots any verified blank starter controls before reusing them.
- Adds and removes criteria and levels using Moodle's visible controls.
- Fills criterion descriptions, level descriptions, and upper scores.
- Waits for each dynamic field to exist before continuing.
- Tracks elements created during the current import.

Selectors should prefer stable field names, data attributes, and accessible labels over theme-specific classes or visible layout. Version-specific selector differences belong inside this adapter, allowing additional adapters to be introduced later without changing parsing or dialog behavior.

### Import Dialog

The dialog owns file selection, worksheet metadata, offset selection, preview rendering, validation feedback, confirmation, progress, and the final result. Its markup and styles are isolated from Moodle themes.

## Data Flow

1. The content script asks the page adapter whether the current document is a supported Ranged Rubric editor.
2. If supported, it mounts the import button once.
3. The user selects an `.xlsx` workbook.
4. The workbook reader reads the first worksheet locally.
5. The parser produces either a normalized rubric or validation errors.
6. The dialog renders the preview and any errors.
7. On confirmation, the page adapter rechecks that the editor is empty.
8. The adapter creates and fills criteria and levels sequentially.
9. The dialog reports success and leaves saving to Moodle.

No workbook data is transmitted, persisted in extension storage, or retained after the dialog closes.

## Failure Handling and Rollback

All parsing errors leave Moodle untouched. Import-time failures may occur when Moodle's markup changes, a dynamic control does not appear, or the user changes the editor during import.

The adapter records every criterion and level it creates and snapshots the values and structure of any verified blank starter controls that it reuses. If an import-time operation fails, it attempts to remove recorded additions in reverse order and restore the starter controls to their original blank state. It must not alter any other pre-existing controls. Rollback is complete only when both removal and starter-state restoration are confirmed. The dialog then reports:

- The criterion and level being processed.
- A plain-language reason for the failure.
- Whether rollback completed successfully.
- A recommendation to reload the page before retrying when rollback could not be confirmed.

An unsupported or ambiguous editor is a safe failure: the extension does not display the import button and does not alter the page.

## Permissions and Privacy

The Manifest V3 extension will request site access as optional host permission. Users grant access to each Moodle origin they want to use rather than receiving a package with one institution's domain hard-coded.

The extension requires no account, analytics, remote service, or workbook upload. It should request only the permissions needed for optional site access and local extension operation. Workbook contents exist only in memory for the lifetime of the open import dialog.

## Compatibility

The packaged extension targets current Chrome and Microsoft Edge. The page adapter will be tested against representative Moodle 4 and Moodle 5 Ranged Rubric fixtures. Compatibility means that the extension can confidently detect the editor, recognize its empty state, and create the expected criteria, levels, descriptions, and upper scores.

The initial pilot will include the University of Canterbury Moodle configuration shown in the supplied screenshots. Compatibility with one theme must not be achieved through institution-specific selectors.

## Testing

### Parser and Validator Tests

- Valid workbooks with and without header offsets.
- Hyphen and en-dash range syntax.
- Whitespace normalization.
- Different level counts between criteria.
- Empty workbook and empty first worksheet.
- Missing descriptions or ranges.
- Invalid, negative, fractional, reversed, overlapping, or gapped ranges.
- Data after an empty level cell.
- Criteria with fewer than two levels.
- Duplicate upper scores.

### Page Adapter Tests

- Supported editor detection and rejection of standard rubrics.
- Idempotent button mounting.
- Blank starter-row recognition.
- Rejection of user-created content.
- Criterion and level creation.
- Correct field population and event dispatch.
- Dynamic-control timeouts.
- Tracking and rollback of created controls.
- Restoration of reused starter controls to their original blank state after a mid-import failure.
- Safe behavior for ambiguous or unsupported markup.

### Integrated Extension Tests

- File selection through successful preview.
- Import disabled for invalid data or a nonempty editor.
- Progress and completion states.
- Failure reporting and rollback outcome.
- No automatic form submission.
- No workbook persistence or network transmission.

### Manual Pilot Checks

- Load the unpacked package in Chrome and Edge.
- Grant access to the pilot Moodle origin.
- Import a small and a large workbook on the University of Canterbury Ranged Rubric editor.
- Review the resulting rubric before saving it as a draft.
- Confirm the saved rubric displays the expected inclusive ranges.

## Acceptance Criteria

The first release is complete when a teacher can grant access to a Moodle site, open an empty Ranged Rubric definition page, select a valid `.xlsx` workbook, verify a faithful preview, and populate the Moodle editor with matching criteria, descriptions, and inclusive score ranges. Invalid workbooks or unsupported pages must not cause partial or silent Moodle edits, and saving the rubric must remain an explicit Moodle action.
