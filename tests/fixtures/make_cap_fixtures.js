#!/usr/bin/env node
"use strict";
/**
 * 캡션 트랙 SRT 픽스처(tests/fixtures/srt/cap_*.srt)를 다시 만든다. 합성 텍스트만 쓴다.
 *   node tests/fixtures/make_cap_fixtures.js
 *
 * Premiere 26.5.1 한국어 UI의 '캡션 내보내기' 실제 표본은 아직 없다(S0-3 i/u, 사용자 확인 대기).
 * 그때까지 그 파일이 가질 법한 모양을 모두 흉내 낸다:
 *   - UTF-8 BOM 있음(C1) / 없음(C2), 줄끝 CRLF, 번호 1부터 차례로, 두 줄 자막, <i>·<b> 태그
 *   - 시퀀스 시작 타임코드 01:00:00:00이 붙은 변형(cap_C2_tc1h.srt)
 *   - 다시 내보낸 C1(cap_C1_edit.srt): 문장 하나 바뀜, 시간 하나 바뀜, 하나 나뉨, 하나 빠짐, 하나 새로 (S1-8 병합용)
 * 두 화자가 번갈아 말한다 (C1 1·5·9…초, C2 3·7.5·11…초).
 * 만든 바이트는 커밋되어 있고(tests/fixtures/** -text), panel_import·panel_merge 테스트가 읽는다.
 */
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "srt");

// [시작, 끝(초), 문장] — 문장 안의 \n은 두 줄 자막
const C1 = [
	[1.0, 2.5, "안녕하세요 합성 인터뷰 첫 번째 질문입니다"],
	[5.0, 7.2, "오늘 날씨가 정말 좋네요"],
	[9.0, 10.5, "두 줄로 된 자막\n아래 줄은 조금 더 깁니다"],
	[13.0, 14.0, "<i>기울임 강조</i> 문장입니다"],
	[17.0, 19.0, "산책을 가면 좋겠어요 그리고 커피도 마셔요"],
	[21.0, 22.5, "<b>굵게</b> 말한 부분"],
	[25.0, 26.0, "마지막 인사입니다"]
];
const C2 = [
	[3.0, 4.5, "네 반갑습니다 저는 두 번째 화자예요"],
	[7.5, 8.8, "맞아요 하늘이 맑아요"],
	[11.0, 12.5, "저도 두 줄로\n대답해 볼게요"],
	[15.0, 16.5, "그 이야기는 처음 들어요"],
	[19.5, 20.5, "<i>좋아요</i>"],
	[23.0, 24.5, "다음에 또 만나요"]
];
// 다시 내보낸 C1: [0] 그대로, [1] 문장 바뀜(날씨→하늘), [2] 시간만 +0.4초, [3] 빠짐,
// [4] 둘로 나뉨(17.0~18.0 / 18.0~19.0), [5] 그대로, 새 줄(27~28), [6] 그대로
const C1_EDIT = [
	[1.0, 2.5, "안녕하세요 합성 인터뷰 첫 번째 질문입니다"],
	[5.0, 7.2, "오늘 하늘이 정말 맑네요"],
	[9.4, 10.9, "두 줄로 된 자막\n아래 줄은 조금 더 깁니다"],
	[17.0, 18.0, "산책을 가면 좋겠어요"],
	[18.0, 19.0, "그리고 커피도 마셔요"],
	[21.0, 22.5, "<b>굵게</b> 말한 부분"],
	[25.0, 26.0, "마지막 인사입니다"],
	[27.0, 28.0, "덧붙이는 새 문장입니다"]
];

function tc(sec) {
	const ms = Math.round(sec * 1000);
	const h = Math.floor(ms / 3600000);
	const m = Math.floor((ms % 3600000) / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "," + p(ms % 1000, 3);
}
function srt(cues, offset) {
	return cues.map(([s, e, t], i) => (i + 1) + "\n" + tc(s + (offset || 0)) + " --> " + tc(e + (offset || 0)) + "\n" + t + "\n").join("\n");
}
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const files = {
	"cap_C1.srt": Buffer.concat([BOM, Buffer.from(crlf(srt(C1)), "utf8")]),
	"cap_interview_C2.srt": Buffer.from(crlf(srt(C2)), "utf8"),
	"cap_C2_tc1h.srt": Buffer.from(crlf(srt(C2, 3600)), "utf8"),
	"cap_C1_edit.srt": Buffer.concat([BOM, Buffer.from(crlf(srt(C1_EDIT)), "utf8")])
};

if (require.main === module) {
	for (const [name, buf] of Object.entries(files)) {
		fs.writeFileSync(path.join(DIR, name), buf);
		console.log(name, buf.length, "bytes");
	}
}

module.exports = { C1, C2, C1_EDIT, srt, tc };
