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
	assert.equal(box.tools.length, 14);
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

test("M5.4 도구: 승인 뒤 바꾸는 요청은 destructive, wait_job은 읽기; 잘못된 경로·범위는 패널 호출 없이 거절", async () => {
	const box = T.createToolbox({ dir: "C:/없음" });
	for (const name of ["request_apply", "import_srt"]) {
		const t = box.tools.find((x) => x.name === name);
		assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.idempotentHint], [false, true, false]);
	}
	assert.equal(box.tools.find((t) => t.name === "wait_job").annotations.readOnlyHint, true);
	for (const p of ["C:/자막/C1.srt", "D:\\자막\\대사.SRT", "/tmp/c1.srt"]) assert.equal(T.localSrtPath(p), true, p);
	for (const p of ["C:relative.srt", "C:/x.txt", "x.srt", "https://x/a.srt", "\\\\server\\x.srt", "//host/x.srt", "\\\\?\\C:\\x.srt", "C:/x\u0000.srt"]) assert.equal(T.localSrtPath(p), false, p);
	for (const [name, args] of [
		["request_apply", { seq_id: "s", scope: "all" }],
		["request_apply", { seq_id: "s", scope: "changed", uids: [] }],
		["request_apply", { seq_id: "s", scope: "rows" }],
		["request_apply", { seq_id: "s", scope: "rows", uids: ["a", "a"] }],
		["request_apply", { seq_id: "s", scope: "rows", uids: [""] }],
		["import_srt", { seq_id: "s", paths: ["relative.srt"] }],
		["import_srt", { seq_id: "s", paths: ["C:/a.srt", "c:\\a.srt"] }],
		["import_srt", { seq_id: "s", paths: [] }],
		["wait_job", { job_id: "", wait_sec: 1 }],
		["wait_job", { job_id: "j", wait_sec: 26 }],
		["wait_job", { job_id: "j", wait_sec: -1 }]
	]) {
		const r = await box.call(name, args);
		assert.deepEqual([r.isError, JSON.parse(r.content[0].text).code], [true, "bad-args"], JSON.stringify(args));
	}
});

test("M5.4 다리: seq_id·by 전달, job_id 이름, 서버 재접속 조회, 제한된 폴링은 실행 중 상태를 실패로 바꾸지 않는다", async () => {
	const B = require("../../mcp/lib/bridge");
	const orig = { checkPanel: B.checkPanel, call: B.call };
	const hb = { extPath: path.join(ROOT, "extension"), coreHash: regionHash("src/mi/core.ts") };
	const sent = [];
	let reads = 0;
	let terminal = false;
	B.checkPanel = async () => ({ ok: true, hb, age: 0 });
	B.call = async (dir, op, args, opts) => {
		sent.push({ op, args, opts });
		return { ok: true, data: { jobId: "j1", rid: "a1", seqId: "s1", state: op === "jobs.get" ? (terminal && ++reads > 1 ? "succeeded" : "running") : "pending_approval", progress: { done: 3, total: 20 } } };
	};
	const json = (r) => JSON.parse(r.content[0].text);
	try {
		let box = T.createToolbox({ dir: "test", clientName: () => "Claude Desktop", budgetMs: 1600 });
		let r = json(await box.call("request_apply", { seq_id: "s1", scope: "rows", uids: ["u1"] }));
		assert.deepEqual([r.job_id, r.jobId, r.seq_id, r.state], ["j1", undefined, "s1", "pending_approval"]);
		assert.deepEqual([sent[0].op, sent[0].args, sent[0].opts.seqId, sent[0].opts.by], ["jobs.requestApply", { scope: "rows", uids: ["u1"] }, "s1", "claude"]);
		r = json(await box.call("import_srt", { seq_id: "s1", paths: ["C:/a.srt"] }));
		assert.equal(sent[1].op, "jobs.importSrt");
		assert.equal(sent[1].opts.seqId, "s1");
		box = T.createToolbox({ dir: "test", clientName: () => "codex", budgetMs: 1600 });
		const started = Date.now();
		r = json(await box.call("wait_job", { job_id: "j1", wait_sec: 25 }));
		assert.ok(Date.now() - started < 1500, "tool budget caps 25-second request");
		assert.deepEqual([r.state, r.progress.done], ["running", 3]);
		assert.ok(sent.filter((x) => x.op === "jobs.get").every((x) => x.opts.seqId === undefined && x.opts.by === "codex"));
		terminal = true;
		r = json(await box.call("wait_job", { job_id: "j1", wait_sec: 1 }));
		assert.equal(r.state, "succeeded");
		hb.coreHash = "mismatch";
		const count = sent.length;
		for (const [name, args] of [["request_apply", { seq_id: "s1", scope: "changed" }], ["import_srt", { seq_id: "s1", paths: ["C:/a.srt"] }]]) {
			r = json(await box.call(name, args));
			assert.equal(r.code, "panel-version-mismatch");
		}
		assert.equal(sent.length, count, "no write sent on hash mismatch");
		assert.equal(json(await box.call("wait_job", { job_id: "j1" })).state, "succeeded", "status reads still work");
		let poll = 0;
		B.call = async () => {
			if (++poll > 1) throw Object.assign(new Error("poll timed out"), { code: "timeout", withdrawn: true });
			return { ok: true, data: { jobId: "j1", state: "running", progress: { done: 3 } } };
		};
		const waiting = await box.call("wait_job", { job_id: "j1", wait_sec: 1 });
		assert.deepEqual([!!waiting.isError, json(waiting).state, json(waiting).progress.done], [false, "running", 3], "후속 상태 조회 시간 초과는 마지막 작업 상태를 보존한다");
	} finally { Object.assign(B, orig); }
});

test("안내문: 2048자 이하, 앞 512자만으로 규칙이 선다, 도구 이름은 실제 도구", () => {
	assert.ok(INSTRUCTIONS.length <= 2048, INSTRUCTIONS.length);
	assert.ok(INSTRUCTIONS_HEAD.length <= 512, "머리 " + INSTRUCTIONS_HEAD.length);
	assert.equal(INSTRUCTIONS.slice(0, INSTRUCTIONS_HEAD.length), INSTRUCTIONS_HEAD);
	["get_status", "AI 연결 허용", "find_row", "field_sig", "캡션", "시간", "승인"].forEach((w) => assert.ok(INSTRUCTIONS_HEAD.indexOf(w) !== -1, w));
	const names = T.createToolbox({ dir: "C:/없음" }).tools.map((t) => t.name);
	const mentioned = (INSTRUCTIONS + "\n" + GUIDE).match(/\b[a-z]+(?:_[a-z]+)+\b/g).filter((w) => w !== "wait_sec" && /^(get|find|list|plan|verify|suggest|set|request|wait|import)_/.test(w));
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

// ── M5.1~M5.3 리뷰: 다리(B)를 흉내 내고 도구가 패널에 무엇을 보내는지 본다 ──
test("도구 → 패널 (다리 흉내): get_rows·find_row는 seq_id 없이 읽고 응답의 seqId(처리한 그때의 시퀀스)로 표시한다, 빈 seq_id도 쓰기 명령에 싣는다, 패널이 모르는 명령은 panel-version-mismatch", async () => {
	const B = require("../../mcp/lib/bridge");
	const orig = { checkPanel: B.checkPanel, call: B.call };
	const hb = { v: 1, state: "on", at: Date.now(), seqId: "seq-A", extPath: path.join(ROOT, "extension"), coreHash: regionHash("src/mi/core.ts") };
	const sent = [];
	let panelSeq = "seq-A";
	const known = { rows: { total: 0, from: 0, rows: [] }, resolve: { uid: "12", fid: "T2" }, "cast.get": { castOrder: ["C1"], cast: { C1: { name: "a" } } }, presets: [] };
	// 패널 흉내: seqId가 오면 지금 시퀀스와 맞춘다 (runCommand와 같다), 모르는 명령은 bad-args '모르는 명령: …' (M5.2 패널의 rows.raw)
	B.checkPanel = async () => ({ ok: true, hb, age: 0 });
	B.call = async (dir, op, args, opts) => {
		sent.push({ op, seqId: opts.seqId });
		const head = { v: 1, id: "m-1", op, at: Date.now(), seqId: panelSeq };
		if (opts.seqId !== undefined && String(opts.seqId) !== panelSeq) return Object.assign(head, { ok: false, error: "seq-mismatch", detail: "지금 시퀀스: " + panelSeq });
		if (!Object.prototype.hasOwnProperty.call(known, op)) return Object.assign(head, { ok: false, error: "bad-args", detail: "모르는 명령: " + op });
		return Object.assign(head, { ok: true, data: known[op] });
	};
	const J = (r) => JSON.parse(r.content[0].text);
	try {
		const box = T.createToolbox({ dir: "C:/없음", clientName: () => "codex-mcp-client" });
		let r = await box.call("get_rows", {});
		assert.deepEqual([!!r.isError, J(r).seq_id], [false, "seq-A"]);
		r = await box.call("find_row", { label: "#12 T2" });
		assert.deepEqual([!!r.isError, J(r).seq_id, J(r).uid], [false, "seq-A", "12"]);
		assert.deepEqual(sent.map((m) => [m.op, m.seqId]), [["rows", undefined], ["resolve", undefined]], "읽기는 seq_id를 싣지 않는다");
		// heartbeat(seq-A)가 늦은 사이 패널이 seq-B로 바뀌었다 → 읽기는 되고, B의 줄에는 응답의 seq-B가 붙는다 (heartbeat의 A가 아니다)
		panelSeq = "seq-B";
		for (const [name, args] of [["get_rows", {}], ["find_row", { label: "#12" }]]) {
			r = await box.call(name, args);
			assert.deepEqual([!!r.isError, J(r).seq_id], [false, "seq-B"], name);
		}
		// 빈 seq_id: 그대로 싣는다 → 패널(seq-B)이 거절한다
		sent.length = 0;
		r = await box.call("set_cast_proposal", { seq_id: "", items: [{ key: "C1", name: "b" }] });
		assert.deepEqual([r.isError, J(r).code], [true, "seq-mismatch"]);
		assert.deepEqual(sent.map((m) => [m.op, m.seqId]), [["cast.get", ""]]);
		r = await box.call("suggest_fields", { seq_id: "", items: [{ uid: "12", field_id: "T2", field_sig: "x", value: "v" }] });
		assert.deepEqual([r.isError, J(r).code], [true, "seq-mismatch"]);
		// 옛 패널(M5.2)은 rows.raw를 모른다: core 해시는 같아도 bad-args가 아니라 panel-version-mismatch (인자를 고치라고 하지 않는다)
		panelSeq = "seq-A";
		r = await box.call("suggest_fields", { seq_id: "seq-A", items: [{ uid: "12", field_id: "T2", field_sig: "x", value: "v" }] });
		assert.deepEqual([r.isError, J(r).code, J(r).op], [true, "panel-version-mismatch", "rows.raw"]);
		assert.match(J(r).message, /옛 버전/);
		assert.match(J(r).hint, /새 버전으로 설치/);
		delete known.presets;
		r = await box.call("list_presets", {});
		assert.equal(J(r).code, "panel-version-mismatch", "읽기 도구도 같다");
		// 인자가 틀린 bad-args는 그대로
		B.call = async (dir, op) => ({ v: 1, id: "m-2", op, at: Date.now(), ok: false, error: "bad-args", detail: "filter는 all|changed|warn|sugg" });
		r = await box.call("get_rows", {});
		assert.deepEqual([J(r).code, J(r).hint], ["bad-args", T.PANEL_ERRORS["bad-args"][1]]);
	} finally {
		Object.assign(B, orig);
	}
});
