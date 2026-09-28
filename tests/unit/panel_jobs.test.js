"use strict";
// M5.4: 작업 기록, 승인 이후 비동기 실행, 시퀀스/만료 보호와 실제 호스트 쓰기 경로.
// panelHarness(app.js 전체) + premiereSim(hostscript.jsx 전체, 가짜 Premiere)
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P, CACHE_ROOT } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, color } = require("../lib/premiereSim");
const { loadRegions } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/cmd.prproj";
const A = { seqId: "seq-cmd-1", seqName: "T_CMD", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const SALT = "ab12";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];
const RULE = "포인트 텍스트는 $$로 구분하며 최대 3개까지 입력 가능합니다.";
const DOT = String.fromCharCode(0xb7);

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
function makeSim(o) {
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: o && o.tracks || 2 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294967295)] });
	const probe = sim.place(seq, 0, MOGRT, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	// 규칙 설명(comment) (o.rule: presets 명령의 notes). 시뮬레이터 템플릿에는 없는 속성이라 적용 시험에는 넣지 않는다 (partial이 된다)
	if (o && o.rule) params.push({ index: 3, displayName: "포인트 텍스트 구분 방법", type: "comment", rawValue: RULE, value: RULE, group: "" });
	const preset = { id: "preset_3", name: "합성 자막", mogrtPath: MOGRT, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	return { sim, seq, preset };
}
function withCaption(preset, text) {
	const all = JSON.parse(JSON.stringify(preset.params));
	CORE.setTextValue(all[0], text);
	return all;
}
function castSession(preset, rows, extra) {
	const subtitles = [];
	const rowStates = {};
	const n = {};
	rows.forEach(([id, spk, sf, ef, text]) => {
		n[spk || ""] = (n[spk || ""] || 0) + 1;
		const s = { index: n[spk || ""], startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id };
		if (spk) { s.spk = spk; s.srtNo = s.index; }
		subtitles.push(s);
		const all = withCaption(preset, text);
		rowStates[id] = { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	});
	const out = { subtitles, rowStates, trashBin: [], nextId: Math.max(...rows.map((r) => r[0])) + 1 };
	if (rows.some((r) => r[1])) {
		out.mi = Object.assign({ v: 1, salt: SALT, hwm: out.nextId - 1, legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0 }, C2: { name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1 } },
			stack: false, stackDy: 0.12, applied: {} }, (extra && extra.mi) || {});
	}
	return out;
}
function rowsTwo() {
	const rows = [];
	let id = 1;
	for (let k = 0; k < 4; k++) {
		const s = 100 + k * 150;
		rows.push([id++, "C1", s, s + 60, "오늘 날씨 " + (k + 1) + " 하늘"]);
		rows.push([id++, "C2", s + 80, s + 130, "영희 " + (k + 1)]);
	}
	return rows;
}
async function boot(sim, preset, session, o) {
	const h = await bootPanel(Object.assign({
		seq: A,
		mogrts: [{ name: preset.name, path: preset.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { [preset.id]: preset }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: session }
	}, o || {}));
	HOST_FNS.forEach((n) => {
		h.host.handlers["MI_" + n] = (json) => sim.callRaw("MI_" + n, json === undefined ? undefined : JSON.stringify(json));
	});
	await h.advance(1000);
	return h;
}
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
const cmdAs = async (h, source, op, args, extra) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmdAs(source, op, args, extra)));

const JOB_FILE = CACHE_ROOT + "/ai_jobs.json";
const SRT = "1\n00:00:01,000 --> 00:00:02,000\n새 화자 문장\n";
const request = (h, op, args) => cmdAs(h, "agent", op, args, { seqId: A.seqId, by: "codex" });
const get = async (h, j) => (await cmd(h, "jobs.get", { jobId: j.jobId })).data;
async function fixture(o) {
	const { sim, seq, preset } = makeSim();
	// 두 트랙뿐이면 C1/C2 적용이 새 트랙 점검 창을 반드시 연다.
	const h = await boot(sim, preset, castSession(preset, rowsTwo().slice(0, 4)), Object.assign({ node: {} }, o || {}));
	return { h, sim, seq, preset };
}
function healthy(h) { assert.deepEqual(h.errors().map((e) => e.message), []); }
async function approve(h, j) {
	const r = await cmd(h, "approvals.approve", { rid: j.rid });
	assert.equal(r.ok, true, JSON.stringify(r));
	await h.flush();
	return r;
}

test("jobs validate shape/sequence, cannot self-approve, rejected jobs persist without host writes", async () => {
	const { h, sim, seq } = await fixture();
	assert.equal((await cmdAs(h, "agent", "jobs.requestApply", { scope: "changed" })).error, "bad-args");
	assert.equal((await cmdAs(h, "agent", "jobs.requestApply", { scope: "changed" }, { seqId: "other" })).error, "seq-mismatch");
	for (const args of [{ scope: "all" }, { scope: "rows", uids: [] }, { scope: "rows", uids: [SALT + "-1", SALT + "-1"] }, { scope: "changed", uids: [] }]) {
		assert.equal((await request(h, "jobs.requestApply", args)).error, "bad-args");
	}
	for (const paths of [["relative.srt"], ["https://x/C1.srt"], ["\\\\server\\x.srt"], ["C:/x.txt"]]) {
		assert.equal((await request(h, "jobs.importSrt", { paths })).error, "bad-args");
	}
	const r = await request(h, "jobs.requestApply", { scope: "rows", uids: [SALT + "-1"] });
	assert.equal(r.ok, true);
	assert.equal(r.data.state, "pending_approval");
	assert.match(h.$("aiReqBar").textContent, /選択|선택 줄 적용/);
	assert.equal(sim.all(seq), 0);
	assert.equal((await cmdAs(h, "agent", "approvals.approve", { rid: r.data.rid })).error, "needs-approval");
	await cmd(h, "approvals.reject", { rid: r.data.rid });
	assert.equal((await get(h, r.data)).state, "rejected");
	assert.equal(h.fs.readJson(JOB_FILE).jobs[0].state, "rejected");
	assert.equal(sim.all(seq), 0);
	assert.equal((await cmd(h, "jobs.get", { jobId: "__proto__" })).error, "not-found");
	healthy(h);
});

test("changed jobs include fresh rows without mm; approval is async, preflight blocks writes, polling stays live and successful replay writes nothing", async () => {
	const { h, sim, seq } = await fixture();
	const j = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	assert.ok(Object.values(h.snapshot().rowStates).every((r) => !r.mm));
	const approved = await approve(h, j);
	assert.equal(approved.data.state, "running");
	assert.equal((await get(h, j)).state, "waiting_input");
	assert.equal(sim.all(seq), 0);
	assert.equal((await cmd(h, "cast.set", { items: [{ key: "C1", name: "x" }] })).error, "busy");
	assert.equal((await request(h, "jobs.importSrt", { paths: ["C:/C3.srt"] })).error, "busy");
	assert.equal((await cmd(h, "status", {})).data.busy, true);
	// 실제 인박스도 긴 작업을 await하지 않아 jobs.get을 처리한다.
	h.win._mogrtDebug.inbox.set(true);
	const dir = h.win._mogrtDebug.inbox.dir();
	h.nodeFs.writeFileSync(dir + "/inbox/polljob.json", JSON.stringify({ id: "polljob", op: "jobs.get", args: { jobId: j.jobId }, at: Date.now() }));
	await h.win._mogrtDebug.inbox.poll();
	assert.equal(JSON.parse(h.nodeFs.readFileSync(dir + "/outbox/polljob.json", "utf8")).data.state, "waiting_input");
	h.$("pfOk").click();
	await h.flush();
	const done = await get(h, j);
	assert.equal(done.state, "succeeded", JSON.stringify(done));
	assert.equal(done.result.created, 4);
	assert.equal(sim.all(seq), 4);
	const again = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, again);
	if (h.$("preflightModal").classList.contains("open")) h.$("pfOk").click();
	await h.flush();
	assert.equal((await get(h, again)).state, "succeeded");
	assert.equal((await get(h, again)).result.created, 0);
	assert.equal(sim.all(seq), 4);
	healthy(h);
});

test("a clip locked after preflight reports removal failure, fails the job, and remains retryable", async () => {
	const { h, sim, seq } = await fixture();
	const first = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, first);
	h.$("pfOk").click(); await h.flush();
	assert.equal((await get(h, first)).state, "succeeded");
	assert.equal(sim.all(seq), 4);
	const orphan = sim.place(seq, 2, MOGRT, 900, 950);
	orphan.name = "old [MI:" + SALT + "-99.1]";
	const failedJob = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, failedJob);
	assert.equal((await get(h, failedJob)).state, "waiting_input");
	h.$("pfOrphansAll").checked = true;
	let removalResult;
	const removeClips = h.host.handlers.MI_removeClips;
	h.host.handlers.MI_removeClips = (json) => {
		// 계획은 잠기지 않은 트랙을 읽었다. 실행 직전에 잠겨 실제 호스트의 항목별 locked 응답을 받는다.
		seq.tracks[2].locked = true;
		try {
			const raw = removeClips(json);
			removalResult = JSON.parse(raw);
			return raw;
		} finally { seq.tracks[2].locked = false; }
	};
	h.$("pfOk").click(); await h.flush();
	const done = await get(h, failedJob);
	assert.equal(removalResult.ok, true, "호스트 호출 자체는 성공해도 항목 삭제는 실패할 수 있다");
	assert.equal(removalResult.results[0].status, "locked");
	assert.equal(done.state, "failed", JSON.stringify(done));
	assert.equal(done.error.code, "apply-incomplete");
	assert.equal(done.result.removeFailed, 1);
	assert.equal(done.result.removed, 0);
	assert.equal(done.result.failed, 0, "배치 실패와 삭제 실패 수를 구분한다");
	assert.equal(sim.all(seq), 5, "잠긴 클립은 남겨 둔다");
	assert.match(h.$("statusBar").textContent, /삭제 실패 1/);
	assert.equal(h.$("statusBar").classList.contains("err"), true);
	assert.equal(h.fs.readJson(JOB_FILE).jobs.find((j) => j.jobId === failedJob.jobId).state, "failed");

	h.host.handlers.MI_removeClips = removeClips;
	const retry = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, retry);
	h.$("pfOrphansAll").checked = true;
	h.$("pfOk").click(); await h.flush();
	const retried = await get(h, retry);
	assert.equal(retried.state, "succeeded", JSON.stringify(retried));
	assert.equal(retried.result.removed, 1);
	assert.equal(retried.result.removeFailed, 0);
	assert.equal(sim.all(seq), 4);
	assert.doesNotMatch(h.$("statusBar").textContent, /삭제 실패/);
	healthy(h);
});

test("preflight cancel and sequence switch make terminal jobs and never write", async () => {
	for (const changeSeq of [false, true]) {
		const { h, sim, seq } = await fixture();
		const j = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
		await approve(h, j);
		assert.equal((await get(h, j)).state, "waiting_input");
		if (changeSeq) { h.host.seq = { seqId: "other", seqName: "T_OTHER", projPath: PROJ }; await h.advance(300); }
		else h.$("pfCancel").click();
		await h.flush();
		const done = await get(h, j);
		assert.equal(done.state, "cancelled");
		assert.equal(done.error.code, changeSeq ? "seq-mismatch" : "cancelled");
		h.$("pfOk").click(); await h.flush();
		assert.equal(sim.all(seq), 0);
		healthy(h);
	}
});

test("selected rows on existing empty tracks complete after approval without an unnecessary preflight", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, rowsTwo().slice(0, 4)));
	const rows = (await cmd(h, "rows", {})).data.rows;
	const j = (await request(h, "jobs.requestApply", { scope: "rows", uids: rows.map((r) => r.uid) })).data;
	assert.equal(sim.all(seq), 0, "승인 전 쓰기는 없다");
	await approve(h, j);
	const done = await get(h, j);
	assert.equal(done.state, "succeeded", JSON.stringify(done));
	assert.equal(done.result.created, 4);
	assert.equal(done.result.tracksAdded, 0);
	assert.equal(h.$("preflightModal").classList.contains("open"), false);
	assert.equal(sim.all(seq), 4);
	healthy(h);
});

test("approval detects row/settings drift; a changed position without mm remains eligible", async () => {
	const { h, sim, seq } = await fixture();
	const j = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await cmd(h, "cast.set", { items: [{ key: "C1", pos: { x: 0.35, y: 0.5 } }] });
	await approve(h, j);
	assert.equal((await get(h, j)).error.code, "rows-changed");
	assert.equal(sim.all(seq), 0);
	const fresh = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, fresh); h.$("pfOk").click(); await h.flush();
	assert.equal((await get(h, fresh)).state, "succeeded");
	assert.equal(sim.all(seq), 4);
	await cmd(h, "cast.set", { items: [{ key: "C1", pos: { x: 0.65, y: 0.5 } }] });
	assert.ok(Object.values(h.snapshot().rowStates).every((r) => !r.mm));
	const moved = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, moved);
	if (h.$("preflightModal").classList.contains("open")) h.$("pfOk").click();
	await h.flush();
	assert.equal((await get(h, moved)).state, "succeeded");
	assert.equal((await get(h, moved)).result.motionOnly, 2, "mm 없는 위치 변경도 보낸다");
	seq.tracks[2].clips.pop();
	const missing = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, missing);
	if (h.$("preflightModal").classList.contains("open")) h.$("pfOk").click();
	await h.flush();
	assert.equal((await get(h, missing)).result.created, 1, "mm 없는 타임라인 삭제도 찾는다");
	assert.equal(sim.all(seq), 4);
	healthy(h);
});

test("import waits for normal dialog input, cancel leaves session, confirm writes session, C-less SRT never silently replaces", async () => {
	const { h } = await fixture({ node: { files: { "C:/C3.srt": SRT, "C:/no-key.srt": SRT } } });
	const before = h.snapshot();
	let j = (await request(h, "jobs.importSrt", { paths: ["C:/no-key.srt"] })).data;
	await approve(h, j);
	assert.equal((await get(h, j)).state, "waiting_input");
	assert.equal(h.$("impOk").disabled, true, "C번호는 사용자가 정한다");
	assert.deepEqual(h.snapshot(), before);
	h.$("impCancel").click();
	assert.equal((await get(h, j)).state, "cancelled");
	j = (await request(h, "jobs.importSrt", { paths: ["C:/C3.srt"] })).data;
	await approve(h, j);
	assert.equal((await get(h, j)).state, "waiting_input");
	h.$("impOk").click(); await h.flush();
	assert.equal((await get(h, j)).state, "succeeded");
	assert.equal(h.snapshot().subtitles.length, before.subtitles.length + 1);
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).subtitles.length, before.subtitles.length + 1);
	assert.match(h.fs.readJson(P.historySafety(PROJ, A.seqId))[0].label, /^AI: SRT 가져오기 전/);
	j = (await request(h, "jobs.importSrt", { paths: ["C:/C3.srt"] })).data;
	await approve(h, j);
	h.host.seq = { seqId: "other", seqName: "T_OTHER", projPath: PROJ }; await h.advance(300);
	assert.equal((await get(h, j)).error.code, "seq-mismatch");
	healthy(h);
});

test("panel reload retains terminal snapshots and cancels pending jobs; storage failure refuses request", async () => {
	const first = await fixture();
	const j = (await request(first.h, "jobs.requestApply", { scope: "changed" })).data;
	const files = Object.fromEntries(first.h.fs.files);
	const second = await fixture({ files });
	const reloaded = await get(second.h, j);
	assert.equal(reloaded.state, "cancelled");
	assert.equal(reloaded.error.code, "panel-reloaded");
	assert.equal((await cmd(second.h, "approvals.list", {})).data.length, 0);
	assert.equal(second.sim.all(second.seq), 0);
	const write = second.h.fs.writeFile;
	second.h.fs.writeFile = (p, d) => p === JOB_FILE ? { err: 4 } : write(p, d);
	assert.equal((await request(second.h, "jobs.requestApply", { scope: "changed" })).error, "storage-failed");
	assert.equal((await cmd(second.h, "approvals.list", {})).data.length, 0);
	healthy(second.h);
});

test("legacy untagged rows are explicitly unsupported rather than succeeding with zero placement", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, [[1, null, 100, 160, "옛 단일 화자"]]));
	for (const args of [{ scope: "changed" }, { scope: "rows", uids: ["1"] }]) {
		const r = await request(h, "jobs.requestApply", args);
		assert.equal(r.error, "unsupported-rows");
		assert.match(r.detail, /일반 ▶ 적용/);
		assert.match(r.detail, /C1/);
	}
	assert.equal((await cmd(h, "approvals.list", {})).data.length, 0);
	assert.equal(sim.all(seq), 0);
	healthy(h);
});

test("expiring apply review closes its callbacks; clicking old confirmation cannot write", async () => {
	const { h, sim, seq } = await fixture();
	const j = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, j);
	assert.equal((await get(h, j)).state, "waiting_input");
	const future = Date.now() + 11 * 60000;
	h.win.Date.now = () => future;
	// 읽기/heartbeat 없이 확인을 눌러도 만료 검사부터 한다.
	h.$("pfOk").click(); await h.flush();
	assert.equal((await get(h, j)).state, "expired");
	assert.equal(sim.all(seq), 0);
	assert.equal(h.$("preflightModal").classList.contains("open"), false);
	healthy(h);
});

test("an older pending request expiry cannot cancel a newer active review", async () => {
	const { h, sim, seq } = await fixture();
	const start = Date.now();
	h.win.Date.now = () => start;
	const old = (await request(h, "jobs.requestApply", { scope: "rows", uids: [SALT + "-1"] })).data;
	h.win.Date.now = () => start + 5 * 60000;
	const active = (await request(h, "jobs.requestApply", { scope: "changed" })).data;
	await approve(h, active);
	assert.equal((await get(h, active)).state, "waiting_input");
	h.win.Date.now = () => start + 11 * 60000;
	assert.equal((await get(h, old)).state, "expired");
	assert.equal((await get(h, active)).state, "waiting_input");
	assert.equal(h.$("preflightModal").classList.contains("open"), true);
	h.$("pfOk").click(); await h.flush();
	assert.equal((await get(h, active)).state, "succeeded");
	assert.equal(sim.all(seq), 4);
	healthy(h);
});
