"use strict";
/**
 * S1-5 하드: mi 블록·cast.json·작업 파일 id/salt 규칙·runCommand (DEV 패널, MI_test.prproj의 T_ 시퀀스).
 * 모두 스크래치 사본(T_scratch_s1_5)에서 돈다. 사본의 DEV 세션 폴더는 끝나면 지워진다. 타임라인은 바꾸지 않는다.
 *   (1) 단일 화자: SRT·프리셋 → session.json(키 4개, mi 없음) → 새로 고친 뒤 속성창을 열고 닫아도 파일이 그대로, cast.json 없음
 *       (스펙은 '실제 시퀀스 4개'지만 가드가 MI_test만 허용한다. 실제 세션 왕복은 tests/compat/realcache.test.js)
 *   (3) 같은 GUID·다른 projKey의 작업 파일 → id 유지, 비어 있던 salt를 받는다, cast.json
 *   (4) session.json에서 mi를 지우고(v27 저장 흉내) 새로 고침 → cast.json에서 화자 표·salt 복원
 *   (2) 다른 GUID의 작업 파일 → hwm 위로 id를 다시 매김, rowStates 키 일치, mi.remapped
 *   (5) cmd('resolve', {label:'#12'}) → index 12 줄의 uid와 문장, status.coreHash
 * 실행: npm run hard -- s1_5
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");

const DOT = String.fromCharCode(0xb7);
const srtOf = (texts) => texts.map((t, i) => {
	const s = 1 + i * 2;
	const tc = (x) => "00:00:" + String(x).padStart(2, "0") + ",000";
	return (i + 1) + "\n" + tc(s) + " --> " + tc(s + 1) + "\n" + t + "\n";
}).join("\n");
const rsOf = () => ({ presetId: "", params: [], _allParams: [], open: false, checked: false });
function subOf(id, index, text, spk) {
	const tc = (x) => "00:00:" + String(x).padStart(2, "0") + ".000";
	const s = { index, startTime: tc(index * 2), endTime: tc(index * 2 + 1), startSec: index * 2, endSec: index * 2 + 1, text, id };
	if (spk) { s.spk = spk; s.srtNo = index; }
	return s;
}
function workOf(seqKey, subs, extra) {
	const rowStates = {};
	subs.forEach((s) => { rowStates[s.id] = rsOf(); });
	return Object.assign({ version: 2, savedAt: new Date().toISOString(), sequenceKey: seqKey, subtitles: subs, rowStates, trashBin: [], nextId: Math.max(...subs.map((s) => s.id)) + 1, trackValue: "2" }, extra || {});
}
const SNAP = "window._mogrtDebug.snapshot()";

module.exports = {
	name: "S1-5 mi·cast.json·작업 파일 id/salt·runCommand",
	run: async (api) => {
		const { panel, assert, log, reload } = api;
		await H.waitKeys(panel);
		const root = await H.devCacheRoot(panel);
		await H.withScratchSequence(api, "s1_5", async (info) => {
			let snap = await panel(SNAP);
			const dir = path.join(root.replace(/\//g, path.sep), snap.keys.proj, snap.keys.seq);
			const file = (f) => path.join(dir, f);
			const readJson = (f) => (fs.existsSync(file(f)) ? JSON.parse(fs.readFileSync(file(f), "utf8")) : null);
			const guid = snap.keys.seq.split("_seq_")[1];
			assert.ok(guid && info.clone.id.replace(/[^a-zA-Z0-9-]/g, "_") === guid, "스크래치 시퀀스 GUID: " + guid);

			// (1) 단일 화자 왕복
			assert.equal(await panel(H.pageDropSrt("s1_5.srt", srtOf(["S15 하나", "S15 둘", "S15 셋"]))), "sent");
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "3줄" });
			const [pid] = await H.ensurePreset(api);
			const rows = await panel(H.PAGE_ROWS);
			await panel(H.pageSetRowPreset(rows[0].id, pid));
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return (s.rowStates[" + rows[0].id + "]._allParams || []).length > 0; })()", { what: "행 속성" });
			const before = readJson("session.json");
			assert.deepEqual(Object.keys(before), ["subtitles", "rowStates", "trashBin", "nextId"], "키 4개");
			await H.reloadClean(reload, assert, log);
			await H.waitKeys(panel);
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "새로 고친 뒤 3줄" });
			await panel("(() => { const t = document.querySelector('#row-" + rows[0].id + " .sub-text'); t.click(); t.click(); window._mogrtDebug.saveSession(); return true; })()");
			assert.deepEqual(readJson("session.json"), before, "새로 고치고 속성창을 열고 닫아도 session.json이 같다");
			assert.equal(fs.existsSync(file("cast.json")), false, "단일 화자는 cast.json을 만들지 않는다");
			snap = await panel(SNAP);
			assert.equal(snap.mi.salt, "");
			log("(1) 단일 화자 왕복: 키 4개, mi 없음");

			// (3) 같은 GUID, 다른 projKey (Premiere 'Save As') → id 유지, salt를 받는다
			const castMi = { salt: "s1t5", castOrder: ["C1", "C2"], cast: { C1: { name: "S15 철수", track: null, presetId: "", color: 0 }, C2: { name: "S15 영희", track: null, presetId: "", color: 1 } }, stack: false, stackDy: 0.12, legacyTrack: null };
			const same = workOf("proj_s15saveas_seq_" + guid, [subOf(101, 1, "S15 C1 하나", "C1"), subOf(102, 2, "S15 C2 하나", "C2"), subOf(103, 3, "S15 C1 둘", "C1")], { mi: castMi });
			assert.equal(await panel(H.pageLoadWork("s1_5_same.json", same)), "sent");
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === 3 && s.subtitles[0].id === 101; })()", { what: "같은 GUID 작업 불러오기" });
			snap = await panel(SNAP);
			assert.deepEqual(snap.subtitles.map((s) => s.id), [101, 102, 103], "id 유지");
			assert.equal(snap.mi.salt, "s1t5", "비어 있던 salt를 받는다");
			assert.deepEqual(snap.mi.castOrder, ["C1", "C2"]);
			const sess3 = readJson("session.json");
			assert.equal(sess3.mi.salt, "s1t5", "session.json에 mi");
			const side = readJson("cast.json");
			assert.ok(side && side.salt === "s1t5" && side.hwm >= 103, "cast.json: " + JSON.stringify(side && { salt: side.salt, hwm: side.hwm }));
			const safety = readJson("history_safety.json") || [];
			assert.equal(safety[0] && safety[0].label, "작업 불러오기 전");
			log("(3) 같은 GUID: id 유지, salt 받음, cast.json hwm " + side.hwm);

			// (4) v27 저장 흉내: session.json에서 mi를 지우고 새로 고침 → cast.json에서 되살린다
			const stripped = readJson("session.json");
			delete stripped.mi;
			fs.writeFileSync(file("session.json"), JSON.stringify(stripped));
			await H.reloadClean(reload, assert, log);
			await H.waitKeys(panel);
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "새로 고친 뒤 3줄" });
			snap = await panel(SNAP);
			assert.equal(snap.mi.salt, "s1t5", "cast.json에서 salt");
			assert.deepEqual(snap.mi.castOrder, ["C1", "C2"]);
			assert.equal(snap.mi.cast.C2.name, "S15 영희");
			assert.deepEqual(snap.mi.applied, {});
			log("(4) mi 없는 session.json + cast.json → 화자 표·salt 복원");

			// (2) 다른 GUID → hwm 위로 다시 매김, remapped, salt는 그대로
			const hwm = snap.mi.hwm;
			const texts = Array.from({ length: 14 }, (_, i) => "S15 다른 시퀀스 " + (i + 1));
			const other = workOf("proj_s15other_seq_00000000-0000-0000-0000-00000000s15x", texts.map((t, i) => subOf(i + 1, i + 1, t)), { mi: Object.assign({}, castMi, { salt: "zzzz" }) });
			other.rowStates[2].checked = true;
			assert.equal(await panel(H.pageLoadWork("s1_5_other.json", other)), "sent");
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === 14; })()", { what: "다른 GUID 작업 불러오기" });
			snap = await panel(SNAP);
			const ids = snap.subtitles.map((s) => s.id);
			assert.ok(ids.every((id) => id > hwm), "모든 id > hwm(" + hwm + "): " + ids.join(","));
			assert.deepEqual(Object.keys(snap.rowStates).map(Number).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b), "rowStates 키 = 새 id");
			assert.equal(snap.rowStates[ids[1]].checked, true, "rowState가 새 id를 따라간다");
			assert.equal(snap.mi.remapped, true);
			assert.equal(snap.mi.salt, "s1t5", "salt는 받지 않는다");
			log("(2) 다른 GUID: " + ids[0] + "~" + ids[ids.length - 1] + " (hwm " + hwm + ")");

			// (5) runCommand
			const r = await panel(H.pageCmd("resolve", { label: "#12" }));
			assert.equal(r.ok, true, JSON.stringify(r));
			const row12 = snap.subtitles.find((s) => s.index === 12);
			assert.deepEqual([r.data.index, r.data.id, r.data.uid, r.data.text, r.data.label], [12, row12.id, "s1t5-" + row12.id, "S15 다른 시퀀스 12", "#12"]);
			const st = await panel(H.pageCmd("status", {}));
			assert.equal(st.ok, true);
			assert.match(String(st.data.coreHash), /^[0-9a-f]{8}$/, "coreHash (설치된 app.js)");
			assert.equal(st.data.seq.id, info.clone.id);
			log("(5) resolve #12 → " + r.data.uid + ", coreHash " + st.data.coreHash + ", 화자 " + st.data.speakers.map((x) => x.key).join("/"));
			const bad = await panel(H.pageCmd("nope", {}));
			assert.deepEqual([bad.ok, bad.error], [false, "bad-args"]);
			const c2 = await panel(H.pageCmd("resolve", { label: "C2" + DOT + "1" }));
			assert.equal(c2.error, "not-found", "지금 목록에는 화자 줄이 없다");
		});
	}
};
