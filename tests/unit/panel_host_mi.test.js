"use strict";
// S2-1: 패널 어댑터 host.mi(_callMi)와 _miHostOk — 접두사·build·seqId 붙이기, U+2028/2029 이스케이프, 응답 파싱, ping 확인.
// panelHarness로 app.js 전체를 돌린다. 호스트 처리기는 테스트가 h.host.handlers[이름]으로 둔다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel } = require("../lib/panelHarness");

const A = { seqId: "aaaa-0001", seqName: "T_A", projPath: "C:/work/mi.prproj" };
const SEP_A = String.fromCharCode(0x2028);
const SEP_B = String.fromCharCode(0x2029);
const BS = String.fromCharCode(92);
const plainOf = (v) => JSON.parse(JSON.stringify(v));

async function boot() {
	const h = await bootPanel({ seq: A });
	await h.advance(1000);
	return h;
}
const lastCall = (h, fn) => h.host.calls.filter((c) => c.fn === fn).pop();
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}

test("_callMi: MI_ 접두사, build·seqId를 붙인 JSON 하나, 파싱한 객체를 그대로 돌려준다 (ok:false 포함)", async () => {
	const h = await boot();
	h.host.handlers.MI_getTracks = (json) => JSON.stringify({ ok: true, echo: JSON.parse(json) });
	const r = plainOf(await h.win._mogrtDebug.callMi("getTracks", { tracks: [2, 3], fromFrame: 0 }));
	assert.equal(r.ok, true);
	assert.deepEqual(r.echo, { tracks: [2, 3], fromFrame: 0, build: "@@BUILD@@", seqId: A.seqId });
	const call = lastCall(h, "MI_getTracks");
	assert.match(call.script, /^MI_getTracks\(decodeURIComponent\("/, "URI 인코딩한 JSON 문자열 하나");
	// 호출부가 준 seqId(적용을 시작할 때 잡은 시퀀스)는 그대로 둔다
	await h.win._mogrtDebug.callMi("getTracks", { seqId: "captured-seq", tracks: null });
	assert.equal(JSON.parse(lastCall(h, "MI_getTracks").args[0]).seqId, "captured-seq");
	// 호스트의 실패 응답은 던지지 않고 돌려준다
	h.host.handlers.MI_readClipTexts = () => JSON.stringify({ ok: false, error: "seq-mismatch", detail: "활성 x / 요청 y" });
	assert.deepEqual(plainOf(await h.win._mogrtDebug.callMi("readClipTexts", { items: [] })), { ok: false, error: "seq-mismatch", detail: "활성 x / 요청 y" });
	noErrors(h);
});

test("_callMi: 문자열 속 U+2028/2029는 JSON 이스케이프로 보낸다 (호스트 JSON.parse가 eval이라 날 문자는 문법 오류)", async () => {
	const h = await boot();
	let got = null;
	h.host.handlers.MI_getTracks = (json) => { got = json; return "{\"ok\":true}"; };
	const note = "줄" + SEP_A + "바꿈" + SEP_B + "끝";
	await h.win._mogrtDebug.callMi("getTracks", { note, tracks: null });
	assert.equal(got.indexOf(SEP_A), -1, "날 U+2028 없음");
	assert.equal(got.indexOf(SEP_B), -1, "날 U+2029 없음");
	assert.ok(got.indexOf(BS + "u2028") !== -1 && got.indexOf(BS + "u2029") !== -1);
	// ES3 eval로 읽어도 된다 (호스트 폴리필 JSON.parse = eval("(" + s + ")"))
	assert.equal((0, eval)("(" + got + ")").note, note);
	noErrors(h);
});

test("_callMi: ping은 인자 없이, 빈 응답·EvalScript error.·JSON 아님·객체 아님은 던진다", async () => {
	const h = await boot();
	h.host.handlers.MI_ping = () => JSON.stringify({ ok: true, v: 28, build: "@@BUILD@@" });
	assert.equal((await h.win._mogrtDebug.callMi("ping")).v, 28);
	const call = lastCall(h, "MI_ping");
	assert.equal(call.script, "MI_ping()");
	delete h.host.handlers.MI_ping;
	await assert.rejects(h.win._mogrtDebug.callMi("ping"), /빈 응답/);
	h.host.handlers.MI_ping = () => { throw new Error("jsx"); };
	await assert.rejects(h.win._mogrtDebug.callMi("ping"), /ExtendScript 실행 오류/);
	h.host.handlers.MI_ping = () => "ERROR: 옛 호스트";
	await assert.rejects(h.win._mogrtDebug.callMi("ping"), /JSON 파싱 실패/);
	h.host.handlers.MI_ping = () => "[1,2]";
	await assert.rejects(h.win._mogrtDebug.callMi("ping"), /객체가 아니다/);
});

test("_miHostOk: 실행마다 ping (캐시 없음), v 28이고 빌드가 같아야 한다", async () => {
	const h = await boot();
	const MSG = "다른 버전의 호스트 스크립트가 로드됨 — Premiere를 다시 시작하세요";
	let r = plainOf(await h.win._mogrtDebug.miHostOk());
	assert.deepEqual([r.ok, r.why, r.msg], [false, "no-host", MSG], "MI_ping이 없는 호스트(v27 캐시)");
	h.host.handlers.MI_ping = () => JSON.stringify({ ok: true, v: 27, build: "@@BUILD@@" });
	r = plainOf(await h.win._mogrtDebug.miHostOk());
	assert.deepEqual([r.ok, r.why], [false, "version"]);
	h.host.handlers.MI_ping = () => JSON.stringify({ ok: true, v: 28, build: "dev-1234567" });
	r = plainOf(await h.win._mogrtDebug.miHostOk());
	assert.deepEqual([r.ok, r.why, r.msg, r.ping.build], [false, "build", MSG, "dev-1234567"]);
	h.host.handlers.MI_ping = () => JSON.stringify({ ok: true, v: 28, build: "@@BUILD@@", seqId: A.seqId });
	const before = h.host.calls.filter((c) => c.fn === "MI_ping").length;
	r = plainOf(await h.win._mogrtDebug.miHostOk());
	assert.deepEqual([r.ok, r.ping.seqId], [true, A.seqId]);
	await h.win._mogrtDebug.miHostOk();
	assert.equal(h.host.calls.filter((c) => c.fn === "MI_ping").length, before + 2, "부를 때마다 새로 ping한다");
	noErrors(h);
});

test("status: panel.build는 이 패널의 빌드, host는 v28 ping 결과 (없으면 null)", async () => {
	const h = await boot();
	let st = plainOf(await h.win._mogrtDebug.cmd("status", {}));
	assert.deepEqual([st.data.panel, st.data.host], [{ v: 28, build: "@@BUILD@@" }, null]);
	const ping = { ok: true, v: 28, build: "@@BUILD@@", prefix: "MI_", seqId: A.seqId, seqName: "T_A", isPreview: false, docId: "d", frameTicks: "10594584000", zeroPoint: "0", endFrame: 0 };
	h.host.handlers.MI_ping = () => JSON.stringify(ping);
	st = plainOf(await h.win._mogrtDebug.cmd("status", {}));
	assert.deepEqual(st.data.host, ping);
	noErrors(h);
});
