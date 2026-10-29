#!/bin/bash
# Downloads yt-dlp and ffmpeg into extension/bin/<platform>/ so Pluck needs nothing else installed.
# Sources are the ones ffmpeg.org and yt-dlp officially point to, plus martin-riedl.de for native Apple Silicon ffmpeg.
# Checksums are verified where published.
#
#   scripts/fetch-tools.sh mac   # macOS (default on a Mac)
#   scripts/fetch-tools.sh win   # Windows 64-bit
set -euo pipefail

PLATFORM="${1:-$( [[ "$(uname)" == "Darwin" ]] && echo mac || echo win )}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/extension/bin/$PLATFORM"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }

fetch_ytdlp() { # $1 = release asset name, $2 = file name to save as
  local base="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
  echo "→ yt-dlp ($1)"
  curl -fsSL "$base/$1" -o "$TMP/$1"
  curl -fsSL "$base/SHA2-256SUMS" -o "$TMP/SUMS"
  local want; want="$(grep " $1\$" "$TMP/SUMS" | cut -d' ' -f1)"
  [[ "$(sha256 "$TMP/$1")" == "$want" ]] || { echo "Checksum mismatch for $1"; exit 1; }
  mv "$TMP/$1" "$OUT/$2"
  chmod +x "$OUT/$2"
}

if [[ "$PLATFORM" == "mac" ]]; then
  # The folder build (a zip) starts in ~0.2 s; the single-file build unpacks itself on every run (~3 s).
  fetch_ytdlp yt-dlp_macos.zip yt-dlp_macos.zip
  rm -rf "$OUT/yt-dlp_macos" "$OUT/yt-dlp"
  unzip -qo "$OUT/yt-dlp_macos.zip" -d "$OUT/yt-dlp_macos"
  mv "$OUT/yt-dlp_macos/yt-dlp_macos" "$OUT/yt-dlp_macos/yt-dlp"
  rm "$OUT/yt-dlp_macos.zip"
  # martin-riedl.de: static GPL builds signed with an Apple Developer ID, for both Apple Silicon and Intel.
  # The two are joined into one universal file, so each Mac runs its own native code (no Rosetta, ~2x faster on M-series).
  for tool in ffmpeg ffprobe; do
    for arch in arm64 amd64; do
      echo "→ $tool $arch (martin-riedl.de)"
      url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$arch/release/$tool.zip")"
      curl -fsSL "$url" -o "$TMP/$tool-$arch.zip"
      want="$(curl -fsSL "$url.sha256" | cut -d' ' -f1)"
      [[ "$(sha256 "$TMP/$tool-$arch.zip")" == "$want" ]] || { echo "Checksum mismatch for $tool ($arch)"; exit 1; }
      unzip -qo "$TMP/$tool-$arch.zip" -d "$TMP/$arch"
    done
    lipo -create "$TMP/arm64/$tool" "$TMP/amd64/$tool" -output "$OUT/$tool"
    chmod +x "$OUT/$tool"
  done
elif [[ "$PLATFORM" == "win" ]]; then
  fetch_ytdlp yt-dlp.exe yt-dlp.exe
  # BtbN: the Windows static build linked from ffmpeg.org.
  echo "→ ffmpeg (BtbN)"
  base="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
  name="ffmpeg-master-latest-win64-gpl.zip"
  curl -fsSL "$base/$name" -o "$TMP/$name"
  curl -fsSL "$base/checksums.sha256" -o "$TMP/SUMS"
  want="$(grep " $name\$" "$TMP/SUMS" | cut -d' ' -f1)"
  [[ "$(sha256 "$TMP/$name")" == "$want" ]] || { echo "Checksum mismatch for $name"; exit 1; }
  unzip -qo "$TMP/$name" -d "$TMP/ff"
  cp "$TMP"/ff/*/bin/ffmpeg.exe "$TMP"/ff/*/bin/ffprobe.exe "$OUT/"
else
  echo "Unknown platform: $PLATFORM (use mac or win)"; exit 1
fi

echo "Done. Tools in $OUT:"
ls -lh "$OUT"
