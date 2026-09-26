"use strict";
// M5.3: MCP 쓰기 도구 — suggest_fields(서버가 설치본 core의 validateSuggestion으로 먼저 확인, field_sig 되돌림, 패널 제안 대기열에만)와
// set_cast_proposal(패널 승인 카드, 화자 표·타임라인 그대로). 진짜 서버(SDK Client, stdio) ↔ 다리 ↔ 진짜 패널(app.js 전체를 vm으로, 가짜 패널 harness 모드).
//   20줄 포인트 텍스트 제안 → 대기열에만(속성 그대로, 'AI 제안 (20)'), 낡은 field_sig·캡션 필드·섞인 오류·최대 개수 초과는 아무것도 넣지 않음,
//   seq_id가 다르면 seq-mismatch, '#12 T2'는 find_row로, 한국어 메모 왕복, core 해시가 다르면 패널에 아무것도 보내지 않고 거절.
// 실행: npm run test:mcp (mcp/에서 npm install 필요)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("./lib/mcpClient");

const DOT = String.fromCharCode(0xb7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function harness(tag, clientName) {
	const tmp = M.tmpDir(tag);
	const ext = M.makeExt(tmp);
	const appdata = path.join(tmp, "appdata");
	const snapFile = path.join(tmp, "snap.json");
	const fake = await M.startFake(tmp, { mode: "harness", appdata, extPath: ext.extPath, snapFile });
	const c = await M.connect({ MI_BRIDGE_DIR: path.join(appdata, "MogrtImporter", "bridge") }, clientName);
	// 스냅숏은 0.3초마다 쓰인다 → 새것을 기다린다
	const snap = async () => {
		const t0 = Date.now();
		for (;;) {
			try {
				const st = fs.statSync(snapFile);
				if (st.mtimeMs > t0 + 50) return JSON.parse(fs.readFileSync(snapFile, "utf8"));
			} catch (_) {}
			if (Date.now() - t0 > 5000) throw new Error("스냅숏이 오지 않음");
			await sleep(100);
		}
	};
	const call = async (name, args) => M.callJson(c.client, name, args);
	const done = async () => {
		await c.close();
		await fake.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	};
	return { c, call, snap, done, ext };
}

test("끝에서 끝: suggest_fields 20줄 포인트 텍스트 → 제안 대기열에만, field_sig 되돌림, 틀린 제안이 섞이면 아무것도 넣지 않음, '#12 T2'는 find_row로", async () => {
	const x = await harness("sugg", "codex-mcp-client");
	try {
		const st = await x.call("get_status", {});
		assert.equal(st.isError, false, st.text);
		const seq_id = st.json.seq_id;
		assert.equal(seq_id, "seq-mcp-1");
		const c1 = await x.call("get_rows", { speaker: "C1", count: 12 });
		const c2 = await x.call("get_rows", { speaker: "C2", count: 12 });
		assert.equal(c1.json.seq_id, seq_id);
		const rows = c1.json.rows.slice(0, 10).concat(c2.json.rows.slice(0, 10));
		const items = rows.map((r) => ({ uid: r.uid, field_id: "T2", field_sig: r.sig, value: r.spk === "C1" ? "날씨$$맑음" : "바다$$이야기", note: "한국어 메모 ✓" }));
		const t0 = Date.now();
		let r = await x.call("suggest_fields", { seq_id, items });
		assert.equal(r.isError, false, r.text);
		assert.ok(Date.now() - t0 < 5000, "5초 안");
		assert.equal(r.json.queued, 20);
		assert.equal(r.json.results.length, 20);
		r.json.results.forEach((res, i) => {
			assert.deepEqual([res.uid, res.field_id, res.field_sig, res.ok, res.kind, res.check], [items[i].uid, "T2", items[i].field_sig, true, "point", "✓ 본문에 있음"]);
		});
		assert.match(r.json.message, /\[적용\]해야 바뀝니다/);
		// 대기열에만: 제안 20개, 속성(T2)은 그대로
		const sg = await x.call("get_suggestions", {});
		assert.equal(sg.json.suggestions.length, 20);
		assert.ok(sg.json.suggestions.every((s) => s.by === "codex" && s.ok && s.note === "한국어 메모 ✓"), JSON.stringify(sg.json.suggestions[0]));
		const f = await x.call("get_rows", { filter: "sugg", count: 50 });
		assert.equal(f.json.total, 20);
		assert.ok(f.json.rows.every((row) => row.fields.T2 === "" && row.sugg.T2), "속성은 그대로, 제안만");
		let s = await x.snap();
		assert.equal(s.ui.sugg, "AI 제안 (20)");
		assert.deepEqual(s.errors, []);
		// 낡은 field_sig → fields-changed, 아무것도 넣지 않는다
		r = await x.call("suggest_fields", { seq_id, items: [Object.assign({}, items[0], { field_sig: "T1:옛 구조" })] });
		assert.deepEqual([r.isError, r.json.code, r.json.results[0].error, r.json.results[0].field_sig], [true, "fields-changed", "fields-changed", "T1:옛 구조"]);
		// 캡션 필드·조각이 캡션에 없음·최대 개수 초과가 하나라도 섞이면 아무것도 넣지 않는다
		const row11 = c1.json.rows[10];
		r = await x.call("suggest_fields", { seq_id, items: [
			{ uid: row11.uid, field_id: "T2", field_sig: row11.sig, value: "날씨$$맑음" },
			{ uid: c1.json.rows[11].uid, field_id: "T2", field_sig: c1.json.rows[11].sig, value: "고래$$하늘" }
		] });
		assert.deepEqual([r.isError, r.json.code, r.json.results.map((q) => q.error)], [true, "rejected", ["", "missing-segment"]]);
		assert.match(r.json.message, /2개 중 1개가 확인을 통과하지 못해 아무것도 넣지 않았습니다/);
		assert.match(r.json.hint, /missing-segment/);
		r = await x.call("suggest_fields", { seq_id, items: [{ uid: row11.uid, field_id: "T1", field_sig: row11.sig, value: "x" }] });
		assert.deepEqual([r.json.code, r.json.results[0].error], ["rejected", "caption-field"]);
		r = await x.call("suggest_fields", { seq_id, items: [{ uid: row11.uid, field_id: "T2", field_sig: row11.sig, value: "오늘$$날씨$$하늘$$맑음" }] });
		assert.deepEqual([r.json.code, r.json.results[0].error], ["rejected", "too-many"]);
		r = await x.call("suggest_fields", { seq_id, items: [{ uid: "zz99-1", field_id: "T2", field_sig: row11.sig, value: "날씨" }] });
		assert.deepEqual([r.isError, r.json.code], [true, "not-found"]);
		assert.equal((await x.call("get_suggestions", {})).json.suggestions.length, 20, "거절한 호출은 아무것도 넣지 않았다");
		// seq_id: 빠지면 bad-args, 다르면 패널이 seq-mismatch
		r = await x.call("suggest_fields", { items: [items[0]] });
		assert.deepEqual([r.isError, r.json.code], [true, "bad-args"]);
		r = await x.call("suggest_fields", { seq_id: "다른 시퀀스", items: [items[0]] });
		assert.deepEqual([r.isError, r.json.code], [true, "seq-mismatch"]);
		// '#12 T2' → find_row → 그 줄의 sig로 제안
		const fr = await x.call("find_row", { label: "C2" + DOT + "12 T2" });
		assert.deepEqual([fr.json.text, fr.json.field.fid, fr.json.field.caption, fr.json.seq_id], ["영희의 바다 12번째 이야기", "T2", false, seq_id]);
		r = await x.call("suggest_fields", { seq_id, items: [{ uid: fr.json.uid, field_id: fr.json.fid, field_sig: fr.json.sig, value: "12번째 이야기" }] });
		assert.deepEqual([r.isError, r.json.queued, r.json.results[0].kind], [false, 1, "text"]);
		const one = await x.call("get_suggestions", { uid: fr.json.uid });
		assert.deepEqual(one.json.suggestions.map((q) => [q.label, q.v, q.check]), [["C2" + DOT + "12", "12번째 이야기", "✓ 본문에 있음"]]);
		s = await x.snap();
		assert.equal(s.ui.sugg, "AI 제안 (21)");
		const rs = s.snapshot.rowStates;
		assert.equal(Object.keys(rs).filter((id) => rs[id].sugg && rs[id].sugg.T2).length, 21);
		assert.ok(Object.keys(rs).every((id) => rs[id]._allParams[1].value === ""), "승인 전에는 속성에 아무것도 쓰지 않았다");
	} finally {
		await x.done();
	}
});

test("끝에서 끝: set_cast_proposal → 패널 승인 카드 (화자 표·타임라인 그대로), 틀린 키·트랙·프리셋·위치는 서버가 거절", async () => {
	const x = await harness("cast", "claude-code");
	try {
		const seq_id = (await x.call("get_status", {})).json.seq_id;
		let r = await x.call("set_cast_proposal", { seq_id, items: [{ key: "C2", name: " 민수 ", track: "V5" }, { key: "C1", preset_id: "preset_3", pos_x: 0.35, pos_y: 0.5 }], note: "콘티 3쪽 기준" });
		assert.equal(r.isError, false, r.text);
		assert.equal(r.json.pending, true);
		assert.match(String(r.json.rid), /^a/);
		assert.deepEqual(r.json.items, [{ key: "C2", name: "민수", track: 4 }, { key: "C1", presetId: "preset_3", pos: { x: 0.35, y: 0.5 } }]);
		assert.match(r.json.message, /\[승인\]해야 바뀝니다/);
		const cast = await x.call("get_cast", {});
		assert.deepEqual([cast.json.cast.C2.name, cast.json.cast.C2.track], ["영희", null], "승인 전에는 그대로");
		const st = await x.call("get_status", {});
		assert.equal(st.json.panel.approvals, 1);
		const s = await x.snap();
		assert.deepEqual(s.ui.aiReq, ["AI 요청 (Claude) · 화자 표: C2(영희) 이름 ‘민수’, 트랙 V5 · C1(철수) 기본 프리셋 ‘합성 자막’, 위치 0.35, 0.5 — 콘티 3쪽 기준"]);
		assert.deepEqual(s.snapshot.mi.applied, {}, "타임라인 적용 기록 없음");
		for (const [items, re] of [
			[[{ key: "C9", name: "x" }], /화자 표에 없는 화자: C9 \(있는 화자: C1, C2\)/],
			[[{ key: "C1", track: "V1" }], /track은 'V2'~'V99' 또는 'auto'/],
			[[{ key: "C1", preset_id: "preset_404" }], /캡션 필드가 있는 프리셋이 아니다/],
			[[{ key: "C1", pos_x: 0.5 }], /pos_x·pos_y 둘 다/],
			[[{ key: "C1" }], /바꿀 칸이 없습니다/],
			[[{ key: "C1", name: "a" }, { key: "C1", name: "b" }], /두 번/]
		]) {
			r = await x.call("set_cast_proposal", { seq_id, items });
			assert.deepEqual([r.isError, r.json.code], [true, "bad-args"], JSON.stringify(items));
			assert.match(r.json.message, re);
		}
		assert.equal((await x.call("get_status", {})).json.panel.approvals, 1, "거절한 제안은 대기열에 없다");
		r = await x.call("set_cast_proposal", { seq_id: "다른 시퀀스", items: [{ key: "C1", name: "x" }] });
		assert.deepEqual([r.isError, r.json.code], [true, "seq-mismatch"]);
	} finally {
		await x.done();
	}
});

test("core 해시가 다르면 쓰기 도구는 panel-version-mismatch로 거절하고 패널에 아무것도 보내지 않는다", async () => {
	const tmp = M.tmpDir("wmismatch");
	const dir = path.join(tmp, "bridge");
	const ext = M.makeExt(tmp);
	const logFile = path.join(tmp, "cmds.jsonl");
	const fake = await M.startFake(tmp, { mode: "fixture", dir, extPath: ext.extPath, coreHash: "deadbeef", logFile });
	const c = await M.connect({ MI_BRIDGE_DIR: dir });
	try {
		let r = await M.callJson(c.client, "suggest_fields", { seq_id: "seq-fx-1", items: [{ uid: "fx01-4", field_id: "T2", field_sig: "T1:텍스트|T2:포인트 텍스트", value: "바다$$이야기" }] });
		assert.deepEqual([r.isError, r.json.code, r.json.panel, r.json.server], [true, "panel-version-mismatch", "deadbeef", ext.coreHash]);
		assert.match(r.json.hint, /새로 고치거나/);
		r = await M.callJson(c.client, "set_cast_proposal", { seq_id: "seq-fx-1", items: [{ key: "C2", name: "민수" }] });
		assert.deepEqual([r.isError, r.json.code], [true, "panel-version-mismatch"]);
		assert.deepEqual(M.readLog(logFile), [], "패널에 아무 명령도 보내지 않았다");
		r = await M.callJson(c.client, "get_rows", {});
		assert.equal(r.isError, false, "읽기 도구는 된다");
		assert.deepEqual(M.readLog(logFile).map((m) => m.op), ["rows"]);
	} finally {
		await c.close();
		await fake.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
