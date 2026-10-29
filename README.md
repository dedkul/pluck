# Pluck

Paste a video link inside Premiere Pro. Pluck downloads it (or just the part you need) and drops it straight into your project.

Works with YouTube, X/Twitter, Instagram, TikTok, Vimeo and [many more sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

## What it does

- **Paste a link** and see the title and thumbnail, then download.
- **Just a clip:** download only the part of a long video you need.
- **Up to 4K, 60 fps:** every size is converted to a file Premiere opens straight away.
- **Whole playlists** and Google Drive folders in one go.
- **Audio only** as M4A or WAV.
- **Lands in your project:** files go into a `Web Downloads` bin, ready to edit.
- **Nothing else to install**, and Pluck tells you when there's an update.

## Install

You need Premiere Pro **2022 or newer**, on Mac or Windows.

1. Download the zip for your computer from the [latest release](https://github.com/dedkul/pluck/releases/latest).
2. Unzip it and close Premiere Pro.
3. Double-click **Install Pluck.command** (Mac) or **Install Pluck.bat** (Windows).
4. Open Premiere Pro, then **Window → Extensions → Pluck**.

Your computer may warn you the first time, because Pluck isn't signed yet. `READ ME FIRST.txt` in the zip shows how to allow it, and how to uninstall.

## Found a bug or have an idea?

- **Send me a DM on X:** [@feat_ashish](https://x.com/feat_ashish). A screenshot of what you saw helps a lot.
- **Or, on GitHub:** [report a bug](https://github.com/dedkul/pluck/issues/new?template=bug.yml) or [request a feature](https://github.com/dedkul/pluck/issues/new?template=feature.yml). It's a short form.

## Please download responsibly

Only download videos you have the right to use. Many platforms' terms forbid downloading, and most videos are copyrighted.

---

## For developers

Pluck is a CEP extension: an HTML panel with Node.js built in. It runs the bundled [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org), then asks Premiere (through ExtendScript) to import the file. The [design log](DESIGN_LOG.md) explains every decision and the roadmap, including the move to UXP Hybrid before Adobe retires CEP in 2028.

```
extension/
  index.html, main.js, styles.css   the panel
  lib/engine.js                     runs yt-dlp and FFmpeg
  host/premiere.jsx                 imports files into a Premiere bin
  bin/mac, bin/win                  bundled tools (fetched by scripts/fetch-tools.sh, not in git)
installer/                          install scripts and READ ME FIRST, copied into each release zip
scripts/fetch-tools.sh              downloads yt-dlp and FFmpeg (checksums verified)
scripts/package.sh                  builds dist/Pluck-<version>-<mac|win>.zip for a release
```

**Run from source (macOS)**

```bash
scripts/fetch-tools.sh
defaults write com.adobe.CSXS.11 PlayerDebugMode 1 && defaults write com.adobe.CSXS.12 PlayerDebugMode 1
ln -s "$PWD/extension" ~/Library/Application\ Support/Adobe/CEP/extensions/com.dedkul.pluck
```

Then restart Premiere and open **Window → Extensions → Pluck**.

**Make a release**

1. Bump the version in `extension/CSXS/manifest.xml` and `extension/main.js` (`package.sh` refuses if they differ).
2. `scripts/fetch-tools.sh mac && scripts/fetch-tools.sh win`
3. `scripts/package.sh mac && scripts/package.sh win`
4. Create a GitHub Release tagged `v<version>` and attach both zips. Pluck's update check reads this tag.

Issues and pull requests are welcome. For a bug, include your Premiere version, your OS, and the link you tried.

## License

MIT for Pluck's own code. The bundled tools have their own licenses: yt-dlp is [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE) and FFmpeg builds are [GPL](https://ffmpeg.org/legal.html).
