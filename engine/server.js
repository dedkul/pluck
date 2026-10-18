// Pluck engine: a tiny local server that runs yt-dlp for the Premiere panel.
// The panel can't run programs itself (UXP sandbox), so it asks this helper over localhost.

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");

const PORT = Number(process.env.PLUCK_PORT) || 47821;
const HOST = "127.0.0.1";
const VERSION = require("./package.json").version;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// ---------- Find the tools ----------
const SEARCH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(__dirname, "bin")];
function findTool(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of [...(process.env.PATH || "").split(path.delimiter), ...SEARCH_DIRS]) {
    const p = path.join(dir, exe);
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}
const YTDLP = findTool("yt-dlp");
const FFMPEG = findTool("ffmpeg");
function ytdlpVersion() {
  try { return execFileSync(YTDLP, ["--version"], { encoding: "utf8" }).trim(); } catch { return null; }
}

// ---------- Helpers ----------
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Bad JSON")); } });
  });
}

function isHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
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

// ---------- Jobs ----------
const jobs = new Map();

function startDownload({ url, outDir, quality }) {
  const id = crypto.randomUUID();
  const job = { id, status: "downloading", percent: 0, speed: "", eta: "", file: null, error: null, proc: null };
  jobs.set(id, job);
  fs.mkdirSync(outDir, { recursive: true });

  const args = [
    // --print turns on quiet mode, so --progress is needed to keep progress lines coming.
    "--no-playlist", "--newline", "--progress", "--no-mtime", "--windows-filenames",
    "--progress-template", "download:PLUCK %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "--print", "after_move:PLUCKFILE %(filepath)s",
    "-o", path.join(outDir, "%(title).80B [%(id)s].%(ext)s"),
    ...(FFMPEG ? ["--ffmpeg-location", FFMPEG] : []),
    ...formatFor(quality),
    "--", url,
  ];
  const proc = spawn(YTDLP, args);
  job.proc = proc;
  let stderr = "", buf = "";
  // yt-dlp downloads video and audio separately; track which part we're on so the bar doesn't jump back.
  let part = 0, lastPct = 0;
  const parts = quality === "audio" ? 1 : 2;

  proc.stdout.on("data", chunk => {
    buf += chunk;
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith("PLUCK ")) {
        const [pct, speed, eta] = line.slice(6).split("|").map(s => s.trim());
        const p = parseFloat(pct) || 0;
        if (p < lastPct - 50) part = Math.min(part + 1, parts - 1);
        lastPct = p;
        job.percent = Math.min(99, Math.round(((part + p / 100) / parts) * 100));
        job.speed = speed === "Unknown B/s" ? "" : speed;
        job.eta = eta;
      } else if (line.startsWith("PLUCKFILE ")) {
        job.file = line.slice(10).trim();
      } else if (/\[Merger\]|\[ExtractAudio\]/.test(line)) {
        job.status = "processing";
      }
    }
  });
  proc.stderr.on("data", c => { stderr += c; });
  const startedAt = Date.now();
  proc.on("close", code => {
    job.proc = null;
    if (job.status === "cancelled") return removePartials(outDir, startedAt);
    if (code === 0 && job.file && fs.existsSync(job.file)) { job.status = "done"; job.percent = 100; }
    else { job.status = "error"; job.error = friendlyError(stderr); console.error(stderr.trim()); }
  });
  return job;
}

// After a cancel, delete the half-finished pieces yt-dlp leaves behind (only ones from this job's time window).
function removePartials(dir, since) {
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(part|ytdl)$|\.f\d+\.\w+$|\.part-Frag\d+$/.test(name)) continue;
    const p = path.join(dir, name);
    try { if (fs.statSync(p).mtimeMs >= since - 1000) fs.unlinkSync(p); } catch {}
  }
}

function publicJob(j) {
  const { proc, ...rest } = j;
  return rest;
}

// ---------- Routes ----------
async function handle(req, res) {
  // Only answer requests addressed to localhost (blocks DNS-rebinding tricks).
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: "Forbidden host" });
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Every write needs JSON + our header. Browsers can't send that cross-site without
  // a preflight we never approve, so random websites can't drive the engine.
  if (req.method === "POST" && (req.headers["x-pluck"] !== "1" || !/application\/json/.test(req.headers["content-type"] || ""))) {
    return send(res, 403, { error: "Missing Pluck header" });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, engine: VERSION, ytdlp: YTDLP ? ytdlpVersion() : null, ffmpeg: !!FFMPEG });
  }

  if (req.method === "POST" && url.pathname === "/info") {
    const { url: link } = await readJson(req);
    if (!isHttpUrl(link)) return send(res, 400, { error: { code: "badurl", message: "That doesn't look like a link." } });
    const proc = spawn(YTDLP, ["-J", "--no-playlist", "--no-warnings", "--", link]);
    let out = "", err = "";
    proc.stdout.on("data", c => { out += c; });
    proc.stderr.on("data", c => { err += c; });
    proc.on("close", code => {
      if (code !== 0) return send(res, 422, { error: friendlyError(err) });
      try {
        const j = JSON.parse(out);
        send(res, 200, {
          title: j.title, uploader: j.uploader || j.channel || j.uploader_id || "",
          duration: j.duration || 0, thumbnail: j.thumbnail || null,
          platform: j.extractor_key || j.extractor || "", url: j.webpage_url || link, id: j.id,
        });
      } catch { send(res, 500, { error: { code: "unknown", message: "Couldn't read the video details." } }); }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/download") {
    const body = await readJson(req);
    if (!isHttpUrl(body.url)) return send(res, 400, { error: { code: "badurl", message: "That doesn't look like a link." } });
    const outDir = body.outDir && path.isAbsolute(body.outDir) ? body.outDir : path.join(os.homedir(), "Movies", "Pluck");
    const job = startDownload({ url: body.url, outDir, quality: body.quality });
    return send(res, 200, publicJob(job));
  }

  const m = url.pathname.match(/^\/jobs\/([\w-]+)(\/cancel)?$/);
  if (m) {
    const job = jobs.get(m[1]);
    if (!job) return send(res, 404, { error: "No such job" });
    if (req.method === "POST" && m[2]) {
      job.status = "cancelled";
      job.proc?.kill();
      return send(res, 200, publicJob(job));
    }
    if (req.method === "GET") return send(res, 200, publicJob(job));
  }

  // Thumbnails go through the engine so the panel only ever talks to localhost.
  if (req.method === "GET" && url.pathname === "/thumb") {
    const src = url.searchParams.get("u");
    if (!src || !src.startsWith("https://")) return send(res, 400, { error: "Bad thumbnail" });
    https.get(src, r => {
      if (r.statusCode !== 200 || !/^image\//.test(r.headers["content-type"] || "")) { r.resume(); return send(res, 502, { error: "Thumbnail failed" }); }
      res.writeHead(200, { "Content-Type": r.headers["content-type"], "Cache-Control": "max-age=3600" });
      r.pipe(res);
    }).on("error", () => send(res, 502, { error: "Thumbnail failed" }));
    return;
  }

  send(res, 404, { error: "Not found" });
}

if (!YTDLP) {
  console.error("Pluck engine: yt-dlp not found. Install it with:  brew install yt-dlp");
  process.exit(1);
}

http.createServer((req, res) => {
  handle(req, res).catch(e => send(res, 500, { error: { code: "unknown", message: e.message } }));
}).listen(PORT, HOST, () => {
  console.log(`Pluck engine ${VERSION} running on http://${HOST}:${PORT}`);
  console.log(`yt-dlp: ${YTDLP} (${ytdlpVersion()})  ffmpeg: ${FFMPEG || "not found"}`);
  console.log("Keep this window open while you use Pluck in Premiere.");
}).on("error", e => {
  if (e.code === "EADDRINUSE") { console.log("Pluck engine is already running."); process.exit(0); }
  throw e;
});
