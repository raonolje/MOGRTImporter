"use strict";
// v27 골든: 바뀌지 않은 srtParser region(app.js)의 동작을 못 박는다.
// 이 테스트가 깨지면 단일 화자 가져오기가 v27과 달라진 것이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadRegions, plain } = require("../lib/loadRegions");

const FIX = path.join(__dirname, "..", "fixtures", "srt");
const readFix = (name) => fs.readFileSync(path.join(FIX, name), "utf8"); // BOM을 벗기지 않는다

const { parseSRT, timeToSec } = loadRegions(["src/srtParser.ts"]);
const parse = (text) => plain(parseSRT(text));

// golden_*.srt 네 파일의 기대값 (번호 5·6·7·9 → 1·2·3, 6은 빈 자막이라 빠진다)
const EXPECTED = [
	{ index: 1, startTime: "00:00:01.000", endTime: "00:00:02.500", startSec: 1, endSec: 2.5, text: "합성 자막 하나" },
	{ index: 2, startTime: "00:00:04.500", endTime: "00:00:06.000", startSec: 4.5, endSec: 6, text: "<i>기울임 합성 자막</i>\n둘째 줄" },
	{ index: 3, startTime: "00:00:07.000", endTime: "00:00:08.250", startSec: 7, endSec: 8.25, text: "줄 구분자 앞 줄 구분자 뒤" }
];

test("region에서 parseSRT·timeToSec을 꺼낸다", () => {
	assert.equal(typeof parseSRT, "function");
	assert.equal(typeof timeToSec, "function");
});

test("LF 골든", () => {
	assert.deepEqual(parse(readFix("golden_lf.srt")), EXPECTED);
});

test("LF, CRLF, CR 입력은 같은 결과", () => {
	const crlf = readFix("golden_crlf.srt");
	const cr = readFix("golden_cr.srt");
	assert.ok(crlf.includes("\r\n"), "CRLF 픽스처가 CRLF여야 한다 (.gitattributes -text)");
	assert.ok(cr.includes("\r") && !cr.includes("\n"), "CR 픽스처는 CR만 있어야 한다");
	assert.deepEqual(parse(crlf), EXPECTED);
	assert.deepEqual(parse(cr), EXPECTED);
});

test("00:00:01,000 → startTime 00:00:01.000, startSec 1", () => {
	const [c] = parse("1\n00:00:01,000 --> 00:00:02,000\n가\n");
	assert.equal(c.startTime, "00:00:01.000");
	assert.equal(c.startSec, 1);
	assert.equal(c.endTime, "00:00:02.000");
	assert.equal(c.endSec, 2);
});

test("timeToSec: 쉼표·점 모두, 시·분 포함", () => {
	assert.equal(timeToSec("01:02:03,500"), 3723.5);
	assert.equal(timeToSec("00:00:59.999"), 59.999);
	assert.equal(timeToSec("00:00:00,000"), 0);
});

test("번호 5, 7, 9는 1, 2, 3으로 다시 매긴다", () => {
	const out = parse("5\n00:00:01,000 --> 00:00:02,000\n가\n\n7\n00:00:03,000 --> 00:00:04,000\n나\n\n9\n00:00:05,000 --> 00:00:06,000\n다\n");
	assert.deepEqual(out.map((c) => c.index), [1, 2, 3]);
	assert.deepEqual(out.map((c) => c.text), ["가", "나", "다"]);
});

test("빈 텍스트 자막은 빠지고 번호를 소비하지 않는다", () => {
	const out = parse("1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\n나\n");
	assert.equal(out.length, 1);
	assert.equal(out[0].index, 1);
	assert.equal(out[0].text, "나");
});

test("<i> 태그는 그대로 통과한다", () => {
	const [c] = parse("1\n00:00:01,000 --> 00:00:02,000\n<i>기울임</i> <b>굵게</b>\n");
	assert.equal(c.text, "<i>기울임</i> <b>굵게</b>");
});

test("U+FEFF로 시작하는 입력도 첫 자막을 유지한다", () => {
	const bom = readFix("golden_bom.srt");
	assert.equal(bom.charCodeAt(0), 0xfeff, "픽스처가 BOM으로 시작해야 한다");
	assert.deepEqual(parse(bom), EXPECTED);
	const [c] = parse("﻿1\n00:00:01,000 --> 00:00:02,000\n첫 자막\n");
	assert.equal(c.text, "첫 자막");
});

test("U+2028은 그대로 통과한다", () => {
	const [c] = parse("1\n00:00:01,000 --> 00:00:02,000\n앞 뒤\n");
	assert.equal(c.text, "앞 뒤");
	assert.equal(c.text.length, 3);
});

test("번호 없는 블록, 점 구분 시간, 시간 없는 블록", () => {
	const out = parse("00:00:01.000 --> 00:00:02.000\n번호 없음\n\n쓰레기 블록\n줄\n\n3\n00:00:03,000-->00:00:04,000\n붙은 화살표\n");
	assert.deepEqual(out.map((c) => [c.index, c.text, c.startSec]), [[1, "번호 없음", 1], [2, "붙은 화살표", 3]]);
});
