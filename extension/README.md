# Moodle Course Review extension

Manifest V3 bootstrap for the private review service. The placeholder hosts are intentionally unusable; a pilot build must provide its approved origins:

```sh
MOODLE_HOST_PATTERNS=https://moodle.pilot.example/* \
REVIEW_SERVICE_ORIGIN=https://review.tailnet-name.ts.net \
OPTIONAL_FRAME_PATTERNS=https://approved-rise.example/* \
BUILD_MODE=production \
EXTENSION_PUBLIC_KEY='<store-owned-public-key>' \
npm run build
```

`MOODLE_HOST_PATTERNS` and `OPTIONAL_FRAME_PATTERNS` accept comma-separated Chrome match patterns. Do not use `<all_urls>`. Rise/SCORM hosts stay optional and should be requested with `chrome.permissions.request` only when a reviewer opens that content. The review-service setting accepts HTTPS origins and HTTP loopback only for local development.

## Stable browser identity

The manifest contains a build-owned **public** key so unpacked Chrome builds retain one extension ID. Its private key was discarded and must never be committed. For a distributed build, use the Chrome Web Store identity (or inject its public key through `EXTENSION_PUBLIC_KEY`) and register exactly:

`https://<chrome-extension-id>.chromiumapp.org/`

in the server `EXTENSION_REDIRECT_URIS` allow-list. Edge distribution has a distinct store ID; add its exact `chromiumapp.org` redirect as a second allow-list entry. Never allow wildcard redirect URIs. After changing distribution identity, load the build and copy the redirect returned by `chrome.identity.getRedirectURL()` into server configuration.

Authentication opens `/extension/authorize` with that redirect, exchanges the one-time callback code at `/extension/token`, and stores only the API token plus its local expiry in `chrome.storage.session`. API requests explicitly omit dashboard cookies.
The callback must use the exact Chrome identity redirect origin and path. The server binds and consumes each authorization code once, preventing replay during token exchange.

The default build is an explicitly non-production example build with unusable placeholder hosts and a placeholder public key. `BUILD_MODE=production` rejects those placeholders and invalid service origins or Chrome match patterns.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

Load `dist/` as an unpacked extension. No private key or real pilot hostname belongs in this repository.
