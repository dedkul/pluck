// Pluck engine: runs the bundled yt-dlp and ffmpeg. Loaded straight into the panel via CEP's Node.js,
// so there's no separate app or server. Kept free of panel code so it can be reused if we move to UXP Hybrid.
// Written for CEP's older Node (15+): no "node:" imports, no optional chaining in Node-only paths.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");

function createEngine(extensionRoot) {
  const exe = name => (process.platform === "win32" ? name + ".exe" : name);
  const platformDir = path.join(extensionRoot, "bin", process.platform === "win32" ? "win" : "mac");

  // Bundled tools first. Fall back to a system install only for development.
  // On Mac, yt-dlp is the folder build, in its own subfolder next to its support files.
  function findTool(name) {
    const dirs = [path.join(platformDir, "yt-dlp_macos"), platformDir, "/opt/homebrew/bin", "/usr/local/bin"].concat((process.env.PATH || "").split(path.delimiter));
    for (const dir of dirs) {
      const p = dir && path.join(dir, exe(name));
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }
  const YTDLP = findTool("yt-dlp");
  const FFMPEG = findTool("ffmpeg");

  // Asking yt-dlp its version can take a few seconds (the old single-file build took ~3 s), so it runs in the
  // background and the answer is remembered. Waiting for it synchronously froze the whole panel.
  let statusPromise = null;
  function status() {
    if (statusPromise) return statusPromise;
    statusPromise = new Promise(resolve => {
      const done = version => resolve({
        ytdlp: version, ffmpeg: !!FFMPEG,
        bundled: !!YTDLP && YTDLP.indexOf(platformDir) === 0 && !!FFMPEG && FFMPEG.indexOf(platformDir) === 0,
      });
      if (!YTDLP) return done(null);
      execFile(YTDLP, ["--version"], { encoding: "utf8", timeout: 20000 }, (err, out) => done(err ? null : out.trim()));
    });
    return statusPromise;
  }

  // Turn yt-dlp's raw error output into something a person can act on.
  function friendlyError(stderr) {
    const s = stderr || "";
    if (/Sign in to confirm|login required|log in|cookies/i.test(s)) return { code: "auth", message: "This video needs you to be signed in to the site." };
    if (/Private video|This video is private/i.test(s)) return { code: "private", message: "This video is private." };
    if (/age.?restricted|confirm your age/i.test(s)) return { code: "age", message: "This video is age-restricted and needs sign-in." };
    if (/Unsupported URL/i.test(s)) return { code: "unsupported", message: "Pluck can't download from this site yet." };
    if (/unavailable|not available|removed/i.test(s)) return { code: "unavailable", message: "This video isn't available. It may have been removed." };
    if (/Unable to download|HTTP Error|timed out|getaddrinfo/i.test(s)) return { code: "network", message: "Couldn't reach the site. Check your internet and try again." };
    const last = s.trim().split("\n").filter(l => /ERROR/.test(l)).pop();
    return { code: "unknown", message: last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "") : "Something went wrong while downloading." };
  }

  // Sites only send H.264 (which Premiere plays) up to 1080p. 1440p and 4K come as VP9 or AV1, which Premiere
  // can't open, so Pluck re-encodes them to H.264. "veryfast" at quality 18 won our test: as fast as the Mac's
  // hardware encoder, a quarter of its file size, and it works the same on Windows (see DESIGN_LOG Entry 10).
  const H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k"];
  const needsConversion = quality => quality === "2160p" || quality === "1440p";
  // yt-dlp keeps ffmpeg quiet while it cuts a clip, so ask ffmpeg to report its progress ("out_time=…").
  const PROGRESS = "-progress pipe:2 -nostats";

  // Prefer H.264 + AAC in MP4, which Premiere plays without conversion.
  // Among equal sizes yt-dlp already picks the highest frame rate, so 60 fps sources stay 60 fps.
  function formatFor(quality, clip) {
    if (quality === "audio") return ["-f", "ba[ext=m4a]/ba", "-x", "--audio-format", "m4a"];
    if (quality === "wav") return ["-f", "ba", "-x", "--audio-format", "wav"];
    if (quality === "original") return ["-f", "bv*+ba/b"];
    if (needsConversion(quality)) {
      const h = parseInt(quality, 10);
      // SDR first: HDR turned into an ordinary H.264 file looks washed out.
      // A clip is converted while it downloads (one pass); a full video is converted afterwards so we can show a percentage.
      return [
        "-f", `bv*[height<=${h}][dynamic_range=?SDR]+ba/bv*[height<=${h}]+ba/b[height<=${h}]/b`,
        ...(clip ? ["--merge-output-format", "mp4", "--downloader-args", `ffmpeg_o:${H264.join(" ")} ${PROGRESS}`] : ["--merge-output-format", "mkv"]),
      ];
    }
    const h = { "1080p": 1080, "720p": 720, "480p": 480 }[quality] || 1080;
    return [
      "-f", `bv*[vcodec^=avc1][height<=${h}]+ba[ext=m4a]/b[ext=mp4][height<=${h}]/bv*[height<=${h}]+ba/b`,
      "--merge-output-format", "mp4",
    ];
  }

  // 754 seconds -> "00-12-34" (dashes, because colons aren't allowed in file names).
  function stamp(sec) {
    const s = Math.round(sec), p = n => String(n).padStart(2, "0");
    return `${p(Math.floor(s / 3600))}-${p(Math.floor((s % 3600) / 60))}-${p(s % 60)}`;
  }

  // Start yt-dlp. UTF-8 so titles in any language survive (Windows otherwise uses its old local text encoding).
  // On Mac it gets its own process group, so stop() can end the ffmpeg it starts too.
  function runYtdlp(args) {
    const proc = spawn(YTDLP, args, {
      env: Object.assign({}, process.env, { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }),
      detached: process.platform !== "win32",
    });
    proc.stdout.setEncoding("utf8"); // decode across chunk edges, or a letter split in two turns into "�"
    proc.stderr.setEncoding("utf8");
    return proc;
  }

  // End yt-dlp and everything it started (ffmpeg keeps downloading otherwise).
  function stop(proc) {
    if (process.platform === "win32") return execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => {});
    try { process.kill(-proc.pid, "SIGTERM"); } catch (e) { proc.kill(); }
  }

  function isHttpUrl(s) {
    try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch (e) { return false; }
  }

  // Video details (title, length, thumbnail) without downloading.
  function info(url) {
    return new Promise((resolve, reject) => {
      if (!isHttpUrl(url)) return reject({ code: "badurl", message: "That doesn't look like a link." });
      const proc = runYtdlp(["-J", "--no-playlist", "--no-warnings", "--", url]);
      let out = "", err = "", timedOut = false;
      // A stuck lookup would otherwise spin forever.
      const timer = setTimeout(() => { timedOut = true; stop(proc); }, 45000);
      proc.stdout.on("data", c => { out += c; });
      proc.stderr.on("data", c => { err += c; });
      proc.on("error", () => { clearTimeout(timer); reject({ code: "tools", message: "Pluck's download tool couldn't start. Try reinstalling Pluck." }); });
      proc.on("close", code => {
        clearTimeout(timer);
        if (timedOut) return reject({ code: "network", message: "The site took too long to answer. Try again." });
        if (code !== 0) return reject(friendlyError(err));
        try {
          const j = JSON.parse(out);
          // Every picture size this video comes in, with its best frame rate, so the panel only offers what exists.
          const sizes = {};
          (j.formats || [j]).forEach(f => {
            if (f.height && f.vcodec !== "none") sizes[f.height] = Math.max(sizes[f.height] || 0, Math.round(f.fps || 0));
          });
          // The best audio "Audio only (M4A)" will get, so the menu can show it.
          const m4a = (j.formats || []).filter(f => f.vcodec === "none" && f.ext === "m4a" && f.abr).map(f => f.abr);
          resolve({
            audioKbps: m4a.length ? Math.round(Math.max(...m4a)) : 0,
            sizes: Object.keys(sizes).map(h => ({ height: Number(h), fps: sizes[h] })),
            title: j.title, uploader: j.uploader || j.channel || j.uploader_id || "",
            duration: j.duration || 0, thumbnail: j.thumbnail || null,
            platform: j.extractor_key || j.extractor || "", url: j.webpage_url || url, id: j.id,
          });
        } catch (e) { reject({ code: "unknown", message: "Couldn't read the video details." }); }
      });
    });
  }

  // Starts a download and returns a job object that updates itself; the panel just reads it.
  // clip = { start, end } in seconds, or null for the full video.
  function download({ url, outDir, quality, clip }) {
    const job = { status: "downloading", percent: 0, speed: "", file: null, error: null, proc: null };
    outDir = outDir || path.join(os.homedir(), "Movies", "Pluck");
    try { fs.mkdirSync(outDir, { recursive: true }); }
    catch (e) { return Object.assign(job, { status: "error", error: { code: "folder", message: "Pluck can't save to " + outDir + ". Pick another folder under “Save to”." } }); }

    const args = [
      // --print turns on quiet mode, so --progress is needed to keep progress lines coming.
      "--no-playlist", "--newline", "--progress", "--no-mtime", "--windows-filenames",
      "--progress-template", "download:PLUCK %(progress._percent_str)s|%(progress._speed_str)s",
      "--print", "after_move:PLUCKFILE %(filepath)s",
      "-o", path.join(outDir, clip ? `%(title).80B [${stamp(clip.start)} to ${stamp(clip.end)}] [%(id)s].%(ext)s` : "%(title).80B [%(id)s].%(ext)s"),
      // Clips: fetch only that stretch, and re-cut the edges so the clip starts exactly where asked.
      // "Original file" skips the re-cut, which would re-encode it; that clip starts at the nearest keyframe instead.
      // (Converted clips get the progress flag together with their conversion settings: yt-dlp keeps only one set.)
      ...(clip ? ["--download-sections", `*${clip.start}-${clip.end}`]
        .concat(needsConversion(quality) ? [] : ["--downloader-args", "ffmpeg:" + PROGRESS])
        .concat(quality === "original" ? [] : ["--force-keyframes-at-cuts"]) : []),
      ...(FFMPEG ? ["--ffmpeg-location", path.dirname(FFMPEG)] : []),
      ...formatFor(quality, clip),
      "--", url,
    ];
    const proc = runYtdlp(args);
    job.proc = proc;
    let stderr = "", buf = "";
    // yt-dlp downloads video and audio separately; track which part we're on so the bar doesn't jump back.
    let part = 0, lastPct = 0;
    const parts = quality === "audio" || quality === "wav" ? 1 : 2;
    const startedAt = Date.now();

    proc.stdout.on("data", chunk => {
      buf += chunk;
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (line.indexOf("PLUCK ") === 0) {
          const bits = line.slice(6).split("|").map(s => s.trim());
          const p = parseFloat(bits[0]) || 0;
          if (p < lastPct - 50) part = Math.min(part + 1, parts - 1);
          lastPct = p;
          job.percent = Math.min(99, Math.round(((part + p / 100) / parts) * 100));
          job.speed = bits[1] === "Unknown B/s" ? "" : bits[1];
        } else if (line.indexOf("PLUCKFILE ") === 0) {
          job.file = line.slice(10).trim();
        } else if (/\[Merger\]|\[ExtractAudio\]/.test(line)) {
          job.status = "processing";
        }
      }
    });
    proc.stderr.on("data", c => {
      stderr += c;
      // Clips are cut by ffmpeg, which reports how far it has got ("out_time=00:00:12.40"); turn that into a percentage.
      const t = lastTime(c);
      if (clip && t !== null) job.percent = Math.min(99, Math.round((t / (clip.end - clip.start)) * 100));
    });
    proc.on("error", () => { job.status = "error"; job.error = { code: "tools", message: "Pluck's download tool couldn't start. Try reinstalling Pluck." }; });
    proc.on("close", code => {
      job.proc = null;
      if (job.status === "cancelled") return removePartials(outDir, startedAt);
      if (code === 0 && job.file && fs.existsSync(job.file) && needsConversion(quality) && !clip) convert(job, outDir, startedAt);
      else if (code === 0 && job.file && fs.existsSync(job.file)) { job.status = "done"; job.percent = 100; }
      else if (job.status !== "error") { job.status = "error"; job.error = friendlyError(stderr); }
    });
    return job;
  }

  // Last "time=HH:MM:SS.ss" in a piece of ffmpeg output, in seconds.
  function lastTime(text) {
    const all = String(text).match(/time=\d+:\d+:[\d.]+/g);
    if (!all) return null;
    const p = all.pop().slice(5).split(":");
    return p[0] * 3600 + p[1] * 60 + parseFloat(p[2]);
  }

  // Re-encode a downloaded 1440p/4K file to H.264 MP4, reporting a real percentage, then delete the original.
  function convert(job, outDir, startedAt) {
    const src = job.file, out = src.replace(/\.\w+$/, ".mp4");
    Object.assign(job, { status: "converting", percent: 0, speed: "" });
    const fail = () => Object.assign(job, { status: "error", error: { code: "convert", message: "Pluck couldn't convert this video for Premiere. Try 1080p, or “Original file” to keep it as it is." } });
    if (!FFMPEG) return fail();
    const proc = spawn(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", ...H264, out],
      { detached: process.platform !== "win32" });
    proc.stderr.setEncoding("utf8");
    job.proc = proc;
    let log = "", total = 0;
    proc.stderr.on("data", c => {
      log = (log + c).slice(-8000);
      const d = !total && /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
      if (d) total = d[1] * 3600 + d[2] * 60 + parseFloat(d[3]);
      const t = lastTime(c);
      if (total && t !== null) job.percent = Math.min(99, Math.round((t / total) * 100));
    });
    proc.on("error", fail);
    proc.on("close", code => {
      job.proc = null;
      if (job.status === "cancelled") { [src, out].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} }); return removePartials(outDir, startedAt); }
      if (code !== 0 || !fs.existsSync(out)) { try { fs.unlinkSync(out); } catch (e) {} return fail(); }
      try { fs.unlinkSync(src); } catch (e) {}
      Object.assign(job, { status: "done", percent: 100, file: out });
    });
  }

  function cancel(job) {
    if (!job || job.status === "done" || job.status === "error") return;
    job.status = "cancelled";
    if (job.proc) stop(job.proc);
  }

  // After a cancel, delete the half-finished pieces yt-dlp leaves behind (only ones from this job's time window).
  function removePartials(dir, since) {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(part|ytdl)$|\.f\d+\.\w+$|\.part-Frag\d+$/.test(name)) continue;
      const p = path.join(dir, name);
      try { if (fs.statSync(p).mtimeMs >= since - 1000) fs.unlinkSync(p); } catch (e) {}
    }
  }

  return { status, info, download, cancel, needsConversion, tools: { ytdlp: YTDLP, ffmpeg: FFMPEG } };
}

module.exports = { createEngine };
