"use strict";
// S3-1: runCommand 전체 — cast.set, suggest, sugg.list/approve/reject, plan(planToken) → apply {planToken}, verify,
// agent의 바꾸는 명령은 needs-approval + 승인 대기열(approvals.*): 승인하면 안전 지점 'AI: … 전', 히스토리 'AI: …'.
// panelHarness(app.js 전체) + premiereSim(hostscript.jsx 전체, 가짜 Premiere)
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, color } = require("../lib/premiereSim");
const { loadRegions } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/cmd.prproj";
const A = { seqId: "seq-cmd-1", seqName: "T_CMD", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const SALT = "ab12";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];
const RULE = "포인트 텍스트는 $$로 구분하며 최대 3개까지 입력 가능합니다.";
const DOT = String.fromCharCode(0xb7);

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
function makeSim(o) {
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: 6 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294967295)] });
	const probe = sim.place(seq, 0, MOGRT, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	// 규칙 설명(comment) (o.rule: presets 명령의 notes). 시뮬레이터 템플릿에는 없는 속성이라 적용 시험에는 넣지 않는다 (partial이 된다)
	if (o && o.rule) params.push({ index: 3, displayName: "포인트 텍스트 구분 방법", type: "comment", rawValue: RULE, value: RULE, group: "" });
	const preset = { id: "preset_3", name: "합성 자막", mogrtPath: MOGRT, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	return { sim, seq, preset };
}
function withCaption(preset, text) {
	const all = JSON.parse(JSON.stringify(preset.params));
	CORE.setTextValue(all[0], text);
	return all;
}
function castSession(preset, rows, extra) {
	const subtitles = [];
	const rowStates = {};
	const n = {};
	rows.forEach(([id, spk, sf, ef, text]) => {
		n[spk || ""] = (n[spk || ""] || 0) + 1;
		const s = { index: n[spk || ""], startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id };
		if (spk) { s.spk = spk; s.srtNo = s.index; }
		subtitles.push(s);
		const all = withCaption(preset, text);
		rowStates[id] = { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	});
	const out = { subtitles, rowStates, trashBin: [], nextId: Math.max(...rows.map((r) => r[0])) + 1 };
	if (rows.some((r) => r[1])) {
		out.mi = Object.assign({ v: 1, salt: SALT, hwm: out.nextId - 1, legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0 }, C2: { name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1 } },
			stack: false, stackDy: 0.12, applied: {} }, (extra && extra.mi) || {});
	}
	return out;
}
function rowsTwo() {
	const rows = [];
	let id = 1;
	for (let k = 0; k < 4; k++) {
		const s = 100 + k * 150;
		rows.push([id++, "C1", s, s + 60, "오늘 날씨 " + (k + 1) + " 하늘"]);
		rows.push([id++, "C2", s + 80, s + 130, "영희 " + (k + 1)]);
	}
	return rows;
}
async function boot(sim, preset, session, o) {
	const h = await bootPanel(Object.assign({
		seq: A,
		mogrts: [{ name: preset.name, path: preset.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { [preset.id]: preset }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: session }
	}, o || {}));
	HOST_FNS.forEach((n) => {
		h.host.handlers["MI_" + n] = (json) => sim.callRaw("MI_" + n, json === undefined ? undefined : JSON.stringify(json));
	});
	await h.advance(1000);
	return h;
}
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
const cmdAs = async (h, source, op, args, extra) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmdAs(source, op, args, extra)));
const safety = (h) => h.fs.readJson(P.historySafety(PROJ, A.seqId)) || [];
const auto = (h) => h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || [];
const calls = (h, fn) => h.host.calls.filter((c) => c.fn === fn);
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}

test("(1)(2)(3) presets·rows·resolve: T-ID·캡션·규칙 문구, 쪽 나누기와 필터, 라벨 'C2·3' → uid", async () => {
	const { sim, preset } = makeSim({ rule: true });
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	const pr = await cmd(h, "presets", {});
	assert.deepEqual(pr.data[0].fields, [{ fid: "T1", label: "텍스트", index: 0, caption: true }, { fid: "T2", label: "포인트 텍스트", index: 1, caption: false }]);
	assert.deepEqual([pr.data[0].captionFid, pr.data[0].notes], ["T1", [RULE]]);
	const r1 = await cmd(h, "rows", { from: 2, count: 3 });
	assert.deepEqual([r1.data.total, r1.data.rows.map((x) => x.label)], [8, ["C1" + DOT + "2", "C2" + DOT + "2", "C1" + DOT + "3"]]);
	assert.deepEqual(r1.data.rows[0].fields, { T1: "오늘 날씨 2 하늘", T2: "" });
	const r2 = await cmd(h, "rows", { spk: "C2", filter: "sugg" });
	assert.equal(r2.data.total, 0);
	const res = await cmd(h, "resolve", { label: "C2" + DOT + "3 T2" });
	assert.deepEqual([res.data.uid, res.data.text, res.data.field.displayName, res.data.field.caption], [SALT + "-6", "영희 3", "포인트 텍스트", false]);
	noErrors(h);
});

test("(4) cast.set: 화자 표가 바뀌고 저장·히스토리 '화자 표: …', 하나라도 틀리면 아무것도 바꾸지 않는다, UI 칸도 같은 함수", async () => {
	const { sim, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	let r = await cmd(h, "cast.set", { items: [{ key: "C2", name: " 지영 ", track: 4 }] });
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual(r.data, { changed: ["C2"], label: "화자 표: C2 이름 지영, 트랙 V5" });
	const row = h.$("castRows").querySelectorAll(".cast-row")[1];
	assert.equal(row.querySelector(".cast-name").value, "지영", "화자 표가 다시 그려졌다");
	assert.equal(row.querySelector(".cast-track").value, "4");
	const saved = h.fs.readJson(P.session(PROJ, A.seqId)).mi.cast.C2;
	assert.deepEqual([saved.name, saved.track], ["지영", 4]);
	assert.equal(auto(h)[0].label, "화자 표: C2 이름 지영, 트랙 V5");
	// 틀린 값: 아무것도 바꾸지 않는다
	const before = JSON.stringify(h.snapshot().mi.cast);
	for (const bad of [{ items: [{ key: "C1", name: "민수" }, { key: "C9", name: "x" }] }, { items: [{ key: "C1", track: 0 }] }, { items: [{ key: "C1", presetId: "preset_404" }] },
		{ items: [{ key: "C1", pos: { x: 2, y: 0 } }] }, { items: [{ key: "C1", color: 3 }] }, { items: [] }, {}]) {
		r = await cmd(h, "cast.set", bad);
		assert.deepEqual([r.ok, r.error], [false, "bad-args"], JSON.stringify(bad));
	}
	assert.equal(JSON.stringify(h.snapshot().mi.cast), before);
	// 위치 (4단계에서 쓴다)와 자동 트랙
	r = await cmd(h, "cast.set", { items: [{ key: "C1", pos: { x: 0.35, y: 0.5 } }, { key: "C2", track: null }] });
	assert.deepEqual(r.data.changed, ["C1", "C2"]);
	assert.deepEqual([h.snapshot().mi.cast.C1.pos, h.snapshot().mi.cast.C2.track], [{ x: 0.35, y: 0.5 }, null]);
	// 같은 값은 바뀐 것이 아니다 (히스토리 없음)
	const n = auto(h).length;
	r = await cmd(h, "cast.set", { items: [{ key: "C1", name: "철수" }] });
	assert.deepEqual([r.data.changed, auto(h).length], [[], n]);
	// 화자 표 이름 칸 = 같은 함수 (v27 라벨 그대로)
	const nameEl = h.$("castRows").querySelectorAll(".cast-row")[0].querySelector(".cast-name");
	nameEl.value = "민수";
	h.change(nameEl);
	assert.equal(h.snapshot().mi.cast.C1.name, "민수");
	assert.equal(auto(h)[0].label, "화자 이름: C1 민수");
	noErrors(h);
});

test("(5)(6) suggest: 캡션 필드는 거절, 서명이 다르면 fields-changed, 하나라도 틀리면 아무것도 넣지 않는다; 넣어도 속성·페이로드는 그대로", async () => {
	const { sim, preset } = makeSim({ rule: true });
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	const rows = (await cmd(h, "rows", {})).data.rows;
	const r1 = rows[0];
	const all0 = JSON.stringify(h.snapshot().rowStates[1]._allParams);
	// (5) 캡션 필드
	let r = await cmdAs(h, "agent", "suggest", { items: [{ uid: r1.uid, fid: "T1", value: "날씨", sig: r1.sig, by: "codex" }] });
	assert.deepEqual([r.ok, r.error, r.results[0].error], [false, "bad-args", "caption-field"]);
	// (6) 낡은 서명
	r = await cmdAs(h, "agent", "suggest", { items: [{ uid: r1.uid, fid: "T2", value: "날씨", sig: "T1=텍스트", by: "codex" }] });
	assert.deepEqual([r.ok, r.error], [false, "fields-changed"]);
	// 하나라도 틀리면 아무것도 넣지 않는다 (없는 줄·조각이 캡션에 없음)
	r = await cmdAs(h, "agent", "suggest", { items: [{ uid: r1.uid, fid: "T2", value: "날씨$$하늘", sig: r1.sig }, { uid: rows[2].uid, fid: "T2", value: "바다$$산", sig: rows[2].sig }] });
	assert.deepEqual([r.ok, r.error, r.results.map((x) => x.error)], [false, "bad-args", ["", "missing-segment"]]);
	r = await cmdAs(h, "agent", "suggest", { items: [{ uid: SALT + "-99", fid: "T2", value: "날씨", sig: r1.sig }] });
	assert.equal(r.error, "not-found");
	assert.equal(h.snapshot().rowStates[1].sugg, undefined);
	// 받는 제안 (agent도 바로: 대기열이 승인 단계다)
	r = await cmdAs(h, "agent", "suggest", { items: [{ uid: r1.uid, fid: "T2", value: "날씨$$하늘", sig: r1.sig, by: "codex", note: "핵심어" }, { uid: rows[2].uid, fid: "T2", value: "오늘의 인터뷰", sig: rows[2].sig, by: "codex" }] });
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual([r.data.queued, r.data.results.map((x) => x.warn)], [2, [[], ["not-in-caption"]]]);
	const s = h.snapshot();
	assert.deepEqual(Object.keys(s.rowStates[1].sugg), ["T2"]);
	const e = s.rowStates[1].sugg.T2;
	assert.deepEqual([e.v, e.by, e.st, e.note, e.sig, e.cap], ["날씨$$하늘", "codex", "pending", "핵심어", r1.sig, CORE.suggCapHash("오늘 날씨 1 하늘")]);
	assert.equal(JSON.stringify(s.rowStates[1]._allParams), all0, "속성은 그대로");
	assert.deepEqual(h.fs.readJson(P.session(PROJ, A.seqId)).rowStates[1].sugg.T2.v, "날씨$$하늘", "session.json에 남는다");
	// rows 필터·status
	assert.equal((await cmd(h, "rows", { filter: "sugg" })).data.total, 2);
	assert.equal((await cmd(h, "status", {})).data.suggestions, 2);
	// sugg.list
	const list = (await cmd(h, "sugg.list", {})).data;
	assert.deepEqual(list.map((x) => [x.label, x.fid, x.field, x.check]), [["C1" + DOT + "1", "T2", "포인트 텍스트", "✓ 본문에 있음"], ["C1" + DOT + "2", "T2", "포인트 텍스트", "! 본문에 없는 문구"]]);
	assert.equal((await cmd(h, "sugg.list", { uid: r1.uid })).data.length, 1);
	noErrors(h);
});

test("sugg.approve·sugg.reject: agent는 못 부른다, 승인하면 안전 지점 'AI 제안 적용 전' → T2에 쓰고 제안을 지우고 줄에 변경 표시(mm text)", async () => {
	const { sim, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	const rows = (await cmd(h, "rows", {})).data.rows;
	await cmdAs(h, "agent", "suggest", { items: [{ uid: rows[0].uid, fid: "T2", value: "날씨$$하늘", sig: rows[0].sig, by: "codex" }, { uid: rows[2].uid, fid: "T2", value: "날씨", sig: rows[2].sig, by: "codex" }] });
	let r = await cmdAs(h, "agent", "sugg.approve", { all: true });
	assert.deepEqual([r.ok, r.error], [false, "needs-approval"]);
	assert.equal((await cmd(h, "approvals.list", {})).data.length, 0, "제안 승인은 대기열에 넣지 않는다");
	r = await cmdAs(h, "agent", "sugg.reject", { all: true });
	assert.equal(r.error, "needs-approval");
	const nSafe = safety(h).length;
	r = await cmd(h, "sugg.approve", { items: [{ uid: rows[0].uid, fid: "T2" }] });
	assert.deepEqual([r.ok, r.data.applied, r.data.ids, r.data.skipped], [true, 1, [1], []]);
	const s = h.snapshot();
	const t2 = CORE.resolveFid(s.rowStates[1]._allParams, "T2", preset.params).param;
	assert.equal(t2.value, "날씨$$하늘");
	assert.equal(JSON.parse(t2.rawValue).textEditValue, "날씨$$하늘");
	assert.equal(s.rowStates[1].params.find((p) => p.index === 1).value, "날씨$$하늘", "노출 속성도");
	assert.deepEqual([s.rowStates[1].sugg, s.rowStates[1].mm], [undefined, "text"]);
	assert.equal(safety(h).length, nSafe + 1);
	assert.equal(safety(h)[0].label, "AI 제안 적용 전");
	assert.equal(safety(h)[0].rowStates[1].sugg.T2.v, "날씨$$하늘", "안전 지점은 적용 전 (제안이 있는 상태)");
	assert.equal(auto(h)[0].label, "AI 제안 적용 (1개)");
	// 낡은 제안은 적용하지 않는다: 줄 3의 캡션을 패널에서 바꾸면(T1 textarea) stale
	const b = h.$("params-3").querySelectorAll(".fid-badge").find((x) => x.textContent === "T1");
	const ta = b.parentNode.parentNode.querySelector("textarea");
	ta.value = "완전히 다른 문장";
	ta.dispatchEvent(new h.win.Event("input"));
	r = await cmd(h, "sugg.approve", { all: true });
	assert.deepEqual([r.data.applied, r.data.skipped.map((x) => x.why)], [0, ["stale"]]);
	assert.equal((await cmd(h, "sugg.list", {})).data[0].check, "캡션이 바뀌어 다시 확인이 필요합니다");
	r = await cmd(h, "sugg.reject", { all: true });
	assert.deepEqual([r.ok, r.data.removed], [true, 1]);
	assert.equal(h.snapshot().rowStates[3].sugg, undefined);
	noErrors(h);
});

test("단일 화자 줄: 제안 uid는 id, 승인해도 병합 표시(mm)를 달지 않는다 ('안전하게 적용'이 캡션만 보내지 않게)", async () => {
	const { sim, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, [[1, null, 100, 160, "오늘 날씨 하늘"], [2, null, 200, 260, "둘째"]]));
	const rows = (await cmd(h, "rows", {})).data.rows;
	assert.deepEqual([rows[0].uid, rows[0].label], ["1", "#1"]);
	let r = await cmd(h, "suggest", { items: [{ uid: "1", fid: "T2", value: "날씨", sig: rows[0].sig }] });
	assert.equal(r.ok, true);
	assert.equal(h.snapshot().rowStates[1].sugg.T2.by, "test");
	r = await cmd(h, "sugg.approve", { all: true });
	assert.equal(r.data.applied, 1);
	const s = h.snapshot();
	assert.equal(s.rowStates[1].mm, undefined);
	assert.equal(CORE.resolveFid(s.rowStates[1]._allParams, "T2", preset.params).param.value, "날씨");
	assert.deepEqual(Object.keys(h.fs.readJson(P.session(PROJ, A.seqId))), ["subtitles", "rowStates", "trashBin", "nextId"], "단일 화자 세션은 키 4개 그대로");
	noErrors(h);
});

test("(7) agent의 apply·undo·cast.set·importSrt·mergeCommit은 needs-approval + 대기열, 승인하면 안전 지점 'AI: … 전' → 실행 → 히스토리 'AI: …'", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	let r = await cmdAs(h, "agent", "apply", {}, { by: "codex" });
	assert.deepEqual([r.ok, r.error], [false, "needs-approval"]);
	assert.match(r.rid, /^a/);
	assert.equal(sim.all(seq), 0, "승인 전에는 아무것도 하지 않는다");
	assert.equal(calls(h, "MI_ping").length, 0, "호스트도 부르지 않는다");
	const r2 = await cmdAs(h, "agent", "cast.set", { items: [{ key: "C1", name: "AI 이름" }] });
	assert.equal(r2.error, "needs-approval");
	assert.equal(h.snapshot().mi.cast.C1.name, "철수");
	let q = (await cmd(h, "approvals.list", {})).data;
	assert.deepEqual(q.map((x) => [x.op, x.what, x.by]), [["apply", "타임라인 적용", "codex"], ["cast.set", "화자 표 바꾸기", "ai"]]);
	assert.equal((await cmd(h, "status", {})).data.approvals, 2);
	// agent는 승인하지 못한다
	assert.equal((await cmdAs(h, "agent", "approvals.approve", { rid: r.rid })).error, "needs-approval");
	// 승인: cast.set
	r = await cmd(h, "approvals.approve", { rid: r2.rid });
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.equal(h.snapshot().mi.cast.C1.name, "AI 이름");
	assert.equal(safety(h)[0].label, "AI: 화자 표 바꾸기 전");
	assert.equal(safety(h)[0].mi.cast.C1.name, "철수", "안전 지점은 바꾸기 전");
	assert.equal(auto(h)[0].label, "AI: 화자 표: C1 이름 AI 이름");
	// 승인: apply
	q = (await cmd(h, "approvals.list", {})).data;
	r = await cmd(h, "approvals.approve", { rid: q[0].rid });
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.equal(r.data.created, 8);
	assert.equal(sim.all(seq), 8);
	assert.equal(auto(h)[0].label, "AI: 타임라인 적용 (8개)");
	assert.equal((await cmd(h, "approvals.list", {})).data.length, 0);
	assert.equal((await cmd(h, "approvals.approve", { rid: q[0].rid })).error, "not-found", "한 번만");
	// 승인 뒤의 사용자 작업 이름은 그대로
	await cmd(h, "cast.set", { items: [{ key: "C1", name: "철수" }] });
	assert.equal(auto(h)[0].label, "화자 표: C1 이름 철수");
	// 버리기
	const r3 = await cmdAs(h, "agent", "undo", {});
	assert.equal(r3.error, "needs-approval");
	r = await cmd(h, "approvals.reject", { rid: r3.rid });
	assert.deepEqual([r.ok, r.data.rid], [true, r3.rid]);
	assert.equal(sim.all(seq), 8, "버린 되돌리기는 돌지 않았다");
	noErrors(h);
});

test("plan → planToken → apply {planToken}: 그 줄·선택지만, 토큰 없음·시퀀스 바뀜은 거절; uids·spk로도 고른다", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	let r = await cmd(h, "plan", { uids: [SALT + "-1", SALT + "-3"] });
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.match(r.data.planToken, /^p/);
	assert.deepEqual(r.data.plan.ops, { place: 2 });
	assert.equal(sim.all(seq), 0);
	const tok = r.data.planToken;
	r = await cmd(h, "apply", { planToken: tok, ids: [1] });
	assert.equal(r.error, "bad-args");
	r = await cmd(h, "apply", { planToken: tok });
	assert.deepEqual([r.ok, r.data.created], [true, 2]);
	assert.equal(sim.all(seq), 2);
	assert.equal((await cmd(h, "apply", { planToken: "p-없음" })).error, "not-found");
	r = await cmd(h, "plan", { spk: "C2" });
	assert.deepEqual(r.data.plan.ops, { place: 4 });
	assert.equal((await cmd(h, "plan", { spk: "C9" })).error, "bad-args");
	assert.equal((await cmd(h, "plan", { uids: ["zz99-1"] })).error, "bad-args");
	assert.equal((await cmd(h, "plan", { ids: [1], spk: "C1" })).error, "bad-args");
	// 시퀀스가 바뀌면 그 토큰은 쓰지 않는다
	const tok2 = r.data.planToken;
	h.host.seq = { seqId: "other", seqName: "T_OTHER", projPath: PROJ };
	await h.advance(300);
	assert.equal((await cmd(h, "apply", { planToken: tok2 })).error, "seq-mismatch");
	noErrors(h);
});

test("ctx.seqId·ctx.build가 다르면 거절, 적용이 도는 동안 바꾸는 명령은 busy (읽기는 된다)", async () => {
	const { sim, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	assert.equal((await cmdAs(h, "test", "rows", {}, { seqId: "딴 시퀀스" })).error, "seq-mismatch");
	assert.equal((await cmdAs(h, "test", "rows", {}, { seqId: A.seqId })).ok, true);
	assert.equal((await cmdAs(h, "test", "rows", {}, { build: "dev-xxxx" })).error, "build-mismatch");
	assert.equal((await cmdAs(h, "test", "rows", {}, { build: "@@BUILD@@" })).ok, true);
	// ping을 잡아 두어 적용이 도는 동안을 만든다
	let release;
	const ping = h.host.handlers.MI_ping;
	h.host.handlers.MI_ping = (json) => new Promise((res) => { release = () => res(ping(json)); });
	const running = h.win._mogrtDebug.cmd("apply", {});
	await h.flush();
	assert.equal(h.win._mogrtDebug.miBusy(), true);
	assert.equal((await cmd(h, "cast.set", { items: [{ key: "C1", name: "x" }] })).error, "busy");
	assert.equal((await cmd(h, "sugg.reject", { all: true })).error, "busy");
	assert.equal((await cmd(h, "verify", {})).error, "busy");
	assert.equal((await cmd(h, "rows", {})).ok, true, "읽기는 된다");
	release();
	h.host.handlers.MI_ping = ping;
	const res = JSON.parse(JSON.stringify(await running));
	assert.equal(res.ok, true);
	noErrors(h);
});

test("verify: 적용한 그대로면 정상, 읽기만 한다 (호스트 쓰기 호출 없음), 레거시 목록은 no-rows", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	await cmd(h, "apply", {});
	assert.equal(sim.all(seq), 8);
	const before = h.host.calls.length;
	const r = await cmd(h, "verify", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.equal(r.data.counts.ok, 8, JSON.stringify(r.data.items.slice(0, 3)));
	assert.match(r.data.text, /^정상 8 · 타임라인에 없음 0 · /);
	const fns = h.host.calls.slice(before).map((c) => c.fn);
	assert.deepEqual([...new Set(fns)].sort(), ["MI_getTracks", "MI_ping", "MI_readClipTexts"]);
	assert.equal(h.win._mogrtDebug.miBusy(), false);
	const h2 = await boot(makeSim().sim, preset, castSession(preset, [[1, null, 100, 160, "하나"]]));
	assert.equal((await cmd(h2, "verify", {})).error, "no-rows");
	noErrors(h);
});

test("importSrt·mergeCommit {path}: 디스크에서 읽고 경로를 화자 표에 남긴다 (Node fs)", async () => {
	const { sim, preset } = makeSim();
	const srt = "1\n00:00:01,000 --> 00:00:02,000\n경로로 읽은 첫 줄\n\n2\n00:00:03,000 --> 00:00:04,000\n둘째 줄\n";
	const h = await boot(sim, preset, { subtitles: [], rowStates: {}, trashBin: [], nextId: 1 }, { node: { files: { "D:/srt/인터뷰_C1.srt": { data: srt, mtimeMs: 1790000000123.4 } } } });
	let r = await cmd(h, "mergeCommit", { files: [{ path: "D:\\srt\\인터뷰_C1.srt" }] });
	assert.equal(r.ok, true, JSON.stringify(r));
	const s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => [x.spk, x.text]), [["C1", "경로로 읽은 첫 줄"], ["C1", "둘째 줄"]]);
	assert.deepEqual([s.mi.cast.C1.file, s.mi.cast.C1.path, s.mi.cast.C1.size, s.mi.cast.C1.mtime], ["인터뷰_C1.srt", "D:/srt/인터뷰_C1.srt", Buffer.byteLength(srt), 1790000000123]);
	r = await cmd(h, "mergePreview", { files: [{ path: "D:/srt/없음.srt" }] });
	assert.equal(r.error, "bad-args");
	assert.match(r.detail, /파일을 읽지 못했다: D:\/srt\/없음\.srt/);
	noErrors(h);
});

test("approvals.approve: 인자가 틀린 요청은 안전 지점을 남기지 않고 그 오류 (대기열에서는 빠진다)", async () => {
	const { sim, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsTwo()));
	const nSafe = safety(h).length;
	const bad = [
		["cast.set", { items: [{ key: "C9", name: "x" }] }, "bad-args"],
		["mergeCommit", { files: [] }, "bad-args"],
		["importSrt", { files: [{ path: "D:/없음.srt" }] }, "bad-args"],
		["apply", { planToken: "p-없음" }, "not-found"],
		["apply", { spk: "C9" }, "bad-args"],
		["undo", { runId: 3 }, "bad-args"]
	];
	for (const [op, args, err] of bad) {
		const q = await cmdAs(h, "agent", op, args);
		assert.equal(q.error, "needs-approval", op);
		const r = await cmd(h, "approvals.approve", { rid: q.rid });
		assert.deepEqual([r.ok, r.error], [false, err], op + " " + JSON.stringify(r));
		assert.equal(safety(h).length, nSafe, op + ": 안전 지점을 남기지 않는다");
	}
	assert.equal((await cmd(h, "approvals.list", {})).data.length, 0);
	// 맞는 요청은 그대로 안전 지점 'AI: … 전' → 실행
	const q = await cmdAs(h, "agent", "cast.set", { items: [{ key: "C2", name: "지영" }] });
	assert.equal((await cmd(h, "approvals.approve", { rid: q.rid })).ok, true);
	assert.equal(safety(h).length, nSafe + 1);
	assert.equal(safety(h)[0].label, "AI: 화자 표 바꾸기 전");
	noErrors(h);
});
