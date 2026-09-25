"use strict";
// S1-9: 옛 버전 MOGRT 픽스처 생성기 (tests/fixtures/mogrt/make_old_mogrt.js) — 합성 템플릿으로만 확인한다
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const M = require("../fixtures/mogrt/make_old_mogrt");

const ctl = (type, name) => ({ type, uiName: { strDB: [{ localeString: "ko_KR", str: name }] } });
const defOf = (capsuleID, controls) => ({ capsuleID, clientControls: controls });
function mogrt(file, def) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, M.writeZip([
		{ name: "definition.json", data: Buffer.from("\uFEFF" + JSON.stringify(def), "utf8") },
		{ name: "project.aegraphic", data: Buffer.from("합성 프로젝트 바이트".repeat(20), "utf8") },
		{ name: "thumb.png", data: Buffer.from([0, 1, 2, 3]), method: 0 }
	]));
}

test("zip 쓰기·읽기 왕복 (deflate·저장, 한글 이름, crc)", () => {
	const entries = [{ name: "a.txt", data: "가나다".repeat(50) }, { name: "폴더/b.bin", data: Buffer.from([9, 8, 7]), method: 0 }];
	const back = M.readZip(M.writeZip(entries));
	assert.deepEqual(back.map((e) => [e.name, e.method, e.data.toString("hex")]), [
		["a.txt", 8, Buffer.from("가나다".repeat(50), "utf8").toString("hex")],
		["폴더/b.bin", 0, "090807"]
	]);
	assert.equal(M.crc32(Buffer.from("123456789")), 0xcbf43926, "표준 CRC-32 검사 값");
	assert.throws(() => M.readZip(Buffer.from("zip 아님 ".repeat(5))), /EOCD/);
});

test("findOldVersion·makeOldLayoutMogrt: 텍스트 이름이 같고 구조가 다른 옛 버전을 찾아 저장소 밖에 복사한다", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi_mogrt_root_"));
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "mi_mogrt_out_"));
	try {
		const T = ["합성 본문", "합성 포인트"];
		const NEW = path.join(root, "합성 새 버전.mogrt");
		mogrt(NEW, defOf("new-cap", [ctl(2, "너비"), ctl(6, T[0]), ctl(4, "색"), ctl(6, T[1]), ctl(2, "여백")]));
		mogrt(path.join(root, "옛것", "합성 옛 버전.mogrt"), defOf("old-cap", [ctl(6, T[0]), ctl(4, "색"), ctl(6, T[1])]));
		mogrt(path.join(root, "다른 템플릿.mogrt"), defOf("other", [ctl(6, "다른 이름"), ctl(6, T[1])]));
		mogrt(path.join(root, "같은 구조 사본.mogrt"), defOf("copy", [ctl(2, "너비"), ctl(6, T[0]), ctl(4, "색"), ctl(6, T[1]), ctl(2, "여백")]));
		const hit = M.findOldVersion(NEW, { root });
		assert.equal(path.basename(hit.path), "합성 옛 버전.mogrt");
		const fx = M.makeOldLayoutMogrt({ root, newName: /합성 새 버전/, outDir: out });
		assert.equal(path.dirname(fx.path), out.split(path.sep).join("/"));
		assert.match(path.basename(fx.path), /^old_layout_[0-9a-f]{8}\.mogrt$/);
		assert.deepEqual(fx.oldNames, [T[0], "색", T[1]]);
		assert.deepEqual(fx.newNames, ["너비", T[0], "색", T[1], "여백"]);
		assert.deepEqual(fs.readFileSync(fx.path), fs.readFileSync(hit.path), "바이트 그대로 복사");
		// 같은 capsule, 이름만 바꾼 사본
		const ren = M.makeRenamedMogrt(fx.path, { [T[0]]: T[0] + " V2" }, path.join(out, "renamed.mogrt"));
		const d = M.readDefinition(ren);
		assert.equal(d.capsuleID, "old-cap");
		assert.deepEqual(M.textNames(d), [T[0] + " V2", T[1]]);
		assert.equal(M.readZip(fs.readFileSync(ren)).find((e) => e.name === "project.aegraphic").data.toString("utf8"), "합성 프로젝트 바이트".repeat(20));
		// 저장소 안에는 만들지 않는다
		assert.throws(() => M.makeOldLayoutMogrt({ root, newName: /합성 새 버전/, outDir: path.join(__dirname, "..", "fixtures", "mogrt") }), /저장소 안에/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(out, { recursive: true, force: true });
	}
});
