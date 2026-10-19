// Runs inside Premiere (ExtendScript). The panel calls these through evalScript and gets a JSON string back.

function pluckProjectPath() {
  try { return JSON.stringify({ path: app.project && app.project.path ? app.project.path : "" }); }
  catch (e) { return JSON.stringify({ path: "" }); }
}

function pluckFindBin(parent, name) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var item = parent.children[i];
    if (item.type === ProjectItemType.BIN && item.name === name) return item;
  }
  return null;
}

// Import one file into the named bin at the top of the project, creating the bin if needed.
function pluckImport(filePath, binName) {
  try {
    if (!app.project) return JSON.stringify({ ok: false, message: "Open a Premiere project first, then try again." });
    var root = app.project.rootItem;
    var bin = pluckFindBin(root, binName) || root.createBin(binName) || root;
    var ok = app.project.importFiles([filePath], true, bin, false);
    return JSON.stringify(ok ? { ok: true } : { ok: false, message: "Premiere couldn't import the file. It's saved here: " + filePath });
  } catch (e) {
    return JSON.stringify({ ok: false, message: "Premiere couldn't import the file: " + e.toString() });
  }
}
