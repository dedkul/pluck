#!/bin/bash
# Builds the zip people download from GitHub Releases: dist/Pluck-<version>-<platform>.zip
# Inside: the Pluck extension (with that platform's tools), an installer, and "READ ME FIRST.txt".
# Run scripts/fetch-tools.sh <platform> first. Runs on a Mac.
#
#   scripts/package.sh mac
#   scripts/package.sh win
set -euo pipefail

PLATFORM="${1:-}"
[[ "$PLATFORM" == "mac" || "$PLATFORM" == "win" ]] || { echo "Usage: scripts/package.sh mac|win"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"

# The version lives in two places; a release with them out of sync would nag people to update forever.
VERSION="$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$EXT/CSXS/manifest.xml")"
grep -q "version: \"$VERSION\"" "$EXT/main.js" || { echo "Version mismatch: manifest.xml says $VERSION, main.js doesn't. Update both."; exit 1; }
[[ -d "$EXT/bin/$PLATFORM" ]] || { echo "No tools in extension/bin/$PLATFORM. Run scripts/fetch-tools.sh $PLATFORM first."; exit 1; }

NAME="Pluck-$VERSION-$PLATFORM"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
OUT="$STAGE/$NAME"
mkdir -p "$OUT/Pluck/bin"

rsync -a --exclude bin --exclude .debug --exclude .DS_Store "$EXT/" "$OUT/Pluck/"
ditto "$EXT/bin/$PLATFORM" "$OUT/Pluck/bin/$PLATFORM"

if [[ "$PLATFORM" == "mac" ]]; then
  cp "$ROOT/installer/Install Pluck.command" "$ROOT/installer/READ ME FIRST.txt" "$OUT/"
else
  # Windows tools expect Windows line endings.
  for f in "Install Pluck.bat" "READ ME FIRST.txt"; do sed 's/$/'$'\r''/' "$ROOT/installer/$f" > "$OUT/$f"; done
fi

mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/$NAME.zip"
ditto -c -k --norsrc --noextattr --keepParent "$OUT" "$ROOT/dist/$NAME.zip"
echo "Built dist/$NAME.zip ($(du -h "$ROOT/dist/$NAME.zip" | cut -f1))"
