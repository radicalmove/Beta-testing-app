# Pilot extension versioning design

## Goal

Make it immediately clear which Moodle Course Review pilot build a reviewer has installed.

## Version source and policy

`extension/package.json` is the single source of truth. The current corrected pilot becomes `0.2.0`. `package-lock.json` must match it. `public/manifest.json` carries a fixed `0.0.0` placeholder that is never a release version; the build always overwrites it and validates the generated manifest against `package.json`. Backwards-compatible fixes increment the patch component (`0.2.1`); a new testable feature set increments the minor component (`0.3.0`). Major version `1.0.0` is reserved for an approved production release.

Versions contain exactly three decimal integer components with no signs, empty components, or leading zeroes except the value `0`. Every component is between 0 and 65535, satisfying Chromium manifest constraints.

## Visible surfaces

- Chrome and Edge extension details display the manifest version.
- The overlay header displays `Pilot v<version>` as readable text at normal width and retains an accessible full label at 320 CSS px and 200% zoom even if the visible label is compacted.
- The review panel includes keyboard- and screen-reader-readable semantic version and short Git commit for support diagnostics, with WCAG AA contrast and no overlap with controls.
- `RELEASE.json` records the semantic version and exact Git commit.
- The release set contains `moodle-review-extension-v<version>-chrome-edge.zip`; the existing `moodle-review-extension-chrome-edge.zip` remains a stable compatibility alias within the same atomic release set.
- `SHA256SUMS` covers the versioned ZIP, unpacked files, and release metadata.

The stable unpacked delivery path remains `moodle-review-extension` so existing installation instructions do not change. Existing operations/tests that consume the stable ZIP name continue to work. The atomic `current` release pointer exposes the unpacked folder, both ZIP names, checksums, and metadata as one coherent version.

## Safety and testing

Build configuration validates the format and component bounds and injects the value into both manifest and content script. Release requires a clean tracked/untracked source tree under the existing release policy, and `RELEASE.json` records the version, exact commit, and artifact digest. Publishing refuses to reuse an existing semantic version for different commit/content; an identical repeat is allowed and deterministic. Tests prove every visible surface and artifact uses the same value, exercise 320 CSS px/200% zoom semantics, reject source/lock/generated-manifest drift and version collisions, retain the stable alias, and verify deterministic release output. No private key, token, credential, or dirty-state ambiguity is included in version metadata.
