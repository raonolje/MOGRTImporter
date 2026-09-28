"use strict";
// 실제 내보내기 UI 경로를 통과한다. 하네스 fs의 Windows 구분자 정규화 전에 쓰기 경로를 검사한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/export.prproj";

async function exportPreset(folder, failNative) {
	const { presets } = build();
	const h = await bootPanel({
		seq: { seqId: "export-1", seqName: "T_EXPORT", projPath: PROJ },
		mogrts: Object.values(presets).map((p) => ({ name: p.name, path: p.mogrtPath })),
		files: { [P.presets(PROJ)]: { presets, presetTrash: [], nextPresetId: 9 } }
	});
	await h.advance(1000);
	h.host.handlers.selectExportFolder = () => folder;
	const writes = [];
	const originalWrite = h.fs.writeFile.bind(h.fs);
	h.fs.writeFile = (target, data, encoding) => {
		writes.push({ target, data });
		return failNative ? { err: 1 } : originalWrite(target, data, encoding);
	};
	let fallback = null;
	h.host.handlers.saveTextFile = (json) => { fallback = JSON.parse(json); return "SUCCESS"; };
	h.$("btnExportPresets").click();
	assert.equal(h.$("exportModal").classList.contains("open"), true);
	h.doc.querySelectorAll(".export-preset-chk").forEach((c) => { c.checked = c.dataset.id === "preset_1"; });
	h.$("exportBrowseBtn").click();
	await h.flush();
	assert.equal(h.$("exportFolderPath").value, folder);
	h.$("exportConfirm").click();
	await h.flush();
	assert.equal(writes.length, 1, "선택한 프리셋 JSON 하나만 쓴다");
	const data = JSON.parse(writes[0].data);
	assert.equal(data.version, 1);
	assert.deepEqual(Object.keys(data.presets), ["preset_1"]);
	assert.deepEqual(data.presets.preset_1, h.snapshot().presets.preset_1);
	assert.equal(h.$("exportModal").classList.contains("open"), false);
	assert.match(h.status().text, /프리셋 내보내기 완료: 1개/);
	assert.deepEqual(h.errors().map((e) => String(e.message || e)), []);
	return { write: writes[0], fallback };
}

test("프리셋 내보내기: Windows/macOS 선택 폴더 안에 저장한다 (한글·공백·끝 구분자·루트)", async () => {
	const cases = [
		["C:\\Users\\사용자\\Export Files\\", "C:/Users/사용자/Export Files"],
		["D:/자막 작업/내보내기", "D:/자막 작업/내보내기"],
		["C:\\", "C:/"],
		["/Users/사용자/Export Files", "/Users/사용자/Export Files"],
		["/Users/사용자/내보내기 폴더///", "/Users/사용자/내보내기 폴더"],
		["/", "/"]
	];
	for (const [folder, expectedDir] of cases) {
		const { write, fallback } = await exportPreset(folder, false);
		const paths = /^[A-Za-z]:/.test(folder) ? path.win32 : path.posix;
		assert.equal(paths.dirname(write.target).replace(/\\/g, "/"), expectedDir, folder);
		assert.match(path.posix.basename(write.target), /^mogrt_presets_[^/\\]+\.json$/);
		assert.equal(write.target.includes("\\"), false, "CEP에 넘기는 경로는 POSIX 구분자");
		assert.equal(fallback, null, "네이티브 저장 성공 시 호스트 저장은 부르지 않는다");
	}
});

test("프리셋 내보내기: CEP 저장 실패의 호스트 폴백도 같은 macOS 경로와 내용을 받는다", async () => {
	const { write, fallback } = await exportPreset("/Users/사용자/Export Files/", true);
	assert.equal(path.posix.dirname(write.target), "/Users/사용자/Export Files");
	assert.deepEqual(fallback, { path: write.target, content: write.data });
});
