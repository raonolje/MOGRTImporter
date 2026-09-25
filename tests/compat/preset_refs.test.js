"use strict";
// 운영 캐시 호환 (읽기 전용): 다른 시퀀스의 session.json·히스토리가 가리키는 프리셋 id를 새 id가 피하는가.
// MI_REAL_CACHE가 운영 캐시(%APPDATA%/Adobe/CEP/extensions/CEP_MogrtImporter/cache)를 가리킬 때만 돈다.
// 파일을 쓰지 않고, 숫자·id만 출력한다 (자막 텍스트·프리셋 이름을 저장소나 로그에 남기지 않는다).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadRegions } = require("../lib/loadRegions");

const ROOT = process.env.MI_REAL_CACHE || "";
const skip = !ROOT || !fs.existsSync(ROOT) ? "MI_REAL_CACHE가 없다" : false;
const REF = /"presetId"\s*:\s*"preset_(\d+)"/g;

// 앱의 _scanDiskPresetRefs와 같은 규칙: <projKey>/*/{session,history_auto,history_manual}.json의 가장 큰 번호
function diskRefMax(projDir) {
	let max = 0;
	for (const e of fs.readdirSync(projDir, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		for (const f of ["session.json", "history_auto.json", "history_manual.json"]) {
			const p = path.join(projDir, e.name, f);
			if (!fs.existsSync(p)) continue;
			const text = fs.readFileSync(p, "utf8");
			let m;
			REF.lastIndex = 0;
			while ((m = REF.exec(text))) max = Math.max(max, parseInt(m[1], 10));
		}
	}
	return max;
}

test("운영 캐시: 새 프리셋 id는 살아 있는 id·휴지통 id·디스크의 모든 참조보다 크다", { skip }, (t) => {
	const { nextFreePresetId, presetNum } = loadRegions(["src/mi/core.ts"]);
	const projects = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	let checked = 0;
	for (const pk of projects) {
		const projDir = path.join(ROOT, pk);
		const presetsPath = path.join(projDir, "presets.json");
		const disk = diskRefMax(projDir);
		if (!fs.existsSync(presetsPath)) {
			t.diagnostic(pk + ": presets.json 없음, 디스크 최대 참조 " + disk);
			continue;
		}
		const file = JSON.parse(fs.readFileSync(presetsPath, "utf8"));
		const live = Object.keys(file.presets || {});
		const trash = (file.presetTrash || []).map((x) => x && x.preset && x.preset.id);
		const liveMax = Math.max(0, ...live.map(presetNum));
		const trashMax = Math.max(0, ...trash.map(presetNum));
		const refs = disk > 0 ? ["preset_" + disk] : [];
		const r = nextFreePresetId(file.presets, file.presetTrash, refs, file.nextPresetId);
		const n = presetNum(r.id);
		t.diagnostic(pk + ": nextPresetId " + file.nextPresetId + " · 살아 있는 최대 " + liveMax + " · 휴지통 최대 " + trashMax + " · 디스크 최대 참조 " + disk + " → 새 id " + r.id);
		assert.ok(n > liveMax && n > trashMax && n > disk, pk + ": " + r.id);
		checked++;
	}
	t.diagnostic("presets.json이 있는 프로젝트 " + checked + "개");
});
