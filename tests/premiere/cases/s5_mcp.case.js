"use strict";
/**
 * M5.2 하드: 진짜 MCP 서버(mcp/server.mjs, SDK Client stdio) ↔ bridge_dev ↔ DEV 패널 — 읽기 도구.
 * 스크래치 사본(T_scratch_s5_mcp)에 C1 14줄·C2 12줄을 캡션 필드와 다른 텍스트 필드가 있는 AE 프리셋으로 가져온다. 타임라인은 바꾸지 않는다.
 * 준비: `cd mcp && npm install` (SDK). 'AI 연결 허용'과 cast_defaults.json은 끝나면 시작 전으로 되돌린다.
 *   (1) get_status: core.match(설치된 DEV app.js core 해시 = heartbeat), seq·줄 수, 클라이언트 by codex
 *   (2) list_presets ↔ 패널 presets, (3) get_rows 화자·쪽, (4) find_row 'C2·12 T?'·'#12' 모호
 *   (5) plan_apply·verify_timeline: 호스트 쓰기 호출 없음, (6) 읽기 도구 5초 안 (계획·검수는 19초 안, 로그)
 * M5.3 쓰기 도구:
 *   (7) suggest_fields 20줄(포인트 텍스트, 프리셋 notes의 최대 개수에 맞춤) → 대기열에만 ('AI 제안 (20)'), 속성·타임라인 그대로, field_sig 되돌림
 *   (8) 낡은 field_sig → fields-changed (아무것도 넣지 않음), (9) 'C2·12 T?'는 find_row로 → 제안
 *   (10) set_cast_proposal → 패널 위쪽 승인 카드: [거절]은 그대로, [승인]은 안전 지점 'AI: 화자 표 바꾸기 전' → 화자 표 → 히스토리 'AI: …'
 *   끝에서 제안은 모두 버린다
 * 실행: npm run hard -- s5_mcp
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const M = require("../../mcp/lib/mcpClient");

const SNAP = "window._mogrtDebug.snapshot()";
const DOT = String.fromCharCode(0xb7);
const pageImportPresets = (presetId) => "(() => { document.querySelectorAll('#impBody tr.imp-row').forEach((r) => { const p = r.querySelector('.imp-preset'); p.value = " + JSON.stringify(presetId) + "; p.dispatchEvent(new Event('change')); }); return true; })()";
const HOST_WRITES = ["MID_placeChunk", "MID_removeClips", "MID_ensureVideoTracks", "MID_setMotion", "applyToTimeline", "updateClipAtTime", "removeNativeClipsAt"];

/** 캡션 필드와 다른 텍스트 필드가 있는 AE 프리셋을 골라(없으면 만들어) 스크래치에 C1·C2를 가져온다 → {P, capF, other, c1, c2, dir} */
async function setup(api, tag) {
	const { panel, assert, log } = api;
	const pick = (list) => list.filter((p) => !p.native && p.captionFid && p.fields.some((f) => !f.caption)).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
	let P = pick((await panel(H.pageCmd("presets", {}))).data);
	if (!P) {
		await H.ensurePreset(api, { prefer: /라온올제/ });
		P = pick((await panel(H.pageCmd("presets", {}))).data);
	}
	assert.ok(P, "캡션 필드와 다른 텍스트 필드가 있는 AE 프리셋이 필요하다");
	const capF = P.fields.find((f) => f.caption);
	const other = P.fields.find((f) => !f.caption);
	log("프리셋 " + P.id + " " + P.name + " (" + P.fields.map((f) => f.fid + (f.caption ? "*" : "") + " " + f.label).join(" · ") + ")");
	const c1 = [];
	const c2 = [];
	for (let k = 0; k < 14; k++) c1.push([1 + k * 3, 2.5 + k * 3, tag + " 철수 " + (k + 1) + "번째 오늘 날씨 하늘 맑음"]);
	for (let k = 0; k < 12; k++) c2.push([2 + k * 3, 3 + k * 3, tag + " 영희 " + (k + 1) + "번째 바다 이야기"]);
	assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: H.srtOf(c1) }, { name: "C2.srt", content: H.srtOf(c2) }])), "sent");
	await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 2 ? m : null; })()", { what: "가져오기 창" });
	await panel(pageImportPresets(P.id));
	await panel("document.getElementById('impOk').click(), true");
	await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 26", { what: "26줄" });
	await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });
	return { P, capF, other, c1, c2 };
}

/** DEV 다리 폴더를 확인하고 'AI 연결 허용'을 켠다 → {dir, wasOn} */
async function linkOn(api) {
	const { panel, assert } = api;
	const dirPosix = String(await panel("window._mogrtDebug.inbox.dir()"));
	assert.match(dirPosix, /\/MogrtImporter\/bridge_dev$/, "DEV 패널은 bridge_dev (운영 다리에 쓰지 않는다)");
	const wasOn = await panel("window._mogrtDebug.inbox.on()");
	assert.equal(await panel("window._mogrtDebug.inbox.set(true)"), true, "AI 연결 켜짐");
	return { dir: dirPosix.replace(/\//g, path.sep), wasOn };
}

async function run(api) {
	const { panel, assert, log } = api;
	await H.waitKeys(panel);
	assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
	M.sdk(); // SDK가 없으면 여기서 'cd mcp && npm install' 안내로 실패
	const root = await H.devCacheRoot(panel);
	const snap0 = await panel(SNAP);
	const defPath = path.join(root.replace(/\//g, path.sep), snap0.keys.proj, "cast_defaults.json");
	const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
	const link = await linkOn(api);
	let c = null;
	try {
		await H.withScratchSequence(api, "s5_mcp", async () => {
			const fx = await module.exports.setup(api, "S5M"); // (module.exports: 저장소 밖 미리 돌리기에서 바꿔 끼운다)
			c = await M.connect({ MI_BRIDGE_DIR: link.dir }, "codex-mcp-client");
			const times = {};
			const call = async (name, args, maxMs = 5000) => {
				const r = await M.callJson(c.client, name, args);
				times[name] = Math.max(times[name] || 0, r.ms);
				assert.ok(r.ms < maxMs, name + " " + maxMs + "ms 안: " + r.ms);
				return r;
			};
			const snap = await panel(SNAP);

			// (1) get_status
			let r = await call("get_status", {});
			assert.equal(r.isError, false, r.text);
			assert.equal(r.json.core.match, true, "설치본 core 해시 = 패널: " + JSON.stringify(r.json.core));
			assert.deepEqual([r.json.panel.seq.id, r.json.panel.rows, r.json.client], [snap.keys.seqId, 26, "codex"]);
			assert.match(String(r.json.panel.panel.build), /^dev-/);
			log("(1) get_status core " + r.json.core.hash + " · seq " + r.json.panel.seq.name + " · 줄 " + r.json.panel.rows);

			// (2) list_presets
			r = await call("list_presets", {});
			const pr = r.json.presets.find((p) => p.id === fx.P.id);
			assert.deepEqual(pr.fields, fx.P.fields);
			log("(2) list_presets " + r.json.presets.length + "개 · " + pr.id + " notes " + pr.notes.length);

			// (3) get_rows
			r = await call("get_rows", { speaker: "C2", count: 5 });
			assert.deepEqual([r.json.total, r.json.rows.length], [12, 5]);
			assert.deepEqual(r.json.rows.map((x) => x.text), fx.c2.slice(0, 5).map((x) => x[2]));
			r = await call("get_rows", { from: 24, count: 50 });
			assert.deepEqual([r.json.total, r.json.rows.length], [26, 2]);
			log("(3) get_rows 화자·쪽");

			// (4) find_row
			r = await call("find_row", { label: "C2" + DOT + "12 " + fx.other.fid });
			assert.equal(r.isError, false, r.text);
			assert.deepEqual([r.json.text, r.json.field.fid, r.json.field.caption], [fx.c2[11][2], fx.other.fid, false]);
			r = await call("find_row", { label: "#12" });
			assert.deepEqual([r.isError, r.json.code], [true, "bad-args"]);
			assert.match(r.json.message, /C1·12, C2·12/);
			log("(4) find_row C2·12 " + fx.other.fid + " · '#12' 모호");

			// (5) 계획·검수는 읽기만
			await panel(H.PAGE_RECORD_HOST_CALLS);
			r = await call("plan_apply", { speaker: "C1" }, 19000);
			assert.equal(r.isError, false, r.text);
			assert.match(String(r.json.planToken), /^p/);
			r = await call("verify_timeline", {}, 19000);
			assert.equal(r.isError, false, r.text);
			const calls = await panel("window.__hostCalls.slice()");
			assert.deepEqual(calls.filter((n) => HOST_WRITES.indexOf(n) !== -1), [], "호스트 쓰기 없음");
			log("(5) plan_apply·verify_timeline 읽기만 (" + r.json.text + ")");

			r = await call("get_suggestions", {});
			assert.deepEqual(r.json.suggestions, []);
			log("(6) 걸린 시간 " + Object.keys(times).map((k) => k + " " + times[k] + "ms").join(" · "));

			// ── M5.3 ──
			// (7) suggest_fields 20줄: 제안 대기열에만 (속성·타임라인 그대로), field_sig 되돌림
			const seq_id = (await call("get_status", {})).json.seq_id;
			const max = (pr.notes.join(" ").match(/최대\s*(\d+)\s*개/) || [])[1];
			const pt = (a, b) => (max === undefined || Number(max) >= 2 ? a + "$$" + b : a);
			const rowsAll = (await call("get_rows", { count: 50 })).json.rows;
			const pick20 = rowsAll.slice(0, 20);
			const items = pick20.map((x) => ({ uid: x.uid, field_id: fx.other.fid, field_sig: x.sig, value: x.spk === "C1" ? pt("날씨", "맑음") : pt("바다", "이야기"), note: "S5 한국어 메모 ✓" }));
			const allBefore = JSON.stringify(pick20.map((x) => (snap.rowStates[x.id] || {})._allParams));
			await panel(H.PAGE_RECORD_HOST_CALLS);
			r = await call("suggest_fields", { seq_id, items });
			assert.equal(r.isError, false, r.text);
			assert.equal(r.json.queued, 20);
			r.json.results.forEach((q, i) => assert.deepEqual([q.uid, q.field_id, q.field_sig, q.ok], [items[i].uid, fx.other.fid, items[i].field_sig, true]));
			assert.ok(r.json.results.every((q) => /본문에 있음/.test(q.check)), JSON.stringify(r.json.results[0]));
			await H.waitFor(panel, "(document.getElementById('btnSuggestions') || {}).textContent === 'AI 제안 (20)'", { what: "'AI 제안 (20)'" });
			let s2 = await panel(SNAP);
			assert.equal(pick20.filter((x) => s2.rowStates[x.id].sugg && s2.rowStates[x.id].sugg[fx.other.fid]).length, 20);
			assert.equal(JSON.stringify(pick20.map((x) => s2.rowStates[x.id]._allParams)), allBefore, "승인 전에는 속성에 쓰지 않는다");
			assert.deepEqual((await panel("window.__hostCalls.slice()")).filter((n) => HOST_WRITES.indexOf(n) !== -1), [], "호스트 쓰기 없음");
			r = await call("get_suggestions", {});
			assert.ok(r.json.suggestions.length === 20 && r.json.suggestions.every((q) => q.by === "codex" && q.note === "S5 한국어 메모 ✓"));
			log("(7) suggest_fields 20개 → 대기열 ('AI 제안 (20)'), 속성·타임라인 그대로, 값 '" + items[0].value + "'");

			// (8) 낡은 field_sig는 거절, 아무것도 넣지 않는다
			r = await call("suggest_fields", { seq_id, items: [Object.assign({}, items[0], { field_sig: "옛 구조" })] });
			assert.deepEqual([r.isError, r.json.code, r.json.results[0].field_sig], [true, "fields-changed", "옛 구조"]);
			assert.equal((await call("get_suggestions", {})).json.suggestions.length, 20);
			log("(8) 낡은 field_sig → fields-changed");

			// (9) 'C2·12 T?' → find_row → 그 줄에 제안
			const fr = (await call("find_row", { label: "C2" + DOT + "12 " + fx.other.fid })).json;
			r = await call("suggest_fields", { seq_id, items: [{ uid: fr.uid, field_id: fr.fid, field_sig: fr.sig, value: pt("바다", "이야기") }] });
			assert.deepEqual([r.isError, r.json.queued], [false, 1]);
			await H.waitFor(panel, "(document.getElementById('btnSuggestions') || {}).textContent === 'AI 제안 (21)'", { what: "'AI 제안 (21)'" });
			log("(9) find_row C2·12 → 제안 1개 (" + fr.uid + ")");

			// (10) set_cast_proposal → 승인 카드: [거절]은 그대로, [승인]은 안전 지점 → 화자 표 → 히스토리
			const castName = (k) => panel("window._mogrtDebug.snapshot().mi.cast." + k + ".name");
			const name0 = await castName("C2");
			r = await call("set_cast_proposal", { seq_id, items: [{ key: "C2", name: "S5M 민수", track: "V6" }], note: "하드 시험" });
			assert.deepEqual([r.isError, r.json.pending], [false, true], r.text);
			const cardText = "Array.from(document.querySelectorAll('#aiReqBar .ai-req-text')).map((e) => e.textContent)";
			const cards = await H.waitFor(panel, "(() => { const t = " + cardText + "; return t.length ? t : null; })()", { what: "승인 카드" });
			assert.match(cards[0], /AI 요청 \(Codex\) · 화자 표: C2\(.+\) 이름 ‘S5M 민수’, 트랙 V6 — 하드 시험/);
			assert.equal(await castName("C2"), name0, "승인 전에는 그대로");
			await panel("document.querySelector('#aiReqBar .ai-req-no').click(), true");
			await H.waitFor(panel, "document.getElementById('aiReqBar').style.display === 'none'", { what: "카드 닫힘" });
			assert.equal(await castName("C2"), name0, "거절하면 그대로");
			r = await call("set_cast_proposal", { seq_id, items: [{ key: "C2", name: "S5M 민수", track: "V6" }] });
			assert.equal(r.json.pending, true);
			await H.waitFor(panel, "document.querySelectorAll('#aiReqBar .ai-req-ok').length === 1", { what: "승인 카드" });
			await panel("document.querySelector('#aiReqBar .ai-req-ok').click(), true");
			await H.waitFor(panel, "window._mogrtDebug.snapshot().mi.cast.C2.name === 'S5M 민수'", { what: "승인 → 화자 표" });
			s2 = await panel(SNAP);
			// 히스토리는 패널이 읽는 그대로 (DEV 캐시, window._mogrtDebug._fsRead)
			const hist = (name) => panel("window._mogrtDebug._fsRead(" + JSON.stringify(root + "/" + s2.keys.proj + "/" + s2.keys.seq + "/" + name) + ")");
			assert.equal((await hist("history_safety.json"))[0].label, "AI: 화자 표 바꾸기 전");
			assert.equal((await hist("history_auto.json"))[0].label, "AI: 화자 표: C2 이름 S5M 민수, 트랙 V6");
			assert.equal(s2.mi.cast.C2.track, 5);
			assert.deepEqual((await panel("window.__hostCalls.slice()")).filter((n) => HOST_WRITES.indexOf(n) !== -1), [], "화자 표 승인도 타임라인을 바꾸지 않는다");
			log("(10) set_cast_proposal → 카드 [거절] 그대로 · [승인] 안전 지점 'AI: 화자 표 바꾸기 전' → C2 'S5M 민수' V6");

			// 정리: 제안 버리기
			r = await panel(H.pageCmd("sugg.reject", { all: true }));
			assert.deepEqual([r.ok, r.data.removed], [true, 21]);
		});
	} finally {
		if (c) await c.close();
		try {
			if (defBefore) fs.writeFileSync(defPath, defBefore);
			else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
		} catch (e) {
			log("cast_defaults 되돌리기 경고: " + e.message);
		}
		await panel("window._mogrtDebug.inbox.set(" + (link.wasOn ? "true" : "false") + ")");
		await panel(H.pageSetMiCast(null));
	}
}

module.exports = {
	name: "M5.2·M5.3 MCP 서버 읽기·제안 도구 (SDK stdio ↔ bridge_dev ↔ DEV 패널, 승인 카드)",
	run,
	setup,
	linkOn
};
