// Pluck panel (CEP). Downloads with the bundled tools through Node, imports through Premiere's ExtendScript.

const CONFIG = {
  version: "0.3.4",
  xHandle: "feat_ashish",
  repo: "https://github.com/dedkul/pluck",
  releasesApi: "https://api.github.com/repos/dedkul/pluck/releases/latest",
};

/* ---------------- CEP bridges ---------------- */
// Not named "cep": Adobe already defines a global "cep", and reusing the name stops this whole file from running.
const adobeHost = window.__adobe_cep__;

// Same conversion Adobe's CSInterface.getSystemPath does: "file:///Users/..." -> "/Users/...".
function extensionRoot() {
  const p = decodeURI(adobeHost.getSystemPath("extension"));
  return /^file:\/\/\/[A-Za-z]:/.test(p) ? p.replace("file:///", "") : p.replace("file://", "");
}

// Non-ASCII characters (like the ’ in a video title) get mangled by evalScript on macOS, so they travel as \uXXXX codes.
const asciiJSON = v => JSON.stringify(v).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

// Call a function in host/premiere.jsx. Arguments go in as JSON literals, results come back as JSON.
function host(fn, ...args) {
  return new Promise(resolve => {
    adobeHost.evalScript(`${fn}(${args.map(asciiJSON).join(",")})`, raw => {
      try { resolve(JSON.parse(raw)); } catch (e) {
        // Show Premiere's actual reply (often "EvalScript error.") so a screenshot is enough to diagnose it.
        console.log(`Pluck: ${fn} returned`, raw);
        resolve({ ok: false, message: `Premiere didn't respond${raw ? ` (it said: ${String(raw).slice(0, 80)})` : ""}.` });
      }
    });
  });
}

function openUrl(url) {
  try { window.cep.util.openURLInDefaultBrowser(url); } catch (e) { toast("Couldn't open the link"); }
}

// Match Premiere's panel color (it changes with the user's brightness setting).
function matchPremiereTheme() {
  try {
    const c = JSON.parse(adobeHost.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color;
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
// saveTo is "project" (a Web Downloads folder next to the project) or a folder path. It's whatever was used last.
const settings = { bin: load("pluck.bin", "Web Downloads"), quality: load("pluck.quality", "1080p"),
  saveTo: load("pluck.saveTo", "project"), customFolder: load("pluck.customFolder", "") };

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
// Pull the first link out of whatever was pasted ("check this https://… lol" works, so does "youtu.be/abc").
function extractUrl(text) {
  const t = String(text || "").trim();
  const m = t.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) return m[0];
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S+$/i.test(t)) return "https://" + t;
  return null;
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
async function projectFolder() {
  const r = await host("pluckProjectPath");
  return r.path ? dirName(r.path) + "/Web Downloads" : null;
}
async function downloadFolder() {
  return settings.saveTo === "project" ? projectFolder() : settings.saveTo;
}

async function importIntoPremiere(file) {
  const r = await host("pluckImport", file, settings.bin);
  // The download itself worked, so always say where the file is; it can be dragged in by hand.
  if (!r.ok) throw { message: /saved here/.test(r.message) ? r.message : `${r.message} The file is saved here: ${file}` };
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
// One field, one action at a time: "Paste link" while it's empty, a clear (×) button once it has a link.
// Pasting or pressing Enter looks the video up straight away, so there's no separate "Get" step.
function pasteRow(error, hint) {
  return `
    <label class="label" for="url">Video link</label>
    <div class="field">
      <div class="input-wrap">
        <input class="input ${error ? "bad" : ""}" id="url" placeholder="Paste a YouTube, X or Instagram link" value="${esc(S.url)}" spellcheck="false">
        <button class="clear ${S.url ? "" : "hidden"}" id="clear" title="Clear link" aria-label="Clear link"><svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      </div>
      <button class="btn primary ${S.url ? "hidden" : ""}" id="paste">Paste link</button>
    </div>
    ${error ? `<div class="hint err">${esc(error)}</div>` : hint ? `<div class="hint">${hint}</div>` : ""}`;
}
function bindPaste() {
  const field = $("url");
  const sync = () => { $("clear").classList.toggle("hidden", !field.value); $("paste").classList.toggle("hidden", !!field.value); };
  field.addEventListener("input", sync);
  field.addEventListener("paste", () => setTimeout(() => lookup(field.value), 0));
  field.addEventListener("keydown", e => { if (e.key === "Enter") lookup(field.value); });
  // Premiere sometimes keeps ⌘V for itself, so this button reads the clipboard directly.
  $("paste").addEventListener("click", () => {
    const text = readClipboard();
    if (!extractUrl(text)) return toast(text ? "There's no link on your clipboard. Copy one from your browser first." : "Your clipboard is empty. Copy a link from your browser first.");
    lookup(text);
  });
  $("clear").addEventListener("click", () => { go("empty", { url: "", info: null }); $("url").focus(); });
}

function vEmpty(error) {
  main.innerHTML = `
    ${pasteRow(error, "Copy a video's link in your browser, then click <b>Paste link</b>.")}
    <div class="chips">
      <span class="chip">YouTube</span><span class="chip">X / Twitter</span><span class="chip">Instagram</span>
      <span class="chip">TikTok</span><span class="chip">Vimeo</span><span class="chip">+ many more</span>
    </div>`;
  bindPaste();
}

async function lookup(raw) {
  if (!String(raw || "").trim()) return;
  const url = extractUrl(raw);
  if (!url) { S.url = String(raw).trim(); return vEmpty("That doesn't look like a link. Copy the full address from your browser."); }
  if (url === S.url && S.view === "ready") return;
  S.url = url;
  go("loading");
  try {
    const info = await engine.info(url);
    if (S.view !== "loading" || S.url !== url) return;
    go("ready", Object.assign({ info, quality: settings.quality }, clipDefaults(info)));
  } catch (e) {
    if (S.view !== "loading") return;
    go("error", { error: e });
  }
}

function vLoading() {
  main.innerHTML = `${pasteRow()}
    <div class="card vid" style="margin-top:14px">
      <div class="thumb skeleton"></div>
      <div class="vid-meta"><div class="skeleton" style="height:11px;margin-bottom:6px"></div><div class="skeleton" style="height:11px;width:60%;margin-bottom:8px"></div><div class="sub">Finding the video…</div></div>
    </div>`;
  bindPaste();
}

function videoCard() {
  const v = S.info;
  return `
    <div class="card vid">
      <div class="thumb">${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="">` : ""}${v.duration ? `<span class="dur">${fmt(v.duration)}</span>` : ""}</div>
      <div class="vid-meta">
        <div class="platform">${esc(v.platform)}</div>
        <div class="vid-title">${esc(v.title)}</div>
        <div class="vid-by">${esc(v.uploader)}</div>
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
        <div class="handle" id="hA" tabindex="0" role="slider" aria-label="Clip start" title="Drag, or use ← → to nudge by a second"></div>
        <div class="handle" id="hB" tabindex="0" role="slider" aria-label="Clip end" title="Drag, or use ← → to nudge by a second"></div>
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
// How long converting will add, from our test on an M4 Pro Mac (DESIGN_LOG Entry 17): 4K takes about half the
// video's length at 24-30 fps and about 0.9x at 60 fps. Slower computers take longer, hence "roughly".
function convertGuess() {
  const h = parseInt(S.quality, 10), fit = (S.info.sizes || []).filter(f => f.height <= h);
  const fps = Math.max(0, ...fit.map(f => f.fps));
  const s = (S.mode === "clip" ? S.end - S.start : S.info.duration) * (fps > 30 ? 0.9 : 0.5);
  return s < 60 ? "under a minute" : `${Math.round(s / 60)} min`;
}

// "about 2 min left", from how fast the percentage has been climbing in this step.
function timeLeft(step, pct) {
  if (S.step !== step) Object.assign(S, { step, stepAt: Date.now() });
  if (pct < 3) return "";
  const s = ((Date.now() - S.stepAt) / 1000) * (100 - pct) / pct;
  return s < 60 ? `about ${Math.max(5, Math.round(s / 5) * 5)} s left` : `about ${Math.round(s / 60)} min left`;
}

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
  const audio = S.quality === "audio" || S.quality === "wav";
  $("qualityHint").textContent = engine.needsConversion(S.quality)
    ? `Takes longer: Premiere can't open 1440p or 4K the way sites send it, so Pluck converts it. Roughly ${convertGuess()} extra for this ${clip ? "clip" : "video"}.`
    : S.quality === "original" ? "Saves the file exactly as the site sends it (often WebM). Premiere may not open it, and clips start a few seconds early." : "";
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

  // Whichever handle is closer to the mouse moves. Plain mouse events, not pointer events: Premiere doesn't pass
  // pointer drags through to panels reliably. Move/up listen on the whole page so dragging past the ends works.
  const range = $("range"), dur = S.info.duration;
  const tFromX = x => { const r = range.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * dur); };
  let dragging = null;
  const onMove = e => { if (dragging) { e.preventDefault(); setT(dragging, tFromX(e.clientX)); } };
  const onUp = () => {
    if (dragging) $("h" + dragging).classList.remove("drag");
    dragging = null;
    document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp);
  };
  range.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    e.preventDefault(); // stops the drag from selecting text
    const t = tFromX(e.clientX);
    // Pick by which side of the midpoint between the handles was clicked. On a long video a short clip puts the
    // handles on top of each other; this way grabbing just left of them moves Start and just right moves End.
    dragging = t < (S.start + S.end) / 2 ? "A" : t > (S.start + S.end) / 2 ? "B" : e.clientX < $("hB").getBoundingClientRect().left + 9 ? "A" : "B";
    $("h" + dragging).classList.add("drag");
    $("h" + dragging).focus();
    setT(dragging, t);
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  });
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
      if (problem) return;
      // Typing a start after the end (or an end before the start) moves the whole clip and keeps its length.
      const len = S.end - S.start;
      if (which === "A" && t >= S.end) { S.start = Math.min(t, dur - 1); S.end = Math.min(dur, S.start + len); updateClip(); }
      else if (which === "B" && t <= S.start) { S.end = Math.max(t, 1); S.start = Math.max(0, S.end - len); updateClip(); }
      else setT(which, t);
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

// Only offer sizes this video actually has, labelled with the real size and its frame rate when above 30 fps.
// Each choice covers the sizes down to the next one (a 1600-pixel-tall film shows as "1600p" under the 4K choice).
// Sites that don't list sizes get the usual 1080p / 720p / 480p.
function qualityItems(info) {
  const sizes = info.sizes || [], tops = [2160, 1440, 1080, 720, 480];
  let video = tops.map((h, i) => {
    const fit = sizes.filter(f => f.height <= h && f.height > (tops[i + 1] || 0));
    if (!fit.length) return null;
    const best = Math.max(...fit.map(f => f.height)), fps = Math.max(...fit.filter(f => f.height === best).map(f => f.fps));
    return [h + "p", (best === 2160 ? "4K" : best + "p") + (fps > 30 ? ` · ${fps} fps` : "")];
  }).filter(Boolean);
  if (!video.length) video = [["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"]];
  video[0][1] += " (best)";
  // Audio is offered as the site sends it: asking for a higher bitrate than the source can't add quality.
  const kbps = info.audioKbps ? ` · ${info.audioKbps} kbps` : "";
  return video.concat([["audio", `Audio only (M4A${kbps})`], ["wav", "Audio only (WAV, uncompressed)"], ["original", "Original file (no conversion)"]]);
}

function vReady() {
  const items = qualityItems(S.info);
  // The default from Settings may be bigger than this video goes; fall back to the best it has.
  if (!items.some(([v]) => v === S.quality)) {
    const smaller = items.find(([v]) => parseInt(v, 10) <= parseInt(S.quality, 10));
    S.quality = (smaller || items[0])[0];
  }
  main.innerHTML = `
    ${pasteRow()}
    <div style="margin-top:12px">${videoCard()}</div>
    ${clipSection()}
    <div class="divider"></div>
    <div class="opts">
      <div>
        <label class="label" for="quality">Quality</label>
        <select class="input full" id="quality">
          ${items.map(([v, l]) => `<option value="${v}" ${v === S.quality ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <div class="sub" id="qualityHint" style="margin-top:5px"></div>
      </div>
      <div>
        <div class="label">Import to bin</div>
        <div class="binname">${esc(settings.bin)}</div>
      </div>
    </div>
    <div class="set">
      <label class="label" for="saveTo">Save to</label>
      ${saveToPicker()}
      <div class="sub" id="saveToPath"></div>
    </div>
    <div class="action">
      <button class="btn primary big full" id="download"></button>
    </div>`;
  bindPaste();
  bindSaveTo();
  $("quality").addEventListener("change", e => { S.quality = e.target.value; updateClip(); });
  $("download").addEventListener("click", startDownload);
  bindClip();
  updateClip();
}

/* ---------------- Save to (remembers the last folder used) ---------------- */
function saveToPicker() {
  const custom = settings.customFolder;
  return `
    <select class="input full" id="saveTo">
      <option value="project" ${settings.saveTo === "project" ? "selected" : ""}>Project folder › Web Downloads</option>
      ${custom ? `<option value="custom" ${settings.saveTo === custom ? "selected" : ""}>${esc(baseName(custom))}</option>` : ""}
      <option value="choose">Choose a folder…</option>
    </select>`;
}

async function showSavePath() {
  const el = $("saveToPath"); if (!el) return;
  if (settings.saveTo !== "project") { el.textContent = settings.saveTo; return; }
  const folder = await projectFolder();
  if ($("saveToPath")) $("saveToPath").textContent = folder || "Save your project first. Until then, files go to Movies/Pluck.";
}

function setSaveTo(value) {
  settings.saveTo = value; save("pluck.saveTo", value);
  if (value !== "project") { settings.customFolder = value; save("pluck.customFolder", value); }
}

function bindSaveTo() {
  const sel = $("saveTo");
  sel.addEventListener("change", () => {
    if (sel.value === "project") setSaveTo("project");
    else if (sel.value === "custom") setSaveTo(settings.customFolder);
    else {
      const start = settings.saveTo === "project" ? "" : settings.saveTo;
      const r = window.cep.fs.showOpenDialogEx(false, true, "Choose where Pluck saves videos", start);
      if (r && !r.err && r.data && r.data[0]) setSaveTo(r.data[0]);
    }
    sel.outerHTML = saveToPicker(); // rebuild so a newly picked folder shows by name
    bindSaveTo();
    showSavePath();
  });
  showSavePath();
}

async function startDownload() {
  // A remembered folder can disappear (an unplugged drive). Fall back to the project folder and say so.
  if (settings.saveTo !== "project" && !require("fs").existsSync(settings.saveTo)) {
    setSaveTo("project"); render();
    return toast("That folder isn't available anymore, so Pluck switched back to your project folder.");
  }
  const outDir = await downloadFolder();
  const clip = S.mode === "clip" ? { start: S.start, end: S.end } : null;
  const job = engine.download({ url: S.info.url, quality: S.quality, outDir, clip });
  S.startedAt = Date.now(); S.step = null;
  go("downloading", { job });
  S.poll = setInterval(pollJob, 400);
}

function vDownloading() {
  // A full 1440p/4K video gets its own "Converting" step; a clip is converted while it downloads.
  const converts = engine.needsConversion(S.quality) && S.mode !== "clip";
  main.innerHTML = `
    ${videoCard()}
    <div class="bar ${S.mode === "clip" ? "hidden" : ""}"><div class="bar-fill" id="barFill"></div></div>
    <div class="bar-meta"><span id="barLabel">Getting ready…</span><span id="barRight"></span></div>
    <div class="steps">
      <div class="step"><span class="dot"></span>${S.mode === "clip" ? `Downloading ${fmt(S.start)} – ${fmt(S.end)}` : "Downloading"}</div>
      ${converts ? `<div class="step"><span class="dot"></span>Converting for Premiere</div>` : ""}
      <div class="step"><span class="dot"></span>Importing into “${esc(settings.bin)}”</div>
    </div>
    <div class="action"><button class="btn big full" id="cancel">Cancel</button></div>`;
  setStep(0);
  $("cancel").addEventListener("click", () => { engine.cancel(S.job); go("ready"); toast("Download cancelled"); });
}

function setStep(n) {
  document.querySelectorAll(".step").forEach((el, i) => { el.className = "step" + (i < n ? " done" : i === n ? " active" : ""); });
}

let importing = false;
async function pollJob() {
  const job = S.job;
  if (S.view !== "downloading" || importing) return;
  const fill = $("barFill"), label = $("barLabel"), right = $("barRight");
  const half = engine.needsConversion(S.quality) ? 0.45 : 0.9; // converting videos: download fills the first half
  // A clip's percentage comes from ffmpeg's progress report, which starts a few seconds in.
  if (S.mode === "clip" && (job.status === "downloading" || job.status === "processing")) {
    const what = engine.needsConversion(S.quality) ? "Downloading and converting your clip" : "Cutting your clip";
    fill.parentNode.classList.toggle("hidden", !job.percent);
    fill.style.width = job.percent * 0.9 + "%";
    label.textContent = job.percent ? `${what} · ${job.percent}%` : `${what}…`;
    right.textContent = timeLeft("clip", job.percent);
  } else if (job.status === "downloading") {
    fill.style.width = job.percent * half + "%";
    label.textContent = job.percent > 0 ? `Downloading · ${job.percent}%` : "Getting ready…";
    right.textContent = [job.speed, timeLeft("download", job.percent)].filter(Boolean).join(" · ");
  } else if (job.status === "processing") {
    fill.style.width = half * 100 + "%"; label.textContent = "Finishing up…"; right.textContent = "";
  } else if (job.status === "converting") {
    setStep(1);
    fill.style.width = 45 + job.percent * 0.45 + "%"; label.textContent = `Converting for Premiere · ${job.percent}%`;
    right.textContent = timeLeft("convert", job.percent);
  } else if (job.status === "error") {
    go("error", { error: job.error });
  } else if (job.status === "done") {
    clearInterval(S.poll);
    fill.style.width = "95%"; label.textContent = "Importing…"; right.textContent = ""; setStep(document.querySelectorAll(".step").length - 1);
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
      <div class="result-actions"><button class="btn primary" id="again">Download another video</button></div>
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
      ${S.url ? `<div class="result-actions"><button class="btn primary" id="retry">Try again</button></div>` : ""}
    </div>`;
  bindPaste();
  if ($("retry")) $("retry").addEventListener("click", () => { if (S.info) return go("ready"); const u = S.url; S.url = ""; lookup(u); });
}

/* ---------------- Settings sheet ---------------- */
// Opens instantly; the tool check fills in when it's ready (it's usually done already, see the bottom of this file).
async function openSettings() {
  $("settings").classList.remove("hidden");
  $("settings").scrollTop = 0;
  const st = await engine.status();
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
  $("updateBtn").addEventListener("click", () => (update.latest ? installUpdate() : checkForUpdate(true)));
  $("bannerGet").addEventListener("click", installUpdate);
  $("bannerClose").addEventListener("click", () => { save("pluck.dismissed", update.latest); $("banner").classList.add("hidden"); });
}

/* ---------------- Updates ---------------- */
// Pluck asks GitHub for the newest release: quietly once a day, or when "Check for updates" is clicked.
// A newer version shows a banner above the panel and an "Install update" button in Settings.
// state: null, "installing", "failed" (the buttons then open the download page) or "done".
const update = { latest: null, release: null, state: null, url: CONFIG.repo + "/releases/latest" };
const updater = require(extensionRoot() + "/lib/updater.js");

function isNewer(a, b) { // "0.4.0" vs "0.3.1"
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function showUpdateState(text, button) {
  $("updateStatus").textContent = text;
  $("updateBtn").textContent = button;
}

async function checkForUpdate(manual) {
  if (manual) { showUpdateState("Checking…", "Check for updates"); $("updateBtn").disabled = true; }
  try {
    const res = await fetch(CONFIG.releasesApi, { headers: { Accept: "application/vnd.github+json" } });
    const rel = res.status === 404 ? null : await res.json(); // 404 = nothing released yet
    save("pluck.lastCheck", String(Date.now()));
    const v = rel && rel.tag_name ? rel.tag_name.replace(/^v/, "") : null;
    if (v && isNewer(v, CONFIG.version)) {
      if (update.state) return; // an install already started; keep its messages
      update.latest = v; update.release = rel; update.url = rel.html_url || update.url;
      showUpdateState(`Version ${v} is available.`, "Install update");
      $("bannerText").textContent = `Pluck ${v} is available.`;
      if (manual || load("pluck.dismissed", "") !== v) $("banner").classList.remove("hidden");
    } else if (manual) showUpdateState("You're on the latest version.", "Check for updates");
  } catch (e) {
    if (manual) showUpdateState("Couldn't check. Are you online?", "Try again");
  }
  $("updateBtn").disabled = false;
}

// Downloads the new version and swaps it in. The banner and Settings both show how it's going.
async function installUpdate() {
  if (update.state === "failed" || updater.isDevInstall(extensionRoot())) return openUrl(update.url);
  if (update.state) return;
  update.state = "installing";
  const say = text => { $("bannerText").textContent = text; $("updateStatus").textContent = text; };
  $("banner").classList.remove("hidden");
  $("bannerGet").disabled = $("updateBtn").disabled = true;
  try {
    const v = await updater.installUpdate(update.release, extensionRoot(), say);
    update.state = "done";
    say(`Pluck ${v} is installed. Close and reopen the Pluck panel (or restart Premiere) to use it.`);
    $("bannerGet").classList.add("hidden");
    $("updateBtn").textContent = "Installed";
  } catch (e) {
    console.log("Pluck: update failed", e, e.cause);
    update.state = "failed";
    say(e.message);
    $("bannerGet").textContent = $("updateBtn").textContent = "Download page";
    $("bannerGet").disabled = $("updateBtn").disabled = false;
  }
}

/* ---------------- Start ---------------- */
matchPremiereTheme();
initSettings();
render();
setTimeout(() => {
  engine.status(); // warm up the slow tool check so Settings has the answer ready
  if (Date.now() - Number(load("pluck.lastCheck", "0")) > 24 * 3600 * 1000) checkForUpdate(false);
}, 1500);
