"use strict";
// M5.2: MCP 서버의 SDK 없는 부분 — 복사한 region 로더(mcp/lib/loadRegions.js·jsmask.js)가 tests/lib와 바이트까지 같다,
// 도구 정의(이름·평평한 스키마·readOnlyHint·설명 크기), 안내문(2048자, 앞 512자 규칙), 인자 확인(checkArgs), 클라이언트 이름 → by,
// 설치본 core 싣기(mcp/lib/core.js: 해시 일치·불일치·파일 없음·함수 싣기).
// SDK로 서버를 띄우는 시험은 tests/mcp (npm run test:mcp).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { regionHash, ROOT } = require("../lib/loadRegions");
const T = require("../../mcp/lib/tools");
const C = require("../../mcp/lib/core");
const { INSTRUCTIONS, INSTRUCTIONS_HEAD, GUIDE } = require("../../mcp/lib/guide");

test("복사한 region 로더는 tests/lib와 바이트까지 같다 (서버와 테스트가 같은 규칙으로 core를 자르고 해시한다)", () => {
	for (const f of ["loadRegions.js", "jsmask.js"]) {
		assert.ok(fs.readFileSync(path.join(ROOT, "mcp", "lib", f)).equals(fs.readFileSync(path.join(ROOT, "tests", "lib", f))), "mcp/lib/" + f + " = tests/lib/" + f + " (고치면 둘 다)");
	}
});

test("도구 정의: 이름 [A-Za-z0-9_], 루트 object + 이름을 적은 properties, anyOf·default·min/max 없음, 읽기 도구 readOnlyHint, 한국어 설명", () => {
	const box = T.createToolbox({ dir: "C:/없음" });
	assert.ok(box.tools.length >= 9);
	const walk = (o, fn, at) => {
		if (!o || typeof o !== "object") return;
		fn(o, at);
		Object.keys(o).forEach((k) => walk(o[k], fn, at + "." + k));
	};
	for (const t of box.tools) {
		assert.match(t.name, /^[A-Za-z0-9_]{1,64}$/);
		assert.equal(t.inputSchema.type, "object");
		assert.equal(t.inputSchema.additionalProperties, false);
		walk(t.inputSchema, (o, at) => {
			["anyOf", "oneOf", "allOf", "$ref", "default", "minimum", "maximum", "pattern", "format"].forEach((k) => assert.ok(!(k in o), t.name + at + " " + k));
			if (o.type === "object") assert.equal(typeof o.properties, "object", t.name + at);
			if (o.type === "array") assert.equal(typeof o.items, "object", t.name + at + " items");
		}, "");
		assert.ok(Buffer.byteLength(JSON.stringify(t.inputSchema)) + Buffer.byteLength(t.description) < 5000, t.name + " 스키마+설명 5000바이트 미만");
		assert.match(t.description, /[가-힣]/);
		assert.equal(typeof t.annotations.readOnlyHint, "boolean", t.name);
		if (/^(get|find|list|plan|verify)_/.test(t.name)) assert.equal(t.annotations.readOnlyHint, true, t.name + "는 읽기");
	}
});

test("안내문: 2048자 이하, 앞 512자만으로 규칙이 선다, 도구 이름은 실제 도구", () => {
	assert.ok(INSTRUCTIONS.length <= 2048, INSTRUCTIONS.length);
	assert.ok(INSTRUCTIONS_HEAD.length <= 512, "머리 " + INSTRUCTIONS_HEAD.length);
	assert.equal(INSTRUCTIONS.slice(0, INSTRUCTIONS_HEAD.length), INSTRUCTIONS_HEAD);
	["get_status", "AI 연결 허용", "find_row", "field_sig", "캡션", "시간", "승인"].forEach((w) => assert.ok(INSTRUCTIONS_HEAD.indexOf(w) !== -1, w));
	const names = T.createToolbox({ dir: "C:/없음" }).tools.map((t) => t.name);
	const mentioned = (INSTRUCTIONS + "\n" + GUIDE).match(/\b[a-z]+(?:_[a-z]+)+\b/g).filter((w) => /^(get|find|list|plan|verify|suggest|set|request|wait|import)_/.test(w));
	[...new Set(mentioned)].forEach((w) => assert.ok(names.indexOf(w) !== -1, "안내문의 " + w + "는 있는 도구"));
});

test("checkArgs: 모르는 이름·형식·enum·필수·중첩 배열", () => {
	const s = { type: "object", additionalProperties: false, required: ["items"], properties: {
		items: { type: "array", items: { type: "object", additionalProperties: false, required: ["uid"], properties: { uid: { type: "string" }, n: { type: "integer" } } } },
		mode: { type: "string", enum: ["a", "b"] }
	} };
	assert.equal(T.checkArgs(s, { items: [{ uid: "x", n: 2 }] }), "");
	assert.match(T.checkArgs(s, {}), /items가 필요합니다/);
	assert.match(T.checkArgs(s, { items: [], extra: 1 }), /모르는 이름: extra/);
	assert.match(T.checkArgs(s, { items: [{ uid: 3 }] }), /items\[0\]\.uid는 문자열/);
	assert.match(T.checkArgs(s, { items: [{ uid: "x", n: 1.5 }] }), /정수/);
	assert.match(T.checkArgs(s, { items: [{ uid: "x", fid: "T2" }] }), /items\[0\]에 모르는 이름: fid/);
	assert.match(T.checkArgs(s, { items: [], mode: "c" }), /a \| b 중 하나/);
	assert.equal(T.checkArgs({ type: "object", properties: {}, additionalProperties: false }, undefined), "");
});

test("byOf: 클라이언트 이름 → 제안 by (패널 'AI 제안 (Codex)')", () => {
	assert.equal(T.byOf("codex-mcp-client"), "codex");
	assert.equal(T.byOf("claude-code"), "claude");
	assert.equal(T.byOf("Claude Desktop"), "claude");
	assert.equal(T.byOf(""), "ai");
	assert.equal(T.byOf("x".repeat(60)).length, 40);
});

test("core.js: 설치본 app.js의 core 해시가 heartbeat와 같을 때만 싣는다", () => {
	const extPath = path.join(ROOT, "extension");
	const want = regionHash("src/mi/core.ts");
	let r = C.loadCore({ extPath, coreHash: want }, { withCore: true });
	assert.deepEqual([r.ok, r.hash], [true, want]);
	assert.equal(typeof r.core.validateSuggestion, "function");
	assert.equal(typeof r.core.fieldSignature, "function");
	r = C.loadCore({ extPath, coreHash: "deadbeef" }, { withCore: true });
	assert.deepEqual([r.ok, r.code, r.server, r.panel], [false, "panel-version-mismatch", want, "deadbeef"]);
	assert.match(r.message, /다릅니다/);
	r = C.loadCore({ extPath, coreHash: null });
	assert.deepEqual([r.ok, r.code], [false, "panel-version-mismatch"]);
	r = C.loadCore({ extPath: path.join(ROOT, "없는 폴더"), coreHash: want });
	assert.deepEqual([r.ok, r.code], [false, "core-unavailable"]);
	r = C.loadCore({ coreHash: want });
	assert.deepEqual([r.ok, r.code], [false, "core-unavailable"]);
});

test("쓰기 도구(M5.3): suggest_fields·set_cast_proposal — readOnlyHint·destructiveHint false, seq_id·items 필수, 줄 항목의 필수 칸; parseTrack", () => {
	const box = T.createToolbox({ dir: "C:/없음" });
	const sf = box.tools.find((t) => t.name === "suggest_fields");
	const cp = box.tools.find((t) => t.name === "set_cast_proposal");
	for (const t of [sf, cp]) {
		assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.openWorldHint], [false, false, false], t.name);
		assert.deepEqual(t.inputSchema.required, ["seq_id", "items"], t.name);
		assert.equal(t.inputSchema.properties.items.type, "array");
	}
	assert.deepEqual(sf.inputSchema.properties.items.items.required, ["uid", "field_id", "field_sig", "value"]);
	assert.deepEqual(Object.keys(cp.inputSchema.properties.items.items.properties), ["key", "name", "track", "preset_id", "pos_x", "pos_y"]);
	assert.equal(T.checkArgs(sf.inputSchema, { seq_id: "s", items: [{ uid: "a-1", field_id: "T2", field_sig: "x", value: "v" }] }), "");
	assert.match(T.checkArgs(sf.inputSchema, { seq_id: "s", items: [{ uid: "a-1", fid: "T2", field_sig: "x", value: "v" }] }), /모르는 이름: fid/);
	assert.match(T.checkArgs(cp.inputSchema, { seq_id: "s", items: [{ key: "C1", pos_x: "0.5" }] }), /pos_x는 숫자/);
	assert.deepEqual(["V3", "v99", "2", " V10 ", "auto", "AUTO", "자동"].map(T.parseTrack), [2, 98, 1, 9, null, null, null]);
	["V1", "1", "V100", "V", "x3", "", "3.5"].forEach((v) => assert.equal(T.parseTrack(v), undefined, v));
	assert.equal(T.SUGG_MAX, 200);
});
