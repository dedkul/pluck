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

  // Prefer H.264 + AAC in MP4, which Premiere plays without conversion.
  function formatFor(quality) {
    if (quality === "audio") return ["-f", "ba[ext=m4a]/ba", "-x", "--audio-format", "m4a"];
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
          resolve({
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
      ...(clip ? ["--download-sections", `*${clip.start}-${clip.end}`, "--force-keyframes-at-cuts"] : []),
      ...(FFMPEG ? ["--ffmpeg-location", path.dirname(FFMPEG)] : []),
      ...formatFor(quality),
      "--", url,
    ];
    const proc = runYtdlp(args);
    job.proc = proc;
    let stderr = "", buf = "";
    // yt-dlp downloads video and audio separately; track which part we're on so the bar doesn't jump back.
    let part = 0, lastPct = 0;
    const parts = quality === "audio" ? 1 : 2;
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
    proc.stderr.on("data", c => { stderr += c; });
    proc.on("error", () => { job.status = "error"; job.error = { code: "tools", message: "Pluck's download tool couldn't start. Try reinstalling Pluck." }; });
    proc.on("close", code => {
      job.proc = null;
      if (job.status === "cancelled") return removePartials(outDir, startedAt);
      if (code === 0 && job.file && fs.existsSync(job.file)) { job.status = "done"; job.percent = 100; }
      else if (job.status !== "error") { job.status = "error"; job.error = friendlyError(stderr); }
    });
    return job;
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

  return { status, info, download, cancel, tools: { ytdlp: YTDLP, ffmpeg: FFMPEG } };
}

module.exports = { createEngine };
