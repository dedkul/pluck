# Pluck

Paste a video link inside Premiere Pro. Pluck downloads it (or just the part you need) and drops it straight into your project.

Works with YouTube, X/Twitter, Instagram, TikTok, Vimeo and [many more sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org).

> **Status: v0.3, early.** Tested on macOS. Windows support is written but not yet tested. Search and GIFs are on the [roadmap](DESIGN_LOG.md).

## Features

- Paste a link, see the title and thumbnail, and download.
- **Just a clip:** pick a start and end time to download only that part of a long video.
- Downloads land in a `Web Downloads` folder next to your project and get imported into a bin.
- Prefers MP4 files that Premiere plays without converting.
- **Nothing else to install:** yt-dlp and FFmpeg ship inside the extension.

## Requirements

- Premiere Pro **2022 (22.0) or newer**
- macOS or Windows (64-bit)

## Install (developer build, for now)

A one-click installer is coming. Until then:

1. Download the tools into the extension:
   ```bash
   scripts/fetch-tools.sh
   ```
2. Let Premiere load unsigned extensions (macOS):
   ```bash
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1 && defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   ```
3. Link the extension into Adobe's extensions folder (macOS):
   ```bash
   ln -s "$PWD/extension" ~/Library/Application\ Support/Adobe/CEP/extensions/com.dedkul.pluck
   ```
4. Restart Premiere, then open **Window → Extensions → Pluck**.

## How it's built

Pluck is a CEP extension: an HTML panel with Node.js built in. The panel runs the bundled yt-dlp and FFmpeg directly, then asks Premiere (through ExtendScript) to import the file.

```
extension/
  index.html, main.js, styles.css   the panel
  lib/engine.js                     runs yt-dlp and FFmpeg
  host/premiere.jsx                 imports files into a Premiere bin
  bin/mac, bin/win                  bundled tools (fetched by scripts/fetch-tools.sh, not in git)
  bin/mac/yt-dlp_macos/yt-dlp       yt-dlp on Mac (folder version: starts fast)
```

Adobe is retiring CEP (off by default from December 2028). The plan is to move to a UXP Hybrid plugin before then. The [design log](DESIGN_LOG.md) has the full story.

## Feedback

- Bugs and feature requests: [open an issue](https://github.com/dedkul/pluck/issues)
- Say hi or follow along on X: [@feat_ashish](https://x.com/feat_ashish)

## Please download responsibly

Only download videos you have the right to use. Many platforms' terms forbid downloading, and most videos are copyrighted.

## License

MIT for Pluck's own code. The bundled tools have their own licenses: yt-dlp is [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE) and FFmpeg builds are [GPL](https://ffmpeg.org/legal.html).
