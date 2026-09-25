"use strict";
// S1-3: 세션 생명주기·부팅 게이트·렌더링 — app.js 전체를 panelHarness(가짜 DOM·호스트·cep.fs)로 돌린다
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P, seqKeyOf } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ1 = "C:/work/one.prproj";
const PROJ2 = "C:/work/two.prproj";
const PROJ3 = "C:/work/three.prproj";
const SEQ = (id, name, proj) => ({ seqId: id, seqName: name, projPath: proj || PROJ1 });
const A = SEQ("aaaa-0001", "T_A");
const B = SEQ("bbbb-0002", "T_B");
const C = SEQ("cccc-0003", "T_C");
const D = SEQ("dddd-0004", "T_D");
const NOSEQ_MSG = "시퀀스를 열면 SRT를 열 수 있습니다";
const clone = (v) => JSON.parse(JSON.stringify(v));

function sub(id, index, text, s) {
	const st = s || index * 2;
	const tc = (x) => "00:00:" + String(Math.floor(x)).padStart(2, "0") + ".000";
	return { index, startTime: tc(st), endTime: tc(st + 1), startSec: st, endSec: st + 1, text, id };
}
function session(rows, extra) {
	const rowStates = {};
	rows.forEach((r) => { rowStates[r.id] = { presetId: "", params: [], _allParams: [], open: false, checked: false }; });
	return Object.assign({ subtitles: rows, rowStates, trashBin: [], nextId: rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1 }, extra || {});
}
function presetsFile(presets, extra) {
	return Object.assign({ presets, presetTrash: [], nextPresetId: 9 }, extra || {});
}
function noErrors(h) {
	const errs = h.errors();
	assert.deepEqual(errs.map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
const sessionWrites = (h) => h.fs.writes.filter((p) => /session\.json$/.test(p));

// ── 부팅 게이트 ──

test("부팅 게이트: 시퀀스가 없으면 SRT 열기·불러오기·▶가 막혀 있고, 타이머로는 열리지 않는다", async () => {
	const h = await bootPanel({ seq: null });
	noErrors(h);
	assert.equal(h.win._mogrtDebug.bootDone, true, "bootDone");
	let s = h.snapshot();
	assert.equal(s.flags.keysResolved, false);
	assert.equal(s.flags.filtersReady, true);
	assert.equal(h.$("srtInput").disabled, true);
	assert.equal(h.$("workInput").disabled, true);
	assert.equal(h.$("btnApply").disabled, true);
	assert.ok(h.$("srtInput").closest("label").classList.contains("gated"));
	assert.deepEqual(h.status(), { text: NOSEQ_MSG, cls: "info" });
	// 오래 기다려도 그대로 (2초마다 다시 확인만 한다)
	await h.advance(20000);
	assert.equal(h.snapshot().flags.keysResolved, false);
	assert.equal(h.$("srtInput").disabled, true);
	const asked = h.host.calls.filter((c) => c.fn === "getActiveSequenceInfo").length;
	assert.ok(asked >= 10, "2초마다 다시 확인: " + asked);
	// change 이벤트를 억지로 보내도 목록은 바뀌지 않는다
	await h.dropSrt("x.srt", "1\n00:00:01,000 --> 00:00:02,000\n가\n");
	assert.equal(h.rows().length, 0);
	assert.equal(h.status().text, NOSEQ_MSG);
	assert.deepEqual(sessionWrites(h), [], "키가 정해지기 전에는 세션 파일에 쓰지 않는다");
	// 시퀀스를 열면 다음 확인에서 열린다
	h.host.seq = A;
	await h.advance(2100);
	s = h.snapshot();
	assert.equal(s.flags.keysResolved, true);
	assert.equal(s.keys.seq, "proj_" + s.keys.proj.slice(5) + "_seq_aaaa-0001");
	assert.equal(h.$("srtInput").disabled, false);
	assert.equal(h.$("workInput").disabled, false);
	assert.equal(h.$("btnApply").disabled, false);
	assert.equal(h.$("srtInput").closest("label").classList.contains("gated"), false);
	assert.deepEqual(h.status(), { text: "준비", cls: "" });
	noErrors(h);
});

test("부팅 게이트: 프리뷰 시퀀스가 활성이면 '시퀀스 확인 중…'으로 기다린다", async () => {
	const h = await bootPanel({ seq: SEQ("pppp", "__MOGRT_PREVIEW__") });
	assert.equal(h.snapshot().flags.keysResolved, false);
	assert.equal(h.status().text, "시퀀스 확인 중…");
	h.host.seq = B;
	await h.advance(2100);
	assert.equal(h.snapshot().flags.keysResolved, true);
	assert.equal(h.snapshot().keys.seqId, "bbbb-0002");
	noErrors(h);
});

test("부팅: 기본 키(default_seq)의 옛 목록이 새 시퀀스로 새지 않고, 그 파일도 그대로다", async () => {
	const old = session([sub(1, 1, "8월 11일 합성 목록")]);
	const h = await bootPanel({ seq: null, files: { [P.defaultSession]: old } });
	assert.equal(h.rows().length, 0, "키가 정해지기 전에는 목록을 읽지 않는다");
	assert.equal(h.snapshot().subtitles.length, 0);
	h.host.seq = A;
	await h.advance(2100);
	assert.equal(h.rows().length, 0, "A에는 세션이 없다 → 빈 목록");
	assert.deepEqual(h.fs.readJson(P.defaultSession), old);
	assert.deepEqual(sessionWrites(h), []);
	noErrors(h);
});

test("▶ 핸들러가 붙어 있다 (목록이 비었다는 안내)", async () => {
	const h = await bootPanel({ seq: A });
	h.$("btnApply").click();
	assert.equal(h.status().text, "먼저 SRT 파일을 열어주세요.");
	noErrors(h);
});

// ── 세션 생명주기 ──

test("세션 없는 시퀀스 3개를 돌아도 캐시 파일 수가 그대로다 (빈 세션 파일을 만들지 않는다)", async () => {
	const h = await bootPanel({ seq: A });
	await h.advance(1000); // 스캔 → 폴러 시작
	const before = h.fs.files.size;
	for (const s of [B, C, D, A]) {
		h.host.seq = s;
		await h.advance(300);
		assert.equal(h.snapshot().keys.seqId, s.seqId);
	}
	assert.equal(h.fs.files.size, before);
	assert.deepEqual(sessionWrites(h), []);
	// 목록이 비고 파일도 없으면 직접 저장을 불러도 쓰지 않는다
	h.win._mogrtDebug.saveSession();
	assert.deepEqual(sessionWrites(h), []);
	noErrors(h);
});

test("같은 프로젝트: 세션 없는 시퀀스로 바꾸면 목록이 비고, 돌아오면 다시 읽는다", async () => {
	const h = await bootPanel({ seq: A, files: { [P.session(PROJ1, A.seqId)]: session([sub(1, 1, "A 하나"), sub(2, 2, "A 둘")], { nextId: 7 }) } });
	await h.advance(1000);
	assert.equal(h.rows().length, 2);
	h.host.seq = B;
	await h.advance(300);
	let s = h.snapshot();
	assert.deepEqual([s.subtitles.length, s.trashBin.length, s.nextId, Object.keys(s.rowStates).length], [0, 0, 1, 0]);
	assert.equal(h.rows().length, 0);
	assert.equal(h.fs.files.has(P.session(PROJ1, B.seqId)), false, "B에 빈 파일을 만들지 않는다");
	h.host.seq = A;
	await h.advance(300);
	s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => x.text), ["A 하나", "A 둘"]);
	assert.equal(s.nextId, 7);
	noErrors(h);
});

test("다른 프로젝트: 목록은 비고, 프리셋은 파일이 있으면 그 프로젝트 것 / 없으면 그대로 가져간다", async () => {
	const { presets } = build();
	const p1 = presetsFile({ preset_1: presets.preset_1, preset_3: presets.preset_3 });
	const p3 = presetsFile({ preset_6: presets.preset_6 }, { nextPresetId: 7 });
	const h = await bootPanel({
		seq: A,
		files: {
			[P.presets(PROJ1)]: p1,
			[P.presets(PROJ3)]: p3,
			[P.session(PROJ1, A.seqId)]: session([sub(1, 1, "프로젝트 1 목록")])
		}
	});
	await h.advance(1000);
	assert.deepEqual(Object.keys(h.snapshot().presets).sort(), ["preset_1", "preset_3"]);
	// 프리셋 파일이 없는 프로젝트 2 → 목록은 비고 프리셋은 그대로
	h.host.seq = SEQ("eeee-0005", "T_E", PROJ2);
	await h.advance(300);
	let s = h.snapshot();
	assert.equal(s.subtitles.length, 0, "프로젝트 1의 목록이 새지 않는다");
	assert.deepEqual(Object.keys(s.presets).sort(), ["preset_1", "preset_3"]);
	// 프리셋 파일이 있는 프로젝트 3 → 그 프로젝트의 프리셋
	h.host.seq = SEQ("ffff-0006", "T_F", PROJ3);
	await h.advance(300);
	s = h.snapshot();
	assert.equal(s.subtitles.length, 0);
	assert.deepEqual(Object.keys(s.presets), ["preset_6"]);
	assert.equal(s.nextPresetId, 7);
	// 전환 직전 저장은 목록이 있던 A 파일에만 (새 프로젝트 키에는 빈 파일을 만들지 않는다)
	assert.deepEqual([...new Set(sessionWrites(h))], [P.session(PROJ1, A.seqId)]);
	assert.deepEqual(h.fs.readJson(P.session(PROJ1, A.seqId)).subtitles.map((x) => x.text), ["프로젝트 1 목록"]);
	noErrors(h);
});

test("읽지 못하는 session.json: 그 파일은 덮지 않고, 이전 시퀀스의 목록을 끌고 오지 않으며, 경고가 남는다", async () => {
	const badPath = P.session(PROJ1, B.seqId);
	const h = await bootPanel({
		seq: A,
		files: {
			[P.session(PROJ1, A.seqId)]: session([sub(1, 1, "A 목록")]),
			[badPath]: "{ 이건 JSON이 아니다"
		}
	});
	await h.advance(1000);
	h.host.seq = B;
	await h.advance(300);
	let s = h.snapshot();
	assert.equal(s.flags.sessionReadFailed, true);
	// A의 목록이 B에 남으면 ▶가 A의 자막을 B 타임라인에 놓는다
	assert.deepEqual([s.subtitles.length, s.trashBin.length, Object.keys(s.rowStates).length], [0, 0, 0], "목록을 비운다 (A의 목록이 아니다)");
	assert.equal(h.rows().length, 0);
	assert.equal(h.status().cls, "err");
	assert.match(h.status().text, /세션 파일을 읽지 못했습니다/);
	assert.match(h.$("activeSeqLabel").textContent, /^⚠ 세션 파일 읽기 실패 · 활성 시퀀스 : T_B$/, "상태 줄이 덮여도 남는 경고");
	// 저장 시도 (속성창 모두 닫기·직접 저장) → 비어 있으니 아무것도 쓰지 않는다
	h.$("btnCloseAllParams").disabled = false;
	h.$("btnCloseAllParams").click();
	h.win._mogrtDebug.saveSession();
	assert.equal(h.fs.files.get(badPath), "{ 이건 JSON이 아니다");
	assert.deepEqual([...h.fs.files.keys()].filter((k) => k.indexOf(badPath) === 0), [badPath], "옮기지도 않는다");
	// 읽을 수 없는 파일(err 4)도 같은 처리
	h.fs.unreadable.add(P.session(PROJ1, C.seqId));
	h.fs.files.set(P.session(PROJ1, C.seqId), "{}");
	h.host.seq = C;
	await h.advance(300);
	assert.equal(h.snapshot().flags.sessionReadFailed, true);
	// A로 돌아오면 풀리고 A의 목록을 다시 읽는다
	h.host.seq = A;
	await h.advance(300);
	s = h.snapshot();
	assert.equal(s.flags.sessionReadFailed, false);
	assert.deepEqual(s.subtitles.map((x) => x.text), ["A 목록"]);
	assert.equal(h.$("activeSeqLabel").textContent, "활성 시퀀스 : T_A");
	assert.equal(h.fs.files.get(badPath), "{ 이건 JSON이 아니다", "B 파일은 끝까지 그대로");
	noErrors(h);
});

test("읽지 못하는 session.json인 시퀀스에서 새로 작업하면 그 파일을 옆 이름으로 옮겨 보관하고 저장한다", async () => {
	const badPath = P.session(PROJ1, B.seqId);
	const h = await bootPanel({ seq: B, files: { [badPath]: "{\"subtitles\":[{\"id\":1,\"text\":\"잘린 파" } });
	await h.advance(1000);
	assert.equal(h.snapshot().flags.sessionReadFailed, true);
	await h.dropSrt("new.srt", "1\n00:00:01,000 --> 00:00:02,000\n새 작업\n");
	const s = h.snapshot();
	assert.equal(s.flags.sessionReadFailed, false);
	const kept = [...h.fs.files.keys()].filter((k) => k.indexOf(badPath + ".unreadable-") === 0);
	assert.equal(kept.length, 1, "읽지 못한 파일을 옮겨 보관");
	assert.equal(h.fs.files.get(kept[0]), "{\"subtitles\":[{\"id\":1,\"text\":\"잘린 파", "내용 그대로");
	assert.deepEqual(h.fs.readJson(badPath).subtitles.map((x) => x.text), ["새 작업"], "새 작업이 저장된다");
	assert.equal(h.$("alertModal").classList.contains("open"), true);
	assert.match(h.$("alertMessage").textContent, /옮겨 보관/);
	assert.ok(h.$("alertMessage").textContent.indexOf(kept[0]) !== -1, "옮긴 경로를 알려 준다");
	assert.equal(h.$("activeSeqLabel").textContent, "활성 시퀀스 : T_B", "경고가 풀린다");
	assert.ok(h.fs.readJson(P.historyAuto(PROJ1, B.seqId)), "히스토리도 이어서 쓴다");
	noErrors(h);
});

test("읽지 못한 파일을 옮기지 못하면 쓰지 않고, 수동저장도 성공이라고 하지 않는다", async () => {
	const badPath = P.session(PROJ1, B.seqId);
	const h = await bootPanel({ seq: B, files: { [badPath]: "{ broken" } });
	await h.advance(1000);
	h.fs.renameFails = true;
	await h.dropSrt("new.srt", "1\n00:00:01,000 --> 00:00:02,000\n새 작업\n");
	assert.equal(h.snapshot().flags.sessionReadFailed, true);
	assert.equal(h.fs.files.get(badPath), "{ broken", "덮지 않는다");
	assert.match(h.$("activeSeqLabel").textContent, /^⚠ 세션 파일 읽기 실패/, "경고가 남는다");
	// 히스토리 → 저장
	h.$("btnHistory").click();
	const saveBtn = h.$("historyDropdown").querySelectorAll("button").find((b) => b.textContent === "저장");
	saveBtn.click();
	assert.deepEqual(h.status(), { text: "수동저장하지 못했습니다: 이 시퀀스의 세션 파일을 읽지 못했습니다", cls: "err" });
	assert.equal(h.fs.files.has(P.historyAuto(PROJ1, B.seqId).replace("history_auto", "history_manual")), false, "수동저장 파일을 만들지 않는다");
	noErrors(h);
});

test("localStorage 마이그레이션은 있는데 읽지 못한 session.json을 옛 값으로 덮지 않는다", async () => {
	const badPath = P.session(PROJ1, A.seqId);
	const seqKey = seqKeyOf(PROJ1, A.seqId);
	const legacy = JSON.stringify(session([sub(1, 1, "옛 localStorage 목록")]));
	const h = await bootPanel({ seq: A, files: { [badPath]: "{\"subtitles\":[{\"id\":1,\"text\":\"잘린 파일" }, localStorage: { ["mogrt_session_" + seqKey]: legacy } });
	await h.advance(1000);
	const s = h.snapshot();
	assert.equal(s.keys.seq, seqKey);
	assert.equal(s.flags.sessionReadFailed, true, "읽기 실패로 잡힌다");
	assert.equal(s.subtitles.length, 0);
	assert.equal(h.fs.files.get(badPath), "{\"subtitles\":[{\"id\":1,\"text\":\"잘린 파일", "마이그레이션이 덮지 않는다");
	noErrors(h);
});

test("키를 정한 뒤 그리기 하나가 예외를 던져도 부팅 게이트는 열린다", async () => {
	const { presets } = build();
	const broken = clone(presets.preset_3);
	delete broken.mogrtPath; // makePresetRow가 던진다
	const trashNoPath = clone(presets.preset_6);
	delete trashNoPath.mogrtPath;
	const h = await bootPanel({ seq: A, files: { [P.presets(PROJ1)]: presetsFile({ preset_3: broken }, { presetTrash: [{ preset: trashNoPath, deletedAt: "x" }] }) } });
	await h.advance(500);
	assert.equal(h.snapshot().flags.keysResolved, true);
	assert.equal(h.$("srtInput").disabled, false);
	assert.equal(h.$("workInput").disabled, false);
	assert.equal(h.$("btnApply").disabled, false);
	assert.notEqual(h.status().text, "시퀀스 확인 중…");
	assert.equal(h.$("presetTrashWrap").querySelectorAll(".trash-row").length, 1, "mogrtPath 없는 휴지통 항목도 그린다");
	await h.dropSrt("x.srt", "1\n00:00:01,000 --> 00:00:02,000\n가\n");
	assert.equal(h.rows().length, 1, "SRT를 열 수 있다");
});

test("SRT 열기는 nextId를 되돌리지 않는다", async () => {
	const h = await bootPanel({ seq: A, files: { [P.session(PROJ1, A.seqId)]: session([sub(3, 1, "옛 줄")], { nextId: 40 }) } });
	await h.advance(500);
	await h.dropSrt("new.srt", "1\n00:00:01,000 --> 00:00:02,000\n새 하나\n\n2\n00:00:03,000 --> 00:00:04,000\n새 둘\n");
	const s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => [x.id, x.index, x.text]), [[40, 1, "새 하나"], [41, 2, "새 둘"]]);
	assert.equal(s.nextId, 42);
	assert.deepEqual(h.fs.readJson(P.session(PROJ1, A.seqId)).subtitles.map((x) => x.id), [40, 41]);
	noErrors(h);
});

// ── 렌더링 ──

function presetNoExposed() {
	const { helpers } = build();
	return {
		id: "preset_4", name: "노출 없음", mogrtPath: "D:/MOGRT/로고.mogrt",
		params: [helpers.C(0, "로고 색상", "#ffffff"), helpers.N(1, "크기", 30), helpers.N(2, "불투명도", 80)],
		exposedIndices: [], textParamIndex: -1, exposedFontFields: {}, thumbnailData: null
	};
}

test("노출 속성이 없는 프리셋의 줄: renderAll을 여러 번 해도 _allParams 값이 그대로다 (v27은 기본값으로 되돌렸다)", async () => {
	const { presets } = build();
	const p4 = presetNoExposed();
	const rows = [sub(1, 1, "로고 줄"), sub(2, 2, "지울 줄")];
	const sess = session(rows);
	const edited = clone(p4.params);
	edited[1].value = "77";
	edited[2].value = "12";
	sess.rowStates[1] = { presetId: "preset_4", params: [], _allParams: edited, open: false, checked: false };
	const h = await bootPanel({ seq: A, files: { [P.presets(PROJ1)]: presetsFile({ preset_4: p4, preset_3: presets.preset_3 }), [P.session(PROJ1, A.seqId)]: sess } });
	await h.advance(500);
	const check = () => {
		const s = h.snapshot();
		assert.deepEqual(s.rowStates[1]._allParams, edited);
		assert.equal(s.rowStates[1].open, false);
		assert.equal(h.$("params-1").className, "sub-params");
	};
	check();
	// renderAll을 더 부르는 길: 줄 삭제 → 휴지통에서 복구 (restoreSubtitle → renderAll) × 2
	for (let i = 0; i < 2; i++) {
		h.$("row-2").querySelector(".btn-del[title='삭제 (휴지통으로)']") || null;
		const delBtn = h.$("row-2").querySelectorAll(".btn-del").find((b) => b.title === "삭제 (휴지통으로)");
		delBtn.click();
		assert.equal(h.snapshot().trashBin.length, 1);
		h.$("trashWrap").querySelector(".btn-restore").click();
		assert.equal(h.snapshot().trashBin.length, 0);
		check();
	}
	assert.deepEqual(h.fs.readJson(P.session(PROJ1, A.seqId)).rowStates[1]._allParams, edited, "저장된 파일도 그대로");
	noErrors(h);
});

test("노출 속성이 없는 줄의 _allParams가 프리셋과 다른 구조면 v27처럼 프리셋에서 다시 채우고, 옛 서명을 psOld로 남겨 ▶가 이름으로 쓴다 (클립은 옛 구조일 수 있다)", async () => {
	const { helpers } = build();
	const { T, N } = helpers;
	// 지금 프리셋 구조: 캡션 idx4. 줄에는 옛 구조(캡션 idx0, '서브 포인트 텍스트' idx4)가 남아 있다
	const cur = [N(0, "크기", 1), N(1, "x", 1), N(2, "y", 1), N(3, "z", 1), T(4, "전체 텍스트", "기본"), N(5, "w", 1), T(6, "포인트 텍스트", "")];
	const old = [T(0, "전체 텍스트", "옛 캡션"), N(1, "크기", 1), T(2, "포인트 텍스트", ""), N(3, "x", 1), T(4, "서브 포인트 텍스트", "")];
	const p1 = { id: "preset_1", name: "P1", mogrtPath: "D:/MOGRT/P1.mogrt", params: cur, exposedIndices: [], textParamIndex: 4, exposedFontFields: {}, thumbnailData: null };
	const sess = session([sub(1, 1, "캡션 문장")]);
	sess.rowStates[1] = { presetId: "preset_1", params: [], _allParams: clone(old), open: false, checked: false };
	const h = await bootPanel({ seq: A, mogrts: [{ name: "P1", path: p1.mogrtPath }], files: { [P.presets(PROJ1)]: presetsFile({ preset_1: p1 }), [P.session(PROJ1, A.seqId)]: sess } });
	await h.advance(500);
	const all = h.snapshot().rowStates[1]._allParams;
	assert.deepEqual(all.map((p) => [p.index, p.displayName]), cur.map((p) => [p.index, p.displayName]), "지금 프리셋 구조");
	assert.equal(all[4].value, "캡션 문장");
	assert.match(h.snapshot().rowStates[1].psOld, /^[0-9a-f]{8}$/, "다시 채우기 전 서명 (S1-9)");
	h.$("btnApply").click();
	await h.flush();
	// psOld → v27에 위험한 줄 → 확인창. '지금 방식으로 전체 적용'도 이 줄은 이름으로 보낸다
	assert.equal(h.$("confirmModal").classList.contains("open"), true, "확인창");
	assert.match(h.$("confirmMessage").textContent, /^구조가 바뀐 줄 1개가 있습니다\./);
	h.$("confirmAlt").click();
	await h.flush();
	const call = h.host.calls.find((c) => c.fn === "applyToTimeline");
	assert.ok(call, "applyToTimeline");
	const sent = JSON.parse(call.args[0]).subtitles[0].params;
	assert.deepEqual(sent.filter((p) => p.type === "text").map((p) => [p.index, p.displayName, p.value]), [[-1, "전체 텍스트", "캡션 문장"], [-1, "포인트 텍스트", ""]]);
	noErrors(h);
});

test("노출 속성이 있는 줄: 열린 속성창과 고친 T2가 그대로다, 노출 목록이 비었으면 _allParams에서 다시 고른다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const rows = [sub(1, 1, "합성 밴드 문장"), sub(2, 2, "노출 목록 빔")];
	const sess = session(rows);
	const all1 = clone(p3.params);
	all1[1].value = "합성 밴드 문장";
	all1[2].value = "밴드$$문장";
	sess.rowStates[1] = { presetId: "preset_3", params: all1.filter((p) => p3.exposedIndices.includes(p.index)), _allParams: all1, open: true, checked: false };
	const all2 = clone(p3.params);
	all2[2].value = "고친 포인트";
	sess.rowStates[2] = { presetId: "preset_3", params: [], _allParams: all2, open: false, checked: false };
	const h = await bootPanel({ seq: A, files: { [P.presets(PROJ1)]: presetsFile({ preset_3: p3 }), [P.session(PROJ1, A.seqId)]: sess } });
	await h.advance(500);
	const s = h.snapshot();
	assert.deepEqual(s.rowStates[1]._allParams, all1);
	assert.equal(s.rowStates[1].open, true);
	assert.equal(h.$("params-1").className, "sub-params open");
	assert.deepEqual(s.rowStates[2]._allParams, all2, "값을 다시 읽지 않는다");
	assert.deepEqual(s.rowStates[2].params.map((p) => [p.index, p.value]), [[1, "합성 밴드 문장"], [2, "고친 포인트"]]);
	noErrors(h);
});

test("체크 안 된 줄에서 '-- 프리셋 선택 --'을 골라도 예외 없이 저장된다 (v27 3515 TypeError)", async () => {
	const { presets } = build();
	const sess = session([sub(1, 1, "줄")]);
	sess.rowStates[1] = { presetId: "preset_3", params: [], _allParams: clone(presets.preset_3.params), open: false, checked: false };
	const h = await bootPanel({ seq: A, files: { [P.presets(PROJ1)]: presetsFile({ preset_3: presets.preset_3 }), [P.session(PROJ1, A.seqId)]: sess } });
	await h.advance(500);
	const sel = h.$("sel-1");
	sel.value = "";
	assert.doesNotThrow(() => h.change(sel));
	const file = h.fs.readJson(P.session(PROJ1, A.seqId));
	assert.deepEqual([file.rowStates[1].presetId, file.rowStates[1]._allParams.length], ["", 0]);
	noErrors(h);
});

test("히스토리 복원은 트랙 값도 settings.json에 저장한다", async () => {
	const entry = { ts: Date.now(), label: "합성 기록", isManual: false, sequenceKey: "x", subtitles: [sub(5, 1, "기록 줄")], rowStates: { 5: { presetId: "", params: [], _allParams: [], open: false, checked: false } }, trashBin: [], nextId: 6, trackValue: "4" };
	const h = await bootPanel({ seq: A, files: { [P.historyAuto(PROJ1, A.seqId)]: [entry] } });
	await h.advance(500);
	h.$("btnHistory").click();
	const item = h.$("historyDropdown").querySelector(".history-item");
	assert.ok(item, "히스토리 항목");
	item.childNodes[0].click();
	assert.equal(h.$("confirmModal").classList.contains("open"), true);
	h.$("confirmYes").click();
	assert.equal(h.$("trackSel").value, "4");
	assert.deepEqual(h.fs.readJson(P.settings(PROJ1, A.seqId)), { trackValue: "4" });
	assert.deepEqual(h.snapshot().subtitles.map((x) => x.text), ["기록 줄"]);
	noErrors(h);
});

// ── 프리셋 모달: 프리뷰 시퀀스 먼저, 패치 뒤 캐시 ──

async function openModalWith(h, mogrtPath) {
	h.$("btnAddPreset").click();
	await h.flush();
	const sel = h.$("defaultMogrtSel");
	sel.value = mogrtPath;
	h.change(sel);
	await h.flush();
}

test("모달: 캐시가 없으면 getMogrtParams 전에 setupPreviewSequence (V1 보호), 두 번째는 캐시", async () => {
	const { presets } = build();
	const path = "D:/MOGRT/합성 A.mogrt";
	const h = await bootPanel({ seq: A, params: { [path]: clone(presets.preset_3.params) } });
	await h.advance(1000);
	await openModalWith(h, path);
	await h.advance(10);
	const fns = h.host.calls.map((c) => c.fn);
	const iSetup = fns.indexOf("setupPreviewSequence");
	const iGet = fns.indexOf("getMogrtParams");
	assert.ok(iSetup !== -1 && iGet !== -1, fns.join(","));
	assert.ok(iSetup < iGet, "setupPreviewSequence가 먼저: " + fns.join(","));
	assert.ok(h.snapshot().mogrtOriginals[path], "캐시됨");
	// 같은 MOGRT를 다시 열면 호스트를 부르지 않는다
	const n = h.host.calls.length;
	await openModalWith(h, path);
	await h.advance(10);
	assert.equal(h.host.calls.slice(n).filter((c) => c.fn === "getMogrtParams" || c.fn === "setupPreviewSequence").length, 0);
	noErrors(h);
});

test("모달: 프리뷰 시퀀스가 있다고 알려진 뒤에는 확인만 하고, 사용자가 지웠으면 다시 만든다", async () => {
	const { presets } = build();
	const p1 = "D:/MOGRT/합성 A.mogrt";
	const p2 = "D:/MOGRT/합성 B.mogrt";
	const h = await bootPanel({ seq: A, mogrts: [{ name: "합성 A", path: p1 }, { name: "합성 B", path: p2 }], params: { [p1]: clone(presets.preset_3.params), [p2]: clone(presets.preset_6.params) } });
	await h.advance(1000);
	await openModalWith(h, p1);
	await h.advance(10);
	h.host.previewExists = false; // 사용자가 __MOGRT_PREVIEW__를 지웠다
	const n = h.host.calls.length;
	await openModalWith(h, p2);
	await h.advance(10);
	const fns = h.host.calls.slice(n).map((c) => c.fn);
	assert.deepEqual(fns.filter((f) => /Preview|getMogrtParams/.test(f)).slice(0, 3), ["findPreviewSequence", "setupPreviewSequence", "getMogrtParams"]);
	noErrors(h);
});

test("모달: 프리뷰 시퀀스를 만들 수 없으면 [그래도 읽기]/[취소]를 묻고, 취소하면 읽지 않는다", async () => {
	const { presets } = build();
	const path = "D:/MOGRT/합성 A.mogrt";
	const h = await bootPanel({ seq: A, previewSetupOk: false, params: { [path]: clone(presets.preset_3.params) } });
	await h.advance(1000);
	await openModalWith(h, path);
	await h.advance(10);
	assert.equal(h.$("confirmModal").classList.contains("open"), true);
	assert.match(h.$("confirmMessage").textContent, /V1의 0~5초 영상이 잘릴 수 있습니다/);
	assert.deepEqual([h.$("confirmYes").textContent, h.$("confirmNo").textContent], ["그래도 읽기", "취소"]);
	h.$("confirmNo").click();
	await h.advance(10);
	assert.equal(h.host.calls.filter((c) => c.fn === "getMogrtParams").length, 0);
	assert.deepEqual([h.$("confirmYes").textContent, h.$("confirmNo").textContent], ["확인", "취소"], "버튼 문구를 되돌린다");
	// 다시 골라 [그래도 읽기]
	await openModalWith(h, path);
	await h.advance(10);
	h.$("confirmYes").click();
	await h.advance(10);
	assert.equal(h.host.calls.filter((c) => c.fn === "getMogrtParams").length, 1);
	noErrors(h);
});

test("모달: definition 패치를 받은 뒤에 캐시한다 (두 번째로 열어도 드롭다운 이름이 있다)", async () => {
	const { helpers } = build();
	const path = "D:/MOGRT/합성 A.mogrt";
	const list = [helpers.T(0, "텍스트", "기본"), helpers.N(1, "정렬", 1, "number")];
	const def = { sourceInfoLocalized: { en_US: { capsuleparams: { capParams: [{ capPropUIName: "정렬", menuContent: ["왼쪽", "가운데", "오른쪽"] }] } } } };
	const h = await bootPanel({ seq: A, params: { [path]: list }, files: { [path]: "ZmFrZQ==" } });
	h.win.JSZip = { loadAsync: async () => ({ file: (n) => (n === "definition.json" ? { async: async () => JSON.stringify(def) } : null) }) };
	await h.advance(1000);
	await openModalWith(h, path);
	await h.advance(10);
	const cached = h.snapshot().mogrtOriginals[path];
	assert.ok(cached, "캐시됨");
	assert.equal(cached[1].type, "dropdown");
	assert.deepEqual(cached[1].dropdownOptions, ["왼쪽", "가운데", "오른쪽"]);
	assert.equal(cached[0].value, "기본");
	noErrors(h);
});

test("모달: 기존 프리셋을 편집으로 열어도 캐시는 MOGRT 원래 값이다 (프리셋 값이 다른 새 프리셋으로 새지 않는다)", async () => {
	const { helpers } = build();
	const path = "D:/MOGRT/합성 A.mogrt";
	const list = [helpers.T(0, "텍스트", "기본"), helpers.N(1, "정렬", 1, "number")];
	const def = { sourceInfoLocalized: { en_US: { capsuleparams: { capParams: [{ capPropUIName: "정렬", menuContent: ["왼쪽", "가운데", "오른쪽"] }] } } } };
	const pv = clone(list);
	pv[0].value = "프리셋 값";
	pv[0].rawValue = JSON.stringify(Object.assign(JSON.parse(pv[0].rawValue), { textEditValue: "프리셋 값", fontTextRunLength: [5] }));
	pv[1].value = "3";
	const p5 = { id: "preset_5", name: "값 있는 프리셋", mogrtPath: path, params: pv, exposedIndices: [0], textParamIndex: 0, exposedFontFields: {}, thumbnailData: null };
	const h = await bootPanel({ seq: A, params: { [path]: list }, files: { [path]: "ZmFrZQ==", [P.presets(PROJ1)]: presetsFile({ preset_5: p5 }) } });
	h.win.JSZip = { loadAsync: async () => ({ file: (n) => (n === "definition.json" ? { async: async () => JSON.stringify(def) } : null) }) };
	await h.advance(1000);
	const edit = h.$("presetList").querySelectorAll("button").find((b) => b.textContent === "편집");
	edit.click();
	await h.flush();
	await h.advance(10);
	assert.ok(h.host.calls.some((c) => c.fn === "getMogrtParams"), "캐시가 없어 호스트에서 읽었다");
	const cached = h.snapshot().mogrtOriginals[path];
	assert.ok(cached, "캐시됨");
	assert.deepEqual([cached[0].value, cached[1].value], ["기본", "1"], "캐시는 원래 값 (프리셋 값을 덮기 전)");
	assert.equal(cached[1].type, "dropdown", "패치는 캐시에도");
	// 모달에는 프리셋 값이 보인다
	assert.ok(h.$("defaultModalBody")._descendants().some((el) => el.value === "프리셋 값"), "모달의 텍스트 입력 = 프리셋 값");
	noErrors(h);
});
