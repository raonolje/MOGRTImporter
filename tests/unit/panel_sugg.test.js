"use strict";
// S3-2: AI 제안 대기열 — 행 머리 'AI', 속성창 .sugg-box [적용]·[무시], 선택 바 'AI 제안 (N)' 드롭다운(제안 줄만 보기·검증 통과만 적용·모두 무시),
// '경고 (N)' 필터와 .field-warn, 제안은 적용 페이로드에 실리지 않는다, 캡션을 바꾸는 병합은 제안을 지운다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");
const { loadRegions } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/sugg.prproj";
const A = { seqId: "seq-sugg-1", seqName: "T_SUGG", projPath: PROJ };
const clone = (v) => JSON.parse(JSON.stringify(v));

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
// preset_3 (T1 캡션 '텍스트', T2 '포인트 텍스트', 최대 3개 규칙) 줄들. rows: [[id, spk, 시작 초, 문장]]
function session(p3, rows, o) {
	const subtitles = [];
	const rowStates = {};
	const n = {};
	rows.forEach(([id, spk, s, text]) => {
		n[spk || ""] = (n[spk || ""] || 0) + 1;
		const sub = { index: n[spk || ""], startTime: tc(s), endTime: tc(s + 1.5), startSec: s, endSec: s + 1.5, text, id };
		if (spk) { sub.spk = spk; sub.srtNo = sub.index; }
		subtitles.push(sub);
		const all = clone(p3.params);
		CORE.setTextValue(all.find((p) => p.index === p3.textParamIndex), text);
		const exposed = (o && o.exposed) || p3.exposedIndices;
		rowStates[id] = { presetId: p3.id, params: all.filter((p) => exposed.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	});
	const out = { subtitles, rowStates, trashBin: [], nextId: Math.max(...rows.map((r) => r[0])) + 1 };
	if (rows.some((r) => r[1])) {
		out.mi = { v: 1, salt: "ab12", hwm: out.nextId - 1, legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: p3.id, color: 0 }, C2: { name: "영희", track: null, autoTrack: null, presetId: p3.id, color: 1 } },
			stack: false, stackDy: 0.12, applied: {} };
	}
	return out;
}
async function boot(p3, sess, o) {
	const presets = { [p3.id]: p3 };
	const h = await bootPanel(Object.assign({
		seq: A,
		mogrts: [{ name: p3.name, path: p3.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets, presetTrash: [], nextPresetId: 9 }, [P.session(PROJ, A.seqId)]: sess }
	}, o || {}));
	await h.advance(1000);
	return h;
}
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
const cmdAs = async (h, source, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmdAs(source, op, args)));
const safety = (h) => h.fs.readJson(P.historySafety(PROJ, A.seqId)) || [];
const auto = (h) => h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || [];
const boxes = (h, id) => h.$("params-" + id).querySelectorAll(".sugg-box").map((b) => ({ fid: b.dataset.fid, text: b.querySelector(".sugg-text").textContent, cls: b.className, ok: !b.querySelector(".sugg-ok").disabled }));
const chip = (h, id) => { const el = h.$("row-" + id).querySelector(".sub-sugg"); return el ? { cls: el.className, title: el.title } : null; };
const t2Of = (h, id, p3) => CORE.resolveFid(h.snapshot().rowStates[id]._allParams, "T2", p3.params).param.value;
const visible = (h) => h.rows().filter((r) => !/(search|preset-filter|speaker-filter|mark-filter)-hidden/.test(r.className)).map((r) => parseInt(r.id.slice(4), 10));
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
async function suggest(h, items, source) {
	const rows = (await cmd(h, "rows", {})).data.rows;
	const byId = {};
	rows.forEach((r) => { byId[r.id] = r; });
	const r = await cmdAs(h, source || "agent", "suggest", { items: items.map(([id, fid, value]) => ({ uid: byId[id].uid, fid, value, sig: byId[id].sig, by: "codex" })) });
	assert.equal(r.ok, true, JSON.stringify(r));
	return r;
}

test("(1) 제안이 와도 속성·▶ 페이로드는 그대로 (단일 화자 v27 applyToTimeline 바이트 같음)", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot(p3, session(p3, [[1, null, 1, "오늘 날씨가 좋고 하늘이 맑다"], [2, null, 4, "둘째 줄 문장"]]));
	h.$("btnApply").click();
	await h.flush();
	const before = h.host.calls.filter((c) => c.fn === "applyToTimeline").map((c) => c.args[0]);
	assert.equal(before.length, 1);
	const all0 = JSON.stringify(h.snapshot().rowStates[1]._allParams);
	await suggest(h, [[1, "T2", "날씨$$하늘"], [2, "T2", "문장"]]);
	assert.equal(JSON.stringify(h.snapshot().rowStates[1]._allParams), all0);
	h.$("btnApply").click();
	await h.flush();
	const after = h.host.calls.filter((c) => c.fn === "applyToTimeline").map((c) => c.args[0]);
	assert.equal(after.length, 2);
	assert.equal(after[1], before[0], "제안은 페이로드에 실리지 않는다");
	assert.doesNotMatch(after[1], /sugg|날씨\$\$하늘/);
	noErrors(h);
});

test("(2) 속성창 .sugg-box 'AI 제안 (Codex): … — ✓ 본문에 있음' [적용] → T2·안전 지점·변경 표시, 행 머리 'AI'가 사라진다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot(p3, session(p3, [[1, "C1", 1, "오늘 날씨가 좋고 하늘이 맑다"], [2, "C2", 4, "영희 문장"], [3, "C1", 7, "셋째 문장"]]));
	assert.equal(h.$("suggWrap").style.display, "none", "제안이 없으면 숨김");
	await suggest(h, [[1, "T2", "날씨$$하늘"], [2, "T2", "오늘의 인터뷰"], [3, "T2", "문장$$바다"]].slice(0, 2));
	assert.equal(h.$("suggWrap").style.display, "");
	assert.equal(h.$("btnSuggestions").textContent, "AI 제안 (2)");
	assert.deepEqual(boxes(h, 1), [{ fid: "T2", text: "AI 제안 (Codex): 날씨$$하늘 — ✓ 본문에 있음", cls: "sugg-box", ok: true }]);
	assert.deepEqual(boxes(h, 2), [{ fid: "T2", text: "AI 제안 (Codex): 오늘의 인터뷰 — ! 본문에 없는 문구", cls: "sugg-box warn", ok: true }]);
	// 칸은 그 필드 블록의 입력 칸 바로 아래
	const blk = h.$("params-1").querySelector(".sugg-box").parentNode;
	assert.equal(blk.className, "mogrt-text-block");
	assert.equal(blk.querySelector(".fid-badge").textContent, "T2");
	const c = chip(h, 1);
	assert.equal(c.cls, "sub-sugg");
	assert.match(c.title, /^AI 제안 1개 — \[적용\]하기 전에는 바뀌지 않습니다\nT2 포인트 텍스트: 날씨\$\$하늘 — ✓ 본문에 있음$/);
	// [적용]
	h.$("params-1").querySelector(".sugg-ok").click();
	await h.flush();
	assert.equal(t2Of(h, 1, p3), "날씨$$하늘");
	const ta = h.$("params-1").querySelectorAll(".fid-badge").find((b) => b.textContent === "T2").parentNode.parentNode.querySelector("textarea");
	assert.equal(ta.value, "날씨$$하늘", "속성창도 새 값");
	assert.deepEqual(boxes(h, 1), []);
	assert.equal(chip(h, 1), null);
	assert.equal(h.snapshot().rowStates[1].mm, "text");
	assert.ok(h.$("row-1").querySelector(".sub-mm.mm-text"), "변경 점");
	assert.equal(safety(h)[0].label, "AI 제안 적용 전");
	assert.equal(auto(h)[0].label, "AI 제안 적용 (1개)");
	assert.equal(h.$("btnSuggestions").textContent, "AI 제안 (1)");
	assert.equal(h.$("btnSelectChanged").textContent, "변경 줄 (1)");
	// [무시]
	h.$("params-2").querySelector(".sugg-no").click();
	await h.flush();
	assert.equal(h.snapshot().rowStates[2].sugg, undefined);
	assert.equal(t2Of(h, 2, p3), "밴드", "속성 그대로");
	assert.equal(h.$("suggWrap").style.display, "none");
	noErrors(h);
});

test("낡은 제안: 캡션을 고치면 회색·[적용] 꺼짐·'캡션이 바뀌어 다시 확인이 필요합니다', 행 머리 'AI'도 회색", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot(p3, session(p3, [[1, "C1", 1, "오늘 날씨가 좋고 하늘이 맑다"]]));
	await suggest(h, [[1, "T2", "날씨$$하늘"]]);
	const ta = h.$("params-1").querySelectorAll(".fid-badge").find((b) => b.textContent === "T1").parentNode.parentNode.querySelector("textarea");
	ta.value = "오늘 날씨가 좋다";
	ta.dispatchEvent(new h.win.Event("input"));
	assert.deepEqual(boxes(h, 1), [{ fid: "T2", text: "AI 제안 (Codex): 날씨$$하늘 — 캡션이 바뀌어 다시 확인이 필요합니다", cls: "sugg-box stale", ok: false }]);
	assert.equal(chip(h, 1).cls, "sub-sugg stale");
	h.$("params-1").querySelector(".sugg-ok").click();
	await h.flush();
	assert.equal(t2Of(h, 1, p3), "밴드", "꺼진 [적용]은 아무것도 하지 않는다");
	noErrors(h);
});

test("(3) 선택 바 'AI 제안 (N)': 제안 줄만 보기 · 검증 통과만 적용(안전 지점 하나, 통과 못 한 것은 남김) · 모두 무시(확인)", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot(p3, session(p3, [[1, "C1", 1, "오늘 날씨가 좋고 하늘이 맑다"], [2, "C2", 4, "영희 문장"], [3, "C1", 7, "셋째 문장"], [4, "C2", 10, "넷째 문장"]]));
	await suggest(h, [[1, "T2", "날씨$$하늘"], [2, "T2", "문장"], [3, "T2", "셋째"]]);
	// 3번 줄 캡션을 바꿔 낡게 만든다
	const ta = h.$("params-3").querySelectorAll(".fid-badge").find((b) => b.textContent === "T1").parentNode.parentNode.querySelector("textarea");
	ta.value = "바뀐 문장";
	ta.dispatchEvent(new h.win.Event("input"));
	// 제안 줄만 보기
	h.$("btnSuggestions").click();
	assert.ok(h.$("suggDropdown").classList.contains("open"));
	h.$("btnSuggFilter").click();
	assert.deepEqual(visible(h), [1, 2, 3]);
	assert.equal(h.$("btnSuggFilter").textContent, "모든 줄 보기");
	// 검증 통과만 적용
	const nSafe = safety(h).length;
	h.$("btnSuggestions").click();
	h.$("btnSuggApplyOk").click();
	await h.flush();
	assert.equal(t2Of(h, 1, p3), "날씨$$하늘");
	assert.equal(t2Of(h, 2, p3), "문장");
	assert.equal(t2Of(h, 3, p3), "밴드", "낡은 제안은 적용하지 않는다");
	assert.equal(safety(h).length, nSafe + 1, "안전 지점 하나");
	assert.match(h.status().text, /^AI 제안 2개 적용 · 건너뜀 1/);
	assert.deepEqual(visible(h), [3], "필터는 남은 제안 줄만");
	// 모두 무시 → 확인창
	h.$("btnSuggestions").click();
	h.$("btnSuggRejectAll").click();
	assert.ok(h.$("confirmModal").classList.contains("open"));
	assert.match(h.$("confirmMessage").textContent, /^AI 제안 1개를 모두 버립니다/);
	h.$("confirmYes").click();
	await h.flush();
	assert.equal(h.snapshot().rowStates[3].sugg, undefined);
	assert.deepEqual(visible(h), [1, 2, 3, 4], "남은 제안이 없으면 필터를 푼다");
	assert.equal(h.$("suggWrap").style.display, "none");
	noErrors(h);
});

test("캡션을 바꾸는 병합은 대기 중인 제안을 지우고, 시간만 바뀐 줄은 둔다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot(p3, { subtitles: [], rowStates: {}, trashBin: [], nextId: 1 });
	const srt = (cues) => Buffer.from(cues.map(([s, e, t], i) => (i + 1) + "\n" + tc(s).replace(".", ",") + " --> " + tc(e).replace(".", ",") + "\n" + t + "\n").join("\n"), "utf8").toString("base64");
	const base = [[1, 2.5, "오늘 날씨가 좋고 하늘이 맑다"], [4, 5.5, "내일은 비가 온다고 한다"], [7, 8.5, "셋째 줄은 그대로"]];
	let r = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64: srt(base), presetId: p3.id }] });
	assert.equal(r.ok, true, JSON.stringify(r));
	await h.flush();
	const ids = h.snapshot().subtitles.map((s) => s.id);
	await suggest(h, [[ids[0], "T2", "날씨$$하늘"], [ids[1], "T2", "비"], [ids[2], "T2", "셋째"]]);
	r = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64: srt([[1, 2.5, "오늘 날씨가 좋고 바다가 맑다"], [4.4, 5.9, base[1][2]], base[2]]) }] });
	assert.equal(r.ok, true, JSON.stringify(r));
	const s = h.snapshot();
	assert.equal(s.rowStates[ids[0]].sugg, undefined, "캡션이 바뀐 줄의 제안은 지운다");
	assert.equal(s.rowStates[ids[1]].sugg.T2.v, "비", "시간만 바뀐 줄은 둔다");
	assert.equal(s.rowStates[ids[2]].sugg.T2.v, "셋째");
	assert.equal(h.$("btnSuggestions").textContent, "AI 제안 (2)");
	noErrors(h);
});

test("'경고 (N)' 필터와 .field-warn: 포인트 경고가 있는 줄만 보기, 필드 아래 경고 문구", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const sess = session(p3, [[1, "C1", 1, "오늘 날씨"], [2, "C1", 4, "둘째"], [3, "C2", 7, "셋째"]]);
	sess.rowStates[2].warn = [{ fid: "T2", missing: ["하늘"], dup: ["날씨"] }];
	const h = await boot(p3, sess);
	assert.equal(h.$("btnWarnFilter").style.display, "");
	assert.equal(h.$("btnWarnFilter").textContent, "경고 (1)");
	assert.deepEqual(h.$("params-2").querySelectorAll(".field-warn").map((e) => e.textContent), ["‘하늘’이 문장에 없습니다", "‘날씨’가 두 번 나와 첫 번째만 칠해집니다"]);
	assert.equal(h.$("params-2").querySelector(".field-warn").parentNode.querySelector(".fid-badge").textContent, "T2", "그 필드 블록 안");
	// 줄 1을 체크해 두면 필터가 숨길 때 체크를 푼다
	const chk = h.$("row-1").querySelector("input[type=checkbox]");
	chk.checked = true;
	h.change(chk);
	h.$("btnWarnFilter").click();
	assert.deepEqual(visible(h), [2]);
	assert.ok(h.$("btnWarnFilter").classList.contains("active"));
	assert.equal(h.snapshot().rowStates[1].checked, false);
	// 전체 선택은 보이는 줄만
	h.$("btnToggleSelect").click();
	assert.deepEqual(h.snapshot().subtitles.filter((x) => h.snapshot().rowStates[x.id].checked).map((x) => x.id), [2]);
	h.$("btnToggleSelect").click();
	h.$("btnWarnFilter").click();
	assert.deepEqual(visible(h), [1, 2, 3]);
	noErrors(h);
});

test("속성창에 없는 필드(노출하지 않은 T2)의 제안은 속성창 맨 위에, 속성창이 없는 줄은 'AI'를 누르면 확인창", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot(p3, session(p3, [[1, "C1", 1, "오늘 날씨가 좋고 하늘이 맑다"]], { exposed: [1] }));
	await suggest(h, [[1, "T2", "날씨$$하늘"]]);
	const ex = h.$("params-1").querySelector(".sugg-extra");
	assert.ok(ex);
	assert.equal(h.$("params-1").childNodes[0], ex, "맨 위");
	assert.equal(ex.querySelector(".sugg-extra-label").textContent, "T2 포인트 텍스트 (속성창에 없는 필드)");
	h.$("row-1").querySelector(".sub-sugg").click();
	assert.equal(h.snapshot().rowStates[1].open, true, "'AI'를 누르면 속성창을 연다");
	ex.querySelector(".sugg-ok").click();
	await h.flush();
	assert.equal(t2Of(h, 1, p3), "날씨$$하늘");
	// 노출 속성이 없는 프리셋의 줄 (속성창이 없다)
	const p3n = Object.assign(clone(p3), { exposedIndices: [] });
	const h2 = await boot(p3n, session(p3n, [[1, "C1", 1, "오늘 날씨가 좋고 하늘이 맑다"]], { exposed: [] }));
	await suggest(h2, [[1, "T2", "날씨$$하늘"]]);
	h2.$("row-1").querySelector(".sub-sugg").click();
	assert.ok(h2.$("confirmModal").classList.contains("open"));
	assert.match(h2.$("confirmMessage").textContent, /^C1·1 줄의 AI 제안 1개:\n\nT2 포인트 텍스트: 날씨\$\$하늘\n   ✓ 본문에 있음/);
	assert.equal(h2.$("confirmYes").textContent, "검증 통과만 적용");
	h2.$("confirmYes").click();
	await h2.flush();
	assert.equal(t2Of(h2, 1, p3), "날씨$$하늘");
	noErrors(h);
	noErrors(h2);
});
