"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { validatePayload, buildInstaller } = require("../../packaging/windows/build");
const WINDOWS = process.platform === "win32";
const ENGINE = path.resolve(__dirname, "../../packaging/windows/installer-engine.ps1");
const NSIS = "C:/Program Files (x86)/NSIS/makensis.exe";
const POWERSHELL = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe") : "powershell.exe";
const hash = text => crypto.createHash("sha256").update(text).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-win-installer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payload = path.join(root, "payload");
  const roaming = path.join(root, "App Data");
  const target = path.join(roaming, "Adobe/CEP/extensions/CEP_MogrtImporter");
  const files = {
    "CSXS/manifest.xml": '<ExtensionManifest ExtensionBundleId="com.raonolje.mogrtimporter" ExtensionBundleVersion="1.4.0"/>',
    "html/index.html": "<html>release</html>",
    "html/js/app.js": "// prod-test release code",
    "jsx/hostscript.jsx": "// prod-test host"
  };
  for (const [rel, data] of Object.entries(files)) {
    const file = path.join(payload, "extension", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  fs.writeFileSync(path.join(payload, "metadata.json"), JSON.stringify({ version: "1.4.0", build: "prod-test" }));
  fs.writeFileSync(path.join(payload, "files.sha256.json"), JSON.stringify(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, hash(value)]))));
  return { root, payload, roaming, target, files };
}
function ps(f, body) {
  const input = Buffer.from(JSON.stringify({ engine: ENGINE, payload: f.payload, roaming: f.roaming, target: f.target }), "utf8").toString("base64");
  const script = `$ErrorActionPreference='Stop';$cfg=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}'))|ConvertFrom-Json; . $cfg.engine; function Assert-MogrtPremiereClosed {}; function Get-MogrtUnsignedCepSetting {return @{exists=$false;value=$null}}; $script:debugCalls=0; function Set-MogrtUnsignedCep {$script:debugCalls++}; ${body}`;
  const result = spawnSync(POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.error ? result.error.message : result.stdout + result.stderr);
  const line = result.stdout.split(/\r?\n/).findLast(s => s.startsWith("RESULT:"));
  assert.ok(line, result.stdout + result.stderr);
  return JSON.parse(line.slice(7));
}

test("Windows installer payload rejects tampering, unlisted files, and cache files", t => {
  const f = fixture(t);
  assert.equal(validatePayload(f.payload).files.length, 4);
  fs.appendFileSync(path.join(f.payload, "extension/html/js/app.js"), "changed");
  assert.throws(() => validatePayload(f.payload), /SHA-256 mismatch/);
  fs.writeFileSync(path.join(f.payload, "extension/html/js/app.js"), f.files["html/js/app.js"]);
  fs.mkdirSync(path.join(f.payload, "extension/cache"));
  fs.writeFileSync(path.join(f.payload, "extension/cache/session.json"), "secret");
  assert.throws(() => validatePayload(f.payload), /every extension file/);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.payload, "files.sha256.json")));
  manifest["cache/session.json"] = hash("secret");
  fs.writeFileSync(path.join(f.payload, "files.sha256.json"), JSON.stringify(manifest));
  assert.throws(() => validatePayload(f.payload), /Reserved/);
});

test("Windows PowerShell 5.1 install/upgrade/uninstall verifies backups and preserves all cache", { skip: !WINDOWS }, t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.target, "cache/project/sequence"), { recursive: true });
  fs.mkdirSync(path.join(f.target, "html/js"), { recursive: true });
  fs.writeFileSync(path.join(f.target, "html/js/app.js"), "old app");
  fs.writeFileSync(path.join(f.target, "cache/project/sequence/session.json"), "user subtitles");
  fs.writeFileSync(path.join(f.target, "notes.txt"), "user note");
  const result = ps(f, `
    $installed=Install-Mogrt $cfg.payload $cfg.roaming $false;
    $receipt=Get-Content -LiteralPath (Join-Path $cfg.target 'install.receipt.json') -Raw|ConvertFrom-Json;
    $firstBackup=$installed.Backup;
    $upgraded=Install-Mogrt $cfg.payload $cfg.roaming $true;
    Uninstall-Mogrt $cfg.roaming;
    Write-Output ('RESULT:'+(@{firstBackup=$firstBackup;upgradeBackup=$upgraded.Backup;debugCalls=$script:debugCalls;receiptFiles=@($receipt.files.PSObject.Properties).Count;debugBefore=$receipt.unsignedCepBefore.exists}|ConvertTo-Json -Compress));
  `);
  assert.equal(result.receiptFiles, 4);
  assert.equal(result.debugBefore, false);
  assert.equal(result.debugCalls, 1, "only explicit opt-in writes the shared debug setting");
  assert.equal(fs.readFileSync(path.join(result.firstBackup, "code/html/js/app.js"), "utf8"), "old app");
  assert.equal(fs.readFileSync(path.join(result.firstBackup, "cache/project/sequence/session.json"), "utf8"), "user subtitles");
  assert.equal(fs.readFileSync(path.join(result.upgradeBackup, "code/html/js/app.js"), "utf8"), f.files["html/js/app.js"]);
  assert.equal(fs.readFileSync(path.join(f.target, "cache/project/sequence/session.json"), "utf8"), "user subtitles");
  assert.equal(fs.readFileSync(path.join(f.target, "notes.txt"), "utf8"), "user note");
  assert.equal(fs.existsSync(path.join(f.target, "CSXS/manifest.xml")), false);
  assert.equal(fs.existsSync(path.join(f.target, "install.receipt.json")), false);
});

test("Windows installer rejects running Premiere before writes and rolls back a failed copy verification", { skip: !WINDOWS }, t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.target, "html/js"), { recursive: true });
  fs.writeFileSync(path.join(f.target, "html/js/app.js"), "old app");
  const result = ps(f, `
    function Assert-MogrtPremiereClosed {throw 'Premiere running'};
    $blocked='';try {$null=Install-Mogrt $cfg.payload $cfg.roaming $false} catch {$blocked=$_.Exception.Message};
    $noBackup= -not (Test-Path -LiteralPath (Join-Path $cfg.roaming 'MOGRT_Importer_backup'));
    function Assert-MogrtPremiereClosed {};
    $script:copy=(Get-Command Copy-MogrtFile).ScriptBlock;$script:corrupted=$false;
    function Copy-MogrtFile([string]$From,[string]$To) {
      & $script:copy $From $To;
      if (-not $script:corrupted -and $From.StartsWith((Join-Path $cfg.payload 'extension')) -and $To.EndsWith('app.js')) {[IO.File]::WriteAllText($To,'corrupt');$script:corrupted=$true}
    };
    $rollback='';try {$null=Install-Mogrt $cfg.payload $cfg.roaming $false} catch {$rollback=$_.Exception.Message};
    Write-Output ('RESULT:'+(@{blocked=$blocked;noBackup=$noBackup;rollback=$rollback}|ConvertTo-Json -Compress));
  `);
  assert.match(result.blocked, /Premiere running/);
  assert.equal(result.noBackup, true);
  assert.match(result.rollback, /original code restored.*SHA-256 mismatch/);
  assert.equal(fs.readFileSync(path.join(f.target, "html/js/app.js"), "utf8"), "old app");
  assert.equal(fs.existsSync(path.join(f.target, "CSXS/manifest.xml")), false);
});

test("Windows installer rejects unsafe hash paths before install and does not reset an existing debug opt-in", { skip: !WINDOWS }, t => {
  const f = fixture(t);
  const result = ps(f, `
    $checks=@('cache/x','../outside','C:/outside','html/../outside','html/CON.txt','html/a:ads','/outside')|ForEach-Object {Test-MogrtRelativePath $_};
    function Get-MogrtUnsignedCepSetting {return @{exists=$true;value='1'}};
    $null=Install-Mogrt $cfg.payload $cfg.roaming $true;
    $receipt=Get-Content -LiteralPath (Join-Path $cfg.target 'install.receipt.json') -Raw|ConvertFrom-Json;
    Write-Output ('RESULT:'+(@{checks=@($checks);debugCalls=$script:debugCalls;previous=$receipt.unsignedCepBefore.value}|ConvertTo-Json -Compress));
  `);
  assert.deepEqual(result.checks, Array(7).fill(false));
  assert.equal(result.debugCalls, 0);
  assert.equal(result.previous, "1");
});

test("Windows installer rejects directory/file collisions before backup or copy", { skip: !WINDOWS }, t => {
  const f = fixture(t);
  const collision = path.join(f.target, "html/js/app.js");
  fs.mkdirSync(collision, { recursive: true });
  fs.writeFileSync(path.join(collision, "keep.txt"), "user file");
  const result = ps(f, `
    $failure='';try {$null=Install-Mogrt $cfg.payload $cfg.roaming $false} catch {$failure=$_.Exception.Message};
    Write-Output ('RESULT:'+(@{failure=$failure;backedUp=(Test-Path -LiteralPath (Join-Path $cfg.roaming 'MOGRT_Importer_backup'))}|ConvertTo-Json -Compress));
  `);
  assert.match(result.failure, /directory occupies the destination file path/);
  assert.equal(result.backedUp, false);
  assert.deepEqual(fs.readdirSync(collision), ["keep.txt"]);
  assert.equal(fs.readFileSync(path.join(collision, "keep.txt"), "utf8"), "user file");
  assert.equal(fs.existsSync(path.join(f.target, "CSXS/manifest.xml")), false);
});

test("NSIS builds a real per-user Windows executable from the verified payload", { skip: !WINDOWS || !fs.existsSync(NSIS) }, t => {
  const f = fixture(t);
  const built = buildInstaller({ payload: f.payload, out: path.join(f.root, "MOGRTImporter-1.4.0-Setup.exe"), makensis: NSIS });
  assert.ok(built.size > 30000);
  assert.match(built.sha256, /^[a-f0-9]{64}$/);
  assert.match(built.log, /Output:/);
  assert.doesNotMatch(built.log, /^\s*(?:warning \d+|\d+ warnings?)[ :]/im);
  assert.equal(fs.existsSync(f.target), false, "compilation must not run the installer");
});

test("NSIS compiler warnings reject a release build instead of accepting an executable", { skip: !WINDOWS || !fs.existsSync(NSIS) }, t => {
  const f = fixture(t);
  const copy = path.join(f.root, "compiler-warning");
  fs.mkdirSync(copy);
  const source = path.resolve(__dirname, "../../packaging/windows");
  for (const name of ["build.js", "installer.nsi", "installer-engine.ps1"]) {
    fs.copyFileSync(path.join(source, name), path.join(copy, name));
  }
  // A real NSIS preprocessor warning must fail the same release builder, even if an .exe could be produced.
  fs.appendFileSync(path.join(copy, "installer.nsi"), '\n!warning "release-regression-warning"\n');
  const isolated = require(path.join(copy, "build.js"));
  assert.throws(() => isolated.buildInstaller({ payload: f.payload, out: path.join(f.root, "rejected.exe"), makensis: NSIS }), /NSIS compilation failed:[\s\S]*release-regression-warning/);
  assert.equal(fs.existsSync(f.target), false);
});
