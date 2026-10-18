#!/bin/zsh
# Starts the Pluck engine. Double-click this file, or press "Start engine" in the Pluck panel.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/../engine" || exit 1

if ! command -v node >/dev/null; then
  echo "Pluck needs Node.js. Install it with:  brew install node"
  read -k1 "?Press any key to close."
  exit 1
fi
if ! command -v yt-dlp >/dev/null; then
  echo "Pluck needs yt-dlp and ffmpeg. Install them with:  brew install yt-dlp ffmpeg"
  read -k1 "?Press any key to close."
  exit 1
fi

node server.js
