"use strict";
// M5.1: node 쪽 다리 클라이언트(mcp/lib/bridge.js, 의존성 없음) — heartbeat 판정(off·closed·낡음·없음·살아 있음),
// 시간 초과면 가져가지 않은 명령을 거둔다, 그리고 진짜 폴더(os.tmpdir)로 패널 하네스(app.js 전체)와 왕복한다
// (패널 inbox.ts와 bridge.js가 같은 약속을 쓰는지: tmp → rename, outbox 읽고 지우기, 한국어 그대로).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const B = require("../../mcp/lib/bridge");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { regionHash } = require("../lib/loadRegions");

function tmpDir(tag) {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mi_bridge_" + tag + "_"));
}
const writeHb = (dir, o) => {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "heartbeat.json"), JSON.stringify(o));
};

test("bridgeDir: MI_BRIDGE_DIR > APPDATA/MogrtImporter/bridge", () => {
	assert.equal(B.bridgeDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }), path.join("C:\\Users\\u\\AppData\\Roaming", "MogrtImporter", "bridge"));
	assert.equal(B.bridgeDir({ MI_BRIDGE_DIR: "D:/x/bridge_dev", APPDATA: "C:/a" }), path.resolve("D:/x/bridge_dev"));
	assert.match(B.newId(), B.ID_RE);
	assert.notEqual(B.newId(), B.newId());
});

test("checkPanel: 신호 없음 · 꺼짐(기다리지 않음) · 닫힘 · 낡음 · 살아 있음", async () => {
	const dir = tmpDir("hb");
	try {
		let r = await B.checkPanel(dir, { waitMs: 200, stepMs: 50 });
		assert.deepEqual([r.ok, r.code], [false, "no-heartbeat"]);
		assert.match(r.hint, /AI 연결 허용/);
		writeHb(dir, { v: 1, at: Date.now() - 999999, state: "off" });
		const t0 = Date.now();
		r = await B.checkPanel(dir, { waitMs: 3000 });
		assert.deepEqual([r.ok, r.code], [false, "ai-link-off"]);
		assert.ok(Date.now() - t0 < 1000, "꺼짐은 기다리지 않는다");
		writeHb(dir, { v: 1, at: Date.now(), state: "closed" });
		r = await B.checkPanel(dir, { waitMs: 200, stepMs: 50 });
		assert.deepEqual([r.ok, r.code], [false, "panel-closed"]);
		writeHb(dir, { v: 1, at: Date.now() - 60000, state: "on" });
		r = await B.checkPanel(dir, { waitMs: 200, stepMs: 50 });
		assert.deepEqual([r.ok, r.code], [false, "panel-not-responding"]);
		assert.match(r.message, /마지막 신호 60초 전/);
		writeHb(dir, { v: 1, at: Date.now(), state: "on", coreHash: "12345678" });
		r = await B.checkPanel(dir);
		assert.deepEqual([r.ok, r.hb.coreHash], [true, "12345678"]);
		// 낡은 신호를 보다가 기다리는 동안 새 신호가 오면 통과
		writeHb(dir, { v: 1, at: Date.now() - 60000, state: "on" });
		setTimeout(() => writeHb(dir, { v: 1, at: Date.now(), state: "on" }), 150);
		r = await B.checkPanel(dir, { waitMs: 2000, stepMs: 50 });
		assert.equal(r.ok, true);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("call: 응답이 없으면 timeout, 패널이 가져가지 않은 명령은 거둔다", async () => {
	const dir = tmpDir("to");
	try {
		await assert.rejects(B.call(dir, "status", {}, { timeoutMs: 200, id: "m-timeout-1" }), (e) => {
			assert.equal(e.code, "timeout");
			assert.equal(e.withdrawn, true);
			assert.match(e.message, /가져가지 않았습니다/);
			return true;
		});
		assert.deepEqual(fs.readdirSync(path.join(dir, "inbox")), [], "거둔 명령은 남지 않는다");
		await assert.rejects(B.call(dir, "status", {}, { id: "../밖" }), /명령 id 형식/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("진짜 폴더로 패널(하네스)과 왕복: heartbeat의 coreHash, status·rows, seq 다름(빈 seqId 포함), needs-approval(한국어 문구), 끄면 off", async () => {
	const appdata = tmpDir("panel");
	const dir = path.join(appdata, "MogrtImporter", "bridge");
	const PROJ = "C:/work/bridge.prproj";
	const A = { seqId: "seq-bridge-1", seqName: "T_BRIDGE", projPath: PROJ };
	try {
		const h = await bootPanel({
			seq: A,
			files: { [P.session(PROJ, A.seqId)]: { subtitles: [{ index: 1, startTime: "00:00:01.000", endTime: "00:00:02.000", startSec: 1, endSec: 2, text: "하나", id: 1 }], rowStates: {}, trashBin: [], nextId: 2 } },
			node: { fs, env: { APPDATA: appdata } }
		});
		await h.advance(1000);
		const chk = h.$("aiLinkChk");
		chk.checked = true;
		h.change(chk);
		// 패널 시계(가짜)를 돌리면서 기다린다
		const pump = async (p) => {
			let done = false;
			let out;
			let err;
			p.then((v) => { done = true; out = v; }, (e) => { done = true; err = e; });
			for (let i = 0; i < 400 && !done; i++) {
				await h.advance(100);
				await new Promise((r) => setTimeout(r, 5));
			}
			if (err) throw err;
			assert.ok(done, "시간 안에 끝난다");
			return out;
		};
		const pc = await B.checkPanel(dir);
		assert.equal(pc.ok, true, JSON.stringify(pc));
		assert.equal(pc.hb.coreHash, regionHash("src/mi/core.ts"));
		const st = await pump(B.call(dir, "status", {}, { by: "codex" }));
		assert.deepEqual([st.ok, st.op, st.data.rows, st.data.seq.id], [true, "status", 1, A.seqId]);
		assert.deepEqual(fs.readdirSync(path.join(dir, "outbox")).filter((n) => !/\.tmp$/.test(n)), [], "읽은 응답은 지운다");
		const rows = await pump(B.call(dir, "rows", {}, { seqId: A.seqId }));
		assert.deepEqual(rows.data.rows.map((r) => [r.uid, r.text]), [["1", "하나"]]);
		const bad = await pump(B.call(dir, "rows", {}, { seqId: "다른 시퀀스" }));
		assert.deepEqual([bad.ok, bad.error], [false, "seq-mismatch"]);
		// 빈 seqId("" = 시퀀스 없음)도 싣는다: 빈 seq_id로 시퀀스 확인을 건너뛰지 못한다
		const empty = await pump(B.call(dir, "rows", {}, { seqId: "" }));
		assert.deepEqual([empty.ok, empty.error], [false, "seq-mismatch"]);
		const q = await pump(B.call(dir, "undo", {}, { by: "claude" }));
		assert.deepEqual([q.ok, q.error], [false, "needs-approval"]);
		assert.match(q.detail, /패널에서 승인해야 합니다/, "한국어 그대로");
		// 끄면 off
		chk.checked = false;
		h.change(chk);
		const off = await B.checkPanel(dir, { waitMs: 0 });
		assert.equal(off.code, "ai-link-off");
		assert.deepEqual(h.errors().map((e) => String(e.message || e)), []);
	} finally {
		fs.rmSync(appdata, { recursive: true, force: true });
	}
});
