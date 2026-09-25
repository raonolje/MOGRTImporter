"use strict";
// S1-2: 프리셋 id 안전 — 단조 증가 할당, 가져오기 id 대응
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/mi/core.ts"]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// 패널 doImport(교체)와 같은 순서: 대응 → 안 쓰인 기존은 휴지통 → 새 id 할당
function simulateImport(state, fileMap) {
	const live = Object.assign({}, state.presets);
	const accepted = Object.entries(fileMap).map(([pid, p]) => ({ pid, p }));
	const plan = core.matchImportedPresets(accepted.map((a) => ({ id: a.pid, name: a.p.name, mogrtPath: a.p.mogrtPath })), live);
	plan.dropped.forEach((id) => {
		state.presetTrash.push({ preset: clone(live[id]), deletedAt: "t", why: "import" });
		delete state.presets[id];
	});
	const out = {};
	accepted.forEach((a, i) => {
		let id = plan.ids[i];
		if (!id) {
			const refs = Object.values(state.rowStates).map((rs) => rs.presetId).filter(Boolean);
			const r = core.nextFreePresetId(state.presets, state.presetTrash, refs, state.nextPresetId);
			state.nextPresetId = r.next;
			id = r.id;
		}
		state.presets[id] = Object.assign({}, a.p, { id });
		out[a.pid] = id;
	});
	Object.values(state.rowStates).forEach((rs) => { if (rs.presetId && !state.presets[rs.presetId]) rs.presetId = ""; });
	return { map: out, dropped: plain(plan.dropped) };
}

function realLike() {
	const { presets } = build();
	const trashP2 = Object.assign(clone(presets.preset_2), { name: "FHD_모션없는 그라데이션 텍스트", mogrtPath: "D:/MOGRT/FHD_그라데이션.mogrt" });
	return {
		presets,
		presetTrash: [{ preset: trashP2, deletedAt: "2026-06-01T00:00:00.000Z" }],
		nextPresetId: 2,
		rowStates: { 1: { presetId: "preset_1" }, 2: { presetId: "preset_3" }, 3: { presetId: "preset_3" }, 4: { presetId: "" } }
	};
}

test("matchImportedPresets: 이름과 MOGRT 파일 이름(대소문자·폴더 무시)이 같으면 기존 id", () => {
	const live = {
		preset_3: { id: "preset_3", name: "밴드", mogrtPath: "D:/MOGRT/Band.mogrt" },
		preset_7: { id: "preset_7", name: "밴드", mogrtPath: "E:\\other\\band.MOGRT" },
		preset_9: { id: "preset_9", name: "제목", mogrtPath: "D:/MOGRT/Title.mogrt" }
	};
	const r = plain(core.matchImportedPresets([
		{ id: "preset_7", name: "밴드", mogrtPath: "C:/x/BAND.mogrt" }, // 파일 id가 후보에 있으면 그것
		{ id: "preset_1", name: "밴드", mogrtPath: "C:/x/band.mogrt" }, // 남은 후보
		{ id: "preset_2", name: "밴드", mogrtPath: "C:/x/band.mogrt" }, // 후보가 다 쓰임 → 새 id
		{ id: "preset_9", name: "제목", mogrtPath: "C:/x/Other.mogrt" }, // 이름만 같고 MOGRT가 다름 → 새 id
		{ id: "preset_5", name: "새 이름", mogrtPath: "D:/MOGRT/Title.mogrt" } // MOGRT만 같음 → 새 id
	], live));
	assert.deepEqual(r.ids, ["preset_7", "preset_3", null, null, null]);
	assert.deepEqual(r.dropped, ["preset_9"]);
	assert.deepEqual(plain(core.matchImportedPresets([], null)), { ids: [], dropped: [] });
});

test("같은 파일을 다시 가져오면 모든 id가 그대로이고 휴지통·카운터도 그대로", () => {
	const st = realLike();
	const exported = clone(st.presets);
	const before = clone(st);
	const r = simulateImport(st, exported);
	assert.deepEqual(r.dropped, []);
	assert.deepEqual(r.map, { preset_1: "preset_1", preset_2: "preset_2", preset_3: "preset_3", preset_4: "preset_4", preset_6: "preset_6", preset_8: "preset_8" });
	assert.deepEqual(Object.keys(st.presets).sort(), Object.keys(before.presets).sort());
	assert.equal(st.presetTrash.length, 1);
	assert.equal(st.nextPresetId, 2, "새 id를 받지 않았으니 카운터도 그대로");
	assert.deepEqual(st.rowStates, before.rowStates, "행은 그대로");
});

test("preset_3이 다른 MOGRT인 파일: 옛 preset_3은 휴지통, 가져온 것은 새 id(preset_9), 행은 프리셋 없음", () => {
	const st = realLike();
	const file = clone(st.presets);
	file.preset_3 = Object.assign(clone(file.preset_3), { mogrtPath: "D:/MOGRT/완전히 다른 템플릿.mogrt" });
	const r = simulateImport(st, file);
	assert.deepEqual(r.dropped, ["preset_3"]);
	assert.equal(r.map.preset_3, "preset_9");
	assert.equal(st.presets.preset_9.mogrtPath, "D:/MOGRT/완전히 다른 템플릿.mogrt");
	assert.equal(st.presets.preset_3, undefined);
	assert.equal(st.presetTrash[1].why, "import");
	assert.equal(st.presetTrash[1].preset.id, "preset_3");
	assert.equal(st.nextPresetId, 10);
	assert.deepEqual([st.rowStates[2].presetId, st.rowStates[3].presetId, st.rowStates[1].presetId], ["", "", "preset_1"]);
});

test("새 이름은 알려진 모든 id(휴지통 포함)보다 큰 새 id를 받는다", () => {
	const st = realLike();
	st.presetTrash.push({ preset: { id: "preset_12", name: "옛날", mogrtPath: "D:/old.mogrt" }, deletedAt: "t" });
	const file = { preset_2: { id: "preset_2", name: "처음 보는 프리셋", mogrtPath: "D:/MOGRT/정의 자막.mogrt" } };
	const r = simulateImport(st, file);
	assert.equal(r.map.preset_2, "preset_13");
	// 파일에 없던 기존 프리셋은 모두 휴지통 (교체), id는 재사용되지 않는다
	assert.deepEqual(r.dropped.sort(), ["preset_1", "preset_2", "preset_3", "preset_4", "preset_6", "preset_8"]);
	assert.ok(st.presetTrash.every((t, i) => i < 2 || t.why === "import"));
});

test("휴지통 preset_2 복구: 살아 있는 preset_2가 있으면 새 id (실제 데이터 → preset_9 다음 preset_10)", () => {
	const st = realLike();
	// preset_9를 먼저 만든다 (btnSaveDefault)
	const a = core.nextFreePresetId(st.presets, st.presetTrash, ["preset_1", "preset_3"], st.nextPresetId);
	assert.equal(a.id, "preset_9");
	st.nextPresetId = a.next;
	st.presets.preset_9 = { id: "preset_9", name: "새 프리셋", mogrtPath: "D:/n.mogrt" };
	// 휴지통 복구: 패널은 항목을 꺼낸 뒤 할당한다
	const item = st.presetTrash.splice(0, 1)[0];
	assert.ok(st.presets[item.preset.id], "같은 id가 살아 있다");
	const b = core.nextFreePresetId(st.presets, st.presetTrash, ["preset_1", "preset_3"], st.nextPresetId);
	assert.equal(b.id, "preset_10");
	assert.equal(b.next, 11);
});

test("패널 정적 검사: 프리셋 id를 카운터로 직접 만들거나 카운터를 되돌리지 않는다", () => {
	const fs = require("node:fs");
	const { APP_JS } = require("../lib/loadRegions");
	const src = fs.readFileSync(APP_JS, "utf8");
	assert.equal(/"preset_"\s*\+\s*state\.nextPresetId/.test(src), false, "\"preset_\" + state.nextPresetId++ 가 남아 있다");
	assert.equal(/state\.nextPresetId\s*=\s*1\s*;/.test(src), false, "가져오기가 카운터를 1로 되돌린다");
	// 새 프리셋 저장, 동기화 불일치 프리셋, 가져오기, 휴지통 복구
	assert.ok((src.match(/_allocPresetId\(\)/g) || []).length >= 4);
});
