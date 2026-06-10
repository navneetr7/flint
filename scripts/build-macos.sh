#!/usr/bin/env bash
# Build Attune for macOS.
#
# Optional environment variables:
#   APPLE_SIGNING_IDENTITY  — "Developer ID Application: Your Name (TEAM_ID)"
#   APPLE_TEAM_ID           — Your 10-character Apple team ID
#   APPLE_ID                — Apple ID email for notarization
#   APPLE_ID_PASSWORD       — App-specific password (or "@keychain:AC_PASSWORD")
#
# Without signing vars the build produces an unsigned .app and .dmg,
# suitable for local testing. Set all four to produce a notarized release.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "→ Installing dependencies"
npm install

echo "→ Type-checking"
npm run typecheck

echo "→ Building Attune (macOS universal)"
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "  Signing as: $APPLE_SIGNING_IDENTITY"
  npm run tauri -- build \
    --target universal-apple-darwin \
    -- \
    --config "{\"bundle\":{\"macOS\":{\"signingIdentity\":\"$APPLE_SIGNING_IDENTITY\"}}}"
else
  echo "  No signing identity — building unsigned"
  npm run tauri -- build --target universal-apple-darwin
fi

DMG="$REPO_ROOT/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/Attune_*.dmg"
echo ""
echo "✓ Build complete."
# shellcheck disable=SC2086
ls -lh $DMG 2>/dev/null || echo "  (DMG not found — check target directory)"
