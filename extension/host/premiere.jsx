// Runs inside Premiere (ExtendScript). The panel calls these through evalScript and gets a JSON string back.

// Answers are flat objects of strings and booleans. They're written by hand because older Premiere versions'
// ExtendScript has no JSON object, and as pure ASCII (\uXXXX) so no character can get mangled on the way back.
function pluckString(s) {
  var out = '"';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i), code = s.charCodeAt(i);
    if (ch === '"' || ch === "\\") out += "\\" + ch;
    else if (code < 32 || code > 126) out += "\\u" + ("000" + code.toString(16)).slice(-4);
    else out += ch;
  }
  return out + '"';
}
function pluckJSON(value) {
  var parts = [];
  for (var key in value) {
    if (value.hasOwnProperty(key)) parts.push(pluckString(key) + ":" + (typeof value[key] === "string" ? pluckString(value[key]) : String(value[key])));
  }
  return "{" + parts.join(",") + "}";
}

function pluckProjectPath() {
  try { return pluckJSON({ path: app.project && app.project.path ? app.project.path : "" }); }
  catch (e) { return pluckJSON({ path: "" }); }
}

function pluckFindBin(parent, name) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var item = parent.children[i];
    if (item.type === ProjectItemType.BIN && item.name === name) return item;
  }
  return null;
}

// Import one file into the named bin at the top of the project, creating the bin if needed.
// subBinName (playlists and folders) puts it one level deeper, in a bin of that name inside the first one.
function pluckImport(filePath, binName, subBinName) {
  try {
    if (!app.project) return pluckJSON({ ok: false, message: "Open a Premiere project first, then try again." });
    var root = app.project.rootItem;
    var bin = pluckFindBin(root, binName) || root.createBin(binName) || root;
    if (subBinName) {
      // Looked up again after creating it: older Premiere versions' createBin doesn't return the new bin.
      if (!pluckFindBin(bin, subBinName)) bin.createBin(subBinName);
      bin = pluckFindBin(bin, subBinName) || bin;
    }
    var ok = app.project.importFiles([filePath], true, bin, false);
    return pluckJSON(ok ? { ok: true } : { ok: false, message: "Premiere couldn't import the file. It's saved here: " + filePath });
  } catch (e) {
    return pluckJSON({ ok: false, message: "Premiere couldn't import the file: " + e.toString() });
  }
}
