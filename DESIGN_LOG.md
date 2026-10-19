# Design Log: Premiere Pro Video Downloader

A running record of decisions, problems, and lessons. Each entry: **Problem → Options → Decision → Why.**
This becomes the source for the final short case study deck.

---

## The problem

Editors need clips from YouTube, X, Instagram, plus GIFs. Today that means:
leave Premiere → find a downloader site → download → maybe trim somewhere else → find the file → import.
Too many steps, too many sketchy websites.

**Goal:** paste a link (or search) inside Premiere → get just the part you need → it lands in your project.

**Who:** video editors on Mac and Windows, Premiere Pro 2022 onward.

---

## Entry 1 — Don't build a downloader, build the experience
*2026-10-18*

- **Problem:** Downloading from YouTube, X, and Instagram is hard, and each site works differently.
- **Decision:** Use two free, open-source tools. **yt-dlp** downloads from 1,000+ sites. **ffmpeg** converts and cuts video.
- **Why:** These are maintained by large communities and fixed within days when sites change. My job is the experience, not the plumbing.
- **Bonus:** yt-dlp can download only a section of a video, so a 1-minute clip from a 1-hour podcast takes seconds.

## Entry 2 — Replace "browser inside the plugin" with search inside the plugin
*2026-10-18*

- **Problem:** I wanted a mini browser in the panel. YouTube, Instagram and X block their pages from loading inside other apps.
- **Decision:** No browser in early versions. Add **in-panel search** instead (results show title + thumbnail, click to download).
- **Why:** The user doesn't need to browse the web. They need to *find a video*. Search solves the real need with less that can break.

## Entry 3 — CEP vs UXP (Adobe's old vs new plugin system)
*2026-10-18*

- **Problem:** Premiere has two plugin systems. CEP is older and is being phased out. UXP is the future.
- **What we found:**
  - UXP only exists in **Premiere 2025 (v25) and newer**. Our users run 2022 and 2023.
  - UXP plugins run in a locked box and **can't launch yt-dlp or ffmpeg**. Working around that means shipping a second "helper" app the user must install and keep running.
  - CEP works in **every version from 2022 to 2026** and can run yt-dlp directly.
  - Adobe has **no announced removal date** for CEP in Premiere. Adobe staff say developers will need to migrate "eventually."
- **Decision:** Build on **CEP now**. Keep the downloading logic (the "engine") separate from the interface, so moving to UXP later only means rebuilding the interface plus adding the helper.
- **Why:** UXP would cut off every user on 2022–2024, and would add a second app to install. That's not "a bit more code," it's a worse product today.
- **Risk we accept:** A future Premiere version will drop CEP. Plan: ship a UXP version before that happens.

> **Update (Entry 7):** Adobe *has* published a CEP shutdown timeline. My "no announced date" was wrong. Decision reopened, see Entry 7.

## Entry 4 — GIF browser: use an official API, don't scrape
*2026-10-18*

- **Problem:** I wanted users to search Tenor or GIPHY and drop GIFs into the project.
- **What we found:** **Google shut down the Tenor API on June 30, 2026.** Scraping the Tenor website breaks easily and goes against their rules.
- **Decision:** Use the **official GIPHY API** (free developer key).
- **Detail:** Import the MP4 version GIPHY provides, not the .gif. Premiere handles MP4 much better than GIF.
- **Lesson:** A service you depend on can disappear. Build so the GIF source can be swapped.

## Entry 5 — Keep trimming simple
*2026-10-18*

- **Decision:** Trimming uses **a range slider + start/end timestamp boxes**. No thumbnail strip, no video preview in early versions.
- **Why:** The typical user has already watched the video and knows the timestamps. A thumbnail strip is nice-to-have, saved for the final version.

## Entry 6 — Formats Premiere actually likes
*2026-10-18*

- **Problem:** YouTube's best quality uses formats Premiere struggles with. Phone videos often have shifting frame rates, which causes audio to drift out of sync.
- ~~Decision: Always convert.~~ **Revised (Entry 7):** convert **only when needed**. Keep files Premiere already handles untouched.
- **Why:** Converting everything costs time and some quality. Premiere copes with many files fine.
- **Trade-off:** YouTube's H.264 usually maxes at 1080p. 4K would need a slower conversion step.

## Entry 7 — A second AI reviewed my plan
*2026-10-18*

I gave Claude's plan to Codex for a second opinion, then checked its sources.

- **Codex was right about:**
  - **CEP has an end date.** Adobe's Sept 2026 roadmap for Premiere: no new CEP plugins on the marketplace from **Dec 2027**, CEP **off by default Dec 2028**, **removed Dec 2029**.
  - **"Downloads in seconds"** was a promise we can't make yet. It depends on the network and on whether the cut needs re-encoding. We'll measure it.
  - **Always converting** was too aggressive (see Entry 6).
  - **Trim before more platforms.** Trimming *is* the product. Roadmap reordered.
  - UXP has a real built-in web view, so an in-panel browser is worth a quick test instead of ruling it out.
- **What I checked that still holds:**
  - UXP can open other programs, but **can't pass them instructions or read their output** (Adobe docs, needs Premiere 25.6+). So UXP still needs a separate helper app to run yt-dlp.
  - UXP only runs on Premiere 2025+. **Supporting 2022–2023 is only possible with CEP.**
- **The real question is no longer technical. It's who we serve:**
  - **CEP:** works on 2022–2026, one install, simple. Has to be rebuilt in UXP before late 2028.
  - **UXP + helper:** 2025.6+ only, users install two pieces (one installer can hide that). Future-proof.
- **Decision:** Settled in Entry 8. Design came first with an HTML prototype, which looks the same either way.
- **Lesson:** Use a second AI as a reviewer, but check its sources too. Both of us were partly wrong.

## Entry 8 — Decision: UXP + a helper engine
*2026-10-18*

- **Decision:** Build on **UXP** (Premiere 25.6+) with a small **local helper ("engine")** that runs yt-dlp.
- **Why:** CEP is gone by Dec 2029 and switched off by default a year before that. Starting a new product on it means rebuilding within two years. Users can update Premiere for free with their subscription.
- **Cost we accept:** No 2022–2024 support. Users start the engine once (a button in the panel does it). A one-click installer comes in v1.0.
- **Security detail:** The engine only listens on this computer, only accepts requests addressed to localhost, and requires a custom header. Random websites can't trigger downloads through it.

## Entry 9 — Naming: "Pluck"
*2026-10-18*

- **Options:** Snag, Yoink, ClipHook, Pluck.
- **Picked:** **Pluck**, because you pluck out just the part you need. It hints at trimming, the core feature.
- **Also added:** an About section in Settings with a Follow-on-X button and links to report bugs or request features.

## Entry 10 — v0.1 built
*2026-10-18*

- **What works:** paste link → video details + thumbnail → pick quality → download with live progress → saved in `Web Downloads` next to the project → imported into a bin. Cancel, clear error messages, and an "engine not running" screen.
- **Tested for real:** downloads arrive as H.264 + AAC MP4 (Premiere-native, no conversion). Cancel cleans up half-finished files.
- **Surprise:** progress was stuck at 0%. Asking yt-dlp to report the final file name silently muted its progress output. One extra flag fixed it. Lesson: test the real thing, not just "does it finish."
- **Not yet verified:** the panel running inside Premiere itself (needs a manual load in Adobe's developer tool).
- **Design changes from the prototype:** no Search/GIFs/History tabs yet (roadmap), no clip trimming yet (v0.2). Uses Adobe's own UI components so it matches Premiere's look.

## Entry 11 — v0.2: "Just a clip"
*2026-10-19*

- **Problem:** Editors usually need 20 seconds of a video, not all of it. Downloading a whole hour-long video to use one quote wastes minutes and gigabytes.
- **Decision:** In the ready screen, a **Full video / Just a clip** switch. Clip mode has a slider with two handles, Start and End boxes that stay in sync with it, a clip-length readout, and 15s / 30s / 1m quick buttons. Videos longer than 10 minutes open in clip mode. Pluck then fetches **only that stretch** from the site and names the file `Title [00-05-00 to 00-06-00] [id].mp4`.
- **Why the edges are re-cut:** Videos can normally only be cut cleanly at certain "anchor" frames a few seconds apart. Pluck asks for the edges to be rebuilt so the clip starts on the exact second you picked, not at the nearest anchor. It costs a little time; a clip that starts 3 seconds early is worse.
- **Measured (60-second clips, real downloads):**

  | | Big Buck Bunny (10 min, 720p) | NASA briefing (58 min, 1080p) |
  |---|---|---|
  | Click → file ready | 48 s | 43 s |
  | Clip length (asked 60 s) | 60.000 s | 60.06 s |
  | First frame vs. source | exact frame | within 1 frame (1/30 s) |
  | Audio vs. source | exact (0 ms) | exact (0 ms) |

  An audio-only 30-second clip took 4.5 s and came out at exactly 30.000 s.
- **What the numbers say:** Time depends on clip length, not video length: the 1-hour video was no slower. Sound and picture stay in sync. Big Buck Bunny is 720p because that's the best the upload offers.
- **Surprise:** While cutting a clip, the downloader reports no percentage, only "done" at the end. A progress bar would sit at 0% for 45 seconds and look broken. So clip downloads hide the bar and show seconds spent ("Cutting your clip · 12s") instead of a fake percentage.
- **How sync was checked:** compared the clip's first second, frame by frame and sound wave by sound wave, against the same moment pulled straight from the source.
- **UXP limits:** Adobe's built-in slider has one handle, so the two-handle slider is built from plain boxes. The handles can't be moved with arrow keys yet; typing in the Start/End boxes is the keyboard route.
- **Not yet verified:** the clip controls inside Premiere itself (dragging, typing, the download button). Needs a manual load in Adobe's developer tool.

## Entry 12 — Back to CEP: one install, nothing extra
*2026-10-19*

- **Problem:** The UXP version needed a separate helper running in a Terminal window. Your point: if people have to install and run extra software anyway, why not just use any downloader app? **A plugin's whole value is that it lives inside Premiere.** A second piece of software breaks that promise.
- **Options:**
  - **CEP:** the panel has Node.js built in, so it can run yt-dlp and ffmpeg packed inside the plugin. Works in Premiere 2022 and newer. Adobe turns it off by default in Dec 2028.
  - **UXP Hybrid:** UXP plus a small C++ part (available in Premiere since April 2026). Future-proof, but needs C++ built separately for Mac and Windows. Premiere 2025.6+ only.
  - **UXP + hidden helper:** an installer that starts the helper silently. Still a background app, and still a lot of packaging work.
- **Decision:** **CEP**, with yt-dlp and ffmpeg bundled inside.
- **Why:** It delivers "install one thing, it works" today, and brings back Premiere 2022–2024 users (your original wish). The code that matters carries over: the download logic is its own file (`lib/engine.js`), ready to reuse in a UXP Hybrid version.
- **Cost we accept:** A rebuild as UXP Hybrid before Dec 2028. The plugin grows by about 115 MB because of the bundled tools.
- **Lesson:** I changed my recommendation twice (CEP → UXP → CEP). Each change came from a new fact: Adobe's shutdown dates, then your "no extra software" rule. The rule mattered more than the tech. The question to ask first was "what does the user have to do?", not "what's newest?"
- **Bundled tools:** downloaded only from sources yt-dlp and ffmpeg.org officially point to, with checksums verified where they're published.
- **Known gaps:**
  - The Mac ffmpeg (evermeet.cx) is an Intel build. On Apple Silicon it runs through Rosetta. Macs without Rosetta will need a native build before release.
  - Bundled tools aren't signed by us yet. macOS may block them when installed from a downloaded file. That gets solved when we package the installer.

---

## Roadmap (reordered after Entry 7)

| Version | What ships |
|---|---|
| **v0.0** | HTML design prototype (`prototype/index.html`). No real downloading. |
| **v0.1** | Paste a YouTube link → download → auto-import into a "Web Downloads" bin. Mac. |
| **v0.2** | Trim: range slider + timestamp boxes. Measure speed and audio sync. |
| **v0.3** | Switch to CEP with yt-dlp + ffmpeg built in: nothing extra to install. Premiere 2022+. |
| **v0.4** | Test X + Instagram, Windows; in-panel YouTube search, GIF search (GIPHY), download history |
| **v1.0** | Signed one-click installer for Mac + Windows, native Apple Silicon ffmpeg, auto-update yt-dlp |
| **By late 2028** | Rebuild as a UXP Hybrid plugin before CEP is switched off; transcript search to find a quote and clip it |

## Open risks

- Sites change → downloads break until yt-dlp updates. Need auto-update.
- Instagram and some X videos need the user to be logged in.
- Downloading breaks platform terms. Personal-use tool, shared on GitHub, not Adobe's marketplace.
- Unsigned bundled tools may be blocked by macOS and Windows security until we sign the installer.
- CEP is switched off by default in Dec 2028 and removed in Dec 2029.
