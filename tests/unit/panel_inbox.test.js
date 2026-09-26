"use strict";
// M5.1: 패널 인박스와 heartbeat (src/mi/inbox.ts) — panelHarness(app.js 전체, Node fs는 메모리) + premiereSim(hostscript 전체).
// 'AI 연결 허용'은 기본 꺼짐(폴더를 읽지도 쓰지도 않는다), 켜면 heartbeat 2초마다(extPath·coreHash = 설치된 app.js core 해시),
// 인박스 300 ms 폴링 → runCommand(agent): status 왕복, seq 다름, 2분 지난 명령, 같은 id 한 번만, 적용 중 busy,
// suggest는 제안 대기열에만, 바꾸는 명령은 needs-approval, 끄면 {state: off} 한 번, 다시 열면 processed.json이 같은 id를 막는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P, EXT_DIR, USER_DATA_DIR } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, color } = require("../lib/premiereSim");
const { loadRegions, regionHash } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const APPDATA = "C:/Users/test/AppData/Roaming";
const BR = APPDATA + "/MogrtImporter/bridge";
const PROJ = "C:/work/inbox.prproj";
const A = { seqId: "seq-inbox-1", seqName: "T_INBOX", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const SALT = "cd34";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
function makeSim() {
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: 6 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294967295)] });
	const probe = sim.place(seq, 0, MOGRT, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	const preset = { id: "preset_3", name: "합성 자막", mogrtPath: MOGRT, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	return { sim, seq, preset };
}
function castSession(preset) {
	const subtitles = [];
	const rowStates = {};
	const n = {};
	const rows = [];
	for (let k = 0; k < 3; k++) {
		const s = 100 + k * 150;
		rows.push([rows.length + 1, "C1", s, s + 60, "오늘 날씨 " + (k + 1) + " 하늘"]);
		rows.push([rows.length + 1, "C2", s + 80, s + 130, "영희 " + (k + 1)]);
	}
	rows.forEach(([id, spk, sf, ef, text]) => {
		n[spk] = (n[spk] || 0) + 1;
		subtitles.push({ index: n[spk], startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id, spk, srtNo: n[spk] });
		const all = JSON.parse(JSON.stringify(preset.params));
		CORE.setTextValue(all[0], text);
		rowStates[id] = { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	});
	return {
		subtitles, rowStates, trashBin: [], nextId: rows.length + 1,
		mi: { v: 1, salt: SALT, hwm: rows.length, legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0 }, C2: { name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1 } },
			stack: false, stackDy: 0.12, applied: {} }
	};
}
async function boot(o) {
	const opts = o || {};
	const { sim, preset } = makeSim();
	const h = await bootPanel({
		seq: A,
		mogrts: [{ name: preset.name, path: preset.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { [preset.id]: preset }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: castSession(preset) },
		node: opts.node === undefined ? { env: { APPDATA }, files: opts.files || {} } : opts.node,
		localStorage: opts.localStorage,
		appSrc: opts.appSrc
	});
	HOST_FNS.forEach((fn) => {
		h.host.handlers["MI_" + fn] = (json) => sim.callRaw("MI_" + fn, json === undefined ? undefined : JSON.stringify(json));
	});
	await h.advance(1000);
	return h;
}
const bridgeWrites = (h) => h.nodeFs.writes.filter((p) => p.indexOf(APPDATA + "/MogrtImporter") === 0);
const read = (h, rel) => {
	const f = h.nodeFs.files.get(BR + "/" + rel);
	return f ? JSON.parse(f.data.toString("utf8")) : null;
};
const hb = (h) => read(h, "heartbeat.json");
const reply = (h, id) => read(h, "outbox/" + id + ".json");
// 서버처럼 tmp에 쓰고 이름을 바꾼다
function send(h, msg) {
	const p = BR + "/inbox/" + msg.id + ".json";
	h.nodeFs.writeFileSync(p + ".tmp", typeof msg === "string" ? msg : JSON.stringify(msg));
	h.nodeFs.renameSync(p + ".tmp", p);
}
let _n = 0;
const cmdMsg = (op, args, extra) => Object.assign({ v: 1, id: "t" + Date.now().toString(36) + "-" + ++_n, op, args: args || {}, at: Date.now(), by: "codex" }, extra || {});
async function roundTrip(h, msg) {
	send(h, msg);
	await h.advance(300);
	const r = reply(h, msg.id);
	assert.ok(r, "응답 " + msg.op + " " + msg.id);
	return r;
}
function linkOn(h) {
	const c = h.$("aiLinkChk");
	c.checked = true;
	h.change(c);
}
function linkOff(h) {
	const c = h.$("aiLinkChk");
	c.checked = false;
	h.change(c);
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}

test("기본 꺼짐: 다리 폴더를 읽지도 쓰지도 않는다 (4단계와 같다)", async () => {
	const h = await boot();
	assert.equal(h.$("aiLinkChk").checked, false);
	assert.equal(h.win._mogrtDebug.inbox.on(), false);
	const msg = cmdMsg("status");
	send(h, msg);
	const before = h.nodeFs.writes.length;
	await h.advance(5000);
	assert.equal(h.nodeFs.writes.length, before, "아무것도 쓰지 않는다");
	assert.ok(h.nodeFs.files.has(BR + "/inbox/" + msg.id + ".json"), "명령 파일은 그대로");
	assert.equal(reply(h, msg.id), null);
	assert.equal(hb(h), null);
	assert.equal(h.win.localStorage.getItem("MI_aiLink"), null);
	noErrors(h);
});

test("켜면 heartbeat 2초마다: 버전·빌드·extPath·coreHash(설치된 app.js core 해시)·시퀀스·busy·승인 대기 수, localStorage에 남는다", async () => {
	const h = await boot();
	linkOn(h);
	assert.equal(h.win._mogrtDebug.inbox.on(), true);
	assert.equal(h.win._mogrtDebug.inbox.dir(), BR);
	assert.equal(h.win.localStorage.getItem("MI_aiLink"), "1");
	assert.match(h.status().text, /AI 연결 허용: 켬/);
	assert.ok(h.$("aiLink").classList.contains("on"));
	let b = hb(h);
	assert.deepEqual([b.v, b.state, b.build, b.extPath, b.seqId, b.keysResolved, b.busy, b.pendingApproval, b.rows, b.pollMs, b.beatMs],
		[1, "on", "@@BUILD@@", EXT_DIR, A.seqId, true, false, 0, 6, 300, 2000]);
	assert.deepEqual(b.panel, { v: 28, build: "@@BUILD@@" });
	assert.equal(b.coreHash, regionHash("src/mi/core.ts"), "coreHash = 설치된 app.js의 core region 해시");
	assert.ok(Math.abs(Date.now() - b.at) < 5000);
	const beats = () => h.nodeFs.writes.filter((p) => p === BR + "/heartbeat.json.tmp").length;
	assert.equal(beats(), 1, "켜자마자 한 번");
	await h.advance(2000);
	assert.equal(beats(), 2);
	await h.advance(4000);
	assert.equal(beats(), 4, "2초마다");
	b = hb(h);
	assert.deepEqual(b.host && [b.host.v, b.host.build], [28, "@@BUILD@@"], "호스트 ping 결과");
	assert.equal(h.host.calls.filter((c) => c.fn === "MI_ping").length, 1, "ping은 30초마다 한 번만");
	assert.ok(!h.nodeFs.files.has(BR + "/heartbeat.json.tmp"), "tmp는 이름을 바꿔 남지 않는다");
	noErrors(h);
});

test("status 왕복 · 형식 오류 · seq 다름 · 2분 지난 명령 · 같은 id는 한 번만", async () => {
	const h = await boot();
	linkOn(h);
	// status
	const st = cmdMsg("status");
	let r = await roundTrip(h, st);
	assert.deepEqual([r.v, r.id, r.op, r.ok], [1, st.id, "status", true]);
	assert.deepEqual([r.data.seq.id, r.data.rows, r.data.coreHash], [A.seqId, 6, regionHash("src/mi/core.ts")]);
	assert.ok(!h.nodeFs.files.has(BR + "/inbox/" + st.id + ".json"), "받은 명령 파일은 지운다");
	assert.ok(read(h, "processed.json").ids[st.id] > 0, "처리한 id를 남긴다");
	// 형식 오류
	r = await roundTrip(h, Object.assign(cmdMsg("status"), { id: "bad1", at: "어제" }));
	assert.deepEqual([r.ok, r.error], [false, "bad-args"]);
	assert.match(r.detail, /at/);
	send(h, { id: "bad2", op: "status" });
	h.nodeFs.writeFileSync(BR + "/inbox/bad3.json", "{깨진 JSON");
	await h.advance(300);
	assert.deepEqual([reply(h, "bad2").error, reply(h, "bad3").error], ["bad-args", "bad-args"]);
	r = await roundTrip(h, Object.assign(cmdMsg("status"), { id: "bad4", op: "없는명령" }));
	assert.deepEqual([r.ok, r.error], [false, "bad-args"]);
	h.nodeFs.writeFileSync(BR + "/inbox/other.json", JSON.stringify(Object.assign(cmdMsg("status"), { id: "다른-id" })));
	await h.advance(300);
	assert.match(reply(h, "other").detail, /id가 파일 이름과 다르다/);
	// seq 다름
	r = await roundTrip(h, cmdMsg("rows", {}, { seqId: "딴 시퀀스" }));
	assert.deepEqual([r.ok, r.error], [false, "seq-mismatch"]);
	r = await roundTrip(h, cmdMsg("rows", { count: 2 }, { seqId: A.seqId }));
	assert.deepEqual([r.ok, r.data.total, r.data.rows.length], [true, 6, 2]);
	const row = r.data.rows[0];
	// 2분 지난 명령은 돌리지 않는다 (제안이 들어가지 않는다)
	r = await roundTrip(h, cmdMsg("suggest", { items: [{ uid: row.uid, fid: "T2", value: "날씨", sig: row.sig, by: "codex" }] }, { at: Date.now() - 121000 }));
	assert.deepEqual([r.ok, r.error], [false, "expired"]);
	assert.equal(h.snapshot().rowStates[row.id].sugg, undefined, "돌리지 않았다");
	// 같은 id를 두 번: 한 번만 돌고, 두 번째는 같은 응답에 dup
	const dup = cmdMsg("cast.set", { items: [{ key: "C2", name: "지영" }] });
	const r1 = await roundTrip(h, dup);
	assert.deepEqual([r1.ok, r1.error], [false, "needs-approval"]);
	assert.match(String(r1.rid), /^a/);
	send(h, dup);
	await h.advance(300);
	const r2 = reply(h, dup.id);
	assert.deepEqual([r2.error, r2.rid, r2.dup], ["needs-approval", r1.rid, true]);
	const q = JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd("approvals.list", {}))).data;
	assert.deepEqual(q.map((x) => [x.op, x.by]), [["cast.set", "codex"]], "대기열에 한 번만");
	assert.equal(h.snapshot().mi.cast.C2.name, "영희", "승인 전에는 그대로");
	await h.advance(2000);
	assert.equal(hb(h).pendingApproval, 1, "heartbeat 승인 대기 수");
	noErrors(h);
});

test("agent: suggest는 제안 대기열에만 (속성·타임라인 그대로), 승인 명령은 못 부른다, 적용이 도는 동안 busy", async () => {
	const h = await boot();
	linkOn(h);
	let r = await roundTrip(h, cmdMsg("rows", { spk: "C1", count: 1 }));
	const row = r.data.rows[0];
	const all0 = JSON.stringify(h.snapshot().rowStates[row.id]._allParams);
	r = await roundTrip(h, cmdMsg("suggest", { items: [{ uid: row.uid, fid: "T2", value: "날씨$$하늘", sig: row.sig, by: "codex", note: "한국어 왕복 ✓" }] }));
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.equal(r.data.queued, 1);
	const s = h.snapshot();
	assert.deepEqual([s.rowStates[row.id].sugg.T2.v, s.rowStates[row.id].sugg.T2.by, s.rowStates[row.id].sugg.T2.note], ["날씨$$하늘", "codex", "한국어 왕복 ✓"]);
	assert.equal(JSON.stringify(s.rowStates[row.id]._allParams), all0, "속성은 그대로");
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).rowStates[row.id].sugg.T2.v, "날씨$$하늘", "session.json은 패널이 쓴다");
	await h.advance(2000);
	assert.equal(hb(h).suggestions, 1);
	// 캡션 필드·낡은 서명은 거절
	r = await roundTrip(h, cmdMsg("suggest", { items: [{ uid: row.uid, fid: "T1", value: "x", sig: row.sig }] }));
	assert.deepEqual([r.ok, r.error, r.results[0].error], [false, "bad-args", "caption-field"]);
	r = await roundTrip(h, cmdMsg("suggest", { items: [{ uid: row.uid, fid: "T2", value: "날씨", sig: row.sig + "|x" }] }));
	assert.deepEqual([r.ok, r.error], [false, "fields-changed"]);
	// 승인은 패널에서만
	r = await roundTrip(h, cmdMsg("sugg.approve", { all: true }));
	assert.deepEqual([r.ok, r.error], [false, "needs-approval"]);
	r = await roundTrip(h, cmdMsg("approvals.approve", { rid: "a-x" }));
	assert.deepEqual([r.ok, r.error], [false, "needs-approval"]);
	assert.equal(h.snapshot().rowStates[row.id].sugg.T2.v, "날씨$$하늘");
	// 적용이 도는 동안 (ping을 잡아 둔다): 바꾸는 명령은 busy, 읽기는 된다, heartbeat.busy
	let release;
	const ping = h.host.handlers.MI_ping;
	h.host.handlers.MI_ping = (json) => new Promise((res) => { release = () => res(ping(json)); });
	const running = h.win._mogrtDebug.cmd("apply", {});
	await h.flush();
	assert.equal(h.win._mogrtDebug.miBusy(), true);
	r = await roundTrip(h, cmdMsg("suggest", { items: [{ uid: row.uid, fid: "T2", value: "하늘", sig: row.sig }] }));
	assert.deepEqual([r.ok, r.error], [false, "busy"]);
	r = await roundTrip(h, cmdMsg("rows", { count: 1 }));
	assert.equal(r.ok, true, "읽기는 된다");
	h.win._mogrtDebug.inbox.beat();
	assert.equal(hb(h).busy, true);
	release();
	h.host.handlers.MI_ping = ping;
	assert.equal(JSON.parse(JSON.stringify(await running)).ok, true);
	noErrors(h);
});

test("끄면 {state: off} 한 번만 쓰고 더는 폴링하지 않는다; 켠 채 다시 열면 켜지고 processed.json이 같은 id를 막는다", async () => {
	const h = await boot();
	linkOn(h);
	const done = cmdMsg("cast.set", { items: [{ key: "C1", name: "민수" }] });
	await roundTrip(h, done);
	linkOff(h);
	assert.equal(h.win._mogrtDebug.inbox.on(), false);
	assert.deepEqual([hb(h).state, hb(h).build], ["off", "@@BUILD@@"]);
	assert.equal(h.win.localStorage.getItem("MI_aiLink"), "0");
	assert.match(h.status().text, /AI 연결 허용: 끔/);
	const n = bridgeWrites(h).length;
	const later = cmdMsg("status");
	send(h, later);
	await h.advance(6000);
	assert.equal(bridgeWrites(h).length, n + 1, "명령 파일(서버 쓰기) 말고는 아무것도 쓰지 않는다");
	assert.equal(reply(h, later.id), null);

	// 켠 채 닫힌 패널을 다시 연다: 같은 다리 폴더(처리 id·남은 명령) + localStorage
	const files = {};
	for (const [p, f] of h.nodeFs.files) files[p] = { data: f.data, mtimeMs: f.mtimeMs };
	files[BR + "/inbox/" + done.id + ".json"] = JSON.stringify(Object.assign({}, done, { at: Date.now() }));
	const h2 = await boot({ files, localStorage: { MI_aiLink: "1" } });
	assert.equal(h2.win._mogrtDebug.inbox.on(), true, "다시 켜진다");
	assert.equal(h2.$("aiLinkChk").checked, true);
	assert.equal(read(h2, "heartbeat.json").state, "on");
	await h2.advance(300);
	const r = read(h2, "outbox/" + done.id + ".json");
	assert.deepEqual([r.ok, r.error, r.dup], [false, "duplicate", true], "처리한 id는 다시 돌리지 않는다");
	assert.equal(read(h2, "outbox/" + later.id + ".json").ok, true, "꺼져 있던 동안 온 명령은 켜면 처리한다");
	assert.equal(JSON.parse(JSON.stringify(await h2.win._mogrtDebug.cmd("approvals.list", {}))).data.length, 0, "cast.set을 다시 넣지 않았다");
	noErrors(h);
	noErrors(h2);
});

test("다리 폴더: APPDATA가 없으면 CEP 사용자 데이터 폴더, DEV 빌드(dev-…)는 bridge_dev; Node가 없으면 켜지 않는다", async () => {
	const h = await boot({ node: { files: {} } });
	assert.equal(h.win._mogrtDebug.inbox.dir(), USER_DATA_DIR + "/MogrtImporter/bridge");
	const fs = require("node:fs");
	const src = fs.readFileSync(require("../lib/loadRegions").APP_JS, "utf8").replace('const MI_BUILD_PANEL = "@@BUILD@@";', 'const MI_BUILD_PANEL = "dev-1234567";');
	const hDev = await boot({ appSrc: src });
	assert.equal(hDev.win._mogrtDebug.inbox.dir(), APPDATA + "/MogrtImporter/bridge_dev");
	linkOn(hDev);
	assert.equal(JSON.parse(hDev.nodeFs.files.get(APPDATA + "/MogrtImporter/bridge_dev/heartbeat.json").data.toString("utf8")).build, "dev-1234567");
	assert.ok(![...hDev.nodeFs.files.keys()].some((p) => p.indexOf(BR + "/") === 0), "운영 다리에는 쓰지 않는다");
	// Node 없음
	const h3 = await boot({ node: null });
	linkOn(h3);
	assert.equal(h3.win._mogrtDebug.inbox.on(), false);
	assert.equal(h3.$("aiLinkChk").checked, false);
	assert.ok(h3.$("aiLink").classList.contains("err"));
	assert.match(h3.status().text, /AI 연결을 켜지 못했습니다: Node 모듈을 쓸 수 없음/);
	noErrors(h);
	noErrors(h3);
});

// ── M5.3: rows.raw (서버 쪽 validateSuggestion 입력)와 화자 표 제안 승인 카드 ──

test("rows.raw: 줄 원본(sub·_allParams)·프리셋·없는 uid·한도, 서버가 같은 core로 돌린 validateSuggestion = 패널 suggest 결과", async () => {
	const h = await boot();
	linkOn(h);
	const rows = (await roundTrip(h, cmdMsg("rows", { count: 6 }))).data.rows;
	let r = await roundTrip(h, cmdMsg("rows.raw", { uids: [rows[0].uid, rows[1].uid, "zz99-1"] }));
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual([r.data.seqId, r.data.rows.map((x) => x.uid), r.data.missing], [A.seqId, [rows[0].uid, rows[1].uid], ["zz99-1"]]);
	assert.deepEqual(r.data.rows[0].sub, { id: rows[0].id, index: rows[0].index, spk: "C1", text: rows[0].text });
	assert.deepEqual(r.data.rows[0].rs._allParams, h.snapshot().rowStates[rows[0].id]._allParams);
	assert.deepEqual(Object.keys(r.data.presets), ["preset_3"]);
	assert.deepEqual(Object.keys(r.data.presets.preset_3).sort(), ["id", "name", "params", "textParamIndex"], "썸네일 같은 큰 칸은 싣지 않는다");
	assert.equal((await roundTrip(h, cmdMsg("rows.raw", { uids: [] }))).error, "bad-args");
	assert.equal((await roundTrip(h, cmdMsg("rows.raw", { uids: new Array(201).fill(rows[0].uid) }))).error, "bad-args");
	// 서버(설치본 core = 이 app.js core)가 rows.raw로 돌린 결과가 패널의 결과와 같다
	const cases = [
		[rows[0], "T2", "날씨$$하늘"], [rows[0], "T2", "날씨$$바다"], [rows[0], "T1", "x"], [rows[1], "T2", "영희"], [rows[1], "T9", "x"], [rows[2], "T2", "a$$b$$c$$d"]
	];
	const raw = (await roundTrip(h, cmdMsg("rows.raw", { uids: [...new Set(cases.map((c) => c[0].uid))] }))).data;
	for (const [row, fid, value] of cases) {
		const x = raw.rows.find((y) => y.uid === row.uid);
		const v = CORE.validateSuggestion({ sub: x.sub, rs: x.rs, preset: raw.presets[x.rs.presetId], fid, value, sig: row.sig });
		const p = await roundTrip(h, cmdMsg("suggest", { items: [{ uid: row.uid, fid, value, sig: row.sig }] }));
		const pr = p.ok ? p.data.results[0] : p.results[0];
		assert.deepEqual([v.ok, v.error, [...v.warn]], [pr.ok, pr.error, pr.warn], row.uid + " " + fid + " " + value);
	}
	noErrors(h);
});

test("승인 카드: agent의 cast.set → #aiReqBar 요약 · [거절]은 버린다 · [승인]은 안전 지점 'AI: 화자 표 바꾸기 전' → 화자 표 → 히스토리 'AI: …'; 다른 요청은 카드에 없다", async () => {
	const h = await boot();
	linkOn(h);
	const bar = h.$("aiReqBar");
	assert.equal(bar.style.display, "none", "요청이 없으면 숨는다");
	let r = await roundTrip(h, cmdMsg("cast.set", { items: [{ key: "C2", name: "민수", track: 4 }, { key: "C1", presetId: "preset_3" }], note: "콘티 3쪽 기준" }));
	assert.deepEqual([r.ok, r.error], [false, "needs-approval"]);
	const rid1 = r.rid;
	assert.equal(bar.style.display, "");
	let cards = bar.querySelectorAll(".ai-req");
	assert.equal(cards.length, 1);
	assert.equal(cards[0].querySelector(".ai-req-text").textContent, "AI 요청 (Codex) · 화자 표: C2(영희) 이름 ‘민수’, 트랙 V5 · C1(철수) 기본 프리셋 ‘합성 자막’ — 콘티 3쪽 기준");
	// 적용 요청은 이 카드에 나오지 않는다 (M5.4)
	r = await roundTrip(h, cmdMsg("apply", {}));
	assert.equal(r.error, "needs-approval");
	assert.equal(bar.querySelectorAll(".ai-req").length, 1);
	await h.advance(2000);
	assert.equal(hb(h).pendingApproval, 2, "heartbeat는 모든 승인 대기 수");
	// [거절]
	const nSafe = (h.fs.readJson(P.historySafety(PROJ, A.seqId)) || []).length;
	bar.querySelector(".ai-req-no").click();
	await h.flush();
	assert.equal(bar.querySelectorAll(".ai-req").length, 0);
	assert.equal(bar.style.display, "none");
	assert.equal(h.snapshot().mi.cast.C2.name, "영희", "거절하면 그대로");
	assert.match(h.status().text, /AI 요청을 버렸습니다: 화자 표 바꾸기/);
	const left = JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd("approvals.list", {}))).data;
	assert.deepEqual(left.map((q) => q.op), ["apply"], "cast.set만 빠졌다");
	assert.ok(left.every((q) => q.rid !== rid1));
	// [승인]
	r = await roundTrip(h, cmdMsg("cast.set", { items: [{ key: "C2", name: "민수", track: 4 }] }));
	bar.querySelector(".ai-req-ok").click();
	await h.flush();
	const s = h.snapshot();
	assert.deepEqual([s.mi.cast.C2.name, s.mi.cast.C2.track], ["민수", 4]);
	assert.equal(bar.style.display, "none");
	assert.match(h.status().text, /AI 요청을 승인했습니다: 화자 표 바꾸기 \(C2\)/);
	const safe = h.fs.readJson(P.historySafety(PROJ, A.seqId));
	assert.deepEqual([safe.length, safe[0].label], [nSafe + 1, "AI: 화자 표 바꾸기 전"]);
	assert.equal(h.fs.readJson(P.historyAuto(PROJ, A.seqId))[0].label, "AI: 화자 표: C2 이름 민수, 트랙 V5");
	// 인자가 틀린 요청은 승인해도 바꾸지 않고 오류를 알린다 (안전 지점 없음)
	r = await roundTrip(h, cmdMsg("cast.set", { items: [{ key: "C9", name: "x" }] }));
	assert.match(bar.querySelector(".ai-req-text").textContent, /C9 이름 ‘x’/);
	bar.querySelector(".ai-req-ok").click();
	await h.flush();
	assert.match(h.status().text, /AI 요청을 실행하지 못했습니다: 화자 표에 없는 화자: C9/);
	assert.equal(h.fs.readJson(P.historySafety(PROJ, A.seqId)).length, nSafe + 1);
	noErrors(h);
});
