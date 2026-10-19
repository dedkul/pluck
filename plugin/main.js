// Pluck panel. Talks to the local engine for downloading, and to Premiere for importing.

const CONFIG = {
  version: "0.2.0",
  xHandle: "feat.ashish", // TODO: confirm. X handles can't contain dots.
  repo: "https://github.com/dedkul/pluck",
  engine: "http://127.0.0.1:47821",
};

const ppro = require("premierepro");
const uxp = require("uxp");

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
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}
function openUrl(url) { uxp.shell.openExternal(url).catch(() => toast("Couldn't open the link")); }

/* ---------------- Engine API ---------------- */
async function api(path, body) {
  const opts = body
    ? { method: "POST", headers: { "Content-Type": "application/json", "X-Pluck": "1" }, body: JSON.stringify(body) }
    : {};
  const res = await fetch(CONFIG.engine + path, opts);
  const data = await res.json();
  if (!res.ok) throw (data.error && data.error.message ? data.error : { code: "unknown", message: "Something went wrong." });
  return data;
}
async function engineHealth() { try { return await api("/health"); } catch (e) { return null; } }

/* ---------------- Premiere ---------------- */
async function activeProject() {
  try { return await ppro.Project.getActiveProject(); } catch (e) { return null; }
}

// Downloads go in "<project folder>/Web Downloads". Unsaved projects fall back to ~/Movies/Pluck (decided by the engine).
async function downloadFolder() {
  const project = await activeProject();
  const p = project && project.path;
  return p ? dirName(p) + "/Web Downloads" : null;
}

async function findBin(root, name) {
  const items = await root.getItems();
  for (const item of items) {
    if (item.name !== name) continue;
    try { const folder = ppro.FolderItem.cast(item); if (folder) return folder; } catch (e) {}
  }
  return null;
}

async function getOrCreateBin(project, name) {
  const root = await project.getRootItem();
  let bin = await findBin(root, name);
  if (bin) return bin;
  try {
    project.lockedAccess(() => {
      project.executeTransaction(compound => { compound.addAction(root.createBinAction(name, false)); }, `Create ${name} bin`);
    });
    bin = await findBin(root, name);
  } catch (e) { console.log("Bin creation failed", e); }
  return bin || root;
}

async function importIntoPremiere(file) {
  const project = await activeProject();
  if (!project) throw { message: "Open a Premiere project first, then try again." };
  const bin = await getOrCreateBin(project, settings.bin);
  const ok = await project.importFiles([file], true, bin, false);
  if (!ok) throw { message: "Premiere couldn't import the file. It's saved here: " + file };
}

/* ---------------- State ---------------- */
const S = { view: "checking", url: "", info: null, quality: settings.quality, job: null, poll: null, error: null, file: null,
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
  ({ checking: vChecking, offline: vOffline, empty: vEmpty, loading: vLoading, ready: vReady,
     downloading: vDownloading, done: vDone, error: vError })[S.view]();
}

/* ---------------- Views ---------------- */
function vChecking() { main.innerHTML = `<div class="sub center" style="padding:40px 0">Starting Pluck…</div>`; }

function vOffline() {
  main.innerHTML = `
    <div class="card offline">
      <div class="result-title" style="text-align:left">The download engine isn't running</div>
      <div class="result-text" style="text-align:left">Pluck uses a small helper app to download videos. Start it once and keep its window open.</div>
      <div class="action"><sp-button id="startEngine" variant="cta" class="full">Start engine</sp-button></div>
      <ol>
        <li>Your Mac asks if Pluck can open <code>start-engine.command</code>. Click Allow.</li>
        <li>A Terminal window opens. Leave it open.</li>
        <li>Come back here and press <b>Check again</b>.</li>
      </ol>
      <div class="action"><sp-button id="recheck" variant="secondary" class="full">Check again</sp-button></div>
    </div>`;
  $("startEngine").addEventListener("click", startEngine);
  $("recheck").addEventListener("click", boot);
}

async function startEngine() {
  try {
    const folder = await uxp.storage.localFileSystem.getPluginFolder();
    await uxp.shell.openPath(folder.nativePath + "/start-engine.command");
    toast("Starting engine…");
    setTimeout(boot, 3000);
  } catch (e) {
    toast("Couldn't start it automatically. Double-click start-engine.command in the plugin folder.");
  }
}

function pasteRow(error) {
  return `
    <div class="label">Paste a video link</div>
    <div class="field">
      <sp-textfield id="url" placeholder="https://…" value="${esc(S.url)}"></sp-textfield>
      <sp-button id="get" variant="cta">Get</sp-button>
    </div>
    ${error ? `<div class="hint err">${esc(error)}</div>` : `<div class="hint">Paste with ⌘V, then press Enter.</div>`}`;
}
function bindPaste() {
  const field = $("url");
  const submit = () => lookup(field.value);
  $("get").addEventListener("click", submit);
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
    const info = await api("/info", { url });
    if (S.view !== "loading" || S.url !== url) return;
    go("ready", Object.assign({ info }, clipDefaults(info)));
  } catch (e) {
    if (S.view !== "loading") return;
    if (!(await engineHealth())) return go("offline");
    go("error", { error: e });
  }
}

function vLoading() {
  main.innerHTML = `${pasteRow()}
    <div class="card vid" style="margin-top:14px">
      <div class="thumb"></div>
      <div class="vid-meta"><div class="sub">Looking up video…</div></div>
    </div>`;
  bindPaste();
}

function videoCard(withChange) {
  const v = S.info;
  const thumb = v.thumbnail ? `<img src="${CONFIG.engine}/thumb?u=${encodeURIComponent(v.thumbnail)}">` : "";
  return `
    <div class="card vid">
      <div class="thumb">${thumb}${v.duration ? `<span class="dur">${fmt(v.duration)}</span>` : ""}</div>
      <div class="vid-meta">
        <div class="platform">${esc(v.platform)}</div>
        <div class="vid-title">${esc(v.title)}</div>
        <div class="vid-by">${esc(v.uploader)}</div>
        ${withChange ? `<div class="vid-change" id="change">Use a different link</div>` : ""}
      </div>
    </div>`;
}

function clipSection() {
  const dur = S.info.duration;
  if (!dur) return ""; // Live streams and some sites don't report a length, so clipping isn't offered.
  return `
    <div class="seg" id="seg">
      <div class="seg-btn ${S.mode === "full" ? "on" : ""}" data-m="full">Full video · ${fmt(dur)}</div>
      <div class="seg-btn ${S.mode === "clip" ? "on" : ""}" data-m="clip">Just a clip</div>
    </div>
    <div id="clipBox" class="${S.mode === "clip" ? "" : "hidden"}">
      <div class="range" id="range">
        <div class="track"></div><div class="fill" id="fill"></div>
        <div class="handle" id="hA"></div><div class="handle" id="hB"></div>
      </div>
      <div class="scale"><span>0:00</span><span>${fmt(dur / 2)}</span><span>${fmt(dur)}</span></div>
      <div class="times">
        <div class="time"><div class="label">Start</div><sp-textfield id="tA"></sp-textfield></div>
        <span class="arrow">→</span>
        <div class="time"><div class="label">End</div><sp-textfield id="tB"></sp-textfield></div>
      </div>
      <div class="hint err hidden" id="timeErr"></div>
      <div class="cliplen">
        <span class="sub">Clip length <b id="len"></b></span>
        <span class="spacer"></span>
        ${dur > 60 ? [[15, "15s"], [30, "30s"], [60, "1m"]].map(([l, t]) => `<sp-action-button size="s" class="quick" data-l="${l}">${t}</sp-action-button>`).join("") : ""}
      </div>
    </div>
    <div class="divider"></div>`;
}

// One place that keeps the slider, the time fields, the length and the button text in step.
// Adds or removes a class (default "hidden"). UXP's classList.toggle doesn't reliably take the second argument.
function showIf(el, on, cls) { if (on) el.classList.add(cls || "hidden"); else el.classList.remove(cls || "hidden"); }

function updateClip() {
  const clip = S.mode === "clip";
  if ($("fill")) {
    const dur = S.info.duration, a = (S.start / dur) * 100, b = (S.end / dur) * 100;
    $("fill").style.left = a + "%"; $("fill").style.width = b - a + "%";
    $("hA").style.left = a + "%"; $("hB").style.left = b + "%";
    $("tA").value = fmt(S.start); $("tB").value = fmt(S.end);
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
  document.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => {
    S.mode = b.getAttribute("data-m");
    document.querySelectorAll(".seg-btn").forEach(x => showIf(x, x === b, "on"));
    showIf($("clipBox"), S.mode !== "clip");
    updateClip();
  }));

  // The slider is plain boxes: Spectrum's slider only has one handle. Whichever handle is closer to the
  // pointer moves. Move/up listen on the whole document so dragging past the slider's edge still works.
  const range = $("range"), dur = S.info.duration;
  const tFromX = x => { const r = range.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * dur); };
  let dragging = null;
  const onMove = e => { if (dragging) setT(dragging, tFromX(e.clientX)); };
  const onUp = () => {
    if (dragging) $("h" + dragging).classList.remove("drag");
    dragging = null;
    document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp);
  };
  range.addEventListener("pointerdown", e => {
    const t = tFromX(e.clientX);
    dragging = e.target.id === "hA" ? "A" : e.target.id === "hB" ? "B" : Math.abs(t - S.start) <= Math.abs(t - S.end) ? "A" : "B";
    $("h" + dragging).classList.add("drag");
    setT(dragging, t);
    document.addEventListener("pointermove", onMove); document.addEventListener("pointerup", onUp);
  });

  [["tA", "A"], ["tB", "B"]].forEach(([id, which]) => {
    const field = $(id);
    const commit = () => {
      const t = parseT(field.value), err = $("timeErr");
      const problem = t === null ? "Use a time like 12:30 or 1:02:45." : t > dur ? `The video is only ${fmt(dur)} long.` : "";
      err.textContent = problem; showIf(err, !problem);
      if (problem) { field.setAttribute("invalid", ""); return; }
      field.removeAttribute("invalid");
      setT(which, t);
    };
    field.addEventListener("change", commit);
    field.addEventListener("keydown", e => { if (e.key === "Enter") commit(); });
  });

  // Quick lengths keep the start where it is; near the end of the video they pull the start back instead.
  document.querySelectorAll(".quick").forEach(b => b.addEventListener("click", () => {
    const l = Number(b.getAttribute("data-l"));
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
    <div class="opts">
      <div>
        <div class="label">Quality</div>
        <sp-picker id="quality" class="full">
          <sp-menu slot="options">
            ${items.map(([v, l]) => `<sp-menu-item value="${v}" ${v === S.quality ? "selected" : ""}>${l}</sp-menu-item>`).join("")}
          </sp-menu>
        </sp-picker>
      </div>
      <div>
        <div class="label">Import to bin</div>
        <div class="binname">${esc(settings.bin)}</div>
      </div>
    </div>
    <div class="action">
      <sp-button id="download" variant="cta" class="full"></sp-button>
      <div class="sub">Saved next to your project and added to “${esc(settings.bin)}”</div>
    </div>`;
  $("change").addEventListener("click", () => go("empty", { url: "", info: null }));
  $("quality").addEventListener("change", e => {
    S.quality = items[e.target.selectedIndex][0];
    updateClip();
  });
  $("download").addEventListener("click", startDownload);
  bindClip();
  updateClip();
}

async function startDownload() {
  const outDir = await downloadFolder();
  try {
    const clip = S.mode === "clip" ? { start: S.start, end: S.end } : {};
    const job = await api("/download", Object.assign({ url: S.info.url, quality: S.quality, outDir }, clip));
    S.startedAt = Date.now();
    go("downloading", { job });
    S.poll = setInterval(pollJob, 500);
  } catch (e) {
    go("error", { error: e });
  }
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
    <div class="action"><sp-button id="cancel" variant="secondary" class="full">Cancel</sp-button></div>`;
  setStep(0);
  $("cancel").addEventListener("click", async () => {
    try { await api(`/jobs/${S.job.id}/cancel`, {}); } catch (e) {}
    go("ready"); toast("Download cancelled");
  });
}

function setStep(n) {
  [0, 1].forEach(i => {
    const el = $("st" + i); if (!el) return;
    el.className = "step" + (i < n ? " done" : i === n ? " active" : "");
  });
}

async function pollJob() {
  let job;
  try { job = await api(`/jobs/${S.job.id}`); } catch (e) { clearInterval(S.poll); return go("offline"); }
  if (S.view !== "downloading") return;
  const fill = $("barFill"), label = $("barLabel"), right = $("barRight");
  // yt-dlp can't report a percentage while cutting a clip, so show time spent instead of a bar that never moves.
  if (S.mode === "clip" && (job.status === "downloading" || job.status === "processing")) {
    label.textContent = `Cutting your clip · ${Math.round((Date.now() - S.startedAt) / 1000)}s`;
    right.textContent = "";
  } else if (job.status === "downloading") {
    fill.style.width = job.percent * 0.9 + "%";
    label.textContent = job.percent > 0 ? `Downloading · ${job.percent}%` : "Getting ready…";
    right.textContent = job.speed || "";
  } else if (job.status === "processing") {
    fill.style.width = "90%"; label.textContent = "Finishing up…"; right.textContent = "";
  } else if (job.status === "error") {
    clearInterval(S.poll); go("error", { error: job.error });
  } else if (job.status === "done") {
    clearInterval(S.poll);
    fill.style.width = "95%"; label.textContent = "Importing…"; right.textContent = ""; setStep(1);
    try {
      await importIntoPremiere(job.file);
      go("done", { file: job.file });
    } catch (e) {
      go("error", { error: e });
    }
  }
}

function vDone() {
  main.innerHTML = `
    <div class="card result ok">
      <div class="result-icon">✓</div>
      <div class="result-title">Added to your project</div>
      <div class="result-text">Find it in the “${esc(settings.bin)}” bin.</div>
      <div class="file">${esc(baseName(S.file))}</div>
      <div class="result-actions"><sp-button id="again" variant="cta">Pluck another</sp-button></div>
    </div>`;
  $("again").addEventListener("click", () => go("empty", { url: "", info: null }));
}

function vError() {
  const e = S.error || {};
  const title = { auth: "This video needs you to sign in", private: "This video is private", age: "Age-restricted video",
    unsupported: "This site isn't supported yet", unavailable: "Video not available", network: "Connection problem" }[e.code] || "Couldn't get this video";
  main.innerHTML = `
    ${pasteRow()}
    <div class="card result bad" style="margin-top:14px">
      <div class="result-icon">!</div>
      <div class="result-title">${esc(title)}</div>
      <div class="result-text">${esc(e.message || "Something went wrong.")}</div>
      <div class="result-actions">
        ${S.url ? `<sp-button id="retry" variant="secondary">Try again</sp-button>` : ""}
        <sp-button id="reset" variant="cta">New link</sp-button>
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
  const h = await engineHealth();
  $("engineLed").className = "led " + (h ? "on" : "off");
  $("engineName").textContent = h ? `Running · yt-dlp ${h.ytdlp}` : "Not running";
  $("engineSub").textContent = h ? `Engine ${h.engine}${h.ffmpeg ? "" : " · ffmpeg missing"}` : "Start it from the main screen.";
}

function initSettings() {
  $("openSettings").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", () => { $("settings").classList.add("hidden"); if (S.view === "ready") render(); });

  const bin = $("setBin");
  bin.value = settings.bin;
  bin.addEventListener("input", e => { settings.bin = (e.target.value || "").trim() || "Web Downloads"; save("pluck.bin", settings.bin); });

  const q = ["1080p", "720p", "480p", "audio"];
  const picker = $("setQuality");
  picker.selectedIndex = Math.max(0, q.indexOf(settings.quality));
  picker.addEventListener("change", e => { settings.quality = q[e.target.selectedIndex]; S.quality = settings.quality; save("pluck.quality", settings.quality); });

  $("aboutVersion").textContent = "v" + CONFIG.version;
  $("makerHandle").textContent = "@" + CONFIG.xHandle;
  $("followBtn").addEventListener("click", () => openUrl(`https://x.com/intent/follow?screen_name=${CONFIG.xHandle}`));
  $("bugLink").addEventListener("click", () => openUrl(`${CONFIG.repo}/issues/new?labels=bug`));
  $("featureLink").addEventListener("click", () => openUrl(`${CONFIG.repo}/issues/new?labels=enhancement`));
  $("codeLink").addEventListener("click", () => openUrl(CONFIG.repo));
}

/* ---------------- Start ---------------- */
async function boot() {
  go("checking");
  const h = await engineHealth();
  go(h ? "empty" : "offline");
}

initSettings();
boot();
