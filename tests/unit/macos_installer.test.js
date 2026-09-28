"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

test("Mac installer recognizes legacy installs but requires current ID in payload", { skip: process.platform === "win32" }, t => {
  const script = fs.readFileSync(path.join(__dirname, "../../packaging/macos/Installer.command"), "utf8");
  const functions = script.match(/same_extension\(\) \{[\s\S]*?\n\}\ninstalled_extension\(\) \{[\s\S]*?\n\}/)[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-mac-id-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = path.join(dir, "manifest.xml");
  for (const [id, installed, payload] of [
    ["com.manus.mogrtimporter", true, false],
    ["com.manus.mogrtimporter.panel", true, false],
    ["com.raonolje.mogrtimporter", true, true],
    ["com.raonolje.mogrtimporter.dev", false, false],
    ["com.other.mogrtimporter", false, false],
  ]) {
    fs.writeFileSync(manifest, '<ExtensionManifest ExtensionBundleId="' + id + '"/>');
    for (const [fn, expected] of [["installed_extension", installed], ["same_extension", payload]]) {
      const result = cp.spawnSync("/bin/bash", ["-c", functions + '\n' + fn + ' "$1"', "test", manifest]);
      assert.equal(result.status, expected ? 0 : 1, fn + ": " + id);
    }
  }
});

test("Mac installer maps actual CEP engine versions, rejecting unknown runtimes", { skip: process.platform === "win32" }, () => {
  const script = fs.readFileSync(path.join(__dirname, "../../packaging/macos/Installer.command"), "utf8");
  const fn = script.match(/runtime_major\(\) \{[\s\S]*?\n\}/)[0];
  for (const [version, expected] of [["12.0.1.2", "12"], ["11.1.0", "11"], ["11", "11"], ["13.0", null], ["", null], ["1.12", null]]) {
    const result = cp.spawnSync("/bin/bash", ["-c", fn + '\nruntime_major "$1"', "test", version], { encoding: "utf8" });
    assert.equal(result.status, expected === null ? 1 : 0);
    assert.equal(result.stdout, expected || "");
  }
});
