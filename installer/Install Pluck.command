#!/bin/bash
# Installs Pluck into Premiere Pro on a Mac. Double-click it (see "READ ME FIRST.txt" if macOS blocks it).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.dedkul.pluck"

if [[ ! -f "$HERE/Pluck/CSXS/manifest.xml" ]]; then
  echo "Can't find the Pluck folder next to this file. Unzip the download first, then run this again."
  exit 1
fi

echo "Installing Pluck…"
# Pluck isn't signed by Adobe yet, so Premiere has to be told to load it.
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
ditto "$HERE/Pluck" "$DEST"
# macOS marks downloaded files as "from the internet" and would block Pluck's bundled tools.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Done. Restart Premiere Pro, then open Window → Extensions → Pluck."
