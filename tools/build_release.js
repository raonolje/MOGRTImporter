#!/usr/bin/env node
"use strict";
// Packages committed source only. The output records its exact source commit.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const JSZip = require("../extension/html/js/jszip.min.js");
const { stageProd, verifyProd } = require("./lib/stamp.js");
const ROOT = path.resolve(__dirname, "..");

function git(...args) {
  return cp.execFileSync("git", args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
}
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function files(root, prefix = "") {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error("Symlink in release: " + rel);
    return entry.isDirectory() ? files(root, rel + "/") : [rel];
  }).sort();
}
function write(root, relative, bytes) {
  const dest = path.join(root, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
}
function writeJson(root, relative, value) { write(root, relative, JSON.stringify(value, null, 2) + "\n"); }
function checksums(root) {
  const entries = files(root).filter(rel => rel !== "SHA256SUMS");
  write(root, "SHA256SUMS", entries.map(rel => hash(fs.readFileSync(path.join(root, rel))) + "  " + rel).join("\n") + "\n");
}
async function zipDirectory(root, destination, commitDate) {
  const zip = new JSZip();
  for (const rel of files(root)) {
    zip.file(rel, fs.readFileSync(path.join(root, rel)), {
      date: commitDate, createFolders: false,
      unixPermissions: rel.endsWith(".command") ? 0o100755 : 0o100644,
    });
  }
  fs.writeFileSync(destination, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE", compressionOptions: { level: 9 } }));
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (["--out", "--makensis"].includes(argv[i]) && argv[i + 1]) options[argv[i].slice(2)] = argv[++i];
    else if (argv[i] === "--zip-only") options.zipOnly = true;
    else throw new Error("Usage: node tools/build_release.js --out <new-directory> [--zip-only] [--makensis <exe>]");
  }
  if (!options.out) throw new Error("--out is required (use a new output directory).");
  if (git("diff", "HEAD", "--name-only").toString().trim()) throw new Error("Commit source changes before building a release.");
  const commit = git("rev-parse", "HEAD").toString().trim();
  const source = rel => git("show", commit + ":" + rel);
  const version = JSON.parse(source("package.json")).version;
  const build = "prod-" + commit.slice(0, 7);
  const date = new Date(git("show", "-s", "--format=%cI", commit).toString().trim());
  const out = path.resolve(options.out);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error("Output directory must be empty: " + out);
  fs.mkdirSync(out, { recursive: true });
  const tracked = git("ls-tree", "-rz", commit, "--", "extension").toString().split("\0").filter(Boolean).map(entry => {
    const tab = entry.indexOf("\t");
    const [mode, type] = entry.slice(0, tab).split(" ");
    if (!/^100(644|755)$/.test(mode) || type !== "blob") throw new Error("Only regular files may be released: " + entry);
    return entry.slice(tab + 1);
  });
  if (!tracked.includes("extension/CSXS/manifest.xml")) throw new Error("Missing extension source.");
  if (tracked.some(rel => /^extension\/cache(?:\/|$)/i.test(rel))) throw new Error("User cache must never be packaged.");
  for (const platform of ["windows", "macos"]) {
    const payload = path.join(out, "payload-" + platform);
    for (const rel of tracked) write(payload, rel, source(rel));
    const extension = path.join(payload, "extension");
    stageProd(extension, build);
    const problems = verifyProd(extension);
    if (problems.length) throw new Error(problems.join("\n"));
    const manifest = fs.readFileSync(path.join(extension, "CSXS/manifest.xml"), "utf8");
    if (!manifest.includes('ExtensionBundleVersion="' + version + '"')) throw new Error("Version mismatch.");
    const metadata = { schemaVersion: 1, version, build, sourceCommit: commit, platform, signed: false,
      validation: platform === "macos" ? "Experimental: actual macOS/Premiere execution not yet verified." : "See docs/MCP_VALIDATION.md for the scope of Premiere validation." };
    writeJson(payload, "release.json", metadata);
    if (platform === "windows") {
      for (const rel of ["Install.ps1", "installer-engine.ps1", "README_WINDOWS.md"]) write(payload, rel, source("packaging/windows/" + rel));
      writeJson(payload, "metadata.json", metadata);
      writeJson(payload, "files.sha256.json", Object.fromEntries(files(extension).map(rel => [rel, hash(fs.readFileSync(path.join(extension, rel)))])));
    } else {
      for (const rel of ["Installer.command", "README_MACOS.md"]) write(payload, rel, source("packaging/macos/" + rel));
    }
    checksums(payload);
    const name = "MOGRTImporter_v" + version + "_" + (platform === "macos" ? "macOS_experimental" : "Windows");
    await zipDirectory(payload, path.join(out, name + ".zip"), date);
    if (platform === "windows" && !options.zipOnly) {
      if (process.platform !== "win32") throw new Error("Build the Windows EXE on Windows, or use --zip-only.");
      const args = [path.join(ROOT, "packaging/windows/build.js"), "--payload", payload, "--out", path.join(out, name + ".exe")];
      if (options.makensis) args.push("--makensis", options.makensis);
      cp.execFileSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
    }
  }
  const artifacts = files(out).filter(rel => !rel.includes("/") && /\.(exe|zip)$/.test(rel));
  write(out, "SHA256SUMS", artifacts.map(rel => hash(fs.readFileSync(path.join(out, rel))) + "  " + rel).join("\n") + "\n");
  writeJson(out, "release.json", { version, build, sourceCommit: commit, macOS: "experimental, not tested on Mac", artifacts });
  console.log(JSON.stringify({ out, version, build, sourceCommit: commit, artifacts }, null, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { hash, checksums, zipDirectory };
