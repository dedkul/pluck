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

## Entry 13 — v0.3.1: first real use, and a UX pass
*2026-10-20*

First time loading the CEP panel in Premiere. Each fix below is a problem found while using it.

- **Blank panel.** *Problem:* only the top bar showed. *Cause:* Pluck named something `cep`, a name Adobe already uses, and that one clash stopped the whole script. *Decision:* renamed it. *Lesson:* checking code outside Premiere can't catch this; it has to run inside Premiere.
- **Laggy Settings, dead Back button.** *Problem:* Settings took ~3.5 s to open and clicks got lost. *Cause:* Pluck asked the download tool for its version and froze the panel while waiting (the bundled tool takes ~3 s to start). *Decision:* ask in the background and open Settings instantly (now ~0.1 s). *Why:* people stop feeling in control when a click takes over ~0.4 s to respond (the "Doherty threshold").
- **Every lookup and download waited ~3 s before starting.** *Problem:* the bundled yt-dlp was the "single-file" version, which unpacks itself every time it runs. *Decision:* switch to yt-dlp's "folder" version (same release, same checksum check), which is already unpacked. *Why:* measured on this Mac, starting yt-dlp went from 2.5–4.0 s to ~0.2 s, and finding a video's details went from 5.5–5.8 s to 2.5–2.9 s (2.7–3.1 s inside Premiere). Same speed-up for every download. *Cost:* it takes more disk space (124 MB instead of 37 MB), and the very first run after installing is still ~3 s while macOS checks the new files once.
- **Paste vs. Get.** *Problem:* two buttons next to one field, and nobody could tell them apart. *Decision:* one field, one button. "Paste link" grabs the copied link and finds the video right away. Pasting with ⌘V or pressing Enter does the same, so there's no "Get" step. Once a link is in, the button turns into a small × to clear it. *Why:* every extra choice slows people down (Hick's law), and a field that acts when you paste is what people know from browsers (Jakob's law). Pluck also accepts messy input, like a link pasted with a message around it, or one missing `https://` (Postel's law: be forgiving about what people type).
- **"Use a different link" was too easy to miss.** *Decision:* the link field stays at the top on every screen, like a browser's address bar. To get another video, paste over it or press ×.
- **Slider didn't drag.** *Cause:* Premiere doesn't reliably pass newer "pointer" drag events to panels. *Decision:* use classic mouse events, and make each handle's grab area bigger than the dot (Fitts's law: bigger targets are faster to hit). On long videos a short clip stacks both handles on top of each other, so Pluck now goes by which side you grab: just left moves Start, just right moves End. Typing a Start after the End moves the whole clip and keeps its length, instead of squeezing it to 1 second.
- **Save location moved into the main screen.** *Decision:* a "Save to" picker right above the download button: Project folder (default), your last custom folder, or "Choose a folder…". It remembers what you used last. *Why:* the choice belongs where the decision happens, not in Settings. If a remembered folder disappears (say, an unplugged drive), Pluck switches back to the project folder and tells you.
- **Settings cleanup.** Dark scrollbar to match Premiere. The three small links (bug, feature, source) all went to the same GitHub page, so they're gone. The DM-me-on-X line covers feedback, and a proper black **Follow on X** button with the X logo replaces the plain blue one. The settings icon is now a gear (the old one looked like a sun, which reads as a light/dark switch).
- **Updates.** *Problem:* people would never know a new version exists. *Decision:* Pluck checks GitHub once a day. If there's a newer release, a slim banner appears ("Pluck 0.4.0 is available. Get update"), and Settings has **Check for updates** / **Download update**. The banner can be dismissed for that version. *Limit:* "Download update" opens the release page; it doesn't install by itself. Self-installing needs the one-click installer (v1.0). *Needs:* each version has to be published as a GitHub Release tagged like `v0.4.0`, or the check finds nothing.
- **Verified inside Premiere** (by driving the live panel through Adobe's debug connection): panel loads with no errors, Settings opens in ~0.1 s, Back works, the update check runs, pasting a link wrapped in text finds the video, dragging both handles (including on top of each other and past the end), quick-length buttons, typed times and errors, and the missing-folder fallback. *Not verified:* the "Choose a folder…" window (it would block the automated test), and a real download through the new screen (it would import into an open project).

## Entry 14 — v0.3.2: ready for someone else to install
*2026-10-20*

Goal: a friend on Windows can download Pluck from GitHub and test it without any developer setup.

- **Cancel didn't really cancel.** *Problem:* found while testing on Mac. After Cancel on a clip, the helper tool that cuts clips (ffmpeg) kept downloading in the background and left a half-written file behind. On Windows, Cancel would likely have left the whole download running. *Decision:* Cancel now stops yt-dlp and everything it started. *Verified on Mac:* nothing left running and no leftover files. *Why:* a Cancel button that doesn't stop anything breaks people's trust in every other button.
- **Video titles in other languages.** *Problem:* Windows hands text between programs in an old local format, so a title in Hindi, Japanese or with emoji could come back garbled. Pluck would then fail to find the file it just downloaded and show an error, even though the download worked. *Decision:* make yt-dlp always use UTF-8, the format that covers every language. *Not verified yet:* needs the Windows test.
- **A lookup could spin forever.** *Decision:* give up after 45 s and say the site took too long. *Why:* an error you can act on beats a spinner that never ends.
- **How people install it.** *Options:* (a) a `.zxp` file, Adobe's own format, which needs a separate installer app and a signing certificate; (b) a zip with a double-click install script. *Decision:* (b) for now. *Why:* nothing extra to download, and it's one step from what we already do. A proper signed installer is still the plan for v1.0. *Cost:* Mac and Windows warn about unsigned files the first time; the zip's "READ ME FIRST" explains how to get past that.
- **One version number, in sync.** The version lives in two files. The release script refuses to build if they differ, because a mismatch would make Pluck tell people to update forever.

## Entry 15 — v0.3.3: "Premiere didn't respond" on a friend's Mac
*2026-10-26*

- **Problem:** On a friend's MacBook, a YouTube download finished but the import failed with "Couldn't get this video. Premiere didn't respond." The same build worked on a Windows friend's machine.
- **What that message means:** the panel asked Premiere's scripting side to import the file and got back something it couldn't read.
- **First guess, tested and mostly wrong:** the title had a curly apostrophe ("INDIA’S…"), and Adobe's bridge on macOS can garble such characters. I made all text cross the bridge as plain codes (`’` → `’`). Then I tested it live in Premiere 2026 on our Mac, and the **old** way worked fine there too. So the fix is a safe precaution, not the proven cause.
- **Second explanation, which fits every symptom:** Pluck's Premiere script used a built-in called `JSON` to write its replies. If a Premiere's script engine lacks it (likely older versions), every reply breaks. The folder lookup fails silently, so the download still runs (to `~/Movies/Pluck`), then the import reply breaks, which is exactly what the friend saw.
- **Decision:** the script now writes its replies by hand and needs no built-ins. Verified live by hiding `JSON` inside Premiere: the folder lookup and the import both still worked.
- **Better error:** if it ever happens again, the message shows what Premiere actually said and where the downloaded file is, so it can be dragged in by hand and a screenshot is enough to diagnose it.
- **Not verified:** on the friend's Mac itself. We still need their Premiere version to confirm which cause it was.
- **Lesson:** I had a convincing story (the apostrophe) and almost shipped it as "the fix." Reproducing it first showed the story didn't hold up. Test the theory before you believe it.

## Entry 16 — v0.3.4: One-click updates
*2026-10-27*

- **Problem:** every new version meant going to GitHub, downloading a zip, unzipping it and running the installer again. A friend on Mac has had to do that twice in a week. Most people would just stay on the old version, bugs and all.
- **Decision:** the "Update now" button in the banner (and "Install update" in Settings) now does the whole thing inside Pluck. It picks the Mac or Windows zip from the release, downloads it with a progress percentage, unpacks it, checks it really is the promised version, and swaps it in. Then it says: close and reopen the Pluck panel (or restart Premiere).
- **Why it can't leave Pluck broken:** the old version isn't touched until the new one is downloaded, unpacked and checked. The swap itself is two quick renames, and if the second fails the first is undone. Every failure (no internet, the release has no zip for your computer, no permission to change the folder, a download that doesn't match) leaves the old version working and turns the button into "Download page", the old way.
- **Developer copies are left alone:** on our own Mac, Pluck is a link to the code folder. Updating that would overwrite the code, so there the button still just opens the release page.
- **Verified on Mac:** a real download of the v0.3.2 release from GitHub into a test install (about 100 MB, 50 s): version swapped, bundled ffmpeg still runs, no leftovers. Each failure case above was tested and left the old version in place.
- **Verified inside Premiere 2026:** a test install pretending to be v0.3.1 found the real v0.3.3 release, "Update now" downloaded and installed it in 29 s with the percentage counting up, and after reopening the panel it ran v0.3.3 with its tools and Premiere link working.
- **Not verified yet:** anything on Windows (unpacking there uses PowerShell, and Windows may refuse to move a folder that's in use; then it says so and nothing changes).
- **Catch:** this only helps from the version that includes it. v0.3.3 went out without it, so anyone on v0.3.3 or older installs v0.3.4 by hand one last time.

## Entry 17 — 4K, 1440p, 60 fps, WAV and "Original file"

- **Problem:** people asked why there's no 4K. Pluck only picks H.264 video, the kind Premiere opens straight away, and YouTube only sends H.264 up to 1080p. Anything bigger comes as VP9 or AV1, which Premiere can't open. The menu also listed 1080p even for a 720p video.
- **Decision:** 1440p and 4K download the best video at that size, then Pluck converts it to H.264 MP4 with its built-in ffmpeg. The menu now lists only the sizes the video really has, with the frame rate when it's above 30 fps (e.g. "4K · 60 fps"). Also new: "Audio only (WAV)" next to M4A, and "Original file (no conversion)" for people who want exactly what the site sends.
- **Which format to convert to? Measured, not guessed.** A 30-second piece of *Sound Asleep* (a Creative Commons 4K film, VP9, 24 fps), converted on an M4 Pro Mac. Pluck's Mac ffmpeg is an Intel build running through Rosetta, so an Apple Silicon build would be faster:

  | Converted to | Time for 30 s of 4K | File size |
  |---|---|---|
  | **H.264, "veryfast", quality 18 (chosen)** | **15.9 s** | **56 MB** |
  | H.264, "fast", quality 18 | 33.0 s | 67 MB |
  | H.264, Mac's hardware encoder | 12.6 s | 211 MB |
  | HEVC (H.265), software | 106.4 s | 35 MB |
  | HEVC, Mac's hardware encoder | didn't start under Rosetta; software fallback took 221.6 s | 75 MB |
  | ProRes 422 Proxy, software | 38.2 s | 536 MB |
  | ProRes 422 Proxy, Mac's hardware encoder | 4.8 s | 533 MB |

- **Why H.264 "veryfast":** nearly as fast as the hardware encoder at a quarter of the size, works the same way on Windows (the hardware encoders are Mac-only), and Premiere edits it smoothly. HEVC makes the smallest files but is 7–14× slower and heavier to edit. ProRes is the editor's favourite but makes files ~10× bigger (about 1 GB per minute even at the "Proxy" level), and its fast version is Mac-only. Quality 18 is the usual "looks the same as the source" setting; at "fast" the file got bigger without looking better.
- **What it costs you:** the menu says plainly that 1440p and 4K take longer, and progress shows a separate "Converting for Premiere" step with a real percentage. Pluck reads how far ffmpeg has got and divides it by the video's length. On this Mac, 4K at 24 fps converts in about half the video's length, and 4K at 60 fps in about 0.9× its length.
- **60 fps:** kept on by default. When a video has 60 fps, you get 60 fps at every size, like on YouTube. Premiere plays 60 fps footage in a 24/30 fps timeline without fuss, and throwing frames away can't be undone. The catch is slower 4K conversion, which is why the menu shows the frame rate.
- **Clips got faster and show a percentage:** a 4K clip used to be re-cut by ffmpeg's VP9 encoder. A 10-second 4K clip took 74 s, then wouldn't open in Premiere. Now it's cut and converted to H.264 in one pass: 12 s. Every clip now shows a real percentage instead of a seconds counter.
- **No "is it frozen?" moments:** before you download, the menu says roughly how much extra time converting adds for this video or clip (e.g. "Roughly 3 min extra"). While it works, every step shows a percentage plus "about 2 min left", worked out from how fast that step is moving. The old clip counter just counted seconds up with no end in sight, so it's gone.
- **Audio quality:** the M4A option shows the real bitrate the site sends (e.g. "M4A · 130 kbps"). We didn't add "192 / 320 kbps" choices, because YouTube's best audio is about 130–160 kbps and converting to a bigger number only makes a bigger file, not better sound. WAV is there for editing: uncompressed, nothing lost again.
- **Apple Silicon would make converting twice as fast:** the same 30 s 4K test took 15.6 s with Pluck's Intel ffmpeg (through Rosetta) and 7.9 s with a native Apple Silicon ffmpeg on the same Mac. yt-dlp is already native. Switching the bundled Mac ffmpeg is the next step (it's on the v1.0 list).
- **HDR:** Pluck prefers the normal (SDR) version, because HDR squeezed into an ordinary H.264 file looks washed out.
- **"Original file" clips** start at the nearest keyframe, a few seconds before the chosen start (4.6 s in our test), because cutting exactly would mean re-encoding. The menu says so.
- **Verified on Mac** with real downloads, checked with ffprobe: 4K 60 fps clip → H.264 3840×2160 at 60 fps + AAC; 1080p 60 fps clip → H.264 1080p60; 1440p full video → converted to H.264, original deleted; WAV clip → PCM WAV; M4A → AAC; Original clip → VP9 WebM, unchanged. A full 3-minute 4K 60 fps video: 180 s to download, 165 s to convert (the percentage counted up steadily), and the result is H.264 3840×2160 at 60 fps, 944 MB (detailed nature footage at 60 fps is about 300 MB a minute). Cancelling halfway through converting left the folder empty.
- **Not verified yet:** importing these files inside Premiere, and anything on Windows. Windows has no hardware encoder in the plan, so it relies on software H.264 there too.


---

## Roadmap (updated after Entry 17)

**Done so far**

| Version | What shipped |
|---|---|
| **v0.0** | HTML design prototype (`prototype/index.html`). No real downloading. |
| **v0.1** | Paste a YouTube link → download → auto-import into a "Web Downloads" bin. Mac. |
| **v0.2** | Trim: range slider + timestamp boxes. |
| **v0.3** | CEP panel with yt-dlp + ffmpeg built in: nothing extra to install. Premiere 2022+, Mac and Windows. One-click updates (v0.3.4). |

**Next, in order.** Each step makes the next one easier, so the order matters more than the dates.

| When | What | Why now |
|---|---|---|
| **v0.4** (now) | 4K / 1440p with conversion, honest quality menu, time-left indicator (Entry 17); whole playlists | The most-asked-for features, and they work in the framework we have. |
| **v0.5** | Native Apple Silicon ffmpeg | Converting gets about 2× faster on M-series Macs (measured: 7.9 s vs 15.6 s). Directly shortens the 4K wait. |
| **v0.6** | Keep yt-dlp up to date automatically | Sites change every few weeks and break downloads. Today the fix only arrives when we ship a new Pluck. This is the biggest "it stopped working" risk. |
| **v1.0** | Signed installer for Mac and Windows; test X, Instagram and Windows properly | Without signing, macOS and Windows may block the bundled tools. Signing makes Pluck feel trustworthy to install. |
| **2027** | Start the UXP Hybrid rebuild (details below) | It has to be finished and tested well before CEP switches off in Dec 2028. |
| **Later** | In-panel YouTube search, GIF search, download history, transcript search (find a quote and clip it) | Nice to have. None of these get easier by doing them before the rebuild. Most would have to be rebuilt anyway. |

**The long-term problem: Pluck's framework has an end date.** Pluck is a CEP panel. Adobe switches CEP off by default in Dec 2028 and removes it in Dec 2029. After that Pluck simply won't load. The replacement is UXP, but a plain UXP plugin isn't allowed to run outside programs like yt-dlp and ffmpeg, and Pluck can't work without them. The way through is a **UXP Hybrid** plugin: UXP for the panel, plus a small native helper (C++, built for Mac and Windows) that runs the tools (Entry 8).

**Why this is less scary than it sounds**
- **The engine moves over almost unchanged.** Downloading, converting, progress and error messages live in their own file (`lib/engine.js`) and don't touch the panel. That split was on purpose (Entry 8), and every feature since has kept it.
- **The panel is plain HTML/CSS/JS,** which UXP also uses. The screens mostly carry over; what gets rewritten is the import into Premiere (ExtendScript → Premiere's UXP API) and the way the panel talks to the engine.
- **The design work is done.** The flows, copy and decisions in this log stay the same. Only the plumbing changes.

**What it costs**
- **Older Premiere drops off:** UXP Hybrid needs Premiere 2025.6 or newer, so people on Premiere 2022–2024 stay on the last CEP version of Pluck. It will keep working for them until Adobe removes CEP.
- **A C++ helper to build and sign** for two platforms. That's new skills for this project, and the main reason to start in 2027, not 2028.
- **Rule until then:** new features go into `engine.js` where possible, not into panel-only code, so less has to be redone.

## Open risks

- Sites change → downloads break until yt-dlp updates. Need auto-update.
- Instagram and some X videos need the user to be logged in.
- Downloading breaks platform terms. Personal-use tool, shared on GitHub, not Adobe's marketplace.
- Unsigned bundled tools may be blocked by macOS and Windows security until we sign the installer.
- CEP is switched off by default in Dec 2028 and removed in Dec 2029.
