"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { checksums, zipDirectory } = require("../../tools/build_release");
const { stageProd, verifyProd } = require("../../tools/lib/stamp");

const ROOT = path.resolve(__dirname, "../..");
const DATE = new Date("2026-01-02T03:04:06Z");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function temporary(t) {
	const parent = path.resolve(os.tmpdir());
	const dir = fs.mkdtempSync(path.join(parent, "mi-release-test-"));
	t.after(() => {
		assert.equal(path.dirname(path.resolve(dir)), parent);
		assert.ok(path.basename(dir).startsWith("mi-release-test-"));
		fs.rmSync(dir, { recursive: true, force: true });
	});
	return dir;
}
function put(root, relative, bytes) {
	const file = path.join(root, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, bytes);
}

// Read the generated ZIP independently of JSZip: central directory + raw DEFLATE.
// These small fixtures do not use ZIP64 or archive comments.
function unzip(bytes) {
	const end = bytes.length - 22;
	assert.equal(bytes.readUInt32LE(end), 0x06054b50, "ZIP end record");
	const count = bytes.readUInt16LE(end + 10);
	let at = bytes.readUInt32LE(end + 16);
	const entries = new Map();
	for (let i = 0; i < count; i++) {
		assert.equal(bytes.readUInt32LE(at), 0x02014b50, "central directory entry");
		const method = bytes.readUInt16LE(at + 10);
		const compressedSize = bytes.readUInt32LE(at + 20);
		const size = bytes.readUInt32LE(at + 24);
		const nameLength = bytes.readUInt16LE(at + 28);
		const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
		const local = bytes.readUInt32LE(at + 42);
		assert.equal(bytes.readUInt32LE(local), 0x04034b50, "local file header");
		const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
		const compressed = bytes.subarray(start, start + compressedSize);
		assert.ok(method === 0 || method === 8, "stored or DEFLATE");
		const data = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);
		assert.equal(data.length, size, name + " uncompressed size");
		assert.ok(!entries.has(name), "no duplicate ZIP path: " + name);
		entries.set(name, { data, unix: bytes.readUInt16LE(at + 4) >>> 8, mode: bytes.readUInt32LE(at + 38) >>> 16 });
		at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
	}
	return entries;
}
function assertChecksums(entries) {
	const manifest = entries.get("SHA256SUMS").data.toString("utf8");
	const listed = new Set();
	for (const line of manifest.trimEnd().split("\n")) {
		const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
		assert.ok(match, "standard sha256sum line");
		const [, expected, relative] = match;
		assert.notEqual(relative, "SHA256SUMS", "checksum file does not hash itself");
		assert.ok(!listed.has(relative), "one checksum per file");
		listed.add(relative);
		assert.ok(entries.has(relative), "checksum target is in ZIP: " + relative);
		assert.equal(sha256(entries.get(relative).data), expected, relative + " SHA-256");
	}
	assert.deepEqual([...listed].sort(), [...entries.keys()].filter(name => name !== "SHA256SUMS").sort());
}

test("release ZIP: 해제한 파일 bytes·SHA256SUMS 일치, Mac .command만 Unix 실행 권한", async (t) => {
	const dir = temporary(t), payload = path.join(dir, "payload"), archive = path.join(dir, "release.zip");
	const original = new Map([
		["Installer.command", Buffer.from("#!/bin/bash\nprintf '한글 설치\\n'\n")],
		["release.json", Buffer.from('{"version":"1.4.0","platform":"macos"}\n')],
		["extension/html/한글 이름.bin", Buffer.from([0, 1, 13, 10, 127, 128, 255])],
		["extension/empty.txt", Buffer.alloc(0)],
		["extension/.debug", Buffer.from("<ExtensionList/>\r\n")]
	]);
	for (const [relative, bytes] of original) put(payload, relative, bytes);
	checksums(payload);
	await zipDirectory(payload, archive, DATE);
	const extracted = unzip(fs.readFileSync(archive));
	assert.deepEqual([...extracted.keys()].sort(), [...original.keys(), "SHA256SUMS"].sort());
	for (const [relative, bytes] of original) {
		assert.deepEqual(extracted.get(relative).data, bytes, relative + " bytes");
		assert.equal(extracted.get(relative).unix, 3, relative + " UNIX creator platform");
		assert.equal(extracted.get(relative).mode & 0o777, relative.endsWith(".command") ? 0o755 : 0o644, relative + " permissions");
	}
	assertChecksums(extracted);
});

test("release payload: 실제 source를 PROD로 stamp한 bytes와 manifest/package 버전이 ZIP에서도 유지된다", async (t) => {
	const dir = temporary(t), payload = path.join(dir, "payload"), extension = path.join(payload, "extension");
	const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
	const build = "prod-1234abc";
	const original = new Map();
	for (const relative of ["CSXS/manifest.xml", ".debug", "html/js/app.js", "jsx/hostscript.jsx"]) {
		const bytes = fs.readFileSync(path.join(ROOT, "extension", relative));
		original.set(relative, bytes);
		put(extension, relative, bytes);
	}
	stageProd(extension, build);
	assert.deepEqual(verifyProd(extension), []);
	put(payload, "release.json", JSON.stringify({ version, build, platform: "macos", signed: false }));
	checksums(payload);
	const archive = path.join(dir, "production.zip");
	await zipDirectory(payload, archive, DATE);
	const extracted = unzip(fs.readFileSync(archive));
	for (const [relative, bytes] of original) {
		const expected = ["html/js/app.js", "jsx/hostscript.jsx"].includes(relative)
			? Buffer.from(bytes.toString("utf8").split("@@BUILD@@").join(build)) : bytes;
		assert.deepEqual(extracted.get("extension/" + relative).data, expected, relative + " only intended stamp changes");
	}
	const manifest = extracted.get("extension/CSXS/manifest.xml").data.toString("utf8");
	assert.equal(/ExtensionBundleVersion="([^"]+)"/.exec(manifest)[1], version);
	assert.match(manifest, /ExtensionBundleId="com\.raonolje\.mogrtimporter"/);
	assert.doesNotMatch(manifest, /mogrtimporter\.dev/);
	for (const relative of ["extension/html/js/app.js", "extension/jsx/hostscript.jsx"]) {
		const text = extracted.get(relative).data.toString("utf8");
		assert.ok(text.includes(build));
		assert.doesNotMatch(text, /@@BUILD@@|\bMID_/);
	}
	assert.deepEqual(JSON.parse(extracted.get("release.json").data), { version, build, platform: "macos", signed: false });
	assertChecksums(extracted);
});

test("release helpers: payload 밖을 가리키는 링크는 체크섬·ZIP 작성 전에 거절한다", async (t) => {
	const dir = temporary(t), payload = path.join(dir, "payload"), outside = path.join(dir, "outside");
	fs.mkdirSync(payload);
	fs.mkdirSync(outside);
	put(outside, "private.txt", "must not enter release");
	fs.symlinkSync(outside, path.join(payload, "linked"), process.platform === "win32" ? "junction" : "dir");
	assert.throws(() => checksums(payload), /Symlink in release/);
	const archive = path.join(dir, "blocked.zip");
	await assert.rejects(zipDirectory(payload, archive, DATE), /Symlink in release/);
	assert.equal(fs.existsSync(archive), false);
	assert.equal(fs.readFileSync(path.join(outside, "private.txt"), "utf8"), "must not enter release");
});
