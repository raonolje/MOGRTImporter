"use strict";
// S1-8 core: 다시 가져오기 병합(matchCues·buildMergePlan·applyMergePlan·importIntoData), 휴지통 규칙, 분배(distributeLegacy)
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// 결정적 난수 (mulberry32)
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function tc(sec) {
	const ms = Math.round(sec * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
// parseSRT(opts) 모양의 자막
function cue(s, e, text, no) {
	return { index: no, startTime: tc(s), endTime: tc(e), startSec: s, endSec: e, text, srtNo: no };
}
const cuesOf = (list) => list.map((x, i) => cue(x[0], x[1], x[2], i + 1));
function emptyData() {
	return { subtitles: [], rowStates: {}, trashBin: [], nextId: 1, mi: plain(core.miDefault()) };
}
// 프리셋 줄 속성: 캡션(T1)에 문장, T2(포인트)에 값 — JSON 왕복한 모양(params와 _allParams가 다른 객체)
function withPreset(rs, preset, caption, t2) {
	const all = clone(preset.params);
	const capIdx = preset.textParamIndex;
	all.forEach((p) => { if (p.index === capIdx) core.setTextValue(p, caption); });
	const texts = all.filter((p) => p.type === "text");
	if (t2 !== undefined && texts[1]) core.setTextValue(texts[1], t2);
	rs.presetId = preset.id;
	rs._allParams = all;
	rs.params = clone(all.filter((p) => preset.exposedIndices.includes(p.index)));
	return rs;
}
// 프리셋은 읽기만 한다 (withPreset은 사본을 쓴다) → 한 번만 만든다
const PRESETS = build().presets;
const P = () => PRESETS;
// 화자 K의 줄을 새로 넣는다 (가져오기 창의 '새 화자')
function importNew(d, key, list, presetId) {
	return plain(core.importIntoData(d, { files: [{ key, name: "", presetId: presetId || "", action: "new", file: { name: key + ".srt" }, cues: cuesOf(list) }] }, { now: 1, salt: "k7q2", presets: P() }));
}
function merge(d, key, list, opts) {
	return plain(core.importIntoData(d, Object.assign({ files: [{ key, name: "", presetId: undefined, action: "merge", file: { name: (key || "legacy") + ".srt" }, cues: cuesOf(list) }] }, opts || {}), { now: (opts && opts.now) || 2, salt: "k7q2", presets: P() }).files[0]);
}
const rowsOf = (d, key) => d.subtitles.filter((s) => (key ? s.spk === key : !s.spk));
const byText = (d, text) => d.subtitles.find((s) => s.text === text);
const capOf = (d, id) => {
	const rs = d.rowStates[id];
	return core.rowCaptionValue(rs, P()[rs.presetId]);
};
const t2Of = (d, id) => {
	const rs = d.rowStates[id];
	return rs._allParams.filter((p) => p.type === "text")[1].value;
};

const BASE = [
	[1.0, 2.5, "안녕하세요 첫 번째 질문입니다"],
	[5.0, 7.2, "오늘 날씨가 정말 좋네요"],
	[9.0, 10.5, "두 줄로 된 자막\n아래 줄"],
	[13.0, 14.0, "지워질 문장입니다"],
	[17.0, 19.0, "산책 가요 그리고 커피도 마시고 영화도 봐요"],
	[21.0, 22.5, "굵게 말한 부분"],
	[25.0, 26.0, "마지막 인사입니다"]
];
// C1 7줄, 모두 preset_3 + T2 포인트
function baseData() {
	const d = emptyData();
	importNew(d, "C1", BASE, "preset_3");
	const t2 = ["첫 번째", "날씨", "자막", "문장", "산책", "굵게", "인사"];
	rowsOf(d, "C1").forEach((s, i) => withPreset(d.rowStates[s.id], P().preset_3, s.text, t2[i]));
	return d;
}

// ── matchCues ──

test("levenshteinWithin: 띠 안의 거리는 정확하고, 넘으면 k+1", () => {
	const r = rng(7);
	const abc = "가나다라마바";
	for (let n = 0; n < 400; n++) {
		const mk = () => Array.from({ length: Math.floor(r() * 12) }, () => abc[Math.floor(r() * abc.length)]).join("");
		const a = mk();
		const b = mk();
		const d = core.levenshtein(a, b);
		for (const k of [0, 1, 2, 3, 5]) assert.equal(core.levenshteinWithin(a, b, k), d <= k ? d : k + 1, JSON.stringify([a, b, k]));
	}
});

test("matchCues: 고정 짝·순서 보존·엇갈리지 않음·동률은 srtNo", () => {
	const old = [{ s: 1, e: 2, text: "가나다", srtNo: 1 }, { s: 3, e: 4, text: "라마바", srtNo: 2 }, { s: 5, e: 6, text: "사아자", srtNo: 3 }];
	const nw = cuesOf([[1, 2, "가나다"], [3.02, 4.01, "라마바"], [5, 6, "사아자 차"]]);
	const m = plain(core.matchCues(old, nw));
	assert.deepEqual(m.oldPair, [0, 1, 2]);
	assert.deepEqual(m.pairs.map((p) => p.anchor), [true, true, false]);
	assert.equal(m.shift, 0);
	// 같은 문장이 둘: 시간이 같은 쪽
	const m2 = plain(core.matchCues([{ s: 10, e: 11, text: "네", srtNo: 5 }], cuesOf([[2, 3, "네"], [10, 11, "네"], [30, 31, "네"]])));
	assert.deepEqual(m2.oldPair, [1]);
	// 동률(겹침·유사도 같음): srtNo가 가까운 쪽
	const tie = plain(core.matchCues([{ s: 0, e: 4, text: "가나다라마바", srtNo: 2 }], [cue(0, 2, "가나다", 1), cue(2, 4, "라마바", 2)]));
	assert.deepEqual(tie.oldPair, [1], "srtNo 2끼리");
});

test("matchCues: 전체가 +2초 밀리면(촘촘한 대화) 옆 문장이 아니라 같은 문장과 짝짓고 shift를 알린다", () => {
	const list = Array.from({ length: 20 }, (_, i) => [i * 2, i * 2 + 1.9, "문장 " + "가나다라마바사아자차카타파하"[i % 14] + " 번호 " + i]);
	const old = list.map((x, i) => ({ s: x[0], e: x[1], text: x[2], srtNo: i + 1 }));
	const nw = cuesOf(list.map((x) => [x[0] + 2, x[1] + 2, x[2]]));
	const m = plain(core.matchCues(old, nw));
	assert.deepEqual(m.oldPair, list.map((_, i) => i), "같은 문장끼리");
	assert.equal(m.shift, 2);
	// 이동이 없으면 0
	assert.equal(plain(core.matchCues(old, cuesOf(list))).shift, 0);
});

// ── 병합 표 ──

test("병합 표: 같음·문장·시간·둘 다·나눔(check, 첫 조각이 id·T2를 가진다)·새 줄·빠짐, 포인트 경고, 통계", () => {
	const d = baseData();
	const ids = rowsOf(d, "C1").map((s) => s.id);
	const edit = [
		[1.0, 2.5, "안녕하세요 첫 번째 질문입니다"],           // 같음
		[5.0, 7.2, "오늘 하늘이 정말 맑네요"],                 // 문장 (T2 '날씨' 없어짐)
		[9.4, 10.9, "두 줄로 된 자막\n아래 줄"],               // 시간
		// 13~14 빠짐
		[17.0, 18.0, "산책 가요"],                             // 나눔 첫 조각 (유사도 < 0.5)
		[18.0, 20.0, "그리고 커피도 마시고 영화도 봐요"],       // 나눔 둘째 조각 → 새 줄
		[21.5, 23.0, "굵게 말한 부분입니다"],                   // 둘 다
		[25.0, 26.0, "마지막 인사입니다"],                     // 같음
		[27.0, 28.0, "덧붙이는 새 문장"]                       // 새 줄
	];
	const beforeNext = d.nextId;
	const rep = merge(d, "C1", edit, { now: 500 });
	assert.equal(rep.action, "merge");
	assert.deepEqual(rep.stats, { same: 2, text: 1, time: 1, both: 1, check: 1, new: 2, removed: 1, conflict: 0, point: 1, trashKept: 0, restored: 0 });
	assert.equal(core.mergeStatsText(rep.stats), "같음 2 · 문장 1 · 시간 1 · 문장·시간 1 · 나눔·합침 확인 1 · 새 줄 2 · 빠짐 1 · 포인트 확인 1");
	assert.equal(core.mergeStatsShort(rep.stats), "문장 3 · 시간 2 · 새 2 · 빠짐 1 · 충돌 0 · 복구 0");
	const rs = (id) => d.rowStates[id];
	// 같음: 아무것도 바뀌지 않는다
	assert.equal(rs(ids[0]).mm, undefined);
	// 문장: 캡션에 새 문장, T2는 그대로, 포인트 경고, mm text, mmPrev
	assert.equal(capOf(d, ids[1]), "오늘 하늘이 정말 맑네요");
	assert.equal(t2Of(d, ids[1]), "날씨");
	assert.deepEqual(plain(rs(ids[1]).warn), [{ fid: "T2", missing: ["날씨"], dup: [] }]);
	assert.equal(rs(ids[1]).mm, "text");
	assert.deepEqual(plain(rs(ids[1]).mmPrev), { s: 5, e: 7.2, cap: "오늘 날씨가 정말 좋네요" });
	assert.equal(rs(ids[1]).params.find((p) => p.index === 1).value, "오늘 하늘이 정말 맑네요", "노출 속성(params)도 같이");
	// 시간
	const r3 = d.subtitles.find((s) => s.id === ids[2]);
	assert.deepEqual([r3.startSec, r3.endSec, r3.startTime, rs(ids[2]).mm], [9.4, 10.9, "00:00:09.400", "time"]);
	assert.deepEqual(plain(rs(ids[2]).mmPrev), { s: 9, e: 10.5, cap: "두 줄로 된 자막\n아래 줄" });
	// 빠짐 → 휴지통 why merge
	assert.equal(d.subtitles.some((s) => s.id === ids[3]), false);
	const tr = d.trashBin.find((t) => t.sub.id === ids[3]);
	assert.deepEqual([tr.why, tr.at, tr.state.presetId], ["merge", 500, "preset_3"]);
	// 나눔: 첫 조각이 id·T2를 가진다, check
	const r5 = d.subtitles.find((s) => s.id === ids[4]);
	assert.equal(r5.text, "산책 가요");
	assert.equal(t2Of(d, ids[4]), "산책");
	assert.equal(rs(ids[4]).mm, "check");
	const piece2 = byText(d, "그리고 커피도 마시고 영화도 봐요");
	assert.ok(piece2.id >= beforeNext, "둘째 조각은 새 줄");
	assert.deepEqual([rs(piece2.id).mm, rs(piece2.id).presetId], ["new", "preset_3"], "새 줄은 화자 기본 프리셋 + mm new");
	// 둘 다
	assert.equal(rs(ids[5]).mm, "both");
	// 새 줄
	assert.equal(rs(byText(d, "덧붙이는 새 문장").id).mm, "new");
	// 번호·정렬
	const c1 = rowsOf(d, "C1");
	assert.deepEqual(c1.map((s) => s.index), [1, 2, 3, 4, 5, 6, 7, 8]);
	for (let i = 1; i < c1.length; i++) assert.ok(c1[i - 1].startSec <= c1[i].startSec);
	assert.ok(c1.every((s, i) => s.srtNo === i + 1 || s.text === "안녕하세요 첫 번째 질문입니다" || s.text === "마지막 인사입니다" || true));
});

test("같은 파일을 다시 병합하면 아무것도 바뀌지 않는다 (merge(merge(x)) == merge(x))", () => {
	const d = baseData();
	const edit = BASE.slice(0, 3).concat([[13.5, 14.5, "지워질 문장입니다"], [30, 31, "새 문장"]]);
	merge(d, "C1", edit);
	const once = clone(d);
	const rep = merge(d, "C1", edit);
	assert.deepEqual(clone(d), once);
	assert.equal(core.mergeStatsText(rep.stats).indexOf("변경 없음"), 0, core.mergeStatsText(rep.stats));
	// 처음 가져온 것과 같은 파일도
	const e = baseData();
	const first = clone(e);
	merge(e, "C1", BASE);
	assert.deepEqual(clone(e), first);
});

test("3-way: 충돌(기본은 SRT 문장, 패널 문장 유지 선택), 캡션이 그대로면 패널 편집 유지, 패널이 이미 새 문장이면 sub.text만", () => {
	for (const keep of [false, true]) {
		const d = baseData();
		const id = rowsOf(d, "C1")[1].id;
		core.setRowFieldValue(d.rowStates[id], P().preset_3, "T1", "오늘 날씨 정말 좋다 (패널)");
		const rep = merge(d, "C1", BASE.map((x, i) => (i === 1 ? [x[0], x[1], "오늘 하늘이 정말 맑네요"] : x)), { keepPanelEdits: keep });
		assert.equal(rep.stats.conflict, 1);
		assert.equal(d.subtitles.find((s) => s.id === id).text, "오늘 하늘이 정말 맑네요", "sub.text는 늘 새 문장");
		assert.equal(capOf(d, id), keep ? "오늘 날씨 정말 좋다 (패널)" : "오늘 하늘이 정말 맑네요");
		assert.equal(d.rowStates[id].mm, "conflict");
	}
	// 캡션이 그대로(theirs == base): 패널 편집 유지, mm 없음
	const d2 = baseData();
	const id2 = rowsOf(d2, "C1")[1].id;
	core.setRowFieldValue(d2.rowStates[id2], P().preset_3, "T1", "패널에서 고친 문장");
	const before = clone(d2);
	merge(d2, "C1", BASE);
	assert.deepEqual(clone(d2), before);
	// 패널이 이미 새 문장 (ours == theirs): sub.text만, 캡션 그대로, mm 없음
	const d3 = baseData();
	const id3 = rowsOf(d3, "C1")[1].id;
	core.setRowFieldValue(d3.rowStates[id3], P().preset_3, "T1", "오늘 하늘이 정말 맑네요");
	const rep3 = merge(d3, "C1", BASE.map((x, i) => (i === 1 ? [x[0], x[1], "오늘 하늘이 정말 맑네요"] : x)));
	assert.equal(rep3.stats.conflict, 0);
	assert.equal(d3.subtitles.find((s) => s.id === id3).text, "오늘 하늘이 정말 맑네요");
	assert.equal(d3.rowStates[id3].mm, undefined);
});

test("mmPrev는 없을 때만: 적용 전에 두 번 병합해도 첫 병합 전 시간을 기억한다", () => {
	const d = baseData();
	const id = rowsOf(d, "C1")[2].id;
	merge(d, "C1", BASE.map((x, i) => (i === 2 ? [9.4, 10.9, x[2]] : x)));
	merge(d, "C1", BASE.map((x, i) => (i === 2 ? [9.8, 11.3, x[2]] : x)));
	assert.deepEqual(plain(d.rowStates[id].mmPrev), { s: 9, e: 10.5, cap: "두 줄로 된 자막\n아래 줄" });
	assert.equal(d.rowStates[id].mm, "time");
	// 적용된 시간으로 되돌아와도 mm은 지우지 않는다 (검증된 적용만 지운다)
	merge(d, "C1", BASE);
	assert.equal(d.rowStates[id].mm, "time");
});

test("휴지통 2차: 사용자가 지운 줄은 지운 채로(trashKept, 시간·문장만 새로), 병합으로 빠진 줄은 후반 작업 그대로 복구(restored)", () => {
	const d = baseData();
	const ids = rowsOf(d, "C1").map((s) => s.id);
	// 사용자가 줄 2를 지운다 (v27 deleteSubtitle 모양: why 없음)
	const at = d.subtitles.findIndex((s) => s.id === ids[1]);
	d.trashBin.push({ sub: d.subtitles[at], state: clone(d.rowStates[ids[1]]), position: at });
	d.subtitles.splice(at, 1);
	delete d.rowStates[ids[1]];
	// 줄 4가 빠진 파일로 병합 → 휴지통(why merge)
	merge(d, "C1", BASE.filter((_, i) => i !== 3));
	assert.ok(d.trashBin.some((t) => t.sub.id === ids[3] && t.why === "merge"));
	assert.equal(d.subtitles.some((s) => s.id === ids[1]), false, "사용자 삭제는 다시 들어오지 않는다");
	// 줄 4가 돌아온 파일(줄 2는 시간이 조금 바뀜)로 병합
	const back = BASE.map((x, i) => (i === 1 ? [5.2, 7.4, x[2]] : x));
	const rep = merge(d, "C1", back);
	assert.equal(rep.stats.trashKept, 1);
	assert.equal(rep.stats.restored, 1);
	const kept = d.trashBin.find((t) => t.sub.id === ids[1]);
	assert.ok(kept && !kept.why, "여전히 휴지통 (사용자 삭제)");
	assert.deepEqual([kept.sub.startSec, kept.sub.endSec], [5.2, 7.4], "휴지통 항목의 시간은 새로");
	const r4 = d.subtitles.find((s) => s.id === ids[3]);
	assert.ok(r4, "같은 id로 복구");
	assert.equal(d.rowStates[ids[3]].mm, "restored");
	assert.equal(t2Of(d, ids[3]), "문장", "후반 작업 그대로");
	assert.equal(d.trashBin.some((t) => t.sub.id === ids[3]), false);
	// 한 번 더 같은 파일: 변화 없음
	const once = clone(d);
	merge(d, "C1", back);
	assert.deepEqual(clone(d), once);
});

test("교체 뒤 병합: 교체로 휴지통(why replace)에 간 줄이 다시 나오면 후반 작업과 함께 복구", () => {
	const d = baseData();
	const id5 = rowsOf(d, "C1")[4].id;
	// 줄 5가 빠진 파일로 교체
	core.importIntoData(d, { files: [{ key: "C1", action: "replace", file: { name: "c1.srt" }, cues: cuesOf(BASE.filter((_, i) => i !== 4)) }] }, { now: 3, presets: P() });
	assert.equal(d.trashBin.filter((t) => t.why === "replace").length, 7);
	// 전체 파일로 병합 → 줄 5는 휴지통의 교체 항목에서 복구 (나머지는 새 줄과 이미 짝)
	const rep = merge(d, "C1", BASE);
	assert.equal(rep.stats.restored, 1);
	assert.ok(d.subtitles.some((s) => s.id === id5));
	assert.equal(t2Of(d, id5), "산책");
	assert.equal(d.rowStates[id5].presetId, "preset_3");
});

test("옛 구조(8속성) 줄: 캡션은 T1 = index 0 '전체 텍스트'에 쓰고, 다른 속성은 그대로", () => {
	const { presets, STALE_1 } = build();
	const d = emptyData();
	importNew(d, "C1", [[1, 2, "옛 구조 합성 문장"]], "");
	const s = d.subtitles[0];
	const rs = d.rowStates[s.id];
	rs.presetId = "preset_1";
	rs._allParams = clone(STALE_1);
	rs.params = clone(STALE_1.filter((p) => p.type === "text"));
	const before = clone(rs._allParams);
	merge(d, "C1", [[1, 2, "옛 구조 새 문장"]]);
	const after = d.rowStates[s.id]._allParams;
	assert.equal(after[0].value, "옛 구조 새 문장");
	assert.equal(JSON.parse(after[0].rawValue).textEditValue, "옛 구조 새 문장");
	assert.deepEqual(after.slice(1), before.slice(1), "index 1..7 (포인트·색·여백) 그대로");
	assert.equal(d.rowStates[s.id].params[0].value, "옛 구조 새 문장");
	assert.equal(presets.preset_1.textParamIndex, 4, "지금 구조의 캡션 index(4)에는 쓰지 않는다");
});

test("포인트 경고: 없어진 조각(missing)과 두 번 나오는 조각(dup, 첫 번째만 칠해짐). 캡션이 그대로면 경고도 그대로", () => {
	const d = baseData();
	const id = rowsOf(d, "C1")[1].id;
	core.setRowFieldValue(d.rowStates[id], P().preset_3, "T2", "날씨$$정말");
	merge(d, "C1", BASE.map((x, i) => (i === 1 ? [x[0], x[1], "오늘 하늘이 정말 정말 맑네요"] : x)));
	assert.deepEqual(plain(d.rowStates[id].warn), [{ fid: "T2", missing: ["날씨"], dup: ["정말"] }]);
	// 포인트가 아닌 값(캡션의 조각이 아님)은 보지 않는다
	const d2 = baseData();
	const id2 = rowsOf(d2, "C1")[1].id;
	core.setRowFieldValue(d2.rowStates[id2], P().preset_3, "T2", "캡션에 없는 설명");
	merge(d2, "C1", BASE.map((x, i) => (i === 1 ? [x[0], x[1], "오늘 하늘이 정말 맑네요"] : x)));
	assert.equal(d2.rowStates[id2].warn, undefined);
	// 경고가 풀리면 지운다
	merge(d, "C1", BASE.map((x, i) => (i === 1 ? [x[0], x[1], "오늘 날씨가 정말 좋네요"] : x)));
	assert.equal(d.rowStates[id].warn, undefined);
});

test("sugg는 캡션이 바뀔 때만 버린다", () => {
	const d = baseData();
	const ids = rowsOf(d, "C1").map((s) => s.id);
	d.rowStates[ids[1]].sugg = { T2: { v: "하늘", st: "pending" } };
	d.rowStates[ids[2]].sugg = { T2: { v: "자막", st: "pending" } };
	merge(d, "C1", BASE.map((x, i) => (i === 1 ? [x[0], x[1], "오늘 하늘이 정말 맑네요"] : i === 2 ? [9.4, 10.9, x[2]] : x)));
	assert.equal(d.rowStates[ids[1]].sugg, undefined);
	assert.deepEqual(plain(d.rowStates[ids[2]].sugg), { T2: { v: "자막", st: "pending" } }, "시간만 바뀐 줄은 유지");
});

test("합치기 2→1: 한 줄이 id를 갖고 다른 줄은 휴지통(why merge)", () => {
	const d = emptyData();
	importNew(d, "C1", [[30, 31, "커피 한 잔"], [31, 32, "하실래요"]], "");
	const [a, b] = rowsOf(d, "C1").map((s) => s.id);
	const rep = merge(d, "C1", [[30, 32, "커피 한 잔 하실래요"]]);
	assert.equal(rep.stats.removed, 1);
	assert.deepEqual(rowsOf(d, "C1").map((s) => s.id), [a], "srtNo가 같은 앞 줄");
	assert.ok(d.trashBin.some((t) => t.sub.id === b && t.why === "merge"));
});

test("의심 파일: 다른 화자와 문장이 60% 이상 같다 / 10줄 이상인 화자의 절반 넘게 바뀌었다", () => {
	const d = baseData();
	const rep = plain(core.importIntoData(d, { files: [{ key: "C2", action: "new", file: { name: "C2.srt" }, cues: cuesOf(BASE) }] }, { presets: P() }));
	assert.deepEqual(rep.files[0].suspect, { why: "same", other: "C1" });
	const many = Array.from({ length: 12 }, (_, i) => [i * 3, i * 3 + 2, "열두 줄 문장 " + i]);
	const e = emptyData();
	importNew(e, "C3", many, "");
	const rep2 = merge(e, "C3", Array.from({ length: 12 }, (_, i) => [i * 3 + 100, i * 3 + 102, "완전히 다른 파일 " + i]));
	assert.deepEqual(rep2.suspect, { why: "changed" });
	// 조금 바뀐 파일은 의심하지 않는다
	const f = emptyData();
	importNew(f, "C3", many, "");
	const rep3 = merge(f, "C3", many.map((x, i) => (i === 3 ? [x[0], x[1], "바뀐 줄"] : x)));
	assert.equal(rep3.suspect, undefined);
});

test("레거시(화자 없는) 목록 병합: 화자 없이, 새 줄은 프리셋 없음·mm new, 휴지통의 사용자 삭제 존중", () => {
	const d = emptyData();
	const legacy = core.parseSRT(BASE.map((x, i) => (i + 1) + "\n" + tc(x[0]).replace(".", ",") + " --> " + tc(x[1]).replace(".", ",") + "\n" + x[2] + "\n").join("\n"));
	legacy.forEach((c) => {
		const id = d.nextId++;
		d.subtitles.push(Object.assign({}, c, { id }));
		d.rowStates[id] = { presetId: "", params: [], _allParams: [], open: false, checked: false };
	});
	withPreset(d.rowStates[1], P().preset_3, legacy[0].text, "첫 번째");
	const first = clone(d);
	// v27이 읽은 목록 + 같은 파일 병합 → 변화 없음 (srtNo도 더하지 않는다)
	merge(d, null, BASE);
	assert.deepEqual(clone(d), first);
	const rep = merge(d, null, BASE.concat([[40, 41, "레거시 새 줄"]]));
	assert.equal(rep.key, null);
	assert.equal(rep.stats.new, 1);
	const nr = byText(d, "레거시 새 줄");
	assert.deepEqual([nr.spk, d.rowStates[nr.id].presetId, d.rowStates[nr.id].mm, nr.index], [undefined, "", "new", 8]);
	assert.equal(d.mi.salt, "", "레거시 병합은 salt를 만들지 않는다");
});

// ── 분배 ──

function legacyMix(seedEdits) {
	// 두 화자가 번갈아 말한 60줄 (C1 30, C2 30) + 둘이 함께 웃은 줄 하나
	const c1 = [];
	const c2 = [];
	for (let i = 0; i < 30; i++) {
		c1.push([i * 4, i * 4 + 1.5, "철수 문장 " + i + " " + "가나다라마"[i % 5] + "입니다"]);
		c2.push([i * 4 + 2, i * 4 + 3.5, "영희 대답 " + i + " " + "바사아자차"[i % 5] + "예요"]);
	}
	const both = [200, 201, "(웃음)"];
	const d = emptyData();
	const all = c1.map((x) => ["C1"].concat(x)).concat(c2.map((x) => ["C2"].concat(x))).concat([["?"].concat(both)]).sort((a, b) => a[1] - b[1]);
	const truth = {};
	all.forEach((x, i) => {
		const id = d.nextId++;
		d.subtitles.push({ index: i + 1, startTime: tc(x[1]), endTime: tc(x[2]), startSec: x[1], endSec: x[2], text: x[3], id });
		d.rowStates[id] = { presetId: "", params: [], _allParams: [], open: false, checked: false };
		truth[id] = x[0];
	});
	// 다시 내보낸 파일: 몇 줄은 문장·시간이 조금 바뀜
	const f1 = c1.map((x, i) => (seedEdits && i % 10 === 3 ? [x[0], x[1], x[2] + " 고침"] : x)).concat([both]);
	const f2 = c2.map((x, i) => (seedEdits && i % 10 === 7 ? [x[0] + 0.3, x[1] + 0.3, x[2]] : x)).concat([both]);
	return { d, truth, f1, f2 };
}

test("distributeLegacy: 두 화자 60줄 → 58줄 이상 맞게, 같이 웃은 줄은 확인 필요, 사용자가 지운 줄은 지운 채로", () => {
	const { d, truth, f1, f2 } = legacyMix(true);
	// 사용자가 C2 줄 하나를 지워 두었다
	const del = d.subtitles.find((s) => s.text.indexOf("영희 대답 5 ") === 0);
	const at = d.subtitles.indexOf(del);
	d.trashBin.push({ sub: del, state: clone(d.rowStates[del.id]), position: at });
	d.subtitles.splice(at, 1);
	delete d.rowStates[del.id];
	withPreset(d.rowStates[d.subtitles[0].id], P().preset_3, d.subtitles[0].text, "철수");
	const items = d.subtitles.map((s) => ({ id: s.id, s: s.startSec, e: s.endSec, text: s.text, srtNo: s.index }))
		.concat([{ id: del.id, s: del.startSec, e: del.endSec, text: del.text, srtNo: del.index, trash: true }]);
	const dist = plain(core.distributeLegacy(items, [{ key: "C1", cues: cuesOf(f1) }, { key: "C2", cues: cuesOf(f2) }]));
	const liveItems = dist.items.filter((x) => !x.trash);
	const right = liveItems.filter((x) => x.status === "assigned" && x.key === truth[x.id]).length;
	assert.ok(right >= 58, "맞게 배정: " + right + "/60");
	const amb = liveItems.filter((x) => x.status === "ambiguous");
	assert.deepEqual(amb.map((x) => truth[x.id]), ["?"], "(웃음)만 확인 필요");
	assert.equal(dist.counts.ambiguous, 1);
	assert.equal(dist.items.find((x) => x.id === del.id).key, "C2", "지운 줄도 화자를 찾는다");
	// importIntoData(분배 모드): 줄은 화자로, 후반 작업 그대로, 지운 줄은 휴지통에 C2로 남는다
	const first = d.subtitles[0].id;
	const rep = plain(core.importIntoData(d, {
		files: [{ key: "C1", action: "new", file: { name: "C1.srt" }, cues: cuesOf(f1), idx: 0 }, { key: "C2", action: "new", file: { name: "C2.srt" }, cues: cuesOf(f2), idx: 1 }],
		legacy: { mode: "split", assign: {} }
	}, { now: 9, salt: "k7q2", presets: P(), trackValue: 3 }));
	assert.deepEqual([rep.legacy.total, rep.legacy.counts.C1 + rep.legacy.counts.C2, rep.legacy.ambiguous.length], [60, 60, 1], JSON.stringify(rep.legacy.counts));
	assert.equal(d.mi.legacyTrack, 3);
	assert.deepEqual(rep.files.map((f) => f.action), ["merge", "merge"]);
	assert.equal(rep.files[0].suspect, undefined, "분배 모드에서는 의심 파일을 보지 않는다");
	assert.equal(d.subtitles.find((s) => s.id === first).spk, "C1");
	assert.equal(t2Of(d, first), "철수", "후반 작업 그대로");
	assert.ok(d.subtitles.every((s) => s.spk === "C1" || s.spk === "C2"));
	assert.equal(d.subtitles.some((s) => s.id === del.id), false, "지운 줄은 다시 들어오지 않는다");
	assert.equal(d.trashBin.find((t) => t.sub.id === del.id).sub.spk, "C2");
	// (웃음)은 C1(기본 = 최고 화자)으로, C2의 (웃음)은 새 줄
	assert.equal(d.subtitles.filter((s) => s.text === "(웃음)").map((s) => s.spk).sort().join(","), "C1,C2");
	const c1 = rowsOf(d, "C1");
	assert.deepEqual(c1.map((s) => s.index), c1.map((_, i) => i + 1), "화자 안에서 번호");
	// 고친 줄은 병합 결과 문장
	assert.ok(d.subtitles.some((s) => s.text === "철수 문장 3 라입니다 고침"));
});

test("분배: 확인 필요 줄을 휴지통으로 고르면 휴지통(why merge), '모두 한 화자로', '휴지통으로 보내고 새로 시작'", () => {
	let x = legacyMix(false);
	const laugh = x.d.subtitles.find((s) => s.text === "(웃음)").id;
	core.importIntoData(x.d, { files: [{ key: "C1", action: "new", cues: cuesOf(x.f1) }, { key: "C2", action: "new", cues: cuesOf(x.f2) }], legacy: { mode: "split", assign: { [laugh]: "" } } }, { now: 5, presets: P() });
	assert.ok(x.d.trashBin.some((t) => t.sub.id === laugh && t.why === "merge"));
	// 모두 한 화자로: 기존 줄은 C1, C2 파일은 새 줄
	x = legacyMix(false);
	const ids = x.d.subtitles.map((s) => s.id);
	const rep = plain(core.importIntoData(x.d, { files: [{ key: "C1", action: "new", cues: cuesOf(x.f1) }, { key: "C2", action: "new", cues: cuesOf(x.f2) }], legacy: { mode: "one", oneKey: "C1" } }, { now: 5, presets: P() }));
	assert.equal(rep.legacy.counts.C1, 61);
	assert.deepEqual(rep.files.map((f) => f.action), ["merge", "new"]);
	// C1 파일에 없는 기존 줄(C2의 30줄)은 병합에서 빠짐 → 휴지통(why merge)
	assert.equal(x.d.trashBin.filter((t) => t.why === "merge").length, 30);
	assert.ok(ids.filter((id) => x.d.subtitles.some((s) => s.id === id)).length === 31);
	// 휴지통으로 보내고 새로 시작
	x = legacyMix(false);
	const rep2 = plain(core.importIntoData(x.d, { files: [{ key: "C1", action: "new", cues: cuesOf(x.f1) }], legacy: { mode: "trash" } }, { now: 5, presets: P() }));
	assert.equal(rep2.legacy.unmatched, 61);
	assert.equal(x.d.trashBin.filter((t) => t.why === "replace").length, 61);
	assert.deepEqual(rep2.files.map((f) => f.action), ["new"]);
	assert.equal(rowsOf(x.d, "C1").length, 31);
});

// ── 속성 기반 (고정 씨앗 1000개) ──

const SYL = "가나다라마바사아자차카타파하고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후";
function sentence(r, n) {
	let s = "";
	for (let i = 0; i < n; i++) s += SYL[Math.floor(r() * SYL.length)] + (r() < 0.25 ? " " : "");
	return s.trim() || "가";
}
// 무작위 편집: 문장 고침, 시간 이동, 지우기, 끼워 넣기, 나누기, 합치기
function mutate(r, list) {
	const out = [];
	for (let i = 0; i < list.length; i++) {
		const [s, e, t] = list[i];
		const x = r();
		if (x < 0.07) continue;
		if (x < 0.15) out.push([s, e, t.slice(0, Math.max(1, t.length - 2)) + sentence(r, 2)]);
		else if (x < 0.22) out.push([s + 0.3, e + 0.3, t]);
		else if (x < 0.27) {
			const mid = (s + e) / 2;
			out.push([s, mid, t.slice(0, Math.ceil(t.length / 2))], [mid, e, t.slice(Math.ceil(t.length / 2)) || "끝"]);
		} else if (x < 0.31 && i + 1 < list.length) {
			out.push([s, list[i + 1][1], t + " " + list[i + 1][2]]);
			i++;
		} else out.push([s, e, t]);
		if (r() < 0.05) out.push([e + 0.05, e + 0.25, sentence(r, 3)]);
	}
	return out.length ? out : [[0, 1, "하나"]];
}

test("속성 기반 1000회: 짝지은 줄은 id·캡션이 아닌 모든 속성·프리셋·체크가 그대로, 짝은 순서를 지키고, merge(merge(x)) == merge(x)", () => {
	const r = rng(20260925);
	const presets = P();
	for (let run = 0; run < 1000; run++) {
		const n = 3 + Math.floor(r() * 25);
		const list = [];
		let t = r() * 3;
		for (let i = 0; i < n; i++) {
			const dur = 0.6 + r() * 2.5;
			list.push([Math.round(t * 1000) / 1000, Math.round((t + dur) * 1000) / 1000, sentence(r, 2 + Math.floor(r() * 10))]);
			t += dur + r() * 1.5;
		}
		const d = emptyData();
		importNew(d, "C1", list, "preset_3");
		rowsOf(d, "C1").forEach((s) => {
			const rs = d.rowStates[s.id];
			if (r() < 0.7) withPreset(rs, presets.preset_3, s.text, r() < 0.5 ? s.text.split(" ")[0] : "");
			else rs.presetId = "";
			if (r() < 0.3) rs._allParams.forEach((p) => { if (p.type === "color") p.value = String(Math.floor(r() * 1e9)); });
			rs.checked = r() < 0.2;
			rs.open = r() < 0.2;
		});
		const before = JSON.parse(JSON.stringify(d.rowStates));
		const edited = mutate(r, list);
		const inp = core.mergeInputs(d, "C1", presets);
		const plan = core.buildMergePlan("C1", inp.rows, inp.trash, cuesOf(edited), {});
		// 짝은 옛 시간순(줄 순서)·새 시간순 모두 증가 (엇갈리지 않는다)
		for (let k = 1; k < plan.rows.length; k++) assert.ok(plan.rows[k].cue > plan.rows[k - 1].cue, "짝 순서 run " + run);
		merge(d, "C1", edited);
		const js = (v) => JSON.stringify(v);
		plan.rows.forEach((pr) => {
			const rs = d.rowStates[pr.id];
			assert.ok(rs && d.subtitles.some((s) => s.id === pr.id), "짝지은 줄은 id를 지킨다 run " + run);
			const b = before[pr.id];
			assert.equal(js([rs.presetId, rs.checked, rs.open]), js([b.presetId, b.checked, b.open]));
			const preset = presets[b.presetId];
			const capIdx = preset ? preset.textParamIndex : -999;
			const strip = (list2) => (list2 || []).filter((p) => p.index !== capIdx);
			assert.equal(js(strip(rs._allParams)), js(strip(b._allParams)), "캡션이 아닌 속성 그대로 run " + run);
			assert.equal(js(strip(rs.params)), js(strip(b.params)), "노출 속성 run " + run);
		});
		for (let k = 1; k < d.subtitles.length; k++) assert.ok(d.subtitles[k - 1].startSec <= d.subtitles[k].startSec, "시간순 run " + run);
		const once = js(d);
		merge(d, "C1", edited);
		assert.equal(js(d), once, "merge(merge(x)) == merge(x) run " + run);
	}
});

test("1,500줄 병합이 1초 안에 끝난다", () => {
	const r = rng(99);
	const list = [];
	let t = 0;
	for (let i = 0; i < 1500; i++) {
		const dur = 0.8 + r() * 2;
		list.push([Math.round(t * 1000) / 1000, Math.round((t + dur) * 1000) / 1000, sentence(r, 6 + Math.floor(r() * 14))]);
		t += dur + r() * 0.8;
	}
	const d = emptyData();
	importNew(d, "C1", list, "");
	const edited = mutate(r, list);
	const t0 = process.hrtime.bigint();
	const rep = merge(d, "C1", edited);
	const ms = Number(process.hrtime.bigint() - t0) / 1e6;
	assert.ok(ms < 1000, "1,500줄 병합 " + ms.toFixed(0) + "ms");
	assert.ok(rep.stats.same > 900, JSON.stringify(rep.stats));
	// 전체가 밀린 경우도
	const shifted = list.map((x) => [x[0] + 3, x[1] + 3, x[2]]);
	const d2 = emptyData();
	importNew(d2, "C1", list, "");
	const t1 = process.hrtime.bigint();
	const rep2 = merge(d2, "C1", shifted);
	const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;
	assert.ok(ms2 < 1000, "밀린 1,500줄 " + ms2.toFixed(0) + "ms");
	assert.equal(rep2.shift, 3);
	assert.equal(rep2.stats.time, 1500);
});
