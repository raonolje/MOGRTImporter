"use strict";
// S1-1 core: 파일 이름 C번호, 인코딩 판별, parseSRT opts, 문장 비교, fnv, frameOf, 순수성
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../lib/loadRegions");
const { loadRegions, plain } = L;

const FIX = path.join(__dirname, "..", "fixtures", "srt");
const readBytes = (name) => fs.readFileSync(path.join(FIX, name));
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);

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

test("core region은 혼자 로드된다 (자기 완결·순수성 가드 통과)", () => {
	const alone = loadRegions(["src/mi/core.ts"]);
	const want = ["parseCaptionKey", "decodeSrtBytes", "normText", "jamo", "textSim", "fnv1a32", "contentHash",
		"textFields", "captionFid", "fieldIdMap", "resolveFid", "fieldSignature", "layoutMismatch", "paramSig", "clipLs",
		"namedParams", "isV27Unsafe", "setTextValue", "pointSegmentsOk", "ruleMaxFromComments", "nextFreePresetId",
		"remapIds", "seqGuidOf", "miDefault", "miHasData", "miFromFile", "miSnapshotOf", "miRestoreFrom", "safeNextId",
		"rowLabel", "frameOf", "stripSrtTags"];
	for (const nm of want) assert.equal(typeof alone[nm], "function", nm + " 가 core에 있어야 한다");
	// 혼자 로드해도 다른 region 없이 돈다
	assert.equal(alone.normText("<i>가</i>  나"), "가 나");
	assert.equal(alone.decodeSrtBytes(readBytes("enc_utf8.srt")).encoding, "utf-8");
});

test("core region에는 MI_ 대문자 접두사 식별자가 없다 (DEV 이름 바꾸기가 해시를 바꾸지 않게)", () => {
	const src = fs.readFileSync(L.APP_JS, "utf8").replace(/\r\n/g, "\n");
	const body = L.sliceRegion("src/mi/core.ts", src).text;
	assert.equal(/\bMI_/.test(body), false);
	assert.match(L.regionHash("src/mi/core.ts"), /^[0-9a-f]{8}$/);
});

test("core는 srtParser 바로 뒤에 있다", () => {
	const names = L.listRegions().map((r) => r.name);
	assert.equal(names[names.indexOf("src/srtParser.ts") + 1], "src/mi/core.ts");
});

// ── (1) parseCaptionKey ──
test("parseCaptionKey: 파일 이름 표", () => {
	const table = [
		["C1.srt", "C1"],
		["인터뷰_C2.srt", "C2"],
		["EP12_C02.srt", "C2"],
		["c3 인터뷰.srt", "C3"],
		["인터뷰C2.srt", "C2"],
		["C12.srt", "C12"],
		["인터뷰-C4.final.srt", "C4"],
		["D:/작업/EP12/C5.srt", "C5"],
		["D:\\작업\\EP12\\c06.srt", "C6"],
		["Cam1.srt", null],
		["CC1.srt", null],
		["C1a.srt", null],
		["C0.srt", null],
		["C123.srt", null],
		["narration.srt", null],
		["Share_MOGRT_001.srt", null],
		["MOGRT_009.srt", null],
		["MOGRT_010.srt", null]
	];
	for (const [name, key] of table) {
		const r = plain(core.parseCaptionKey(name));
		assert.equal(r.key, key, name);
		assert.equal(r.ambiguous, false, name);
	}
});

test("parseCaptionKey: 번호가 둘이면 모호, 같은 번호 반복은 하나", () => {
	assert.deepEqual(plain(core.parseCaptionKey("C1_C2.srt")), { key: null, ambiguous: true, nums: [1, 2] });
	assert.deepEqual(plain(core.parseCaptionKey("C2_인터뷰_C02.srt")), { key: "C2", ambiguous: false, nums: [2] });
	assert.deepEqual(plain(core.parseCaptionKey("narration.srt")), { key: null, ambiguous: false, nums: [] });
});

test("parseCaptionKey: NFD 파일 이름도 NFC로 읽는다", () => {
	const nfd = "인터뷰_C2.srt".normalize("NFD");
	assert.notEqual(nfd, "인터뷰_C2.srt");
	assert.equal(core.parseCaptionKey(nfd).key, "C2");
});

// ── (2) decodeSrtBytes ──
const EXPECT_TEXT = "1\n00:00:01,000 --> 00:00:02,500\n안녕하세요 합성 자막\n\n2\n00:00:03,000 --> 00:00:04,000\n두 번째 줄입니다\n";

test("decodeSrtBytes: UTF-8 / UTF-8 BOM / UTF-16LE(BOM 유무) / UTF-16BE BOM / CP949", () => {
	const cases = [
		["enc_utf8.srt", "utf-8"],
		["enc_utf8_bom.srt", "utf-8"],
		["enc_utf16le_bom.srt", "utf-16le"],
		["enc_utf16le.srt", "utf-16le"],
		["enc_utf16be_bom.srt", "utf-16be"],
		["enc_cp949.srt", "euc-kr"]
	];
	for (const [file, enc] of cases) {
		const r = plain(core.decodeSrtBytes(readBytes(file)));
		assert.deepEqual(r, { text: EXPECT_TEXT, encoding: enc, replaced: 0 }, file);
	}
});

test("decodeSrtBytes: CP949 '안녕하세요' → euc-kr", () => {
	const b = Uint8Array.from([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4]);
	assert.deepEqual(plain(core.decodeSrtBytes(b)), { text: "안녕하세요", encoding: "euc-kr", replaced: 0 });
	// ArrayBuffer로 넘겨도 같다 (FileReader.readAsArrayBuffer)
	assert.equal(core.decodeSrtBytes(b.buffer).encoding, "euc-kr");
});

test("decodeSrtBytes: 깨진 바이트 하나인 UTF-8은 euc-kr로 넘어가지 않는다 (replaced 3)", () => {
	const bytes = readBytes("enc_utf8_badbyte.srt");
	const r = core.decodeSrtBytes(bytes);
	assert.equal(r.encoding, "utf-8");
	assert.equal(r.replaced, 3);
	// euc-kr로 읽었다면 더 많이 깨진다
	const k = [...new TextDecoder("euc-kr").decode(bytes)].filter((ch) => ch === String.fromCharCode(0xfffd)).length;
	assert.ok(k > 3, "euc-kr 쪽 U+FFFD " + k);
	// 나머지 문장은 멀쩡하다
	assert.ok(r.text.indexOf("두 번째 줄입니다") !== -1);
});

test("decodeSrtBytes: 오프셋이 있는 뷰와 빈 입력", () => {
	const all = Buffer.concat([Buffer.from([1, 2, 3]), readBytes("enc_utf8_bom.srt")]);
	const view = new Uint8Array(all.buffer, all.byteOffset + 3, all.length - 3);
	assert.equal(core.decodeSrtBytes(view).text, EXPECT_TEXT);
	assert.deepEqual(plain(core.decodeSrtBytes(new Uint8Array(0))), { text: "", encoding: "utf-8", replaced: 0 });
});

// ── (3) parseSRT opts ──
const GOLDEN = [
	{ index: 1, startTime: "00:00:01.000", endTime: "00:00:02.500", startSec: 1, endSec: 2.5, text: "합성 자막 하나" },
	{ index: 2, startTime: "00:00:04.500", endTime: "00:00:06.000", startSec: 4.5, endSec: 6, text: "<i>기울임 합성 자막</i>\n둘째 줄" },
	{ index: 3, startTime: "00:00:07.000", endTime: "00:00:08.250", startSec: 7, endSec: 8.25, text: "줄 구분자 앞" + LS + "줄 구분자 뒤" }
];

test("parseSRT: opts가 없으면 v27 골든 그대로 (srtNo 없음)", () => {
	for (const f of ["golden_lf.srt", "golden_crlf.srt", "golden_cr.srt", "golden_bom.srt"]) {
		const out = plain(core.parseSRT(fs.readFileSync(path.join(FIX, f), "utf8")));
		assert.deepEqual(out, GOLDEN, f);
		assert.equal(out.some((c) => "srtNo" in c), false);
	}
});

test("parseSRT: opts가 있으면 U+2028/2029 → LF, keepNo는 원래 번호, stripTags는 태그 제거", () => {
	const golden = fs.readFileSync(path.join(FIX, "golden_lf.srt"), "utf8");
	const withEmpty = plain(core.parseSRT(golden, {}));
	assert.deepEqual(withEmpty.map((c) => c.text), ["합성 자막 하나", "<i>기울임 합성 자막</i>\n둘째 줄", "줄 구분자 앞\n줄 구분자 뒤"]);
	assert.equal(withEmpty.some((c) => "srtNo" in c), false);
	const full = plain(core.parseSRT(golden, { keepNo: true, stripTags: true }));
	assert.deepEqual(full.map((c) => [c.index, c.srtNo, c.text]), [
		[1, 5, "합성 자막 하나"],
		[2, 7, "기울임 합성 자막\n둘째 줄"],
		[3, 9, "줄 구분자 앞\n줄 구분자 뒤"]
	]);
	// 나머지 필드는 골든과 같다
	full.forEach((c, i) => {
		for (const k of ["startTime", "endTime", "startSec", "endSec"]) assert.equal(c[k], GOLDEN[i][k]);
	});
	assert.deepEqual(plain(core.parseSRT("1\n00:00:01,000 --> 00:00:02,000\n앞" + PS + "뒤\n", {}))[0].text, "앞\n뒤");
});

test("parseSRT: CRLF·태그·ASS·번호 없는 자막 (tags_crlf.srt)", () => {
	const text = core.decodeSrtBytes(readBytes("tags_crlf.srt")).text;
	const out = plain(core.parseSRT(text, { keepNo: true, stripTags: true }));
	assert.deepEqual(out.map((c) => [c.index, c.srtNo, c.text, c.startSec]), [
		[1, 3, "기울임 그리고 굵게", 1],
		[2, 5, "위쪽 빨강", 2.5],
		[3, null, "번호 없는 자막", 4],
		[4, 8, "밑줄\n다음 줄", 6]
	]);
	// 태그만 있는 자막은 빠지고 번호를 소비하지 않는다
	const only = plain(core.parseSRT("1\n00:00:01,000 --> 00:00:02,000\n<i></i>\n\n2\n00:00:03,000 --> 00:00:04,000\n나\n", { stripTags: true }));
	assert.deepEqual(only.map((c) => [c.index, c.text]), [[1, "나"]]);
});

test("stripSrtTags: 여는·닫는 태그와 ASS 지시만 지운다", () => {
	assert.equal(core.stripSrtTags("<font color=\"#fff\" size=\"3\">가</font> <B>나</B> {\\an8}다 {\\pos(1,2)}라 <span>마</span> a<b"),
		"가 나 다 라 <span>마</span> a<b");
});

// ── 문장 비교 ──
test("normText: NFC, 줄바꿈, 태그, 공백", () => {
	const nfd = "한글".normalize("NFD");
	assert.equal(core.normText(nfd), "한글");
	assert.equal(core.normText("  <i>가</i>\t\t나 \r\n\r\n 다" + LS + "라  "), "가 나\n다\n라");
	assert.equal(core.normText("가" + String.fromCharCode(0xa0) + String.fromCharCode(0x3000) + "나"), "가 나");
	assert.equal(core.normText(null), "");
});

test("jamo: 음절을 자모로 푼다", () => {
	assert.equal(core.jamo("각"), String.fromCharCode(0x1100, 0x1161, 0x11a8));
	assert.equal(core.jamo("가a"), String.fromCharCode(0x1100, 0x1161) + "a");
	assert.equal(core.jamo("각").length, 3);
});

test("textSim: 같으면 1, 받침 하나 차이는 높고, 다른 문장은 낮다", () => {
	assert.equal(core.textSim("오늘 날씨 좋다", "오늘 날씨 좋다"), 1);
	assert.equal(core.textSim("오늘 날씨 좋다", "<i>오늘  날씨 좋다</i>"), 1);
	assert.equal(core.textSim("", ""), 1);
	assert.equal(core.textSim("가", ""), 0);
	const close = core.textSim("오늘 날씨 좋다", "오늘 날씨 좋네");
	assert.ok(close > 0.8 && close < 1, String(close));
	assert.ok(core.textSim("오늘 날씨 좋다", "내일은 비가 온대요") < 0.5);
	assert.equal(core.levenshtein("kitten", "sitting"), 3);
});

// ── (16) fnv1a32 ──
test("fnv1a32: 표준 벡터와 하네스 구현(Buffer UTF-8)과 같은 값", () => {
	assert.equal(core.fnv1a32(""), "811c9dc5");
	assert.equal(core.fnv1a32("a"), "e40c292c");
	assert.equal(core.fnv1a32("foobar"), "bf9cf968");
	const r = rng(7);
	const pool = ["a", "Z", "0", " ", "\n", "가", "힣", "·", String.fromCharCode(0xd83d, 0xde00), String.fromCharCode(0xd800), String.fromCharCode(0xdc00), String.fromCharCode(0x7ff), String.fromCharCode(0x800)];
	for (let n = 0; n < 300; n++) {
		let s = "";
		const len = Math.floor(r() * 12);
		for (let i = 0; i < len; i++) s += pool[Math.floor(r() * pool.length)];
		assert.equal(core.fnv1a32(s), L.fnv1a32(s), JSON.stringify(s));
	}
});

test("contentHash: 필드 순서가 달라도 내용이 같으면 같고, 값이 다르면 다르다", () => {
	const a = core.contentHash([{ id: 1, text: "가" }], { 1: { presetId: "preset_1", open: false } }, []);
	const b = core.contentHash([{ text: "가", id: 1 }], { 1: { open: false, presetId: "preset_1" } }, []);
	const c = core.contentHash([{ id: 1, text: "나" }], { 1: { presetId: "preset_1", open: false } }, []);
	assert.equal(a, b);
	assert.notEqual(a, c);
	assert.equal(core.contentHash(), core.contentHash([], {}, []));
});

// ── (17) frameOf ──
const RATES = [
	{ name: "23.976", ticks: 10594584000, num: 24000, den: 1001 },
	{ name: "29.97", ticks: 8475667200, num: 30000, den: 1001 },
	{ name: "25", ticks: 10160640000, num: 25, den: 1 },
	{ name: "59.94", ticks: 4237833600, num: 60000, den: 1001 }
];

test("frameOf: 프레임 경계 시간 5,000개 × 4개 프레임레이트, ms 반올림·버림 모두 오류 0", () => {
	for (const rate of RATES) {
		assert.equal(core.TICKS_PER_SEC / (rate.num / rate.den), rate.ticks, rate.name + " frameTicks");
		const r = rng(rate.num);
		const maxF = Math.floor((9 * 3600 * rate.num) / rate.den); // 9시간
		let wrongRound = 0;
		let wrongTrunc = 0;
		let floorWrong = 0;
		for (let n = 0; n < 5000; n++) {
			const f = Math.floor(r() * maxF);
			const t = (f * rate.den) / rate.num;
			const msRound = Math.round(t * 1000) / 1000;
			const msTrunc = Math.floor(t * 1000) / 1000;
			if (core.frameOf(msRound, rate.ticks) !== f) wrongRound++;
			if (core.frameOf(msTrunc, String(rate.ticks)) !== f) wrongTrunc++;
			if (Math.floor((msRound * core.TICKS_PER_SEC) / rate.ticks) !== f) floorWrong++;
		}
		assert.equal(wrongRound, 0, rate.name + " ms 반올림");
		assert.equal(wrongTrunc, 0, rate.name + " ms 버림");
		// 비교 기준: Math.floor는 많이 틀린다 (테스트가 실제로 차이를 잡는지 확인)
		if (rate.den === 1001) assert.ok(floorWrong > 100, rate.name + " floor 오류 " + floorWrong);
	}
	assert.ok(Number.isNaN(core.frameOf(1, 0)));
	assert.equal(core.frameOf(0, 10594584000), 0);
});
