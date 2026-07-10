#!/usr/bin/env bash
set -euo pipefail
: "${PRIVATE_KEY_PATH:?Set PRIVATE_KEY_PATH to an RSA private key outside the repository}"
: "${REVIEW_SERVICE_ORIGIN:?Set REVIEW_SERVICE_ORIGIN=https://host.tailnet.ts.net}"
case "$PRIVATE_KEY_PATH" in "$PWD"/*) echo "private key must be outside repository" >&2; exit 1;; esac
[[ $REVIEW_SERVICE_ORIGIN == https://*.ts.net ]] || { echo "origin must be Tailscale HTTPS" >&2; exit 1; }
public_der=$(mktemp)
trap 'rm -f "$public_der"' EXIT
openssl rsa -in "$PRIVATE_KEY_PATH" -pubout -outform DER -out "$public_der"
EXTENSION_PUBLIC_KEY=$(openssl base64 -A -in "$public_der") \
MOODLE_HOST_PATTERNS='https://my.uconline.ac.nz/*' \
OPTIONAL_FRAME_PATTERNS="${OPTIONAL_FRAME_PATTERNS-}" \
REVIEW_SERVICE_ORIGIN="$REVIEW_SERVICE_ORIGIN" BUILD_MODE=production npm --prefix extension run build
echo "Built extension/dist. Keep PRIVATE_KEY_PATH secure and never commit it."
