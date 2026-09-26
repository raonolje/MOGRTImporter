"use strict";
// S0-2: CDP 실행기(tests/premiere)의 순수 부분. Premiere·CDP 포트에는 붙지 않는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkGuard, guard, GuardError } = require("../premiere/lib/guard");
const { Cdp, checkPort, checkProdFile, pickTarget, parseCliArgs } = require("../premiere/cdp");
const R = require("../premiere/run");
const { caseFiles, failHint } = require("../premiere/suite");
const H = require("../premiere/lib/hard");

const SMOKE = path.join(__dirname, "..", "premiere", "smoke.expr.txt");
const TEST_PROJ = "C:\\Users\\RAONOLJE\\Documents\\MI_test\\MI_test.prproj";

test("guard: MI_test.prproj의 T_ 시퀀스만 통과", () => {
	assert.deepEqual(checkGuard({ projPath: TEST_PROJ, seqName: "T_23976" }), { ok: true });
	assert.deepEqual(checkGuard({ projPath: "C:/x/MI_test.prproj", seqName: "T_TC1h" }), { ok: true });
	const refuse = (info, re) => {
		const r = checkGuard(info);
		assert.equal(r.ok, false);
		assert.match(r.reason, re);
	};
	refuse({ projPath: "C:\\Users\\RAONOLJE\\Documents\\EP12\\EP12.prproj", seqName: "T_23976" }, /테스트 프로젝트가 아니다/);
	refuse({ projPath: "C:/x/MI_test.prproj.bak", seqName: "T_1" }, /테스트 프로젝트가 아니다/);
	refuse({ projPath: "C:/x/NOT_MI_test.prproj", seqName: "T_1" }, /테스트 프로젝트가 아니다/);
	refuse({ projPath: TEST_PROJ, seqName: "EP12 편집" }, /테스트 시퀀스가 아니다/);
	refuse({ projPath: TEST_PROJ, seqName: "" }, /활성 시퀀스가 없다/);
	refuse({ projPath: "", seqName: "T_1" }, /경로/);
	refuse(null, /경로/);
});

test("guard(host): MI_test 밖에서는 GuardError, 안에서는 정보를 돌려준다", async () => {
	const hostOf = (obj) => async (jsx) => {
		assert.equal(jsx, "getActiveSequenceInfo()");
		return typeof obj === "string" ? obj : JSON.stringify(obj);
	};
	await assert.rejects(guard(hostOf({ seqId: "a", seqName: "EP12", projPath: "D:/work/EP12.prproj" })), GuardError);
	await assert.rejects(guard(hostOf("EvalScript error.")), /읽지 못했다/);
	const info = await guard(hostOf({ seqId: "abc", seqName: "T_25", projPath: TEST_PROJ }));
	assert.equal(info.seqId, "abc");
});

test("checkPort: 7777은 --prod일 때만, --prod는 7777에서만", () => {
	assert.equal(checkPort(7778), 7778);
	assert.equal(checkPort("7778"), 7778);
	assert.throws(() => checkPort(7777), /운영 패널/);
	assert.equal(checkPort(7777, { prod: true }), 7777);
	assert.throws(() => checkPort(7778, { prod: true }), /--prod/);
	assert.throws(() => checkPort("abc"), /포트/);
});

test("pickTarget: DEV는 CEP_MogrtImporter_dev 페이지만, 운영은 운영 페이지만", () => {
	const dev = { type: "page", url: "file:///C:/Users/R/AppData/Roaming/Adobe/CEP/extensions/CEP_MogrtImporter_dev/html/index.html", webSocketDebuggerUrl: "ws://dev" };
	const prod = { type: "page", url: "file:///C:/Users/R/AppData/Roaming/Adobe/CEP/extensions/CEP_MogrtImporter/html/index.html", webSocketDebuggerUrl: "ws://prod" };
	const other = { type: "page", url: "file:///C:/x/MCPBridgeCEP/index.html", webSocketDebuggerUrl: "ws://o" };
	assert.equal(pickTarget([other, dev]).webSocketDebuggerUrl, "ws://dev");
	assert.throws(() => pickTarget([prod, other]), /DEV\(CEP_MogrtImporter_dev\)/);
	assert.equal(pickTarget([dev, prod], { prod: true }).webSocketDebuggerUrl, "ws://prod");
	assert.throws(() => pickTarget([dev], { prod: true }), /운영/);
	assert.throws(() => pickTarget([{ type: "service_worker", url: "x" }]), /페이지 대상이 없다/);
	const broken = { ...dev, url: dev.url.replace("index.html", "index%E0%A4.html") };
	assert.equal(pickTarget([broken]).webSocketDebuggerUrl, "ws://dev");
});

test("splitExprs: '---' 줄로 나누고 CRLF·빈 조각을 정리한다", () => {
	const ex = R.splitExprs("// a\n1 + 1\r\n---\r\n\n// b\n2\n---\n\n---  \n");
	assert.deepEqual(ex.map((e) => e.label), ["// a", "// b"]);
	assert.equal(ex[0].code, "// a\n1 + 1");
	assert.deepEqual(R.splitExprs("a --- b"), [{ label: "a --- b", code: "a --- b" }]);
	assert.deepEqual(R.splitExprs("---\n1\n---\n2\n---").map((e) => e.code), ["1", "2"]);
});

test("smoke.expr.txt: 두 표현식이 있고 문법이 맞다", () => {
	const file = path.join(__dirname, "..", "premiere", "smoke.expr.txt");
	const ex = R.splitExprs(fs.readFileSync(file, "utf8"));
	assert.equal(ex.length, 2);
	assert.match(ex[0].code, /_mogrtDebug/);
	assert.match(ex[1].code, /getActiveSequenceInfo\(\)/);
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	for (const e of ex) assert.doesNotThrow(() => new AsyncFunction(e.code), e.label);
});

test("jsxString: ASCII만 쓰고, 값은 그대로 되돌아온다", () => {
	const samples = ["", "a\"b'c\\d", "줄\n바꿈\r\t탭", "\u2028\u2029", "철수 [MI:ab12-1.1]", "😀 이모지", "\u0000\u001f\u007f"];
	for (const s of samples) {
		const lit = R.jsxString(s);
		assert.match(lit, /^[\x20-\x7e]*$/, "ASCII 출력");
		assert.equal(eval(lit), s);
	}
});

test("hostCallSource: payload JSON을 ASCII 리터럴로 넘긴다 (U+2028 안전)", () => {
	const payload = { seqId: "8f1c", text: "앞\u2028뒤 \"따옴표\"", n: 3 };
	const src = R.hostCallSource("MID_ping", payload);
	assert.match(src, /^MID_ping\("[\x20-\x7e]*"\)$/);
	const got = new Function("MID_ping", "return " + src)((s) => s);
	assert.deepEqual(JSON.parse(got), payload);
	// 호스트가 받는 문자열(= parsePayload 입력)에 날 U+2028/2029가 없어야 한다.
	// 호스트 JSON.parse 폴리필은 ES3 eval이라 문자열 속 날 구분자를 줄 끝으로 보고 문법 오류를 낸다.
	// V8 JSON.parse·eval은 날 구분자를 받아 주므로, ES3 흉내로 LF로 바꿔 eval한다.
	const RAW_SEP_G = new RegExp("[\\u2028\\u2029]", "g");
	const es3Parse = (s) => eval("(" + s.replace(RAW_SEP_G, "\n") + ")");
	assert.ok(!new RegExp("[\\u2028\\u2029]").test(got), "날 U+2028/2029가 호스트까지 갔다");
	assert.deepEqual(es3Parse(got), payload);
	const p2 = { t: "a" + String.fromCharCode(0x2029) + "b" + String.fromCharCode(0x2028) };
	const got2 = new Function("MID_x", "return " + R.hostCallSource("MID_x", p2))((s) => s);
	assert.ok(!new RegExp("[\\u2028\\u2029]").test(got2));
	assert.deepEqual(es3Parse(got2), p2);
	assert.equal(R.hostCallSource("MID_ping"), "MID_ping()");
	assert.throws(() => R.hostCallSource("x); evil(", {}), /함수 이름/);
});

test("asciiJsx / evalScriptExpr: 비ASCII는 \\u 이스케이프, 뜻은 그대로", () => {
	const src = "var s = \"가\u2028나\"; // 주석 한글\nvar r = /철수/.test(\"철수\"); s + r";
	const a = R.asciiJsx(src);
	assert.match(a, /^[\x00-\x7f]*$/);
	assert.equal(eval(a), eval(src.replace("\u2028", "\\u2028")));
	assert.match(R.evalScriptExpr(src), /^[\x00-\x7f]*$/);
	assert.match(R.evalScriptExpr("getActiveSequenceInfo()"), /new CSInterface\(\)\.evalScript\("getActiveSequenceInfo\(\)"/);
});

test("rewriteMiForDev: spike .jsx의 MI_ 호출을 MID_로", () => {
	assert.equal(R.rewriteMiForDev("MI_ping(); MI__json(1); '[MI:a-1.1]'"), "MID_ping(); MID__json(1); '[MI:a-1.1]'");
	// 테스트 프로젝트 확인(MI_test.prproj)은 DEV에서도 그대로여야 스스로 실패하지 않는다
	assert.equal(R.rewriteMiForDev("if (String(app.project.path).indexOf(\"MI_test.prproj\") < 0) throw \"not test\"; MI_getTracks(p);"),
		"if (String(app.project.path).indexOf(\"MI_test.prproj\") < 0) throw \"not test\"; MID_getTracks(p);");
});

test("runFile: --prod는 .expr.txt만, --no-guard는 .expr.txt에만", async () => {
	const client = {}; // 종류 검사에서 먼저 거부되므로 쓰이지 않는다
	await assert.rejects(R.runFile(client, "x.jsx", { prod: true }), /--prod에서는/);
	await assert.rejects(R.runFile(client, "x.case.js", { prod: true }), /--prod에서는/);
	await assert.rejects(R.runFile(client, "x.case.js", { guard: false }), /--no-guard/);
	await assert.rejects(R.runFile(client, "x.txt", {}), /모르는 파일 종류/);
});

test("parseArgs: 기본 7778, 7777은 --prod 필요", () => {
	assert.equal(R.parseArgs(["a.expr.txt"]).port, 7778);
	assert.throws(() => R.parseArgs(["--port", "7777", "a.expr.txt"]), /운영 패널/);
	assert.equal(R.parseArgs(["--prod", "--port", "7777", SMOKE]).prod, true);
	assert.equal(R.parseArgs(["--check-build"]).checkBuild, true);
	assert.throws(() => R.parseArgs([]), /파일이 없다/);
});

test("--prod 정책: 저장소 smoke.expr.txt와 --check-build만, --reload는 거부 (run.js·cdp.js)", async () => {
	// run.js
	assert.equal(R.parseArgs(["--prod", "--port", "7777", "--check-build"]).checkBuild, true);
	assert.deepEqual(R.parseArgs(["--prod", "--port", "7777", path.relative(process.cwd(), SMOKE)]).files.length, 1);
	assert.throws(() => R.parseArgs(["--prod", "--port", "7777", "a.expr.txt"]), /읽기 전용 스모크만/);
	assert.throws(() => R.parseArgs(["--prod", "--port", "7777", path.join(os.tmpdir(), "smoke.expr.txt")]), /읽기 전용 스모크만/);
	assert.throws(() => R.parseArgs(["--prod", "--port", "7777", "--reload"]), /--reload/);
	assert.equal(R.parseArgs(["--reload"]).reload, true); // DEV 새로 고침은 된다
	await assert.rejects(R.runFile({}, "write_cache.expr.txt", { prod: true }), /읽기 전용 스모크만/);
	// cdp.js
	assert.throws(() => parseCliArgs(["--prod", "--port", "7777", "--reload"]), /--reload/);
	assert.throws(() => parseCliArgs(["--prod", "--port", "7777", "--expr-file", "x.expr.txt"]), /읽기 전용 스모크만/);
	assert.equal(parseCliArgs(["--prod", "--port", "7777", "--expr-file", SMOKE]).exprFile, SMOKE);
	assert.equal(parseCliArgs(["--port", "7778", "--reload", "--expr-file", "x.expr.txt"]).reload, true);
	assert.equal(checkProdFile(SMOKE), path.resolve(SMOKE));
});

test("runFile --no-guard: 실행 전에 열린 프로젝트·시퀀스를 찍는다", async () => {
	const file = path.join(os.tmpdir(), "mi_noguard_" + process.pid + ".expr.txt");
	fs.writeFileSync(file, "1 + 1\n");
	const seen = [];
	const client = {
		async evaluate(expr) {
			seen.push(expr);
			if (expr.indexOf("getActiveSequenceInfo") !== -1) return JSON.stringify({ projPath: "D:/work/EP12.prproj", seqName: "EP12 편집" });
			return 2;
		}
	};
	const logs = [];
	try {
		await R.runFile(client, file, { guard: false }, (s) => logs.push(s));
	} finally { fs.unlinkSync(file); }
	assert.match(logs[0], /가드 없음.*EP12\.prproj.*EP12 편집/);
	assert.equal(seen[seen.length - 1], "1 + 1");
});

test("expectedBuild: 설치본 hostscript의 MID_BUILD, 없으면 .mi_build", () => {
	const ext = fs.mkdtempSync(path.join(os.tmpdir(), "mi_ext_"));
	try {
		const dev = path.join(ext, "CEP_MogrtImporter_dev");
		fs.mkdirSync(path.join(dev, "jsx"), { recursive: true });
		fs.writeFileSync(path.join(dev, "jsx", "hostscript.jsx"), "function a() {}\n");
		fs.writeFileSync(path.join(dev, ".mi_build"), "dev-0aa8b82\ninstalled …\n");
		assert.equal(R.expectedBuild({ extDir: ext }).build, "dev-0aa8b82");
		fs.writeFileSync(path.join(dev, "jsx", "hostscript.jsx"), "var MID_VERSION = 28, MID_BUILD = 'dev-1234567-d1';\n");
		assert.equal(R.expectedBuild({ extDir: ext }).build, "dev-1234567-d1");
		assert.equal(R.expectedBuild({ extDir: ext, prod: true }).build, null);
	} finally { fs.rmSync(ext, { recursive: true, force: true }); }
});

test("suite: cases 폴더가 없거나 비면 빈 목록, 필터는 이름 부분 일치", () => {
	assert.ok(Array.isArray(caseFiles([])));
	assert.deepEqual(caseFiles(["__없는_케이스__"]), []);
});

// 가짜 WebSocket으로 Cdp의 요청·응답·예외·이벤트 처리를 확인한다
function fakeWs(handler) {
	const ws = {
		sent: [],
		send(txt) {
			const msg = JSON.parse(txt);
			ws.sent.push(msg);
			setImmediate(() => handler(msg, (obj) => ws.onmessage({ data: JSON.stringify(obj) })));
		},
		close() {}
	};
	return ws;
}

test("Cdp.evaluate: 값, 예외, 오류 응답", async () => {
	const ws = fakeWs((msg, reply) => {
		const expr = msg.params.expression;
		if (expr === "ok") reply({ id: msg.id, result: { result: { type: "string", value: "v" } } });
		else if (expr === "undef") reply({ id: msg.id, result: { result: { type: "undefined" } } });
		else if (expr === "throw") reply({ id: msg.id, result: { result: {}, exceptionDetails: { exception: { description: "Error: 터짐\n    at x" } } } });
		else reply({ id: msg.id, error: { message: "bad" } });
	});
	const c = new Cdp(ws, { url: "x" }, { timeoutMs: 1000 });
	assert.equal(await c.evaluate("ok"), "v");
	assert.equal(await c.evaluate("undef"), undefined);
	await assert.rejects(c.evaluate("throw"), /Error: 터짐$/);
	await assert.rejects(c.evaluate("?"), /bad/);
	assert.equal(ws.sent[0].params.awaitPromise, true);
	assert.equal(ws.sent[0].params.replMode, true);
});

test("Cdp.reload: load 이벤트를 기다리고 그동안의 콘솔을 돌려준다", async () => {
	const ws = fakeWs((msg, reply) => {
		reply({ id: msg.id, result: {} });
		if (msg.method === "Page.reload") {
			setImmediate(() => {
				reply({ method: "Runtime.consoleAPICalled", params: { type: "log", args: [{ type: "string", value: "부팅" }] } });
				reply({ method: "Runtime.exceptionThrown", params: { exceptionDetails: { exception: { description: "TypeError: x" } } } });
				reply({ method: "Page.loadEventFired", params: {} });
			});
		}
	});
	const c = new Cdp(ws, { url: "x" }, { timeoutMs: 1000 });
	const logs = await c.reload({ settleMs: 0 });
	assert.deepEqual(logs, ["[log] \"부팅\"", "[EXCEPTION] TypeError: x"]);
});

test("suite failHint: 시간 초과(케이스 대기·CDP)에만 모달 안내를 붙인다", () => {
	assert.match(failHint("시간 초과(240000ms): 화자별 적용이 끝나지 않았다 — 마지막 문구: 배치 중 전체 3/120"), /모달/);
	assert.match(failHint("시간 초과(30000ms): 검수 창 — 마지막 값: null"), /모달/);
	assert.match(failHint("시간 초과(120000ms): Runtime.evaluate"), /모달/);
	assert.equal(failHint("V3 클립 수: 2 !== 3"), null);
	assert.equal(failHint(undefined), null);
});

test("hard miApplyButton (S3-4 리뷰): 끝나지 않으면 '시간 초과(…ms)' 문구에 마지막 진행·워치독 문구를 싣고 스위트가 모달 안내를 붙인다", async () => {
	const seen = [];
	// ExtendScript가 막혀도 페이지는 돈다: 바쁨이 풀리지 않고 워치독 문구가 보인다
	const panel = async (expr) => {
		seen.push(expr);
		if (expr === H.PAGE_MI_APPLY_STATE) return { pf: null, busy: true, text: "화자별 배치 중… 전체 8/120", watch: "Premiere에 대화상자가 떠 있을 수 있습니다", confirm: null };
		if (expr === H.PAGE_STATUS) return { text: "", cls: "" };
		return true;
	};
	let err = null;
	try {
		await H.miApplyButton({ panel }, null, { timeoutMs: 20 });
	} catch (e) {
		err = e;
	}
	assert.ok(err, "시간이 넘으면 실패한다");
	assert.match(err.message, /^시간 초과\(20ms\): 화자별 적용이 끝나지 않았다 — 마지막 문구: 화자별 배치 중… 전체 8\/120 · 워치독: Premiere에 대화상자가 떠 있을 수 있습니다$/);
	assert.match(failHint(err.message), /모달/);
	assert.ok(seen.some((x) => /btnApply/.test(x)), "▶를 눌렀다");
});

test("hard miApplyButton: 점검 창 대신 확인창(체크된 줄)이 뜨면 [취소]로 닫고 그 문구로 실패한다. 점검 창이면 onPf 뒤 [적용]", async () => {
	const clicks = [];
	let n = 0;
	const panel1 = async (expr) => {
		if (/click\(\)/.test(expr)) clicks.push(expr);
		if (expr === H.PAGE_MI_APPLY_STATE) return { pf: null, busy: false, text: "", watch: "", confirm: "3개 자막이 선택되어 있습니다." };
		return true;
	};
	await assert.rejects(H.miApplyButton({ panel: panel1 }, null, { timeoutMs: 1000 }), /확인창을 띄웠다 \(체크된 줄\?\): 3개 자막이 선택되어 있습니다\./);
	assert.ok(clicks.some((x) => /confirmNo/.test(x)), "[취소]");
	clicks.length = 0;
	const pfs = [];
	const panel2 = async (expr) => {
		if (/click\(\)/.test(expr)) clicks.push(expr);
		if (expr === H.PAGE_MI_APPLY_STATE) {
			n++;
			if (n === 1) return { pf: { lines: ["배치 2줄: C1 철수 V3 1 · C2 영희 V4 1"] }, busy: true, text: "", watch: "", confirm: null };
			if (n === 2) return { pf: null, busy: true, text: "화자별 배치 중… 전체 2/2", watch: "", confirm: null };
			return { pf: null, busy: false, text: "", watch: "", confirm: null };
		}
		if (expr === H.PAGE_STATUS) return { text: "화자별 배치: 놓음 2", cls: "ok" };
		return true;
	};
	const r = await H.miApplyButton({ panel: panel2 }, async (pf) => pfs.push(pf.lines[0]), { timeoutMs: 5000 });
	assert.deepEqual(pfs, ["배치 2줄: C1 철수 V3 1 · C2 영희 V4 1"]);
	assert.ok(clicks.some((x) => /pfOk/.test(x)), "[적용]");
	assert.deepEqual([r.status.text, r.progress], ["화자별 배치: 놓음 2", ["화자별 배치 중… 전체 2/2"]]);
});
