"use strict";
/**
 * JS 소스를 "가린" 사본으로 바꾼다 (길이·줄 번호는 그대로).
 *  - 주석 → 공백
 *  - 문자열·템플릿·정규식 리터럴 → 구분자만 남기고 내용은 공백
 * es3lint(금지 구문 검사)와 loadRegions(순수성 가드, 최상위 이름 찾기)가 쓴다.
 * 주석이나 문자열 안의 단어("state." 같은)로 오탐하지 않게 하는 것이 목적이다.
 *
 * 정규식과 나눗셈은 직전 토큰으로 가른다(흔한 휴리스틱). 완전한 파서는 아니다.
 */

const WORD = /[A-Za-z0-9_$]/;
// 이 키워드 뒤의 '/'는 정규식 리터럴의 시작이다
const REGEX_AFTER_WORD = /^(return|typeof|case|do|else|in|instanceof|new|delete|void|throw)$/;
// 이 문자 뒤의 '/'는 정규식 리터럴의 시작이다
const REGEX_AFTER_PUNCT = "(,=:[!&|?{};+-*%<>~^";

/**
 * @param {string} src
 * @returns {{code: string, templates: number[]}} code: 가린 소스, templates: 백틱 위치(오프셋)
 */
function maskJs(src) {
	const n = src.length;
	const out = src.split("");
	const templates = [];
	let lastSig = ""; // "" = 처음, "word", "lit", 또는 구두점 한 글자
	let lastWord = "";
	const blank = (a, b) => {
		for (let k = a; k < b && k < n; k++) {
			if (src[k] !== "\n" && src[k] !== "\r") out[k] = " ";
		}
	};
	const regexAllowed = () =>
		lastSig === "" ||
		(lastSig.length === 1 && REGEX_AFTER_PUNCT.indexOf(lastSig) !== -1) ||
		(lastSig === "word" && REGEX_AFTER_WORD.test(lastWord));

	let i = 0;
	while (i < n) {
		const c = src[i];
		const d = src[i + 1];
		// 한 줄 주석
		if (c === "/" && d === "/") {
			let j = i;
			while (j < n && src[j] !== "\n" && src[j] !== "\r") j++;
			blank(i, j);
			i = j;
			continue;
		}
		// 블록 주석
		if (c === "/" && d === "*") {
			let j = src.indexOf("*/", i + 2);
			j = j < 0 ? n : j + 2;
			blank(i, j);
			i = j;
			continue;
		}
		// 문자열·템플릿 리터럴
		if (c === '"' || c === "'" || c === "`") {
			if (c === "`") templates.push(i);
			let j = i + 1;
			while (j < n && src[j] !== c) {
				if (src[j] === "\\") { j += 2; continue; }
				if (c !== "`" && (src[j] === "\n" || src[j] === "\r")) break; // 닫히지 않은 문자열
				j++;
			}
			blank(i + 1, j);
			i = j + 1;
			lastSig = "lit";
			continue;
		}
		// 정규식 리터럴
		if (c === "/" && regexAllowed()) {
			let j = i + 1;
			let inClass = false;
			while (j < n && src[j] !== "\n" && src[j] !== "\r") {
				const ch = src[j];
				if (ch === "\\") { j += 2; continue; }
				if (inClass) {
					if (ch === "]") inClass = false;
				} else if (ch === "[") {
					inClass = true;
				} else if (ch === "/") {
					break;
				}
				j++;
			}
			blank(i + 1, j);
			i = j + 1;
			while (i < n && /[A-Za-z]/.test(src[i])) i++; // 플래그
			lastSig = "lit";
			continue;
		}
		if (WORD.test(c)) {
			let j = i;
			while (j < n && WORD.test(src[j])) j++;
			lastWord = src.slice(i, j);
			lastSig = "word";
			i = j;
			continue;
		}
		if (!/\s/.test(c)) {
			lastSig = c;
			lastWord = "";
		}
		i++;
	}
	return { code: out.join(""), templates };
}

/** 오프셋 → 1부터 세는 줄 번호 */
function lineOf(src, offset) {
	let line = 1;
	for (let k = 0; k < offset && k < src.length; k++) {
		if (src[k] === "\n") line++;
	}
	return line;
}

module.exports = { maskJs, lineOf };
