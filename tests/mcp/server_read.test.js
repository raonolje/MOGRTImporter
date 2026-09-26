"use strict";
// M5.2: MCP 서버 읽기 도구 — 진짜 서버(mcp/server.mjs)를 SDK Client(stdio)로, 패널은 가짜 패널 프로세스(tests/mcp/fake_panel.js)로.
//   tools/list(평평한 스키마·readOnlyHint·한국어 안내문), 패널 꺼짐·닫힘·낡음·신호 없음(5초), 응답 없음 → 도구 한도 안에서 timeout,
//   fixture 답으로 읽기 도구 왕복(한국어, by codex, 5초 안), core 해시가 다르면 get_status가 알린다,
//   진짜 패널(app.js 전체를 vm으로) ↔ 다리 ↔ 서버 끝에서 끝.
// 실행: npm run test:mcp (mcp/에서 npm install 필요)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("./lib/mcpClient");

const READ_TOOLS = ["get_status", "list_presets", "get_cast", "get_rows", "find_row", "get_suggestions", "plan_apply", "verify_timeline", "get_guide"];
const DOT = String.fromCharCode(0xb7);

function walk(o, fn, at = "") {
	if (!o || typeof o !== "object") return;
	fn(o, at);
	for (const k of Object.keys(o)) walk(o[k], fn, at + "." + k);
}

test("tools/list: 읽기 도구 · 평평한 스키마 · readOnlyHint · 한국어 안내문 (패널 없이)", async () => {
	const tmp = M.tmpDir("list");
	const c = await M.connect({ MI_BRIDGE_DIR: path.join(tmp, "bridge") });
	try {
		const { tools } = await c.client.listTools();
		const names = tools.map((t) => t.name);
		READ_TOOLS.forEach((n) => assert.ok(names.indexOf(n) !== -1, n));
		for (const t of tools) {
			assert.match(t.name, /^[A-Za-z0-9_]+$/);
			assert.equal(t.inputSchema.type, "object", t.name);
			assert.equal(typeof t.inputSchema.properties, "object", t.name + " properties");
			assert.ok(Buffer.byteLength(JSON.stringify(t.inputSchema)) < 5000, t.name + " 스키마 5000바이트 미만");
			walk(t.inputSchema, (o, at) => {
				["anyOf", "oneOf", "allOf", "$ref", "patternProperties", "minimum", "maximum", "pattern", "default"].forEach((k) => assert.ok(!(k in o), t.name + at + " " + k));
				if (o.type === "object") assert.equal(typeof o.properties, "object", t.name + at + " 이름을 적은 properties");
			});
			if (READ_TOOLS.indexOf(t.name) !== -1) assert.equal(t.annotations.readOnlyHint, true, t.name);
			assert.match(t.description, /[가-힣]/, t.name + " 한국어 설명");
		}
		const ins = c.client.getInstructions();
		assert.ok(ins.length <= 2048, "안내문 2048자 이하: " + ins.length);
		const head = ins.slice(0, 512);
		["get_status", "AI 연결 허용", "find_row", "field_sig", "캡션", "시간", "승인"].forEach((w) => assert.ok(head.indexOf(w) !== -1, "앞 512자에 " + w));
		const g = await M.callJson(c.client, "get_guide", {});
		assert.equal(g.isError, false);
		assert.match(g.json.guide, /\$\$/);
		assert.match(g.json.guide, /panel-version-mismatch/);
		assert.equal(g.raw.structuredContent, undefined, "structuredContent를 싣지 않는다 (Codex는 글자를 버린다)");
		// 모르는 도구·틀린 인자는 패널에 가지 않고 거절
		let r = await M.callJson(c.client, "get_rows", { filter: "모두" });
		assert.deepEqual([r.isError, r.json.code], [true, "bad-args"]);
		r = await M.callJson(c.client, "get_rows", { fid: "T2" });
		assert.deepEqual([r.isError, r.json.code], [true, "bad-args"]);
		assert.match(r.json.message, /모르는 이름: fid/);
		r = await M.callJson(c.client, "find_row", {});
		assert.match(r.json.message, /label가 필요합니다/);
	} finally {
		await c.close();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("패널 꺼짐·닫힘·낡음·신호 없음(5초): 한국어 오류와 할 일", async () => {
	const tmp = M.tmpDir("down");
	const fakes = [];
	try {
		const cases = [["off", "ai-link-off", /AI 연결 허용'이 꺼져/], ["closed", "panel-closed", /패널이 닫혀/], ["stale", "panel-not-responding", /패널 신호가 끊겼습니다 \(마지막 신호 6\d초 전\)/]];
		for (const [mode, code, re] of cases) {
			const dir = path.join(tmp, mode);
			fakes.push(await M.startFake(tmp, { mode, dir, extPath: tmp, coreHash: "x" }));
			const c = await M.connect({ MI_BRIDGE_DIR: dir, MI_HB_WAIT_MS: "1000" });
			try {
				const r = await M.callJson(c.client, "get_status", {});
				assert.deepEqual([r.isError, r.json.ok, r.json.code], [true, false, code], mode + " " + r.text);
				assert.match(r.json.message, re);
				assert.match(r.json.hint, /AI 연결 허용|패널/);
				if (mode === "off") assert.ok(r.ms < 1500, "꺼짐은 기다리지 않는다: " + r.ms);
			} finally {
				await c.close();
			}
		}
		// 신호가 전혀 없으면 5초 기다린 뒤 no-heartbeat
		const c = await M.connect({ MI_BRIDGE_DIR: path.join(tmp, "nothing") });
		try {
			const r = await M.callJson(c.client, "list_presets", {});
			assert.deepEqual([r.isError, r.json.code], [true, "no-heartbeat"]);
			assert.ok(r.ms >= 4500 && r.ms < 8000, "5초 기다림: " + r.ms);
			assert.match(r.json.hint, /창 > 확장 > MOGRT Subtitle Importer/);
		} finally {
			await c.close();
		}
	} finally {
		for (const f of fakes) await f.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("패널이 답하지 않으면 도구 한도 안에서 timeout, 가져가지 않은 명령은 거둔다", async () => {
	const tmp = M.tmpDir("silent");
	const dir = path.join(tmp, "bridge");
	const fake = await M.startFake(tmp, { mode: "silent", dir, extPath: tmp, coreHash: "x" });
	const c = await M.connect({ MI_BRIDGE_DIR: dir, MI_TOOL_BUDGET_MS: "2500" });
	try {
		const r = await M.callJson(c.client, "get_rows", {});
		assert.deepEqual([r.isError, r.json.code, r.json.withdrawn], [true, "timeout", true], r.text);
		assert.ok(r.ms < 3500, "한도 안: " + r.ms);
		assert.deepEqual(fs.readdirSync(path.join(dir, "inbox")), [], "거둔 명령은 남지 않는다");
	} finally {
		await c.close();
		await fake.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("fixture 패널: 읽기 도구 왕복(한국어), by codex, 인자 옮김, 호출마다 5초 안, core 해시 확인", async () => {
	const tmp = M.tmpDir("fx");
	const dir = path.join(tmp, "bridge");
	const ext = M.makeExt(tmp);
	const logFile = path.join(tmp, "cmds.jsonl");
	const fake = await M.startFake(tmp, { mode: "fixture", dir, extPath: ext.extPath, coreHash: ext.coreHash, logFile });
	const c = await M.connect({ MI_BRIDGE_DIR: dir });
	try {
		const call = async (name, args) => {
			const r = await M.callJson(c.client, name, args);
			assert.ok(r.ms < 5000, name + " 5초 안: " + r.ms);
			return r;
		};
		let r = await call("get_status", {});
		assert.equal(r.isError, false, r.text);
		assert.deepEqual([r.json.panel.seq.name, r.json.panel.speakers.map((s) => s.name), r.json.core.match, r.json.core.hash, r.json.client], ["T_FIXTURE", ["철수", "영희"], true, ext.coreHash, "codex"]);
		assert.equal(r.json.bridge.dir, dir);
		r = await call("list_presets", {});
		assert.deepEqual([r.json.presets[0].captionFid, r.json.presets[0].notes[0]], ["T1", "포인트 텍스트는 $$로 구분하며 최대 3개까지 입력 가능합니다."]);
		r = await call("get_cast", {});
		assert.equal(r.json.cast.C2.name, "영희");
		r = await call("get_rows", {});
		assert.deepEqual([r.json.total, r.json.rows[0].text], [4, "오늘 날씨 1번 하늘 맑음"]);
		r = await call("get_rows", { speaker: "C2" });
		assert.deepEqual(r.json.rows.map((x) => x.label), ["C2" + DOT + "1", "C2" + DOT + "2"]);
		r = await call("get_rows", { from: 2, count: 1 });
		assert.deepEqual(r.json.rows.map((x) => x.uid), ["fx01-3"]);
		r = await call("get_rows", { filter: "warn" });
		assert.deepEqual(r.json.rows[0].warn[0].missing, ["고래"]);
		r = await call("get_rows", { count: 201 });
		assert.deepEqual([r.isError, r.json.code], [true, "bad-args"]);
		r = await call("find_row", { label: "#2" });
		assert.deepEqual([r.isError, r.json.code], [true, "bad-args"]);
		assert.match(r.json.message, /여러 줄이 맞는다: C1·2, C2·2 — 화자를 붙여 주세요/);
		r = await call("find_row", { label: "C2" + DOT + "2 T2" });
		assert.deepEqual([r.json.uid, r.json.text, r.json.field.displayName, r.json.field.caption], ["fx01-4", "영희의 바다 2번째 이야기", "포인트 텍스트", false]);
		r = await call("find_row", { label: "#99" });
		assert.deepEqual([r.isError, r.json.code], [true, "not-found"]);
		r = await call("get_suggestions", {});
		assert.deepEqual(r.json.suggestions.map((s) => [s.v, s.check]), [["바다$$이야기", "✓ 본문에 있음"]]);
		r = await call("plan_apply", { speaker: "C1" });
		assert.deepEqual([r.json.planToken, r.json.lines[1]], ["p-fx-1", "C2 영희 → V4 (새 트랙, 2줄)"]);
		assert.match(r.json.note, /타임라인은 바뀌지 않았습니다/);
		r = await call("plan_apply", { speaker: "C1", uids: ["fx01-1"] });
		assert.deepEqual([r.isError, r.json.code], [true, "bad-args"]);
		r = await call("verify_timeline", {});
		assert.equal(r.json.text, "정상 3 · 타임라인에 없음 1");
		// 패널이 받은 명령: source는 패널이 agent로 정한다, by는 클라이언트 이름에서
		const log = M.readLog(logFile);
		assert.deepEqual(log.map((m) => m.op), ["status", "presets", "cast.get", "rows", "rows", "rows", "rows", "resolve", "resolve", "resolve", "sugg.list", "plan", "verify"]);
		assert.ok(log.every((m) => m.by === "codex" && m.v === 1 && typeof m.at === "number"), "by codex");
		assert.deepEqual(log[4].args, { count: 50, spk: "C2" }, "speaker → spk, 기본 50줄");
		assert.deepEqual(log[11].args, { spk: "C1" });
	} finally {
		await c.close();
		await fake.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("core 해시가 다르면 get_status가 panel-version-mismatch로 알린다 (읽기는 된다)", async () => {
	const tmp = M.tmpDir("mismatch");
	const dir = path.join(tmp, "bridge");
	const ext = M.makeExt(tmp);
	const fake = await M.startFake(tmp, { mode: "fixture", dir, extPath: ext.extPath, coreHash: "deadbeef" });
	const c = await M.connect({ MI_BRIDGE_DIR: dir });
	try {
		const r = await M.callJson(c.client, "get_status", {});
		assert.equal(r.isError, false);
		assert.deepEqual([r.json.core.match, r.json.core.code, r.json.core.panel, r.json.core.server], [false, "panel-version-mismatch", "deadbeef", ext.coreHash]);
		const rows = await M.callJson(c.client, "get_rows", {});
		assert.equal(rows.isError, false, "읽기 도구는 된다");
		// 설치본 파일이 없으면 core-unavailable
		fs.rmSync(path.join(ext.extPath, "html"), { recursive: true, force: true });
		const r2 = await M.callJson(c.client, "get_status", {});
		assert.deepEqual([r2.json.core.match, r2.json.core.code], [false, "core-unavailable"]);
	} finally {
		await c.close();
		await fake.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("끝에서 끝: 진짜 패널(app.js 전체, vm) ↔ 다리 폴더 ↔ 서버 — 읽기 도구", async () => {
	const tmp = M.tmpDir("e2e");
	const ext = M.makeExt(tmp);
	const appdata = path.join(tmp, "appdata");
	const snapFile = path.join(tmp, "snap.json");
	const fake = await M.startFake(tmp, { mode: "harness", appdata, extPath: ext.extPath, snapFile });
	const c = await M.connect({ MI_BRIDGE_DIR: path.join(appdata, "MogrtImporter", "bridge") }, "claude-code");
	try {
		const call = async (name, args) => {
			const r = await M.callJson(c.client, name, args);
			assert.equal(r.isError, false, name + " " + r.text);
			assert.ok(r.ms < 5000, name + " 5초 안: " + r.ms);
			return r.json;
		};
		const st = await call("get_status", {});
		assert.deepEqual([st.panel.rows, st.panel.speakers.map((s) => s.key), st.core.match, st.client], [24, ["C1", "C2"], true, "claude"]);
		const pr = await call("list_presets", {});
		assert.deepEqual(pr.presets[0].fields.map((f) => f.fid + (f.caption ? "*" : "")), ["T1*", "T2"]);
		assert.match(pr.presets[0].notes[0], /최대 3개/);
		const rows = await call("get_rows", { speaker: "C2", count: 5 });
		assert.deepEqual([rows.total, rows.rows.length, rows.rows[0].text], [12, 5, "영희의 바다 1번째 이야기"]);
		const f = await call("find_row", { label: "C2" + DOT + "3 T2" });
		assert.deepEqual([f.text, f.field.fid, f.field.caption], ["영희의 바다 3번째 이야기", "T2", false]);
		assert.equal(f.sig, rows.rows[2].sig);
		const cast = await call("get_cast", {});
		assert.deepEqual(cast.castOrder, ["C1", "C2"]);
		const plan = await call("plan_apply", { speaker: "C1" });
		assert.match(plan.planToken, /^p/);
		assert.ok(plan.plan && plan.plan.ops, JSON.stringify(plan).slice(0, 300));
		const vr = await call("verify_timeline", {});
		assert.equal(typeof vr.counts, "object");
		const sg = await call("get_suggestions", {});
		assert.deepEqual(sg.suggestions, []);
		const snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
		assert.deepEqual(snap.errors, [], "패널 예외 없음");
	} finally {
		await c.close();
		await fake.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
