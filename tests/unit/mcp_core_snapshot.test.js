"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const C = require("../../mcp/lib/core");
const { fnv1a32, sliceRegion } = require("../../mcp/lib/loadRegions");

const source = (revision) => [
	"//#region src/mi/core.ts",
	"const revision = " + JSON.stringify(revision) + ";",
	"function validateSuggestion() { return revision; }",
	"//#endregion"
].join("\n");
const hash = (text) => fnv1a32(sliceRegion(C.CORE_REGION, text.replace(/\r\n/g, "\n")).text);

function fixture(t) {
	const tempRoot = path.resolve(os.tmpdir());
	const extPath = fs.mkdtempSync(path.join(tempRoot, "mi_core_snapshot_"));
	const file = C.installedAppJs(extPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	t.after(() => {
		assert.equal(path.dirname(path.resolve(extPath)), tempRoot);
		assert.match(path.basename(extPath), /^mi_core_snapshot_/);
		fs.rmSync(extPath, { recursive: true, force: true });
	});
	return { extPath, file };
}

test("core: 해시를 읽은 직후 파일이 교체돼도 같은 스냅샷의 exports를 실행한다", (t) => {
	const { extPath, file } = fixture(t);
	const before = source("A").replace(/\n/g, "\r\n");
	const after = source("B");
	fs.writeFileSync(file, before, "utf8");
	const read = fs.readFileSync;
	let reads = 0;
	t.mock.method(fs, "readFileSync", function (target, ...args) {
		const snapshot = read.call(this, target, ...args);
		if (target === file && ++reads === 1) fs.writeFileSync(file, after, "utf8");
		return snapshot;
	});
	const r = C.loadCore({ extPath, coreHash: hash(before) }, { withCore: true });
	assert.equal(r.ok, true);
	assert.equal(r.hash, hash(before));
	assert.equal(r.core.validateSuggestion(), "A", "확인한 A 해시의 코드를 실행해야 한다");
	assert.equal(reads, 1, "검사와 실행 사이에 설치 파일을 다시 읽지 않는다");
	assert.equal(C.loadCore({ extPath, coreHash: hash(before) }).code, "panel-version-mismatch", "다음 호출은 교체된 B 파일을 감지한다");
	const updated = C.loadCore({ extPath, coreHash: hash(after) }, { withCore: true });
	assert.equal(updated.ok, true);
	assert.equal(updated.core.validateSuggestion(), "B");
	assert.equal(C.loadCore({ extPath, coreHash: hash(after) }, { withCore: true }).core, updated.core, "내용이 같으면 VM 결과를 재사용한다");
});

test("core: 크기와 mtime이 같은 파일 변경도 캐시를 무효화한다", (t) => {
	const { extPath, file } = fixture(t);
	const a = source("A"), b = source("B");
	const stamp = new Date("2026-01-01T00:00:00.000Z");
	fs.writeFileSync(file, a, "utf8");
	fs.utimesSync(file, stamp, stamp);
	const before = fs.statSync(file);
	assert.equal(C.loadCore({ extPath, coreHash: hash(a) }, { withCore: true }).core.revision, "A");
	fs.writeFileSync(file, b, "utf8");
	fs.utimesSync(file, stamp, stamp);
	const after = fs.statSync(file);
	assert.deepEqual([after.size, after.mtimeMs], [before.size, before.mtimeMs]);
	assert.equal(C.loadCore({ extPath, coreHash: hash(a) }).code, "panel-version-mismatch");
	const r = C.loadCore({ extPath, coreHash: hash(b) }, { withCore: true });
	assert.equal(r.ok, true);
	assert.equal(r.hash, hash(b));
	assert.equal(r.core.revision, "B");
});
