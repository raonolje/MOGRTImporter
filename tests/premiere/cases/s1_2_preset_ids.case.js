"use strict";
/**
 * S1-2 하드: 프리셋 id 안전.
 *   DEV 캐시의 이 프로젝트 presets.json을 실제 데이터 모양(preset_1,2,3,4,6,8 + 휴지통의 다른 preset_2,
 *   nextPresetId 2)으로 바꿔 놓고 (끝나면 원래 파일로 되돌린다):
 *   (1) 새 프리셋 → preset_9, preset_2는 그대로
 *   (2) 휴지통의 preset_2 복구 → preset_10 ('새 ID로 복구')
 *   (DEV 캐시의 이 프로젝트 session·히스토리가 preset_9 이상을 이미 가리키면 패널은 그 번호도 피한다 →
 *    기대 id를 그만큼 올린다. 깨끗한 캐시에서는 preset_9·10·11)
 *   (3) 같은 프리셋 파일을 가져오면 모든 id·행이 그대로
 *   (4) preset_3이 다른 MOGRT인 파일 → 옛 preset_3은 휴지통(why import), 가져온 것은 새 id, preset_3을 쓰던 행은 프리셋 없음
 * 필요: 스캔된 MOGRT 2개 이상. 실행: npm run hard -- s1_2
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");

const SRT = [
	"1", "00:00:01,000 --> 00:00:02,000", "S12 합성 하나", "",
	"2", "00:00:03,000 --> 00:00:04,000", "S12 합성 둘", "",
	"3", "00:00:05,000 --> 00:00:06,000", "S12 합성 셋", ""
].join("\n");

function synthPreset(id, name, mogrtPath) {
	return { id, name, mogrtPath, params: [], exposedIndices: [], textParamIndex: -1, exposedFontFields: {}, thumbnailData: null };
}

// DEV 캐시의 이 프로젝트 폴더에서 session·히스토리가 가리키는 가장 큰 프리셋 번호 (패널 _scanDiskPresetRefs와 같은 규칙)
function diskPresetRefMax(root, projKey) {
	const dir = path.join(root, projKey);
	let max = 0;
	if (!fs.existsSync(dir)) return 0;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		for (const f of ["session.json", "history_auto.json", "history_manual.json"]) {
			const fp = path.join(dir, e.name, f);
			if (!fs.existsSync(fp)) continue;
			const text = fs.readFileSync(fp, "utf8");
			const re = /"presetId"\s*:\s*"preset_(\d+)"/g;
			let m;
			while ((m = re.exec(text))) max = Math.max(max, parseInt(m[1], 10));
		}
	}
	return max;
}

async function importText(api, text, log) {
	const { panel } = api;
	for (let attempt = 0; attempt < 6; attempt++) {
		// 이전 '프리셋 불러오기' 문구와 섞이지 않게 상태 줄을 비운다 (테스트 전용 DOM 조작)
		await panel("(() => { document.getElementById('statusBar').textContent = ''; return true; })()");
		await panel(H.pageImportPresetsText(text, "s1_2_presets.json"));
		// 30초 재스캔과 겹치면 '스캔이 진행 중' 알림이 뜬다 → 닫고 다시
		const res = await H.waitFor(panel, "(() => { const a = " + H.PAGE_ALERT + "; if (a) return { alert: a };" +
			" const m = document.getElementById('confirmModal'); return m && m.classList.contains('open') ? { confirm: document.getElementById('confirmMessage').textContent } : null; })()",
			{ timeoutMs: 15000, what: "가져오기 확인창" });
		if (res.alert) {
			log("알림: " + res.alert);
			await panel("document.getElementById('alertOk').click(), true");
			if (/스캔이 진행 중/.test(res.alert)) { await H.sleep(3000); continue; }
			throw new Error("가져오기 알림: " + res.alert);
		}
		await H.confirmYes(api.panel);
		return H.waitStatus(panel, /프리셋 불러오기/);
	}
	throw new Error("MOGRT 스캔이 끝나지 않아 가져오지 못했다");
}

module.exports = {
	name: "S1-2 프리셋 id 안전",
	run: async (api) => {
		const { panel, assert, log, reload } = api;
		await H.reloadClean(reload, assert, log);
		await H.waitKeys(panel);
		const root = await H.devCacheRoot(panel);
		const snap0 = await panel("window._mogrtDebug.snapshot()");
		const presetsPath = root + "/" + snap0.keys.proj + "/presets.json";
		const backup = await panel("window._mogrtDebug._fsRead(" + JSON.stringify(presetsPath) + ")");
		const mogrts = await H.waitMogrts(panel, 2);
		const M = (i) => mogrts[i % mogrts.length][0];
		// 씨앗을 넣기 전(홈 session.json이 아직 이전 줄을 가질 때) 디스크 참조를 본다 → 첫 새 id
		const refMax = diskPresetRefMax(root, snap0.keys.proj);
		const F = Math.max(9, refMax + 1);
		const id = (k) => "preset_" + (F + k);
		log("디스크의 가장 큰 프리셋 참조: " + (refMax || "없음") + " → 첫 새 id " + id(0));

		const seed = {
			presets: {
				preset_1: synthPreset("preset_1", "S12 합성 1", M(0)),
				preset_2: synthPreset("preset_2", "S12 합성 2", M(1)),
				preset_3: synthPreset("preset_3", "S12 합성 3", M(0)),
				preset_4: synthPreset("preset_4", "S12 합성 4", M(1)),
				preset_6: synthPreset("preset_6", "S12 합성 6", M(0)),
				preset_8: synthPreset("preset_8", "S12 합성 8", M(1))
			},
			presetTrash: [{ preset: synthPreset("preset_2", "S12 휴지통 2", M(0)), deletedAt: "2026-06-01T00:00:00.000Z" }],
			nextPresetId: 2
		};
		try {
			assert.equal(await panel("window._mogrtDebug._fsWrite(" + JSON.stringify(presetsPath) + ", " + JSON.stringify(seed) + ")"), true, "DEV presets.json 쓰기");
			await H.reloadClean(reload, assert, log);
			await H.waitFor(panel, "(() => { const s = window._mogrtDebug.snapshot(); return s.presets.preset_8 && s.presets.preset_8.name === 'S12 합성 8'; })()", { what: "합성 프리셋 로드" });
			await H.waitKeys(panel);
			// 먼저 SRT를 연다: 행·자막 휴지통이 비워져 이전 실행의 presetId 참조가 할당에 끼지 않는다
			assert.equal(await panel(H.pageDropSrt("s1_2.srt", SRT)), "sent");
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "행 3개" });
			const rows = await panel(H.PAGE_ROWS);

			// (1) 새 프리셋 → preset_9
			await H.createPresetViaModal(api, M(1), { name: "S12 새 프리셋" });
			let s = await panel("window._mogrtDebug.snapshot()");
			assert.ok(s.presets[id(0)], id(0) + "가 생겼다: " + Object.keys(s.presets).join(","));
			assert.equal(s.presets[id(0)].name, "S12 새 프리셋");
			assert.deepEqual([s.presets.preset_2.name, s.presets.preset_2.mogrtPath], ["S12 합성 2", M(1)], "preset_2는 그대로");
			assert.equal(s.nextPresetId, F + 1);

			// (2) 휴지통의 preset_2 복구 → preset_10
			const clicked = await panel("(() => { const r = Array.from(document.querySelectorAll('#presetTrashWrap .trash-row')).find((x) => (x.querySelector('.trash-text') || {}).textContent.indexOf('S12 휴지통 2') === 0);" +
				" if (!r) return false; r.querySelector('.btn-restore').click(); return true; })()");
			assert.equal(clicked, true, "프리셋 휴지통에서 'S12 휴지통 2'를 찾았다");
			const st2 = await H.waitStatus(panel, /새 ID로 복구/);
			log(st2.text);
			s = await panel("window._mogrtDebug.snapshot()");
			assert.equal(s.presets[id(1)] && s.presets[id(1)].name, "S12 휴지통 2");
			assert.equal(s.presets[id(1)].id, id(1));
			assert.equal(s.presets.preset_2.name, "S12 합성 2", "살아 있던 preset_2를 덮어쓰지 않았다");
			assert.equal(s.nextPresetId, F + 2);

			// (3) 행 준비: 1번 → preset_1, 2·3번 → preset_3
			await panel(H.pageSetRowPreset(rows[0].id, "preset_1"));
			await panel(H.pageSetRowPreset(rows[1].id, "preset_3"));
			await panel(H.pageSetRowPreset(rows[2].id, "preset_3"));
			const beforeImport = await panel("window._mogrtDebug.snapshot()");
			// 내보내기 파일과 같은 모양 (저장된 presets.json의 프리셋 그대로)
			const saved = await panel("window._mogrtDebug._fsRead(" + JSON.stringify(presetsPath) + ")");
			const exportText = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), presets: saved.presets }, null, 2);
			const st3 = await importText(api, exportText, log);
			log(st3.text);
			s = await panel("window._mogrtDebug.snapshot()");
			assert.deepEqual(Object.keys(s.presets).sort(), Object.keys(beforeImport.presets).sort(), "id 목록이 그대로");
			for (const id of Object.keys(s.presets)) {
				assert.deepEqual([s.presets[id].name, s.presets[id].mogrtPath], [beforeImport.presets[id].name, beforeImport.presets[id].mogrtPath], id);
			}
			assert.deepEqual(rows.map((r) => s.rowStates[r.id].presetId), ["preset_1", "preset_3", "preset_3"], "행 프리셋 그대로");
			assert.equal(s.presetTrash.length, beforeImport.presetTrash.length, "휴지통 그대로");
			assert.equal(s.nextPresetId, beforeImport.nextPresetId, "카운터 그대로");

			// (4) preset_3이 다른 MOGRT인 파일
			const other = JSON.parse(JSON.stringify(saved.presets));
			other.preset_3.mogrtPath = M(1) === saved.presets.preset_3.mogrtPath ? M(0) : M(1);
			assert.notEqual(other.preset_3.mogrtPath, saved.presets.preset_3.mogrtPath);
			const st4 = await importText(api, JSON.stringify({ version: 1, presets: other }), log);
			log(st4.text);
			assert.match(st4.text, /2개 줄의 프리셋 연결이 끊어졌습니다/);
			s = await panel("window._mogrtDebug.snapshot()");
			assert.equal(s.presets.preset_3, undefined, "옛 preset_3은 살아 있지 않다");
			const trashed = s.presetTrash.filter((t) => t.why === "import");
			assert.deepEqual(trashed.map((t) => t.preset.id), ["preset_3"]);
			const fresh = Object.values(s.presets).find((p) => p.name === "S12 합성 3");
			assert.ok(fresh && fresh.id !== "preset_3", "가져온 preset_3은 새 id: " + (fresh && fresh.id));
			assert.equal(fresh.id, id(2));
			assert.equal(fresh.mogrtPath, other.preset_3.mogrtPath);
			assert.deepEqual(rows.map((r) => s.rowStates[r.id].presetId), ["preset_1", "", ""], "preset_3 행은 프리셋 없음 (다른 MOGRT가 아님)");
			const sel = await panel(H.PAGE_ROWS);
			assert.deepEqual(sel.map((r) => r.preset), ["preset_1", "", ""]);
			return id(0) + " · " + id(1) + " · 재가져오기 id 유지 · " + fresh.id;
		} finally {
			// DEV presets.json을 원래대로 (없었으면 빈 프리셋 파일)
			const restore = backup || { presets: {}, presetTrash: [], nextPresetId: 1 };
			await panel("window._mogrtDebug._fsWrite(" + JSON.stringify(presetsPath) + ", " + JSON.stringify(restore) + ")");
			await reload();
		}
	}
};
