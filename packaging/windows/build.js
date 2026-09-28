"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function walk(root, prefix = "") {
  const out = [];
  for (const item of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? prefix + "/" + item.name : item.name;
    if (item.isSymbolicLink()) throw new Error("Release payload contains a symbolic link: " + rel);
    if (item.isDirectory()) out.push(...walk(root, rel));
    else if (item.isFile()) out.push(rel);
    else throw new Error("Release payload contains an unsupported file: " + rel);
  }
  return out.sort();
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function validatePayload(payload) {
  const metadata = JSON.parse(fs.readFileSync(path.join(payload, "metadata.json"), "utf8").replace(/^\uFEFF/, ""));
  const hashes = JSON.parse(fs.readFileSync(path.join(payload, "files.sha256.json"), "utf8").replace(/^\uFEFF/, ""));
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version) || !/^prod-[a-zA-Z0-9.-]+$/.test(metadata.build)) throw new Error("Invalid production metadata");
  if (!hashes || typeof hashes !== "object" || Array.isArray(hashes)) throw new Error("Invalid hash manifest");
  const extension = path.join(payload, "extension");
  const files = walk(extension);
  const keys = Object.keys(hashes).sort();
  if (JSON.stringify(files) !== JSON.stringify(keys)) throw new Error("Hash manifest must describe every extension file, and no other files");
  for (const rel of files) {
    if (/^(?:cache)(?:\/|$)|^(?:Uninstall\.exe|install\.receipt\.json)$/i.test(rel) || rel.split("/").some(p => p === ".." || p === "." || /[\\:"<>|?*]/.test(p))) throw new Error("Reserved/unsafe payload path: " + rel);
    if (!/^[a-f0-9]{64}$/.test(hashes[rel]) || sha256(path.join(extension, rel)) !== hashes[rel]) throw new Error("Payload SHA-256 mismatch: " + rel);
  }
  for (const required of ["CSXS/manifest.xml", "html/index.html", "html/js/app.js", "jsx/hostscript.jsx"]) {
    if (!Object.prototype.hasOwnProperty.call(hashes, required)) throw new Error("Missing release file: " + required);
  }
  const manifest = fs.readFileSync(path.join(extension, "CSXS/manifest.xml"), "utf8");
  if (!/ExtensionBundleId="com\.raonolje\.mogrtimporter"/.test(manifest) || !manifest.includes('ExtensionBundleVersion="' + metadata.version + '"')) throw new Error("Wrong production extension identity/version");
  return { metadata, files, sizeKB: Math.ceil(files.reduce((n, rel) => n + fs.statSync(path.join(extension, rel)).size, 0) / 1024) };
}
function findCompiler(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.MAKENSIS) return path.resolve(process.env.MAKENSIS);
  const candidates = ["C:/Program Files (x86)/NSIS/makensis.exe", "C:/Program Files/NSIS/makensis.exe"];
  const found = candidates.find(p => fs.existsSync(p));
  return found || "makensis";
}
function nsisString(value) {
  if (/[\r\n\0"]/.test(value)) throw new Error("Unsupported build path: " + value);
  return value.replace(/\$/g, () => "$$");
}
function buildInstaller({ payload, out, makensis }) {
  payload = path.resolve(payload);
  out = path.resolve(out);
  const verified = validatePayload(payload);
  const compiler = findCompiler(makensis);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ["/V3", "/INPUTCHARSET", "UTF8", "/DVERSION=" + verified.metadata.version, "/DSIZE_KB=" + verified.sizeKB,
    "/DPAYLOAD=" + nsisString(payload), "/DOUTPUT=" + nsisString(out), "/DSOURCE=" + nsisString(__dirname), path.join(__dirname, "installer.nsi")];
  const result = spawnSync(compiler, args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("NSIS compilation failed:\n" + result.stdout + result.stderr);
  const file = fs.readFileSync(out);
  if (file.readUInt16LE(0) !== 0x5a4d) throw new Error("Compiler did not produce a Windows PE executable");
  return { file: out, version: verified.metadata.version, build: verified.metadata.build, sha256: sha256(out), size: file.length, compiler, log: result.stdout };
}
if (require.main === module) {
  try {
    const opts = {};
    const args = process.argv.slice(2);
    while (args.length) {
      const flag = args.shift();
      if (!["--payload", "--out", "--makensis"].includes(flag) || !args.length) throw new Error("Usage: node build.js --payload <release-root> --out <setup.exe> [--makensis <path>]");
      opts[flag.slice(2)] = args.shift();
    }
    if (!opts.payload || !opts.out) throw new Error("--payload and --out are required");
    const result = buildInstaller(opts);
    process.stdout.write(result.log);
    delete result.log;
    console.log(JSON.stringify(result));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { buildInstaller, validatePayload };
