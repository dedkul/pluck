# Pluck

Paste a video link inside Premiere Pro. Pluck downloads it and drops it straight into your project.

Works with YouTube, X/Twitter, Instagram, TikTok, Vimeo and [many more sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp).

> **Status: v0.1, early and Mac-only.** Trimming, search and GIFs are on the [roadmap](DESIGN_LOG.md#roadmap-reordered-after-entry-7).

## How it works

Premiere's plugin system (UXP) isn't allowed to run other programs, so Pluck has two parts:

- **`plugin/`**: the panel inside Premiere. You paste a link here.
- **`engine/`**: a small helper that runs on your Mac and does the downloading.

```
Premiere panel  →  local engine (127.0.0.1)  →  yt-dlp  →  file saved next to your project  →  imported into a bin
```

## Requirements

- Premiere Pro **25.6 or newer** (2025 / 2026)
- macOS with [Homebrew](https://brew.sh)
- Node.js, yt-dlp and ffmpeg:

```bash
brew install node yt-dlp ffmpeg
```

## Install (developer mode, for now)

1. In Premiere: **Settings → Plugins → Enable developer mode**, then restart Premiere.
2. Open **Adobe UXP Developer Tools** → **Add Plugin** → choose `plugin/manifest.json` → **Load**.
3. In Premiere: **Window → UXP Plugins → Pluck**.
4. Press **Start engine** in the panel (or double-click `plugin/start-engine.command`). Keep the Terminal window open.

## Use it

1. Save your Premiere project (downloads go in a `Web Downloads` folder next to it).
2. Paste a link and press **Get**.
3. Pick a quality and press **Download**. The video lands in the **Web Downloads** bin.

## Feedback

- Bugs and feature requests: [open an issue](https://github.com/dedkul/pluck/issues)
- Say hi or follow along on X: [@feat_ashish](https://x.com/feat_ashish)

## Please download responsibly

Only download videos you have the right to use. Many platforms' terms forbid downloading, and most videos are copyrighted. Pluck saves the source link with each file so you can credit creators.

## License

MIT
