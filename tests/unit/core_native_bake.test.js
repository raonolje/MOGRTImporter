"use strict";
// S1-11 core: 네이티브 MOGRT 굽기 — 블롭 왕복(한글), 여러 TextLayer 순서, 같은 문구 → 같은 키·UUID, definition 패치,
// prproj XML(지역화 이름·빈 요소 참조·BinaryHash), 지울 자리 계획
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");
const N = require("../fixtures/mogrt/make_native_mogrt");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/mi/core.ts"]);
const b64 = (s) => Buffer.from(s).toString("base64");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 블롭 JSON (mText 빼고) — 다른 값이 그대로인지 본다
function blobJson(b64s) {
	const b = Buffer.from(b64s, "base64");
	const n = b.readUInt32LE(0);
	const j = JSON.parse(b.subarray(8, 8 + n).toString("utf16le"));
	delete j.mTextParam.mStyleSheet.mText;
	return j;
}

test("nativeBakeText·nativeTexts·nativeRowTexts: 줄바꿈은 CR, index 순, 줄 값 ← 캡션 ← 프리셋 값", () => {
	assert.equal(core.nativeBakeText("가\n나\r\n다\r라"), "가\r나\r다\r라");
	assert.equal(core.nativeBakeText(null), "");
	const { NATIVE } = build();
	const list = JSON.parse(JSON.stringify(NATIVE)).reverse();
	list[0].value = "둘째 합성";
	list[1].value = "첫째 합성";
	assert.deepEqual(plain(core.nativeTexts(list)), ["첫째 합성", "둘째 합성"], "배열 순서가 아니라 index 순");
	const preset = JSON.parse(JSON.stringify(NATIVE));
	preset[1].value = "프리셋 둘째";
	assert.deepEqual(plain(core.nativeRowTexts([], preset, 0, "캡션 합성")), ["캡션 합성", "프리셋 둘째"], "빈 줄: 프리셋 + 캡션");
	const row = JSON.parse(JSON.stringify(NATIVE));
	row[0].value = "줄 캡션 합성";
	row[1].value = "줄 후반 작업";
	assert.deepEqual(plain(core.nativeRowTexts(row, preset, 0, "SRT 문장")), ["줄 캡션 합성", "줄 후반 작업"], "줄 값이 이긴다");
	assert.deepEqual(plain(core.nativeRowTexts([row[1]], preset, 0, "SRT 문장")), ["SRT 문장", "줄 후반 작업"], "노출 속성만 있는 줄: 빠진 필드는 캡션·프리셋 값");
	assert.deepEqual(plain(core.nativeRowTexts(row, preset, -1, "SRT")), ["줄 캡션 합성", "줄 후반 작업"], "캡션 필드 없음");
});

test("b64ToBytes·bytesToB64: Buffer와 같다 (0~10바이트, 공백·= 무시, 알파벳 밖 글자는 null)", () => {
	const src = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 128]);
	for (let n = 0; n <= src.length; n++) {
		const s = src.subarray(0, n);
		assert.equal(core.bytesToB64(s), s.toString("base64"), "encode " + n);
		assert.deepEqual(Buffer.from(core.b64ToBytes(s.toString("base64"))), s, "decode " + n);
	}
	assert.deepEqual(Buffer.from(core.b64ToBytes("AAEC\n+vv8")), Buffer.from([0, 1, 2, 250, 251, 252]));
	assert.equal(core.b64ToBytes("AA*A"), null);
	assert.equal(core.b64ToBytes("가나"), null);
});

test("jsonParseKeepNumbers·jsonStringifyKeepNumbers: int64·1.0·지수 표기를 글자 그대로 되쓴다 (문자열 안은 그대로)", () => {
	const text = "{\"a\": 9223372036854775807, \"b\": 1.0, \"c\": 171.86990356445313, \"d\": \"x 1.0 \\\" 9223372036854775807 \\\\\", \"e\": [1e-7, -0.5, 1E5, 0, -12], \"f\": {\"g\": true, \"h\": null}}";
	const o = core.jsonParseKeepNumbers(text);
	assert.equal(o.d, "x 1.0 \" 9223372036854775807 \\", "문자열 안의 숫자·이스케이프");
	assert.equal(o.f.g, true);
	assert.equal(core.jsonStringifyKeepNumbers(o), text.replace(/(": |, )/g, (m) => m.trim()), "공백 말고 같은 글자");
	assert.equal(core.jsonStringifyKeepNumbers(core.jsonParseKeepNumbers("\uFEFF[1, 2.50]")), "[1,2.50]", "BOM");
	assert.throws(() => core.jsonParseKeepNumbers("{\"a\": }"));
});

test("Source Text 블롭 왕복: 한글·줄바꿈(CR)·길이 머리를 고치고 나머지 JSON 값과 꼬리 바이트는 그대로", () => {
	const orig = N.textBlob("Insert Name Here");
	const r = core.readSourceTextBlob(orig);
	assert.equal(r.text, "Insert Name Here");
	const nb = core.patchSourceTextBlob(orig, "한글 첫 줄\n둘째 줄 🎬");
	assert.equal(N.blobText(nb), "한글 첫 줄\r둘째 줄 🎬", "따로 쓴 디코더로 읽는다");
	assert.equal(core.readSourceTextBlob(nb).text, "한글 첫 줄\r둘째 줄 🎬");
	const b = Buffer.from(nb, "base64");
	assert.equal(Number(b.readBigUInt64LE(0)), b.length - 8, "8바이트 LE 길이 = 본문 바이트 수");
	assert.deepEqual(blobJson(nb), blobJson(orig), "mText 말고 그대로");
	assert.match(b.subarray(8).toString("utf16le"), /"mShadowAngle":171\.86990356445313,/, "숫자 글자 그대로 (JS는 …312로 쓴다)");
	// 꼬리 바이트가 있는 블롭
	const withTail = Buffer.concat([Buffer.from(orig, "base64"), Buffer.from([9, 8, 7])]).toString("base64");
	const nt = Buffer.from(core.patchSourceTextBlob(withTail, "꼬리 합성"), "base64");
	assert.deepEqual(nt.subarray(nt.length - 3), Buffer.from([9, 8, 7]));
	assert.equal(N.blobText(nt.toString("base64")), "꼬리 합성");
	assert.equal(core.patchSourceTextBlob(nb, ""), core.patchSourceTextBlob(orig, ""), "빈 문구도 된다 (같은 결과)");
	assert.equal(N.blobText(core.patchSourceTextBlob(orig, "")), "");
});

test("텍스트 블롭이 아니면 null: 이진 Path, mTextParam 없는 JSON, 새 형식(이진) Source Text, 길이가 맞지 않음", () => {
	assert.equal(core.readSourceTextBlob(N.pathBlob()), null);
	assert.equal(core.readSourceTextBlob(N.appearanceBlob()), null);
	assert.equal(core.readSourceTextBlob(N.binaryTextBlob("텍스트에 따라 움직이는 합성")), null);
	assert.equal(core.patchSourceTextBlob(N.binaryTextBlob("합성"), "x"), null);
	const bad = Buffer.from(N.textBlob("합성"), "base64");
	bad.writeUInt32LE(bad.length, 0);
	assert.equal(core.readSourceTextBlob(bad.toString("base64")), null, "길이가 본문보다 길다");
	assert.equal(core.readSourceTextBlob(""), null);
	assert.equal(core.readSourceTextBlob(b64("짧음")), null);
});

test("patchPrprojTexts: Source Text 블롭을 문서 순서대로 바꾸고, 지역화 이름(소스 텍스트)도 내용으로 찾는다. 다른 블롭·참조는 그대로", () => {
	for (const name of ["Source Text", "소스 텍스트"]) {
		const xml = N.prprojXml(["기본 A", "기본 B"], { sourceTextName: name });
		const before = N.xmlTexts(xml);
		assert.deepEqual(before.texts, ["기본 A", "기본 B"]);
		const r = core.patchPrprojTexts(xml, ["구운 첫째 합성", "구운 둘째\n두 줄"]);
		assert.deepEqual([r.count, r.patched], [2, 2], name);
		const after = N.xmlTexts(r.xml);
		assert.deepEqual(after.texts, ["구운 첫째 합성", "구운 둘째\r두 줄"], name + " 순서");
		// BinaryHash: 새 값, 같은 모양, 끝 8자리 = 새 바이트 길이 + 12 (원래 차이)
		after.hashes.forEach((x, k) => {
			assert.match(x.h, HASH_RE);
			assert.notEqual(x.h, before.hashes[k].h, "새 해시");
			assert.equal(parseInt(x.h.slice(-8), 16), x.len + 12, "끝 8자리 = 길이 + 12");
		});
		// 텍스트가 아닌 블롭(Path 온전한 요소·빈 요소 참조, Appearance)은 글자 그대로
		const strip = (s) => s.replace(/<StartKeyframeValue[^>]*?(?:\/>|>[^<]*<\/StartKeyframeValue>)/g, (m) => (N.blobText((/>([^<]*)</.exec(m) || [])[1] || "") === null ? m : "<T/>"));
		assert.equal(strip(r.xml), strip(xml), "텍스트 블롭 말고는 그대로");
		assert.deepEqual(after.refs, before.refs, "Path 참조 그대로");
		after.refs.forEach((h) => assert.ok(h in after.full, "끊긴 참조 없음: " + h));
	}
	const one = core.patchPrprojTexts(N.prprojXml(["기본 A", "기본 B"]), ["하나만 합성"]);
	assert.deepEqual([one.count, one.patched], [2, 1]);
	assert.deepEqual(N.xmlTexts(one.xml).texts, ["하나만 합성", "기본 B"], "모자란 문구의 필드는 그대로");
	const bin = core.patchPrprojTexts(N.prprojXml(["새 형식 A"], { format: "binary" }), ["x"]);
	assert.deepEqual([bin.count, bin.patched], [0, 0], "새 형식(이진)은 찾지 못한다 → 패널이 굽지 않는다");
});

test("patchPrprojTexts 빈 요소 참조: 같은 기본 문구를 가리키던 두 번째 필드도 제 문구를 받고, 끊긴 참조가 없다", () => {
	const xml = N.prprojXml(["같은 기본 문구", "같은 기본 문구"], { selfRef: true });
	const before = N.xmlTexts(xml);
	assert.deepEqual(before.hashes.map((x) => x.ref), [false, true], "픽스처: 두 번째는 빈 요소");
	const r = core.patchPrprojTexts(xml, ["첫째 합성", "둘째 합성"]);
	assert.deepEqual([r.count, r.patched], [2, 2]);
	const after = N.xmlTexts(r.xml);
	assert.deepEqual(after.texts, ["첫째 합성", "둘째 합성"]);
	assert.deepEqual(after.hashes.map((x) => x.ref), [false, false], "제 내용을 채운 요소");
	assert.notEqual(after.hashes[0].h, after.hashes[1].h);
	after.refs.forEach((h) => assert.ok(h in after.full, "끊긴 참조 없음"));
	// 문구가 하나뿐이면 두 번째(빈 요소)는 원래 내용으로 채운다 (첫째의 해시가 바뀌어 끊기지 않게)
	const r1 = core.patchPrprojTexts(xml, ["첫째만 합성"]);
	const a1 = N.xmlTexts(r1.xml);
	assert.deepEqual(a1.texts, ["첫째만 합성", "같은 기본 문구"]);
	assert.equal(a1.hashes[1].h, before.hashes[0].h, "원래 해시·내용");
	a1.refs.forEach((h) => assert.ok(h in a1.full, "끊긴 참조 없음"));
	assert.equal(core.patchPrprojTexts(xml, ["같은 문구 합성", "같은 문구 합성"]).xml.match(/BinaryHash="[^"]*">/g).length, 4, "Path·Appearance 하나씩 + 텍스트 2개가 온전한 요소 (두 번째 Path는 참조 그대로)");
});

test("patchNativeDefinition: capsuleID, [MI] 꼬리(한 번), 지역화 이름, TextLayer 순서, 다른 컨트롤·int64·1.0 그대로", () => {
	const text = N.definitionJson(["기본 이름 칸", "기본 제목 칸"]);
	assert.match(text, /"ticksperframe": 9223372036854775807/);
	const r = core.patchNativeDefinition(text, ["구운 이름 합성", "구운 제목\n두 줄"], "11111111-2222-4333-8444-555555555555");
	assert.deepEqual([r.textLayers, r.patched], [2, 2]);
	assert.match(r.json, /"ticksperframe":9223372036854775807[,}]/, "int64 글자 그대로");
	assert.match(r.json, /"scale":1\.0[,}]/, "1.0 그대로");
	const d = JSON.parse(r.json);
	assert.equal(d.capsuleID, "11111111-2222-4333-8444-555555555555");
	assert.equal(d.capsuleName, "합성 네이티브 [MI]");
	assert.deepEqual(d.capsuleNameLocalized.strDB.map((e) => e.str), ["합성 네이티브 [MI]", "합성 네이티브 (한국어) [MI]"]);
	const layers = d.clientControls.filter((c) => c.type === 6);
	assert.deepEqual(layers.map((c) => c.value.strDB.map((e) => e.str)), [["구운 이름 합성", "구운 이름 합성"], ["구운 제목\r두 줄", "구운 제목\r두 줄"]], "모든 로캘, 줄바꿈 CR");
	const orig = JSON.parse(text);
	assert.deepEqual(d.clientControls.filter((c) => c.type !== 6), orig.clientControls.filter((c) => c.type !== 6), "다른 컨트롤 그대로");
	// 두 번 구워도 꼬리는 하나
	const again = JSON.parse(core.patchNativeDefinition(r.json, ["x", "y"], "").json);
	assert.equal(again.capsuleName, "합성 네이티브 [MI]");
	assert.equal(again.capsuleID, d.capsuleID, "capsuleId가 비면 그대로");
	// 문구가 모자라면 남은 TextLayer는 그대로, 글자 value
	const partial = core.patchNativeDefinition("{\"clientControls\": [{\"type\": 6, \"value\": \"옛 글자\"}, {\"type\": 6, \"value\": \"그대로\"}]}", ["새 글자 합성"], "u");
	assert.deepEqual(JSON.parse(partial.json).clientControls.map((c) => c.value), ["새 글자 합성", "그대로"]);
	assert.deepEqual([partial.textLayers, partial.patched], [2, 1]);
	assert.equal(core.patchNativeDefinition("[1, 2]", [], "u"), null);
	assert.equal(core.patchNativeDefinition("깨진 JSON", [], "u"), null);
});

test("nativeBakeKey·uuidFromHash: 같은 문구 → 같은 키·UUID, 문구·원본·수정 시각이 다르면 다르다", () => {
	const k = core.nativeBakeKey("D:/MOGRT/합성 네이티브.mogrt", 1727241234567.25, ["첫째 합성", "둘째 합성"]);
	assert.match(k, /^[0-9a-f]{32}$/);
	assert.equal(core.nativeBakeKey("D:\\MOGRT\\합성 네이티브.mogrt", 1727241234567, ["첫째 합성", "둘째 합성"]), k, "구분자·밀리초 아래는 같다");
	assert.equal(core.nativeBakeKey("D:/MOGRT/합성 네이티브.mogrt", 1727241234567, ["첫째 합성", "둘째 합성"]), k);
	assert.equal(core.nativeBakeKey("D:/a.mogrt", 1, ["가\r\n나"]), core.nativeBakeKey("D:/a.mogrt", 1, ["가\n나"]), "줄바꿈 모양은 같다 (CR로 굽는다)");
	const others = [
		core.nativeBakeKey("D:/MOGRT/합성 네이티브.mogrt", 1727241234567, ["첫째 합성", "둘째 합성 "]),
		core.nativeBakeKey("D:/MOGRT/합성 네이티브.mogrt", 1727241234567, ["둘째 합성", "첫째 합성"]),
		core.nativeBakeKey("D:/MOGRT/합성 네이티브.mogrt", 1727241299999, ["첫째 합성", "둘째 합성"]),
		core.nativeBakeKey("D:/MOGRT/다른 네이티브.mogrt", 1727241234567, ["첫째 합성", "둘째 합성"]),
		core.nativeBakeKey("D:/MOGRT/합성 네이티브.mogrt", 1727241234567, ["첫째 합성둘째 합성"])
	];
	others.forEach((o) => assert.notEqual(o, k));
	assert.equal(new Set(others).size, others.length);
	const u = core.uuidFromHash(k);
	assert.match(u, UUID_RE);
	assert.equal(core.uuidFromHash(k), u, "같은 해시 → 같은 UUID");
	assert.equal(u.replace(/-/g, "").slice(0, 12), k.slice(0, 12));
	assert.match(core.uuidFromHash("abc"), UUID_RE, "짧은 해시도 모양을 맞춘다");
	// 1,000개 문구에 겹치는 키가 없다
	const seen = new Set();
	for (let i = 0; i < 1000; i++) seen.add(core.nativeBakeKey("D:/a.mogrt", 5, ["합성 문장 " + i, ""]));
	assert.equal(seen.size, 1000);
});

test("nativeReplaceSpots: 처음(ap 없음)은 지금 자리, 같은 문구·자리는 없음, 문구·시간·트랙이 바뀌면 옛 자리도, AE 줄의 ap.nk", () => {
	const sub = (id, s, e) => ({ id, startSec: s, endSec: e });
	const K1 = "a".repeat(32);
	const K2 = "b".repeat(32);
	const spots = (rows) => plain(core.nativeReplaceSpots(rows));
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: {}, track: 2, nk: K1 }]), [{ t: 2, s: 2 }], "처음 (v27이 남긴 빈 네이티브 클립일 수 있다)");
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: { ap: { s: 2, e: 4, t: 2, nk: K1 } }, track: 2, nk: K1 }]), [], "같은 문구·자리 → v27이 끝만 맞춘다");
	assert.deepEqual(spots([{ sub: sub(1, 2.0004, 4), rs: { ap: { s: 2, e: 4, t: 2, nk: K1 } }, track: 2, nk: K1 }]), [], "0.5ms 안은 같은 자리");
	assert.deepEqual(spots([{ sub: sub(1, 2.03, 4), rs: { ap: { s: 2, e: 4, t: 2, nk: K1 } }, track: 2, nk: K1 }]), [{ t: 2, s: 2.03 }, { t: 2, s: 2 }],
		"30ms만 달라도 교체 (v27은 Math.round(시작×100) 키로 찾아 못 찾으면 옛 클립 위에 새로 놓는다)");
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: { ap: { s: 2, e: 4, t: 2, nk: K1 } }, track: 2, nk: K2 }]), [{ t: 2, s: 2 }], "문구가 바뀌면 교체");
	assert.deepEqual(spots([{ sub: sub(1, 3, 5), rs: { ap: { s: 2, e: 4, t: 2, nk: K1 } }, track: 2, nk: K1 }]), [{ t: 2, s: 3 }, { t: 2, s: 2 }], "시간이 바뀌면 옛 자리도");
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: { ap: { s: 2, e: 4, t: 1, nk: K1 } }, track: 2, nk: K1 }]), [{ t: 2, s: 2 }, { t: 1, s: 2 }], "트랙이 바뀌면 옛 트랙도");
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: { ap: { s: 2, e: 4, t: 2, cap: "x", ps: "p" } }, track: 2, nk: K1 }]), [{ t: 2, s: 2 }], "AE로 놓았던 줄을 네이티브로");
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: { ap: { s: 2, e: 4, t: 2, nk: K1 } }, track: 2, nk: null }]), [{ t: 2, s: 2 }], "네이티브로 놓았던 줄을 AE로 (v27이 네이티브 클립에 AE 속성을 쓰지 않게)");
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: { ap: { s: 2, e: 4, t: 2 } }, track: 2, nk: null }, { sub: sub(2, 6, 8), rs: {}, track: 2, nk: null }]), [], "AE 줄은 없음");
	assert.deepEqual(spots([{ sub: sub(1, 2, 4), rs: {}, track: 2, nk: K1 }, { sub: sub(2, 6, 8), rs: { ap: { s: 2, e: 4, t: 2, nk: K2 } }, track: 2, nk: K2 }]),
		[{ t: 2, s: 2 }, { t: 2, s: 6 }], "같은 자리는 한 번");
});

test("markApplied·apRecord: 네이티브 줄은 ap.nk (AE 줄은 없음)", () => {
	const { NATIVE } = build();
	const preset = { id: "preset_9", params: NATIVE, textParamIndex: 0 };
	const rs = { presetId: "preset_9", params: [], _allParams: JSON.parse(JSON.stringify(NATIVE)), mm: "text", mmPrev: { s: 1, e: 2, cap: "옛" } };
	rs._allParams[0].value = "캡션 합성";
	core.markApplied(rs, { id: 1, startSec: 1, endSec: 2, text: "캡션 합성" }, preset, 3, "c".repeat(32));
	assert.deepEqual(plain(rs.ap), { s: 1, e: 2, cap: "캡션 합성", ps: core.paramSig(rs._allParams), t: 3, nk: "c".repeat(32) });
	assert.equal(rs.mm, undefined);
	core.markApplied(rs, { id: 1, startSec: 1, endSec: 2, text: "캡션 합성" }, preset, 3);
	assert.equal(rs.ap.nk, undefined, "nk 없이 적으면 지운다 (AE로 놓았다)");
});

test("nativeApplyPlan 연쇄: 새로 놓는 클립 창(길이 + 0.5초) 안의 뒤 네이티브 클립 줄도 다시 놓는다 (대상 밖은 마지막 적용 그대로), AE·사본 없는 줄은 위험", () => {
	const sub = (id, s, e) => ({ id, startSec: s, endSec: e });
	const K = (c) => c.repeat(32);
	const ap = (s, e, nk, t) => ({ s, e, cap: "x", ps: "p", t: t === undefined ? 2 : t, nk });
	const row = (id, s, o) => Object.assign({ sub: sub(id, s, s + 2), rs: {}, target: true, native: true, nk: null, durSec: 0 }, o || {});
	const plan = (rows) => plain(core.nativeApplyPlan(rows, 2));
	// 바뀐 줄 1(2초) → 창 [2, 7.6): 3(5초)은 대상·그대로인 줄이지만 함께 다시 놓는다. 4(9초)는 3의 창 [5, 10.6) 안 → 연쇄. 5(20초)는 밖
	let p = plan([
		row(1, 2, { rs: { ap: ap(2, 4, K("a")) }, nk: K("b") }),
		row(3, 5, { rs: { ap: ap(5, 7, K("c")) }, nk: K("c") }),
		row(4, 9, { rs: { ap: ap(9, 11, K("d")) }, nk: K("d") }),
		row(5, 20, { rs: { ap: ap(20, 22, K("e")) }, nk: K("e") })
	]);
	assert.deepEqual(p.place, { 1: 2, 3: 5, 4: 9 });
	assert.deepEqual(p.spots, [{ t: 2, s: 2 }, { t: 2, s: 5 }, { t: 2, s: 9 }]);
	assert.deepEqual([p.extra, p.risk], [[], []]);
	// 대상 밖 네이티브 줄: 사본(nk = ap.nk)이 있으면 마지막 적용 자리 그대로 다시 놓고(extra), 없으면(null) 위험
	p = plan([
		row(1, 2, { rs: { ap: ap(2, 4, K("a")) }, nk: K("b") }),
		row(3, 5.5, { rs: { ap: ap(5, 7, K("c")) }, target: false, nk: K("c") }),
		row(4, 6, { rs: { ap: ap(6.5, 7.5, K("d")) }, target: false, nk: null })
	]);
	assert.deepEqual(p.place, { 1: 2, 3: 5 }, "대상 밖 줄은 ap.s에 (지금 시간 5.5가 아니라)");
	assert.deepEqual(p.extra, [3]);
	assert.deepEqual(p.risk, [4]);
	assert.deepEqual(p.spots, [{ t: 2, s: 2 }, { t: 2, s: 5 }]);
	// AE 줄(ap가 있다)은 위험, ap가 없는 줄은 자리를 몰라 빼고, 다른 트랙은 창 밖
	p = plan([
		row(1, 2, { nk: K("b") }),
		row(2, 3, { native: false, rs: { ap: ap(3, 4) } }),
		row(3, 4, { native: false }),
		row(4, 5, { rs: { ap: ap(5, 6, K("c"), 1) }, target: false, nk: K("c") })
	]);
	assert.deepEqual(p.place, { 1: 2 }, "처음 놓는 줄 (ap 없음)");
	assert.deepEqual(p.risk, [2]);
	assert.deepEqual(p.spots, [{ t: 2, s: 2 }]);
	// 그대로인 줄만 있으면 아무것도 하지 않는다. 템플릿 길이(durSec)가 길면 창도 길다
	assert.deepEqual(plan([row(1, 2, { rs: { ap: ap(2, 4, K("a")) }, nk: K("a") }), row(2, 4, { rs: { ap: ap(4, 6, K("c")) }, nk: K("c") })]),
		{ spots: [], place: {}, extra: [], risk: [] });
	p = plan([row(1, 2, { nk: K("b"), durSec: 9 }), row(2, 11, { rs: { ap: ap(11, 12, K("c")) }, nk: K("c") })]);
	assert.deepEqual(p.place, { 1: 2, 2: 11 }, "9초 템플릿 창 [2, 11.5)");
	// 굽지 못한 대상 줄은 놓지도 지우지도 않는다. AE 대상 줄의 ap.nk(전에 네이티브)는 지운다
	p = plan([row(1, 2, { rs: { ap: ap(2, 4, K("a")) }, nk: null }), row(2, 10, { native: false, rs: { ap: ap(10, 12, K("f")) } })]);
	assert.deepEqual([p.place, p.spots], [{}, [{ t: 2, s: 10 }]]);
});

test("patchNativeDefinition durSec: sourceInfoLocalized duration 중 가장 긴 것 (없으면 0)", () => {
	const d = (info) => core.patchNativeDefinition(JSON.stringify({ clientControls: [], sourceInfoLocalized: info }), [], "u").durSec;
	assert.equal(d({ en_US: { duration: { scale: 200, value: 1001 } }, ja_JP: { duration: { scale: 1, value: 5 } } }), 5.005);
	assert.equal(d({ en_US: { duration: { scale: 12000, value: 61061 } } }), 61061 / 12000);
	assert.equal(d({ en_US: {} }), 0);
	assert.equal(core.patchNativeDefinition("{}", [], "u").durSec, 0);
});
