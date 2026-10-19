// Pluck panel (CEP). Downloads with the bundled tools through Node, imports through Premiere's ExtendScript.

const CONFIG = {
  version: "0.3.0",
  xHandle: "feat_ashish",
  repo: "https://github.com/dedkul/pluck",
};

/* ---------------- CEP bridges ---------------- */
const cep = window.__adobe_cep__;

// Same conversion Adobe's CSInterface.getSystemPath does: "file:///Users/..." -> "/Users/...".
function extensionRoot() {
  const p = decodeURI(cep.getSystemPath("extension"));
  return /^file:\/\/\/[A-Za-z]:/.test(p) ? p.replace("file:///", "") : p.replace("file://", "");
}

// Call a function in host/premiere.jsx. Arguments go in as JSON literals, results come back as JSON.
function host(fn, ...args) {
  return new Promise(resolve => {
    cep.evalScript(`${fn}(${args.map(a => JSON.stringify(a)).join(",")})`, raw => {
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({ ok: false, message: "Premiere didn't respond. Try again." }); }
    });
  });
}

function openUrl(url) {
  try { window.cep.util.openURLInDefaultBrowser(url); } catch (e) { toast("Couldn't open the link"); }
}

// Match Premiere's panel color (it changes with the user's brightness setting).
function matchPremiereTheme() {
  try {
    const c = JSON.parse(cep.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color;
    const rgb = `rgb(${Math.round(c.red)}, ${Math.round(c.green)}, ${Math.round(c.blue)})`;
    document.documentElement.style.setProperty("--bg", rgb);
  } catch (e) {}
}

// Some Premiere versions swallow ⌘V before the panel sees it, so the Paste button reads the clipboard directly.
function readClipboard() {
  const { execFileSync } = require("child_process");
  try {
    return process.platform === "win32"
      ? execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { encoding: "utf8" }).trim()
      : execFileSync("pbpaste", { encoding: "utf8" }).trim();
  } catch (e) { return ""; }
}

const engine = require(extensionRoot() + "/lib/engine.js").createEngine(extensionRoot());

/* ---------------- Settings (remembered between sessions) ---------------- */
function load(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
const settings = { bin: load("pluck.bin", "Web Downloads"), quality: load("pluck.quality", "1080p") };

/* ---------------- Small helpers ---------------- */
const $ = id => document.getElementById(id);
const main = $("main");
const pad = n => String(n).padStart(2, "0");
function fmt(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}
// "12:30" -> 750, "1:02:45" -> 3765, "90" -> 90. Returns null if it can't be read.
function parseT(str) {
  const parts = String(str || "").trim().split(":");
  if (parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}
function esc(s) { return String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function baseName(p) { return String(p).split(/[\\/]/).pop(); }
function dirName(p) { const parts = String(p).split(/[\\/]/); parts.pop(); return parts.join("/"); }
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}

/* ---------------- Premiere ---------------- */
// Downloads go in "<project folder>/Web Downloads". Unsaved projects fall back to ~/Movies/Pluck.
async function downloadFolder() {
  const r = await host("pluckProjectPath");
  return r.path ? dirName(r.path) + "/Web Downloads" : null;
}

async function importIntoPremiere(file) {
  const r = await host("pluckImport", file, settings.bin);
  if (!r.ok) throw { message: r.message };
}

/* ---------------- State ---------------- */
const S = { view: "empty", url: "", info: null, quality: settings.quality, job: null, poll: null, error: null, file: null,
  mode: "full", start: 0, end: 0 };

// Long videos (over 10 min) open in clip mode: people rarely want all of a long video.
function clipDefaults(info) {
  const d = info.duration || 0;
  return { mode: d > 600 ? "clip" : "full", start: 0, end: Math.min(60, d) };
}

function go(view, patch) {
  Object.assign(S, patch || {}, { view });
  clearInterval(S.poll);
  render();
}

function render() {
  ({ empty: vEmpty, loading: vLoading, ready: vReady, downloading: vDownloading, done: vDone, error: vError })[S.view]();
}

/* ---------------- Views ---------------- */
function pasteRow(error) {
  return `
    <label class="label" for="url">Paste a video link</label>
    <div class="field">
      <input class="input ${error ? "bad" : ""}" id="url" placeholder="https://…" value="${esc(S.url)}" spellcheck="false">
      <button class="btn" id="paste" title="Paste from clipboard">Paste</button>
      <button class="btn primary" id="get">Get</button>
    </div>
    ${error ? `<div class="hint err">${esc(error)}</div>` : `<div class="hint">Copy a link in your browser, then click Paste.</div>`}`;
}
function bindPaste() {
  const field = $("url");
  const submit = () => lookup(field.value);
  $("get").addEventListener("click", submit);
  $("paste").addEventListener("click", () => {
    const text = readClipboard();
    if (!text) return toast("Your clipboard is empty");
    field.value = text; submit();
  });
  field.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
}

function vEmpty(error) {
  main.innerHTML = `
    ${pasteRow(error)}
    <div class="chips">
      <span class="chip">YouTube</span><span class="chip">X / Twitter</span><span class="chip">Instagram</span>
      <span class="chip">TikTok</span><span class="chip">Vimeo</span><span class="chip">+ many more</span>
    </div>`;
  bindPaste();
}

async function lookup(raw) {
  const url = String(raw || "").trim();
  if (!url) return;
  S.url = url;
  if (!/^https?:\/\//i.test(url)) return vEmpty("That doesn't look like a link. Copy the full address from your browser.");
  go("loading");
  try {
    const info = await engine.info(url);
    if (S.view !== "loading" || S.url !== url) return;
    go("ready", Object.assign({ info }, clipDefaults(info)));
  } catch (e) {
    if (S.view !== "loading") return;
    go("error", { error: e });
  }
}

function vLoading() {
  main.innerHTML = `${pasteRow()}
    <div class="card vid" style="margin-top:14px">
      <div class="thumb skeleton"></div>
      <div class="vid-meta"><div class="skeleton" style="height:11px;margin-bottom:6px"></div><div class="skeleton" style="height:11px;width:60%;margin-bottom:8px"></div><div class="sub">Looking up video…</div></div>
    </div>`;
  bindPaste();
}

function videoCard(withChange) {
  const v = S.info;
  return `
    <div class="card vid">
      <div class="thumb">${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="">` : ""}${v.duration ? `<span class="dur">${fmt(v.duration)}</span>` : ""}</div>
      <div class="vid-meta">
        <div class="platform">${esc(v.platform)}</div>
        <div class="vid-title">${esc(v.title)}</div>
        <div class="vid-by">${esc(v.uploader)}</div>
        ${withChange ? `<button class="vid-change" id="change">Use a different link</button>` : ""}
      </div>
    </div>`;
}

function clipSection() {
  const dur = S.info.duration;
  if (!dur) return ""; // Live streams and some sites don't report a length, so clipping isn't offered.
  return `
    <div class="seg" id="seg">
      <button class="${S.mode === "full" ? "on" : ""}" data-m="full">Full video · ${fmt(dur)}</button>
      <button class="${S.mode === "clip" ? "on" : ""}" data-m="clip">Just a clip</button>
    </div>
    <div id="clipBox" class="${S.mode === "clip" ? "" : "hidden"}">
      <div class="range" id="range">
        <div class="track"></div><div class="fill" id="fill"></div>
        <div class="handle" id="hA" tabindex="0" role="slider" aria-label="Clip start"></div>
        <div class="handle" id="hB" tabindex="0" role="slider" aria-label="Clip end"></div>
      </div>
      <div class="scale"><span>0:00</span><span>${fmt(dur / 2)}</span><span>${fmt(dur)}</span></div>
      <div class="times">
        <div><label class="label" for="tA">Start</label><input class="input" id="tA"></div>
        <span class="arrow">→</span>
        <div><label class="label" for="tB">End</label><input class="input" id="tB"></div>
      </div>
      <div class="hint err hidden" id="timeErr"></div>
      <div class="cliplen">
        <span class="sub">Clip length <b id="len"></b></span>
        <span class="spacer"></span>
        ${dur > 60 ? [[15, "15s"], [30, "30s"], [60, "1m"]].map(([l, t]) => `<button class="btn small quick" data-l="${l}">${t}</button>`).join("") : ""}
      </div>
    </div>`;
}

// One place that keeps the slider, the time fields, the length and the button text in step.
function updateClip() {
  const clip = S.mode === "clip";
  if ($("fill")) {
    const dur = S.info.duration, a = (S.start / dur) * 100, b = (S.end / dur) * 100;
    $("fill").style.left = a + "%"; $("fill").style.width = b - a + "%";
    $("hA").style.left = a + "%"; $("hB").style.left = b + "%";
    if (document.activeElement !== $("tA")) $("tA").value = fmt(S.start);
    if (document.activeElement !== $("tB")) $("tB").value = fmt(S.end);
    $("len").textContent = fmt(S.end - S.start);
  }
  const audio = S.quality === "audio";
  $("download").textContent = clip
    ? `Download ${audio ? "audio clip" : "clip"} (${fmt(S.end - S.start)})`
    : audio ? "Download audio" : "Download video";
}

// Move one end of the clip, keeping at least 1 second between start and end.
function setT(which, t) {
  const dur = S.info.duration;
  if (which === "A") S.start = Math.max(0, Math.min(t, S.end - 1));
  else S.end = Math.min(dur, Math.max(t, S.start + 1));
  updateClip();
}

function bindClip() {
  if (!$("seg")) return;
  document.querySelectorAll("#seg button").forEach(b => b.addEventListener("click", () => {
    S.mode = b.dataset.m;
    document.querySelectorAll("#seg button").forEach(x => x.classList.toggle("on", x === b));
    $("clipBox").classList.toggle("hidden", S.mode !== "clip");
    updateClip();
  }));

  // Whichever handle is closer to the pointer moves. Pointer capture keeps the drag going past the edges.
  const range = $("range"), dur = S.info.duration;
  const tFromX = x => { const r = range.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * dur); };
  let dragging = null;
  range.addEventListener("pointerdown", e => {
    const t = tFromX(e.clientX);
    dragging = e.target.id === "hA" ? "A" : e.target.id === "hB" ? "B" : Math.abs(t - S.start) <= Math.abs(t - S.end) ? "A" : "B";
    range.setPointerCapture(e.pointerId);
    $("h" + dragging).classList.add("drag");
    setT(dragging, t);
  });
  range.addEventListener("pointermove", e => { if (dragging) setT(dragging, tFromX(e.clientX)); });
  const end = () => { if (dragging) $("h" + dragging).classList.remove("drag"); dragging = null; };
  range.addEventListener("pointerup", end); range.addEventListener("pointercancel", end);
  ["A", "B"].forEach(w => $("h" + w).addEventListener("keydown", e => {
    const step = e.shiftKey ? 10 : 1, cur = w === "A" ? S.start : S.end;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setT(w, cur - step); e.preventDefault(); }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { setT(w, cur + step); e.preventDefault(); }
  }));

  [["tA", "A"], ["tB", "B"]].forEach(([id, which]) => {
    const field = $(id);
    const commit = () => {
      const t = parseT(field.value), err = $("timeErr");
      const problem = t === null ? "Use a time like 12:30 or 1:02:45." : t > dur ? `The video is only ${fmt(dur)} long.` : "";
      err.textContent = problem; err.classList.toggle("hidden", !problem); field.classList.toggle("bad", !!problem);
      if (!problem) setT(which, t);
    };
    field.addEventListener("change", commit);
    field.addEventListener("keydown", e => { if (e.key === "Enter") { commit(); field.blur(); } });
  });

  // Quick lengths keep the start where it is; near the end of the video they pull the start back instead.
  document.querySelectorAll(".quick").forEach(b => b.addEventListener("click", () => {
    const l = Number(b.dataset.l);
    S.end = Math.min(dur, S.start + l);
    S.start = Math.max(0, S.end - l);
    updateClip();
  }));
}

function vReady() {
  const items = [["1080p", "1080p (best)"], ["720p", "720p"], ["480p", "480p"], ["audio", "Audio only"]];
  main.innerHTML = `
    ${videoCard(true)}
    ${clipSection()}
    <div class="divider"></div>
    <div class="opts">
      <div>
        <label class="label" for="quality">Quality</label>
        <select class="input full" id="quality">
          ${items.map(([v, l]) => `<option value="${v}" ${v === S.quality ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="label">Import to bin</div>
        <div class="binname">${esc(settings.bin)}</div>
      </div>
    </div>
    <div class="action">
      <button class="btn primary big full" id="download"></button>
      <div class="sub">Saved next to your project and added to “${esc(settings.bin)}”</div>
    </div>`;
  $("change").addEventListener("click", () => go("empty", { url: "", info: null }));
  $("quality").addEventListener("change", e => { S.quality = e.target.value; updateClip(); });
  $("download").addEventListener("click", startDownload);
  bindClip();
  updateClip();
}

async function startDownload() {
  const outDir = await downloadFolder();
  const clip = S.mode === "clip" ? { start: S.start, end: S.end } : null;
  const job = engine.download({ url: S.info.url, quality: S.quality, outDir, clip });
  S.startedAt = Date.now();
  go("downloading", { job });
  S.poll = setInterval(pollJob, 400);
}

function vDownloading() {
  main.innerHTML = `
    ${videoCard(false)}
    <div class="bar ${S.mode === "clip" ? "hidden" : ""}"><div class="bar-fill" id="barFill"></div></div>
    <div class="bar-meta"><span id="barLabel">Getting ready…</span><span id="barRight"></span></div>
    <div class="steps">
      <div class="step" id="st0"><span class="dot"></span>${S.mode === "clip" ? `Downloading ${fmt(S.start)} – ${fmt(S.end)}` : "Downloading"}</div>
      <div class="step" id="st1"><span class="dot"></span>Importing into “${esc(settings.bin)}”</div>
    </div>
    <div class="action"><button class="btn big full" id="cancel">Cancel</button></div>`;
  setStep(0);
  $("cancel").addEventListener("click", () => { engine.cancel(S.job); go("ready"); toast("Download cancelled"); });
}

function setStep(n) {
  [0, 1].forEach(i => { const el = $("st" + i); if (el) el.className = "step" + (i < n ? " done" : i === n ? " active" : ""); });
}

let importing = false;
async function pollJob() {
  const job = S.job;
  if (S.view !== "downloading" || importing) return;
  const fill = $("barFill"), label = $("barLabel"), right = $("barRight");
  // yt-dlp can't report a percentage while cutting a clip, so show time spent instead of a bar that never moves.
  if (S.mode === "clip" && (job.status === "downloading" || job.status === "processing")) {
    label.textContent = `Cutting your clip · ${Math.round((Date.now() - S.startedAt) / 1000)}s`;
  } else if (job.status === "downloading") {
    fill.style.width = job.percent * 0.9 + "%";
    label.textContent = job.percent > 0 ? `Downloading · ${job.percent}%` : "Getting ready…";
    right.textContent = job.speed || "";
  } else if (job.status === "processing") {
    fill.style.width = "90%"; label.textContent = "Finishing up…"; right.textContent = "";
  } else if (job.status === "error") {
    go("error", { error: job.error });
  } else if (job.status === "done") {
    clearInterval(S.poll);
    fill.style.width = "95%"; label.textContent = "Importing…"; right.textContent = ""; setStep(1);
    importing = true;
    try {
      await importIntoPremiere(job.file);
      go("done", { file: job.file });
    } catch (e) {
      go("error", { error: e });
    } finally { importing = false; }
  }
}

function vDone() {
  main.innerHTML = `
    <div class="card result ok">
      <div class="result-icon">✓</div>
      <div class="result-title">Added to your project</div>
      <div class="result-text">Find it in the “${esc(settings.bin)}” bin.</div>
      <div class="file">${esc(baseName(S.file))}</div>
      <div class="result-actions"><button class="btn primary" id="again">Pluck another</button></div>
    </div>`;
  $("again").addEventListener("click", () => go("empty", { url: "", info: null }));
}

function vError() {
  const e = S.error || {};
  const title = { auth: "This video needs you to sign in", private: "This video is private", age: "Age-restricted video",
    unsupported: "This site isn't supported yet", unavailable: "Video not available", network: "Connection problem",
    tools: "Pluck's download tool is missing" }[e.code] || "Couldn't get this video";
  main.innerHTML = `
    ${pasteRow()}
    <div class="card result bad" style="margin-top:14px">
      <div class="result-icon">!</div>
      <div class="result-title">${esc(title)}</div>
      <div class="result-text">${esc(e.message || "Something went wrong.")}</div>
      <div class="result-actions">
        ${S.url ? `<button class="btn" id="retry">Try again</button>` : ""}
        <button class="btn primary" id="reset">New link</button>
      </div>
    </div>`;
  bindPaste();
  if ($("retry")) $("retry").addEventListener("click", () => (S.info ? go("ready") : lookup(S.url)));
  $("reset").addEventListener("click", () => go("empty", { url: "", info: null }));
}

/* ---------------- Settings sheet ---------------- */
async function openSettings() {
  $("settings").classList.remove("hidden");
  const folder = await downloadFolder();
  $("setFolder").textContent = folder || "~/Movies/Pluck (save your project to keep media next to it)";
  const st = engine.status();
  $("toolsLed").className = "led " + (st.ytdlp && st.ffmpeg ? "on" : "off");
  $("toolsName").textContent = st.ytdlp ? `yt-dlp ${st.ytdlp}` : "yt-dlp is missing";
  $("toolsSub").textContent = !st.ffmpeg ? "ffmpeg is missing" : st.bundled ? "Built into Pluck" : "Using tools installed on this computer";
}

function initSettings() {
  $("openSettings").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", () => { $("settings").classList.add("hidden"); if (S.view === "ready") render(); });

  const bin = $("setBin");
  bin.value = settings.bin;
  bin.addEventListener("input", e => { settings.bin = e.target.value.trim() || "Web Downloads"; save("pluck.bin", settings.bin); });

  const q = $("setQuality");
  q.value = settings.quality;
  q.addEventListener("change", e => { settings.quality = e.target.value; S.quality = settings.quality; save("pluck.quality", settings.quality); });

  $("aboutVersion").textContent = "v" + CONFIG.version;
  $("makerHandle").textContent = "@" + CONFIG.xHandle;
  $("followBtn").addEventListener("click", () => openUrl(`https://x.com/intent/follow?screen_name=${CONFIG.xHandle}`));
  const link = (id, url) => $(id).addEventListener("click", e => { e.preventDefault(); openUrl(url); });
  link("bugLink", `${CONFIG.repo}/issues/new?labels=bug`);
  link("featureLink", `${CONFIG.repo}/issues/new?labels=enhancement`);
  link("codeLink", CONFIG.repo);
}

/* ---------------- Start ---------------- */
matchPremiereTheme();
initSettings();
render();
