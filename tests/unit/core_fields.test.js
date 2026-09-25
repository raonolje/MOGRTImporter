"use strict";
// S1-1 core: 텍스트 필드 ID, 구조 서명, 이름 쓰기(namedParams), v27 위험 판정, 텍스트 값, 포인트 규칙, 프리셋 id
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/mi/core.ts"]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── (4)~(8) 필드 ID ──
test("preset_1 (현재 15속성): T1 캡션 idx4, T2 idx6, T3 idx8", () => {
	const { presets } = build();
	const p1 = presets.preset_1;
	assert.deepEqual(plain(core.fieldIdMap(p1.params, p1.textParamIndex)), [
		{ fid: "T1", index: 4, displayName: "전체 텍스트", caption: true },
		{ fid: "T2", index: 6, displayName: "포인트 텍스트" },
		{ fid: "T3", index: 8, displayName: "서브 포인트 텍스트" }
	]);
	assert.equal(core.captionFid(p1), "T1");
	assert.equal(core.fieldSignature(p1.params), "T1=전체 텍스트|T2=포인트 텍스트|T3=서브 포인트 텍스트");
	// ID는 index+1이 아니다
	assert.notEqual(core.textFields(p1.params)[0].index + 1, 1);
});

test("옛 8속성 줄: T1 → idx0 '전체 텍스트' (서수·이름 일치)", () => {
	const { presets, STALE_1 } = build();
	const r = core.resolveFid(STALE_1, "T1", presets.preset_1.params);
	assert.equal(r.index, 0);
	assert.equal(r.displayName, "전체 텍스트");
	assert.equal(r.how, "ordinal");
	assert.equal(r.param, STALE_1[0], "param은 줄 목록의 바로 그 객체");
	assert.equal(core.resolveFid(STALE_1, "T2", presets.preset_1.params).index, 2);
	assert.equal(core.resolveFid(STALE_1, "T3", presets.preset_1.params).index, 4);
	assert.equal(core.resolveFid(STALE_1, "T4", presets.preset_1.params), null);
	// 텍스트가 아닌 속성이 늘어도 T-ID는 같다
	assert.equal(core.fieldSignature(STALE_1), core.fieldSignature(presets.preset_1.params));
});

test("resolveFid: 텍스트 순서가 바뀌면 이름으로, 이름도 없으면 null", () => {
	const { presets, helpers } = build();
	const pre = presets.preset_3.params; // T1 텍스트, T2 포인트 텍스트
	const row = [helpers.T(0, "포인트 텍스트", "p"), helpers.T(1, "텍스트", "t"), helpers.C(2, "밴드 색상")];
	const t1 = core.resolveFid(row, "T1", pre);
	const t2 = core.resolveFid(row, "T2", pre);
	assert.deepEqual([t1.index, t1.how, t2.index, t2.how], [1, "name", 0, "name"]);
	const renamed = [helpers.T(0, "본문", "t"), helpers.T(1, "포인트 텍스트", "p")];
	assert.equal(core.resolveFid(renamed, "T1", pre), null, "이름이 바뀐 캡션 필드는 해석하지 않는다");
	assert.equal(core.resolveFid(renamed, "T2", pre).index, 1);
	// 프리셋 없이: 줄 자신의 서수
	assert.equal(core.resolveFid(renamed, "T1", null).index, 0);
	// 같은 이름 두 개: 서수 일치가 먼저, 남은 것은 쓰이지 않은 것부터
	const dupPre = [helpers.T(0, "텍스트", ""), helpers.T(1, "텍스트", ""), helpers.T(2, "꼬리", "")];
	const dupRow = [helpers.T(0, "꼬리", ""), helpers.T(1, "텍스트", ""), helpers.T(2, "텍스트", "")];
	const all = core.resolveFields(dupRow, dupPre);
	assert.deepEqual([all.T1.index, all.T2.index, all.T3.index], [2, 1, 0]);
	assert.deepEqual([all.T1.how, all.T2.how, all.T3.how], ["name", "ordinal", "name"]);
});

test("resolveFields: 둘 다 네이티브면 이름이 달라도 서수로 짝짓는다 ('텍스트 N' 줄 ↔ definition 이름 프리셋)", () => {
	const nat = (names) => names.map((n, i) => ({ index: i, displayName: n, type: "text", value: "v" + i, rawValue: "", nativeText: true }));
	const row = nat(["텍스트 1", "텍스트 2"]);
	const pre = nat(["Insert Name Here", "ADD TITLE HERE"]);
	const all = core.resolveFields(row, pre);
	assert.deepEqual(Object.keys(all), ["T1", "T2"]);
	assert.deepEqual([all.T1.index, all.T1.how, all.T2.index, all.T2.how], [0, "ordinal", 1, "ordinal"]);
	assert.equal(all.T2.param, row[1], "param은 줄 목록의 바로 그 객체");
	assert.equal(core.layoutMismatch(row, pre), false, "네이티브는 텍스트 개수만 본다");
	// 줄의 텍스트 필드가 모자라면 그 ID만 빠진다
	assert.deepEqual(Object.keys(core.resolveFields(nat(["텍스트 1"]), pre)), ["T1"]);
	// 한쪽만 네이티브면 이름 규칙 그대로
	const { helpers } = build();
	assert.deepEqual(Object.keys(core.resolveFields([helpers.T(0, "텍스트 1", ""), helpers.T(1, "본문", "")], pre)), []);
});

test("preset_2·3·6·8·4: 필드 ID와 캡션", () => {
	const { presets } = build();
	assert.deepEqual(plain(core.fieldIdMap(presets.preset_2.params, 0)).map((f) => [f.fid, f.index, !!f.caption]),
		[["T1", 0, true], ["T2", 2, false], ["T3", 8, false], ["T4", 9, false]]);
	assert.equal(core.fieldIdMap(presets.preset_2.params, 0)[2].displayName, "Text_02");
	assert.equal(core.captionFid(presets.preset_3), "T1");
	assert.equal(core.fieldSignature(presets.preset_3.params), "T1=텍스트|T2=포인트 텍스트");
	assert.deepEqual(plain(core.fieldIdMap(presets.preset_6.params, 0)).map((f) => [f.fid, f.index]),
		[["T1", 0], ["T2", 1], ["T3", 2], ["T4", 3]]);
	assert.equal(core.captionFid(presets.preset_6), "T1");
	assert.equal(core.captionFid(presets.preset_8), null);
	assert.equal(core.textFields(presets.preset_8.params).length, 5);
	assert.equal(core.fieldIdMap(presets.preset_8.params, -1).some((f) => f.caption), false);
	assert.equal(core.captionFid(presets.preset_4), null);
	assert.deepEqual(plain(core.textFields(presets.preset_4.params)), []);
	assert.equal(core.captionFid(null), null);
	// textParamIndex가 텍스트가 아닌 속성을 가리키면 null
	assert.equal(core.captionFid(Object.assign(clone(presets.preset_3), { textParamIndex: 3 })), null);
});

test("네이티브 목록: T1, T2", () => {
	const { NATIVE } = build();
	assert.deepEqual(plain(core.fieldIdMap(NATIVE, 0)), [
		{ fid: "T1", index: 0, displayName: "텍스트 1", caption: true },
		{ fid: "T2", index: 1, displayName: "텍스트 2" }
	]);
	assert.equal(core.isNativeList(NATIVE), true);
	assert.equal(core.paramSig(NATIVE), core.fnv1a32("n:2"));
});

// ── (9) 구조 비교와 v27 위험 ──
test("layoutMismatch·isV27Unsafe: 옛 구조 줄은 참, 현재 구조 줄은 거짓", () => {
	const { presets, STALE_1 } = build();
	const p1 = presets.preset_1;
	assert.equal(core.layoutMismatch(STALE_1, p1.params), true);
	assert.equal(core.layoutMismatch(clone(p1.params), p1.params), false);
	assert.equal(core.isV27Unsafe({ presetId: "preset_1", params: [], _allParams: STALE_1 }, p1), true);
	const fresh = { presetId: "preset_1", params: [], _allParams: clone(p1.params) };
	assert.equal(core.isV27Unsafe(fresh, p1), false);
	// 값만 다르면 같은 구조
	fresh._allParams[4].value = "다른 문장";
	fresh._allParams[1].colorHex = "#123456";
	assert.equal(core.isV27Unsafe(fresh, p1), false);
	// definition 패치의 number → dropdown 차이는 같은 속성
	const patched = clone(p1.params);
	patched[13].type = "number";
	assert.equal(core.layoutMismatch(patched, p1.params), false);
	// ap.ps가 지금 서명과 다르면 위험, 같으면 안전
	assert.equal(core.isV27Unsafe(Object.assign({}, fresh, { ap: { ps: core.paramSig(STALE_1) } }), p1), true);
	assert.equal(core.isV27Unsafe(Object.assign({}, fresh, { ap: { ps: core.paramSig(p1.params) } }), p1), false);
	assert.equal(core.isV27Unsafe(Object.assign({}, fresh, { psOld: "77aa01bc" }), p1), true);
	// 프리셋이 없거나 속성이 비었으면 v27도 index로 쓰지 않는다
	assert.equal(core.isV27Unsafe({ presetId: "", params: [], _allParams: [] }, null), false);
	assert.equal(core.isV27Unsafe({ presetId: "preset_1", params: [], _allParams: [] }, p1), false);
	// _allParams 없이 노출 속성만 있는 줄: 그 index가 프리셋과 같은 속성인지 본다
	assert.equal(core.isV27Unsafe({ presetId: "preset_1", params: [clone(p1.params[4])], _allParams: [] }, p1), false);
	assert.equal(core.isV27Unsafe({ presetId: "preset_1", params: [clone(STALE_1[0])], _allParams: [] }, p1), true);
});

test("paramSig·clipLs: 배열 순서·값과 무관, 이름·텍스트 여부에는 민감", () => {
	const { presets, STALE_1 } = build();
	const p = presets.preset_1.params;
	const sig = core.paramSig(p);
	assert.match(sig, /^[0-9a-f]{8}$/);
	assert.equal(core.paramSig(clone(p).reverse()), sig);
	const renamed = clone(p);
	renamed[6].displayName = "포인트";
	assert.notEqual(core.paramSig(renamed), sig);
	assert.notEqual(core.paramSig(STALE_1), sig);
	assert.equal(core.paramSig([{ index: 0, type: "text", displayName: "가" }]), core.fnv1a32("0:t:가"));
	assert.equal(core.clipLs([["가", "t"], ["색", "o"]]), core.fnv1a32("0:t:가|1:o:색"));
	assert.equal(core.clipLs({ n: 2 }), core.fnv1a32("n:2"));
	assert.equal(core.clipLs(null), "");
});

// ── (10) namedParams ──
test("namedParams: 이름이 유일한 text·color·number 등은 index -1, comment·textsetting·중복·네이티브는 그대로", () => {
	const { presets, NATIVE, helpers } = build();
	const src = clone(presets.preset_1.params);
	src.push(helpers.TS(15, "텍스트 세팅"));
	src.push(helpers.N(16, "박스 가로 여백", 10)); // 이름 중복
	const before = clone(src);
	const out = plain(core.namedParams(src));
	assert.deepEqual(src, before, "입력은 바꾸지 않는다");
	const byName = (nm, i) => out.filter((p) => p.displayName === nm)[i || 0];
	for (const nm of ["전체 텍스트", "포인트 텍스트", "서브 포인트 텍스트", "박스 색상", "강조 색상", "박스 세로 여백", "자동 줄바꿈", "최대 너비", "정렬", "그림자 각도"]) {
		assert.equal(byName(nm).index, -1, nm);
	}
	assert.equal(byName("포인트 텍스트 구분 방법").index, 10, "comment");
	assert.equal(byName("스타일").index, 0, "group");
	assert.equal(byName("텍스트 세팅").index, 15, "textsetting");
	assert.equal(byName("박스 가로 여백", 0).index, 2, "중복 이름 1");
	assert.equal(byName("박스 가로 여백", 1).index, 16, "중복 이름 2");
	// 값과 나머지 필드는 그대로
	assert.equal(byName("전체 텍스트").rawValue, before[4].rawValue);
	assert.deepEqual(plain(core.namedParams(NATIVE)), NATIVE, "네이티브는 서수로만 쓴다");
	assert.deepEqual(plain(core.namedParams([])), []);
});

// ── (11) setTextValue ──
test("setTextValue: value, textEditValue, fontTextRunLength", () => {
	const { helpers } = build();
	const p = helpers.T(4, "전체 텍스트", "옛 문장");
	const ret = core.setTextValue(p, "새 문장\n둘째 줄");
	assert.equal(ret, p);
	assert.equal(p.value, "새 문장\n둘째 줄");
	const raw = JSON.parse(p.rawValue);
	assert.equal(raw.textEditValue, "새 문장\n둘째 줄");
	assert.deepEqual(raw.fontTextRunLength, [9]);
	assert.deepEqual(raw.fontEditValue, ["NanumSquareRoundOTF"], "다른 필드는 그대로");
	// 기본 줄바꿈 규칙: LF 그대로 (S0-3 d 전)
	assert.equal(core.AE_NEWLINE, "\n");
	// aeNewline 옵션은 AE 텍스트에만
	const q = helpers.T(0, "텍스트", "");
	core.setTextValue(q, "가\r\n나\n다", { aeNewline: "\r" });
	assert.equal(q.value, "가\r나\r다");
	assert.equal(JSON.parse(q.rawValue).textEditValue, "가\r나\r다");
	const nat = { index: 0, displayName: "텍스트 1", type: "text", value: "", rawValue: "", nativeText: true };
	core.setTextValue(nat, "가\n나", { aeNewline: "\r" });
	assert.deepEqual([nat.value, nat.rawValue], ["가\n나", ""]);
	// rawValue가 JSON이 아니거나 textEditValue가 없으면 value만
	const odd = { index: 1, type: "text", value: "", rawValue: "{\"textEditValue\":" };
	core.setTextValue(odd, "가");
	assert.deepEqual([odd.value, odd.rawValue], ["가", "{\"textEditValue\":"]);
	const noRun = { index: 1, type: "text", value: "", rawValue: JSON.stringify({ textEditValue: "x" }) };
	core.setTextValue(noRun, "가나");
	assert.deepEqual(JSON.parse(noRun.rawValue), { textEditValue: "가나" });
	assert.equal(core.setTextValue(null, "x"), null);
});

// ── (12) pointSegmentsOk, (13) ruleMaxFromComments ──
test("pointSegmentsOk: 조각이 캡션에 그대로 있는지, 없는 조각, 두 번 나오는 조각, 개수 상한", () => {
	const cap = "오늘 날씨가 좋고 하늘이 맑다, 하늘 아래";
	assert.deepEqual(plain(core.pointSegmentsOk("날씨$$맑다", cap)), { ok: true, segs: ["날씨", "맑다"], missing: [], dup: [], tooMany: false });
	const miss = plain(core.pointSegmentsOk("날씨$$구름", cap));
	assert.deepEqual([miss.ok, miss.missing], [false, ["구름"]]);
	const dup = plain(core.pointSegmentsOk("하늘", cap));
	assert.deepEqual([dup.ok, dup.dup], [true, ["하늘"]]);
	assert.equal(core.pointSegmentsOk("", cap).ok, false, "빈 값은 포인트 텍스트가 아니다");
	assert.deepEqual(plain(core.pointSegmentsOk("날씨$$", cap)).segs, ["날씨"]);
	const many = plain(core.pointSegmentsOk("오늘$$날씨$$하늘$$아래", cap, 3));
	assert.deepEqual([many.ok, many.tooMany, many.missing.length], [false, true, 0]);
	assert.equal(core.pointSegmentsOk("한글".normalize("NFD"), "한글 문장").ok, true, "NFC로 비교");
});

test("ruleMaxFromComments: '최대 3개' → 3, 규칙이 없으면 null", () => {
	const { presets, helpers } = build();
	assert.equal(core.ruleMaxFromComments(presets.preset_3.params), 3);
	assert.equal(core.ruleMaxFromComments(presets.preset_6.params), 3);
	assert.equal(core.ruleMaxFromComments(presets.preset_4.params), null);
	assert.equal(core.ruleMaxFromComments([helpers.CM(0, "최대 5개", ""), helpers.CM(1, "설명", "최대 2 개까지")]), 2);
	// comment가 아니면 보지 않는다
	assert.equal(core.ruleMaxFromComments([helpers.T(0, "최대 3개", "최대 3개")]), null);
});

// ── (14) nextFreePresetId ──
test("nextFreePresetId: 실제 데이터 모양 → preset_9, 다음은 preset_10 (빈 번호를 메우지 않는다)", () => {
	const { presets } = build();
	const trash = [{ preset: Object.assign(clone(presets.preset_2), { name: "FHD_모션없는 그라데이션 텍스트" }), deletedAt: "2026-06-01T00:00:00.000Z" }];
	const first = plain(core.nextFreePresetId(presets, trash, ["preset_1", "preset_3"], 2));
	assert.deepEqual(first, { id: "preset_9", next: 10 });
	const all = Object.assign({}, presets, { preset_9: Object.assign(clone(presets.preset_2), { id: "preset_9" }) });
	assert.deepEqual(plain(core.nextFreePresetId(all, trash, new Set(["preset_1"]), first.next)), { id: "preset_10", next: 11 });
	// 저장된 카운터가 더 크면 그것을 따른다
	assert.deepEqual(plain(core.nextFreePresetId({}, [], [], 42)), { id: "preset_42", next: 43 });
	// 행·휴지통이 가리키는 id도 피한다 (프리셋이 지워져도)
	assert.deepEqual(plain(core.nextFreePresetId({}, [], ["preset_17", "", null, "preset_x"], 1)), { id: "preset_18", next: 19 });
	assert.deepEqual(plain(core.nextFreePresetId(null, null, null, undefined)), { id: "preset_1", next: 2 });
	// 배열 입력
	assert.equal(core.nextFreePresetId(["preset_3", { id: "preset_5" }], [], [], 1).id, "preset_6");
});

// ── S1-6: 네이티브 텍스트 필드 이름 (S0-3 결정 4) ──

test("nativeTextLabels: TextLayer(type 6) 순서대로 기본 문구, UI 로캘 → en_US → 첫 항목, 개수가 다르면 null", () => {
	const layer = (en, ko) => ({ type: 6, uiName: "TextLayer", value: { strDB: [{ localeString: "en_US", str: en }].concat(ko ? [{ localeString: "ko_KR", str: ko }] : []) } });
	const def = { clientControls: [layer("Insert Name Here", "이름을 넣으세요"), { type: 2, uiName: "Color" }, layer("ADD TITLE HERE")] };
	assert.deepEqual(plain(core.nativeTextLabels(def, 2, "")), ["Insert Name Here", "ADD TITLE HERE"]);
	assert.deepEqual(plain(core.nativeTextLabels(def, 2, "ko_KR")), ["이름을 넣으세요", "ADD TITLE HERE"], "UI 로캘 우선, 없으면 en_US");
	assert.deepEqual(plain(core.nativeTextLabels(def, 2, "ko-KR")), ["이름을 넣으세요", "ADD TITLE HERE"], "ko-KR도 같다");
	assert.equal(core.nativeTextLabels(def, 3, ""), null, "개수가 다르면 일반 이름 그대로");
	assert.equal(core.nativeTextLabels(def, 0, ""), null);
	assert.equal(core.nativeTextLabels({}, 2, ""), null);
	assert.equal(core.nativeTextLabels(null, 2, ""), null);
	// en_US가 없으면 첫 항목, 줄바꿈은 " / ", 빈 문구는 '텍스트 k', 같은 이름은 (2), 40자에서 자른다
	const odd = { clientControls: [
		{ type: 6, value: { strDB: [{ localeString: "fr_FR", str: "Ligne 1\rLigne 2" }] } },
		{ type: "6", value: { strDB: [{ localeString: "en_US", str: "  " }] } },
		{ type: 6, value: "Title" },
		{ type: 6, value: { strDB: [{ localeString: "en_US", str: "Title" }] } },
		{ type: 6, value: { strDB: [{ localeString: "en_US", str: "x".repeat(60) }] } }
	] };
	assert.deepEqual(plain(core.nativeTextLabels(odd, 5, "")), ["Ligne 1 / Ligne 2", "텍스트 2", "Title", "Title (2)", "x".repeat(39) + "…"]);
});

test("nativeTextDefaults: 라벨과 같은 규칙으로 고른 원문 기본 문구 (줄바꿈 LF, 자르거나 번호를 붙이지 않음)", () => {
	const layer = (en, ko) => ({ type: 6, value: { strDB: [{ localeString: "en_US", str: en }].concat(ko ? [{ localeString: "ko_KR", str: ko }] : []) } });
	const def = { clientControls: [layer("Insert Name Here", "이름을 넣으세요"), { type: 2 }, layer("LINE ONE\rLINE TWO"), layer("Title"), layer("Title")] };
	assert.deepEqual(plain(core.nativeTextDefaults(def, 4, "")), ["Insert Name Here", "LINE ONE\nLINE TWO", "Title", "Title"]);
	assert.deepEqual(plain(core.nativeTextDefaults(def, 4, "ko_KR")).slice(0, 1), ["이름을 넣으세요"]);
	assert.equal(core.nativeTextDefaults(def, 3, ""), null, "개수가 다르면 null");
	assert.equal(core.nativeTextDefaults(null, 1, ""), null);
});
