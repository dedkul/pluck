// Pluck updater: downloads a newer release from GitHub and swaps it in place of the installed extension.
// Plain Node like engine.js (CEP's older Node 15+), so it can be tested outside Premiere.
// The old version stays in place until the new one is downloaded, unpacked and checked, so a failed update changes nothing.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");

const isWin = process.platform === "win32";

// A developer install is a link to a git checkout. Updating it would overwrite the working copy, so it's left to git.
function isDevInstall(root) {
  try { return fs.lstatSync(root).isSymbolicLink() || fs.existsSync(path.join(fs.realpathSync(root), "..", ".git")); }
  catch (e) { return true; }
}

// The zip scripts/package.sh builds for this computer: Pluck-<version>-mac.zip or -win.zip.
function pickAsset(release) {
  const name = `Pluck-${release.tag_name.replace(/^v/, "")}-${isWin ? "win" : "mac"}.zip`;
  return (release.assets || []).find(a => a.name === name) || null;
}

// Turns any failure into a sentence for the panel. Permission problems get their own, since retrying won't help.
function explain(e, message) {
  const denied = e && (e.code === "EACCES" || e.code === "EPERM");
  const err = new Error(denied ? "Pluck isn't allowed to change its own folder, so it can't update itself." : message);
  err.cause = e;
  return err;
}

// GitHub sends release files from another server, so redirects are followed.
function download(url, dest, onProgress, redirects) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Pluck", Accept: "application/octet-stream" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, onProgress, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("GitHub answered " + res.statusCode)); }
      const total = Number(res.headers["content-length"]) || 0;
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on("data", chunk => { got += chunk.length; if (total) onProgress(got / total); });
      res.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => (total && got !== total ? reject(new Error("Download was cut short")) : resolve()));
      res.pipe(out);
    });
    req.setTimeout(30000, () => req.destroy(new Error("No answer for 30 s")));
    req.on("error", reject);
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 120000 }, (err, out, errText) =>
    err ? reject(new Error(String(errText || err.message).trim())) : resolve()));
}

function unzip(zip, dir) {
  if (!isWin) return run("ditto", ["-x", "-k", zip, dir]);
  const q = p => "'" + p.replace(/'/g, "''") + "'"; // PowerShell quoting
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dir)} -Force`]);
}

// Installs `release` (GitHub's answer for the latest release) over the extension folder at `root`.
// onStatus gets short progress lines for the panel. Throws an Error with a plain-language message on failure.
async function installUpdate(release, root, onStatus) {
  const version = release.tag_name.replace(/^v/, "");
  const asset = pickAsset(release);
  if (!asset) throw new Error(`Pluck ${version} doesn't have a ${isWin ? "Windows" : "Mac"} download yet.`);

  // Work next to the installed folder, so the final swap is two quick renames on the same disk.
  // The name starts with a dot and holds nothing Premiere loads, so Premiere ignores it.
  const work = path.join(path.dirname(root), ".pluck-update");
  try {
    fs.rmSync(work, { recursive: true, force: true }); // leftovers from an earlier try
    fs.mkdirSync(work);
  } catch (e) { throw explain(e, "Couldn't make room for the update."); }

  let keepWork = false; // only if the swap failed halfway, since the old copy is in there
  try {
    return await downloadAndSwap(release, asset, root, work, onStatus, () => { keepWork = true; });
  } finally {
    // On Windows the old folder may still be in use. It's harmless there and goes with the next update.
    if (!keepWork) try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
  }
}

async function downloadAndSwap(release, asset, root, work, onStatus, keepWork) {
  const version = release.tag_name.replace(/^v/, "");
  const zip = path.join(work, asset.name);
  onStatus(`Downloading Pluck ${version}…`);
  try { await download(asset.browser_download_url, zip, f => onStatus(`Downloading Pluck ${version}… ${Math.round(f * 100)}%`)); }
  catch (e) { throw explain(e, "Couldn't download the update. Are you online?"); }

  onStatus("Installing…");
  const unpacked = path.join(work, "unpacked");
  try { await unzip(zip, unpacked); } catch (e) { throw explain(e, "Couldn't unpack the update. Nothing was changed."); }

  // The zip holds Pluck-<version>-<platform>/Pluck. Check it really is the version GitHub promised.
  const fresh = path.join(unpacked, asset.name.replace(/\.zip$/, ""), "Pluck");
  let found = null;
  try { found = (fs.readFileSync(path.join(fresh, "CSXS", "manifest.xml"), "utf8").match(/ExtensionBundleVersion="([^"]+)"/) || [])[1]; }
  catch (e) {}
  if (found !== version) throw new Error(`The download didn't contain Pluck ${version}. Nothing was changed.`);

  // The swap: move the old folder aside (inside the work folder), move the new one in, put the old one back if that fails.
  const old = path.join(work, "old");
  try { fs.renameSync(root, old); } catch (e) { throw explain(e, "Couldn't replace the old version. Nothing was changed."); }
  try { fs.renameSync(fresh, root); } catch (e) {
    try { fs.renameSync(old, root); } catch (e2) {
      keepWork();
      throw new Error(`The update failed halfway. Reinstall Pluck from the download page (your old copy is in ${old}).`);
    }
    throw explain(e, "Couldn't replace the old version. Nothing was changed.");
  }

  // Like the installer: macOS would otherwise block downloaded tools as "from the internet".
  if (!isWin) await run("xattr", ["-dr", "com.apple.quarantine", root]).catch(() => {});
  return version;
}

module.exports = { isDevInstall, pickAsset, installUpdate };
