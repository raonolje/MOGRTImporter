"use strict";
// 실제 SDK 서버 두 개 ↔ 임시 브리지 ↔ 실제 app.js VM. 승인/점검은 가짜 사용자 입력 통로만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("./lib/mcpClient");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(options = {}) {
	const tmp = M.tmpDir("jobs"), ext = M.makeExt(tmp);
	const appdata = path.join(tmp, "appdata"), controlFile = path.join(tmp, "control.json"), snapFile = path.join(tmp, "snap.json");
	const srt = path.join(tmp, "C3_new.srt");
	fs.writeFileSync(srt, "1\n00:00:01,000 --> 00:00:03,000\n새 화자 자막입니다\n", "utf8");
	const fake = await M.startFake(tmp, { mode: "harness", appdata, extPath: ext.extPath, controlFile, snapFile, applyFixture: true, single: !!options.single });
	const env = { MI_BRIDGE_DIR: path.join(appdata, "MogrtImporter", "bridge") };
	const clients = [await M.connect(env, "codex-mcp-client"), await M.connect(env, "Claude Desktop")];
	const call = async (name, args, who = 0) => {
		const r = await M.callJson(clients[who].client, name, args);
		assert.equal(r.isError, false, name + " " + r.text);
		return r.json;
	};
	let serial = 0;
	const control = async (input) => {
		const id = ++serial;
		fs.writeFileSync(controlFile + ".tmp", JSON.stringify(Object.assign({ id }, input)));
		fs.renameSync(controlFile + ".tmp", controlFile);
		for (let i = 0; i < 100; i++) {
			try {
				const r = JSON.parse(fs.readFileSync(controlFile + ".response", "utf8"));
				if (r.id === id) { assert.equal(r.error, undefined, r.error); return r.result; }
			} catch (e) { if (e.code !== "ENOENT") throw e; }
			await sleep(50);
		}
		throw new Error("사용자 입력 응답 없음: " + JSON.stringify(input));
	};
	const state = async (job_id, expected, who = 0) => {
		let r;
		for (let i = 0; i < 30; i++) {
			r = await call("wait_job", { job_id }, who);
			if (expected.includes(r.state)) return r;
			await sleep(100);
		}
		throw new Error("작업 상태: " + JSON.stringify(r));
	};
	const snap = async () => { await sleep(400); return JSON.parse(fs.readFileSync(snapFile, "utf8")); };
	const done = async () => {
		for (const c of clients) await c.close();
		await fake.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	};
	return { tmp, env, clients, call, control, state, snap, done, srt };
}

test("M5.4 SDK/VM: 두 클라이언트 요청·거절·승인·점검·성공, 같은 작업을 재접속 후 조회", async () => {
	const x = await setup();
	try {
		const st = await x.call("get_status", {}), rows = await x.call("get_rows", { count: 2 });
		const args = { seq_id: st.seq_id, scope: "rows", uids: rows.rows.map((r) => r.uid) };
		let j = await x.call("request_apply", args);
		assert.equal(j.state, "pending_approval");
		assert.equal(j.seq_id, st.seq_id);
		assert.equal(j.jobId, undefined);
		assert.equal((await x.call("wait_job", { job_id: j.job_id }, 1)).state, "pending_approval");
		let snap = await x.snap();
		assert.equal(snap.hostCalls.filter((fn) => /MI_(placeChunk|removeClips|setMotion)/.test(fn)).length, 0, "승인 전 타임라인 쓰기 없음");
		assert.ok(snap.ui.aiReq.some((s) => /Codex/.test(s)));
		await x.control({ op: "approvals.reject", args: { rid: j.rid } });
		assert.equal((await x.state(j.job_id, ["rejected"], 1)).state, "rejected");
		j = await x.call("request_apply", args, 1);
		assert.ok((await x.snap()).ui.aiReq.some((s) => /Claude/.test(s)));
		const approved = await x.control({ op: "approvals.approve", args: { rid: j.rid } });
		assert.equal(approved.ok, true, JSON.stringify(approved));
		const waiting = await x.state(j.job_id, ["waiting_input", "failed"]);
		assert.equal(waiting.state, "waiting_input", JSON.stringify(waiting));
		assert.equal((await x.call("wait_job", { job_id: j.job_id, wait_sec: 0.4 })).state, "waiting_input", "짧은 대기는 작업을 실패로 바꾸지 않음");
		await x.control({ click: "pfOk" });
		const finished = await x.state(j.job_id, ["succeeded", "failed"]);
		assert.equal(finished.state, "succeeded", JSON.stringify(finished));
		assert.equal(finished.result.ok, true);
		snap = await x.snap();
		assert.ok(snap.hostCalls.some((fn) => fn === "MI_placeChunk"));
		assert.deepEqual(snap.errors, []);
		await x.clients[0].close();
		x.clients[0] = await M.connect(x.env, "codex-mcp-client");
		assert.equal((await x.call("wait_job", { job_id: j.job_id })).state, "succeeded");
	} finally { await x.done(); }
});

test("M5.4 SDK/VM: import_srt는 승인·가져오기 확인까지 목록 그대로, 취소·읽기 실패·가져오기 성공을 구별", async () => {
	const x = await setup();
	try {
		const seq_id = (await x.call("get_status", {})).seq_id;
		const args = { seq_id, paths: [x.srt] };
		let j = await x.call("import_srt", args, 1);
		assert.equal(j.state, "pending_approval");
		assert.equal((await x.call("get_rows", {})).total, 24);
		await x.control({ op: "approvals.approve", args: { rid: j.rid } });
		assert.equal((await x.state(j.job_id, ["waiting_input", "failed"])).state, "waiting_input");
		assert.equal((await x.call("get_rows", {})).total, 24);
		await x.control({ click: "impCancel" });
		assert.equal((await x.state(j.job_id, ["cancelled"])).state, "cancelled");
		j = await x.call("import_srt", { seq_id, paths: [path.join(x.tmp, "missing.srt")] });
		await x.control({ op: "approvals.approve", args: { rid: j.rid } });
		const failed = await x.state(j.job_id, ["failed"]);
		assert.equal(failed.error.code, "read-failed");
		j = await x.call("import_srt", args);
		await x.control({ op: "approvals.approve", args: { rid: j.rid } });
		await x.state(j.job_id, ["waiting_input"]);
		await x.control({ click: "impOk" });
		const finished = await x.state(j.job_id, ["succeeded", "failed"]);
		assert.equal(finished.state, "succeeded", JSON.stringify(finished));
		assert.equal((await x.call("get_rows", { speaker: "C3" })).rows[0].text, "새 화자 자막입니다");
		assert.deepEqual((await x.snap()).errors, []);
	} finally { await x.done(); }
});

test("M5.4 SDK/VM: 잘못된 인자·시퀀스는 작업/승인 카드를 만들지 않는다", async () => {
	const x = await setup();
	try {
		const seq_id = (await x.call("get_status", {})).seq_id;
		for (const [name, args, code] of [
			["request_apply", { seq_id, scope: "rows", uids: [] }, "bad-args"],
			["request_apply", { seq_id, scope: "rows", uids: ["missing"] }, "not-found"],
			["request_apply", { seq_id: "other", scope: "changed" }, "seq-mismatch"],
			["import_srt", { seq_id, paths: ["https://example.com/a.srt"] }, "bad-args"],
			["import_srt", { seq_id: "other", paths: [x.srt] }, "seq-mismatch"],
			["wait_job", { job_id: "not-found" }, "not-found"],
			["wait_job", { job_id: "anything", wait_sec: 26 }, "bad-args"]
		]) {
			const r = await M.callJson(x.clients[0].client, name, args);
			assert.deepEqual([r.isError, r.json.code], [true, code], name + " " + r.text);
		}
		assert.equal((await x.call("get_status", {})).panel.approvals, 0);
		const simultaneous = await Promise.all([0, 1].map((who) => x.call("request_apply", { seq_id, scope: "changed" }, who)));
		assert.equal(new Set(simultaneous.map((j) => j.job_id)).size, 2, "동시 클라이언트는 서로 다른 작업");
		assert.equal((await x.call("get_status", {})).panel.approvals, 2);
		for (const j of simultaneous) {
			await x.control({ op: "approvals.reject", args: { rid: j.rid } });
			assert.equal((await x.call("wait_job", { job_id: j.job_id })).state, "rejected");
		}
	} finally { await x.done(); }
});

test("M5.4 SDK/VM: 화자 없는 목록은 적용 성공으로 오인시키지 않고 지원 범위와 패널 진행 방법을 알린다", async () => {
	const x = await setup({ single: true });
	try {
		const seq_id = (await x.call("get_status", {})).seq_id;
		const rows = await x.call("get_rows", {});
		for (const selection of [{ scope: "changed" }, { scope: "rows", uids: [rows.rows[0].uid] }]) {
			const r = await M.callJson(x.clients[0].client, "request_apply", Object.assign({ seq_id }, selection));
			assert.deepEqual([r.isError, r.json.code], [true, "unsupported-rows"], r.text);
			assert.match(r.json.hint, /패널.*▶.*화자/);
		}
		assert.equal((await x.call("get_status", {})).panel.approvals, 0);
		const snap = await x.snap();
		assert.equal(snap.hostCalls.filter((fn) => /MI_(placeChunk|removeClips|setMotion)/.test(fn)).length, 0);
		assert.deepEqual(snap.errors, []);
	} finally { await x.done(); }
});
