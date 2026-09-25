"use strict";
// S3-3 core: 타임라인 검수 verifyReport (읽기만) — 줄·클립 분류와 요약 글
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");

const core = loadRegions(["src/mi/core.ts"]);
const FT = 10594584000; // 23.976
const SALT = "ab12";
const LAY = [["텍스트", "t"], ["포인트 텍스트", "t"], ["색", "o"]];
const LS = core.clipLs(LAY);
const PRESET = { id: "preset_3", name: "합성", mogrtPath: "C:/m/a.mogrt", params: [{ index: 0, displayName: "텍스트", type: "text" }, { index: 1, displayName: "포인트 텍스트", type: "text" }], textParamIndex: 0, mogrtLs: LS, mogrtBaseComps: 3, mogrtBaseKeyed: [] };
const NATIVE = { id: "preset_5", name: "네이티브", mogrtPath: "C:/m/n.mogrt", params: [{ index: 0, displayName: "제목", type: "text", nativeText: true }], textParamIndex: 0 };

// 줄 id → [sf, ef] (프레임), 문장
function sub(id, sf, ef, text, spk) {
	return { id, index: id, spk: spk || "C1", startSec: (sf * FT) / 254016000000, endSec: (ef * FT) / 254016000000, text };
}
const tag = (id, g) => "철수 [MI:" + SALT + "-" + id + "." + (g === undefined ? 1 : g) + "]";
function applied(id, sf, ef, texts, extra) {
	return Object.assign({ g: 1, m: PRESET.mogrtPath, ls: LS, h: "h" + id, fh: {}, rh: core.textsHash(texts), k: "ae", t: 2, sf, ef, cef: ef }, extra || {});
}
function detail(texts, extra) {
	return Object.assign({ found: true, kind: "ae", pin: "합성", texts, lay: LAY, deco: { comps: 3, keyed: [] } }, extra || {});
}
// 줄 10개가 V3에 적용된 상태에서 시작해 필요한 것만 바꾼다
function base() {
	const rows = [];
	const clips = [];
	const details = {};
	const ap = {};
	const intentOf = {};
	for (let id = 1; id <= 10; id++) {
		const sf = id * 100;
		const ef = sf + 50;
		const text = "문장 " + id;
		rows.push({ sub: sub(id, sf, ef, text), rs: { presetId: "preset_3" }, preset: PRESET });
		clips.push({ sf, ef, nodeId: "n" + id, name: tag(id) });
		details["n" + id] = detail([text, ""]);
		ap[SALT + "-" + id] = applied(id, sf, ef, [text, ""]);
		intentOf[id] = "h" + id;
	}
	return { rows, clips, details, ap, intentOf };
}
function run(x, extraTracks) {
	const scan = { frameTicks: String(FT), numVideoTracks: 6, tracks: [{ i: 2, locked: false, clips: x.clips }].concat(extraTracks || []) };
	return plain(core.verifyReport({ rows: x.rows, allRows: x.rows.map((r) => r.sub), mi: { salt: SALT, applied: x.ap }, scan, details: x.details, plan: { intentOf: x.intentOf } }));
}
const cats = (rep) => rep.items.map((i) => [i.cat, i.id]).sort((a, b) => (a[1] - b[1]) || (a[0] < b[0] ? -1 : 1));

test("모두 적용한 그대로면 정상 10, 요약 글에 분류가 모두 (0 포함)", () => {
	const rep = run(base());
	assert.equal(rep.counts.ok, 10);
	assert.deepEqual(rep.items, []);
	assert.equal(rep.text, "정상 10 · 타임라인에 없음 0 · 옮겨짐 0 · 같은 태그 중복 0 · 옛 세대 0 · Premiere에서 고침 0 · 옛 버전 템플릿 0 · 효과·키프레임 0 · 미적용 0 · 목록에 없는 클립 0");
});

test("지움·자름(끝)·자르기(razor)·문장 고침·Motion 키 → 정확히 그 다섯 줄 (spec S3-3 하드 테스트 (1)의 모양)", () => {
	const x = base();
	// 1: 지움
	x.clips = x.clips.filter((c) => c.nodeId !== "n1");
	// 2: 끝을 자름 (길이 바꿈)
	x.clips.find((c) => c.nodeId === "n2").ef = 230;
	// 3: 자르기 → 같은 이름 두 조각
	const c3 = x.clips.find((c) => c.nodeId === "n3");
	c3.ef = 320;
	x.clips.push({ sf: 320, ef: 350, nodeId: "n3b", name: tag(3) });
	// 4: 문장 고침
	x.details.n4 = detail(["Premiere에서 고친 문장", ""]);
	// 5: Motion 키
	x.details.n5 = detail(["문장 5", ""], { deco: { comps: 3, keyed: ["AE.ADBE Motion"] } });
	const rep = run(x);
	assert.deepEqual(cats(rep), [["missing", 1], ["moved", 2], ["dup", 3], ["edited", 4], ["decorated", 5]]);
	assert.deepEqual([rep.counts.ok, rep.counts.missing, rep.counts.moved, rep.counts.dup, rep.counts.edited, rep.counts.decorated, rep.counts.unapplied], [5, 1, 1, 1, 1, 1, 0]);
	const byCat = {};
	rep.items.forEach((i) => { byCat[i.cat] = i; });
	assert.deepEqual([byCat.missing.track, byCat.missing.sf, byCat.missing.ef], [2, 100, 150], "지운 클립은 마지막 적용 자리");
	assert.equal(byCat.missing.detail, "V3 4.17~6.26에 있던 클립이 없음");
	assert.match(byCat.moved.detail, /^V3 8\.34~10\.43 → V3 8\.34~9\.59$/);
	assert.equal(byCat.dup.clips.length, 2);
	assert.equal(byCat.edited.detail, "클립 문장: Premiere에서 고친 문장");
	assert.equal(byCat.decorated.detail, "키: Motion");
	assert.equal(byCat.edited.label, "C1·4");
});

test("옛 버전 템플릿·템플릿 바뀜·패널에서 바뀐 값(의도 해시)·병합 표시·적용 기록 없음·놓인 적 없음", () => {
	const x = base();
	x.details.n1 = detail(["문장 1", ""], { lay: [["텍스트", "t"], ["색", "o"]] });
	x.ap[SALT + "-2"].m = "C:/m/old.mogrt";
	x.intentOf[3] = "다른 해시";
	x.rows[3].rs.mm = "text";
	delete x.ap[SALT + "-5"];
	x.clips = x.clips.filter((c) => c.nodeId !== "n6");
	delete x.ap[SALT + "-6"];
	const rep = run(x);
	assert.deepEqual(cats(rep), [["oldVersion", 1], ["unapplied", 2], ["unapplied", 3], ["unapplied", 4], ["unapplied", 5], ["unapplied", 6]]);
	const why = {};
	rep.items.forEach((i) => { why[i.id] = i.detail; });
	assert.deepEqual([why[2], why[3], why[4], why[5], why[6]], ["템플릿이 바뀜", "패널에서 바뀐 값이 있음", "바뀐 줄 (변경 표시)", "마지막 적용 기록 없음", "아직 타임라인에 없음"]);
});

test("클립 분류: 옛 gen(중단된 적용이 남김)과 목록에 없는 줄의 클립, 다른 트랙으로 옮긴 클립은 옮겨짐", () => {
	const x = base();
	x.clips.push({ sf: 700, ef: 750, nodeId: "old7", name: tag(7, 0) });
	x.clips.push({ sf: 1500, ef: 1550, nodeId: "gone", name: tag(99) });
	// 8은 V5로 옮김
	x.clips = x.clips.filter((c) => c.nodeId !== "n8");
	const rep = run(x, [{ i: 4, locked: false, clips: [{ sf: 800, ef: 850, nodeId: "n8", name: tag(8) }] }]);
	assert.deepEqual(cats(rep), [["stale", 7], ["moved", 8], ["orphan", 99]]);
	assert.deepEqual([rep.counts.stale, rep.counts.orphan, rep.counts.ok], [1, 1, 9]);
	const st = rep.items.find((i) => i.cat === "stale");
	assert.deepEqual([st.g, st.label, st.nodeId], [0, "C1·7", "old7"]);
	assert.equal(rep.items.find((i) => i.cat === "orphan").label, null);
	assert.equal(rep.items.find((i) => i.cat === "moved").detail, "V3 33.37~35.45 → V5 33.37~35.45");
});

test("네이티브 줄: 텍스트로 확인할 수 없다 → 다른 분류가 없으면 정상이 아니라 확인 불가(네이티브), 요약 글 끝에 붙는다", () => {
	const x = base();
	x.rows[0].preset = NATIVE;
	x.details.n1 = { found: true, kind: "native", pin: "", texts: [""], lay: { n: 1 }, deco: { comps: 3, keyed: ["Opacity"] } };
	x.ap[SALT + "-1"].k = "native";
	x.ap[SALT + "-1"].rh = core.textsHash(["다른 문장"]);
	const rep = run(x);
	assert.deepEqual(rep.items, [], "네이티브는 문장·템플릿 키(배우지 않은 기본 키)로 고침·효과를 판정하지 않는다");
	assert.deepEqual([rep.counts.ok, rep.counts.native], [9, 1]);
	assert.match(rep.text, / · 확인 불가\(네이티브\) 1$/);
});

test("salt가 없으면 우리 클립을 알아볼 수 없다: 모든 줄이 미적용 (태그 클립은 다른 salt라 목록에 없는 클립도 아니다)", () => {
	const x = base();
	const scan = { frameTicks: String(FT), tracks: [{ i: 2, clips: x.clips }] };
	const rep = plain(core.verifyReport({ rows: x.rows, mi: { salt: "", applied: {} }, scan, details: x.details, plan: null }));
	assert.equal(rep.counts.unapplied, 10);
	assert.equal(rep.counts.orphan, 0);
});
