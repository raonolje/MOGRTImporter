"use strict";
/**
 * 실제 프리셋 모양을 흉내 낸 합성 픽스처 (이름·구조만 맞추고 값은 지어낸 것).
 * 실제 캐시의 텍스트는 저장소에 넣지 않는다.
 *
 *   preset_1  현재 15속성 [라온올제] 자동 줄바꿈 박스 자막: 텍스트 idx 4/6/8, 캡션 idx4
 *   STALE_1   같은 MOGRT의 옛 8속성 구조로 만든 줄 (텍스트 idx 0/2/4)
 *   preset_2  텍스트 idx 0/2/8/9, 캡션 idx0
 *   preset_3  텍스트 "텍스트"(캡션)·"포인트 텍스트", 규칙 comment idx10
 *   preset_4  텍스트 없음
 *   preset_6  텍스트 idx 0-3, 캡션 T1, 규칙 comment idx13
 *   preset_8  텍스트 5개, 캡션 없음 (textParamIndex -1)
 *   NATIVE    Premiere 네이티브 템플릿 (Source Text 두 개)
 * 매번 새 사본을 돌려준다(테스트끼리 서로 바꾸지 않게).
 */

function textRaw(text, extra) {
	return JSON.stringify(Object.assign({
		capPropFontEdit: false,
		fontEditValue: ["NanumSquareRoundOTF"],
		fontSizeEditValue: [60],
		fontTextRunLength: [String(text).length],
		textEditValue: String(text)
	}, extra || {}));
}
function T(index, displayName, value, group) {
	return { index, displayName, type: "text", rawValue: textRaw(value), value, group: group || "", fontExposed: false, exposedFontFields: [] };
}
function C(index, displayName, hex) {
	return { index, displayName, type: "color", rawValue: "4294967295", value: "4294967295", group: "", colorHex: hex || "#ffffff", colorFormat: "argb32" };
}
function N(index, displayName, value, type) {
	return { index, displayName, type: type || "number", rawValue: String(value), value: String(value), group: "" };
}
function G(index, displayName) {
	return { index, displayName, type: "group", rawValue: "", value: "", group: "" };
}
function CM(index, displayName, value) {
	return { index, displayName, type: "comment", rawValue: value, value, group: "" };
}
function TS(index, displayName) {
	return { index, displayName, type: "textsetting", rawValue: "{\"fontFamily\":\"x\"}", value: "", group: "" };
}

const RULE = "포인트 텍스트는 $$로 구분하며 최대 3개까지 입력 가능합니다.";

function preset(id, name, params, textParamIndex) {
	return {
		id,
		name,
		mogrtPath: "D:/MOGRT/" + name + ".mogrt",
		params,
		exposedIndices: params.filter((p) => p.type === "text").map((p) => p.index),
		textParamIndex,
		exposedFontFields: {},
		thumbnailData: null
	};
}

function build() {
	const p1 = preset("preset_1", "[라온올제] 자동 줄바꿈 박스 자막", [
		G(0, "스타일"),
		C(1, "박스 색상", "#202020"),
		N(2, "박스 가로 여백", 40),
		N(3, "박스 세로 여백", 20),
		T(4, "전체 텍스트", "합성 전체 문장"),
		C(5, "강조 색상", "#ffcc00"),
		T(6, "포인트 텍스트", "전체"),
		C(7, "포인트 색상", "#ff8800"),
		T(8, "서브 포인트 텍스트", ""),
		C(9, "서브 포인트 색상", "#00ccff"),
		CM(10, "포인트 텍스트 구분 방법", RULE),
		N(11, "자동 줄바꿈", "true", "boolean"),
		N(12, "최대 너비", 1400),
		N(13, "정렬", 1, "dropdown"),
		N(14, "그림자 각도", 135, "angle")
	], 4);
	// 옛 8속성 구조 (2026-06-26 재저장 전): 현재 구조의 index로 쓰면 캡션이 '서브 포인트 텍스트'에 들어간다
	const stale1 = [
		T(0, "전체 텍스트", "옛 구조 합성 문장"),
		C(1, "강조 색상", "#ffcc00"),
		T(2, "포인트 텍스트", "합성"),
		C(3, "포인트 색상", "#ff8800"),
		T(4, "서브 포인트 텍스트", ""),
		C(5, "박스 색상", "#202020"),
		N(6, "박스 가로 여백", 40),
		N(7, "박스 세로 여백", 20)
	];
	const p2 = preset("preset_2", "정의 자막", [
		T(0, "Text", "합성 정의 문장"),
		TS(1, "Text 세팅"),
		T(2, "PointText", "정의"),
		C(3, "Color", "#ffffff"),
		C(4, "PointColor", "#ff0000"),
		N(5, "Size", 100),
		N(6, "Position", "960,540", "point"),
		N(7, "Opacity", 100),
		T(8, "Text_02", ""),
		T(9, "PointText_02", "")
	], 0);
	const p3 = preset("preset_3", "심플한 하단 반응형 밴드 자막", [
		G(0, "텍스트"),
		T(1, "텍스트", "합성 밴드 문장"),
		T(2, "포인트 텍스트", "밴드"),
		C(3, "밴드 색상", "#111111"),
		C(4, "글자 색상", "#ffffff"),
		C(5, "포인트 색상", "#ffd400"),
		N(6, "밴드 높이", 120),
		N(7, "글자 크기", 54),
		N(8, "등장 방향", 0, "dropdown"),
		N(9, "그림자", "false", "boolean"),
		CM(10, "포인트 텍스트 구분 방법", RULE)
	], 1);
	const p4 = preset("preset_4", "로고 워터마크", [
		C(0, "로고 색상", "#ffffff"),
		N(1, "크기", 30),
		N(2, "불투명도", 80)
	], -1);
	const p6 = preset("preset_6", "두 줄 나눔 자막", [
		T(0, "자막 1 텍스트", "합성 첫 줄"),
		T(1, "자막 1 포인트 텍스트", ""),
		T(2, "자막 2 텍스트", "합성 둘째 줄"),
		T(3, "자막 2 포인트 텍스트", ""),
		C(4, "자막 1 색상", "#ffffff"),
		C(5, "자막 2 색상", "#ffffff"),
		C(6, "포인트 색상", "#ffd400"),
		N(7, "간격", 12),
		N(8, "크기", 54),
		N(9, "정렬", 1, "dropdown"),
		N(10, "그림자", "true", "boolean"),
		N(11, "등장 시간", 0.3),
		N(12, "퇴장 시간", 0.3),
		CM(13, "포인트 텍스트 구분 방법", RULE)
	], 0);
	const p8 = preset("preset_8", "타이틀 카드", [
		T(0, "제목", "합성 제목"),
		T(1, "부제목", ""),
		T(2, "날짜", ""),
		T(3, "장소", ""),
		T(4, "출처", ""),
		C(5, "배경 색상", "#000000")
	], -1);
	const native = [
		{ index: 0, displayName: "텍스트 1", type: "text", value: "", rawValue: "", exposedFontFields: [], fontExposed: false, nativeText: true },
		{ index: 1, displayName: "텍스트 2", type: "text", value: "", rawValue: "", exposedFontFields: [], fontExposed: false, nativeText: true }
	];
	return {
		RULE,
		presets: { preset_1: p1, preset_2: p2, preset_3: p3, preset_4: p4, preset_6: p6, preset_8: p8 },
		STALE_1: stale1,
		NATIVE: native,
		helpers: { T, C, N, G, CM, TS, textRaw }
	};
}

module.exports = { build };
