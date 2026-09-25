#!/usr/bin/env node
"use strict";
/**
 * 인코딩 픽스처(tests/fixtures/srt/enc_*.srt, tags_crlf.srt)를 다시 만든다. 합성 텍스트만 쓴다.
 *   node tests/fixtures/make_enc_fixtures.js
 * 만든 바이트는 커밋되어 있고(tests/fixtures/** -text), core_parse.test.js가 내용을 확인한다.
 */
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "srt");
const TEXT = "1\n00:00:01,000 --> 00:00:02,500\n안녕하세요 합성 자막\n\n2\n00:00:03,000 --> 00:00:04,000\n두 번째 줄입니다\n";

// CP949(KS X 1001) 역표: 2바이트 조합을 모두 디코드해 글자 → 바이트
function cp949Encoder() {
	const td = new TextDecoder("euc-kr");
	const map = new Map();
	for (let a = 0xa1; a <= 0xfe; a++) {
		for (let b = 0xa1; b <= 0xfe; b++) {
			const ch = td.decode(Buffer.from([a, b]));
			if (ch.length === 1 && ch.charCodeAt(0) !== 0xfffd && !map.has(ch)) map.set(ch, [a, b]);
		}
	}
	return (s) => {
		const out = [];
		for (const ch of s) {
			if (ch.charCodeAt(0) < 0x80) out.push(ch.charCodeAt(0));
			else if (map.has(ch)) out.push(...map.get(ch));
			else throw new Error("CP949에 없는 글자: " + ch);
		}
		return Buffer.from(out);
	};
}

function utf16be(s) {
	const le = Buffer.from(s, "utf16le");
	const be = Buffer.alloc(le.length);
	for (let i = 0; i < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i]; }
	return be;
}

const utf8 = Buffer.from(TEXT, "utf8");
// 첫 한글 음절(3바이트)의 두 번째 바이트 뒤에 0xFF 하나 → U+FFFD 3개
const firstHangul = utf8.findIndex((b) => b >= 0xe0);
const bad = Buffer.concat([utf8.subarray(0, firstHangul + 2), Buffer.from([0xff]), utf8.subarray(firstHangul + 2)]);

const files = {
	"enc_utf8.srt": utf8,
	"enc_utf8_bom.srt": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]),
	"enc_utf16le_bom.srt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TEXT, "utf16le")]),
	"enc_utf16le.srt": Buffer.from(TEXT, "utf16le"),
	"enc_utf16be_bom.srt": Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be(TEXT)]),
	"enc_cp949.srt": cp949Encoder()(TEXT),
	"enc_utf8_badbyte.srt": bad,
	// CRLF, 원래 번호 3·5·8, 스타일 태그, ASS 지시, U+2028
	"tags_crlf.srt": Buffer.from([
		"3", "00:00:01,000 --> 00:00:02,000", "<i>기울임</i> 그리고 <b>굵게</b>", "",
		"5", "00:00:02,500 --> 00:00:03,500", "{\\an8}<font color=\"#ff0000\">위쪽 빨강</font>", "",
		"00:00:04,000 --> 00:00:05,000", "번호 없는 자막", "",
		"8", "00:00:06,000 --> 00:00:07,000", "<u>밑줄</u>" + String.fromCharCode(0x2028) + "다음 줄", ""
	].join("\r\n"), "utf8")
};

for (const [name, buf] of Object.entries(files)) {
	fs.writeFileSync(path.join(DIR, name), buf);
	console.log(name, buf.length, "bytes");
}
