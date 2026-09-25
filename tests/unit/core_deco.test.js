"use strict";
// decoratedOf: 템플릿 자체의 키(네이티브 Opacity 페이드 등)는 효과로 치지 않는다 (2026-09-25 하드 테스트에서 발견).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions } = require("../lib/loadRegions");

const C = loadRegions(["src/mi/core.ts"]);

test("decoratedOf: 배운 기본 키는 빼고, 더 생긴 키·컴포넌트만 효과로 본다", () => {
	const nat = { kind: "native", deco: { comps: 6, keyed: ["AE.ADBE Opacity"] } };
	// 기본값을 모르는 네이티브: 템플릿 키일 수 있으니 효과가 아니다
	assert.equal(C.decoratedOf(nat, {}), false);
	// 배운 기본값과 같으면 효과가 아니다
	assert.equal(C.decoratedOf(nat, { mogrtBaseComps: 6, mogrtBaseKeyed: ["AE.ADBE Opacity"] }), false);
	// 사용자가 Motion에 키를 넣었다
	assert.equal(C.decoratedOf({ kind: "native", deco: { comps: 6, keyed: ["AE.ADBE Opacity", "AE.ADBE Motion"] } }, { mogrtBaseComps: 6, mogrtBaseKeyed: ["AE.ADBE Opacity"] }), true);
	// 사용자가 효과(컴포넌트)를 더했다
	assert.equal(C.decoratedOf({ kind: "native", deco: { comps: 7, keyed: ["AE.ADBE Opacity"] } }, { mogrtBaseComps: 6, mogrtBaseKeyed: ["AE.ADBE Opacity"] }), true);
	// AE: 기본값을 몰라도 Motion·Opacity 키는 효과다 (AE MOGRT의 애니메이션은 캡슐 안에 있다)
	assert.equal(C.decoratedOf({ kind: "ae", deco: { comps: 3, keyed: ["AE.ADBE Motion"] } }, {}), true);
	assert.equal(C.decoratedOf({ kind: "ae", deco: { comps: 3, keyed: [] } }, { mogrtBaseComps: 3 }), false);
	assert.equal(C.decoratedOf({ kind: "ae", deco: { comps: 4, keyed: [] } }, { mogrtBaseComps: 3 }), true);
	assert.equal(C.decoratedOf(null, {}), false);
});
