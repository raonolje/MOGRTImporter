#!/usr/bin/env node
"use strict";
/**
 * MCP 테스트의 가짜 패널 (별도 프로세스). 진짜 다리 폴더(임시)에 heartbeat를 쓰고 inbox에 답한다.
 *
 *   node tests/mcp/fake_panel.js <설정 JSON 경로>
 *   설정 {mode, dir, extPath, coreHash?, logFile?, snapFile?, appdata?, beatMs?, slowMs?}
 *
 * mode
 *   fixture  tests/mcp/fixtures/panel_replies.json의 답을 돌려준다 (op별, 일부는 인자별). seqId가 다르면 seq-mismatch,
 *            2분 지난 명령은 expired — 패널 inbox.ts와 같은 겉모양. 받은 명령은 logFile(jsonl)에 남긴다.
 *   harness  진짜 app.js 전체를 panelHarness(vm)로 띄우고 premiereSim을 호스트로 잇는다. 'AI 연결 허용'을 켜고
 *            가짜 시계를 실제 시간에 맞춰 돌린다 → 패널 inbox.ts가 진짜로 답한다. snapFile에 스냅숏·상태 줄·ui(제안 버튼 글자,
 *            승인 카드 글자)·예외를 0.3초마다 쓴다.
 *   off | closed | stale   heartbeat에 그 상태 하나만 쓰고 답하지 않는다 (stale = 60초 전 state on)
 *   silent   살아 있는 heartbeat만 쓰고 명령은 가져가지 않는다 (시간 초과 시험)
 * 준비되면 stdout에 "ready"를 쓴다.
 */
const fs = require("node:fs");
const path = require("node:path");

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeJsonAtomic(file, obj) {
	fs.writeFileSync(file + ".tmp", JSON.stringify(obj));
	fs.renameSync(file + ".tmp", file);
}
function logCmd(msg) {
	if (cfg.logFile) fs.appendFileSync(cfg.logFile, JSON.stringify(msg) + "\n");
}

async function scripted() {
	const dir = cfg.dir;
	fs.mkdirSync(path.join(dir, "inbox"), { recursive: true });
	fs.mkdirSync(path.join(dir, "outbox"), { recursive: true });
	const hbFile = path.join(dir, "heartbeat.json");
	if (cfg.mode === "off" || cfg.mode === "closed") {
		writeJsonAtomic(hbFile, { v: 1, at: Date.now(), state: cfg.mode, build: "@@BUILD@@" });
		process.stdout.write("ready\n");
		return;
	}
	const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "panel_replies.json"), "utf8"));
	const beat = () => writeJsonAtomic(hbFile, {
		v: 1, at: cfg.mode === "stale" ? Date.now() - 60000 : Date.now(), state: "on",
		panel: { v: 28, build: "@@BUILD@@" }, host: { v: 28, build: "@@BUILD@@", prefix: "MI_" }, build: "@@BUILD@@",
		extPath: cfg.extPath, coreHash: cfg.coreHash, seqId: fx.seqId, seqName: fx.seqName, keysResolved: true,
		busy: false, processing: null, pendingApproval: 0, suggestions: 0, rows: 24, pollMs: 50, beatMs: cfg.beatMs || 250
	});
	beat();
	if (cfg.mode === "stale") {
		process.stdout.write("ready\n");
		return;
	}
	setInterval(beat, cfg.beatMs || 250);
	process.stdout.write("ready\n");
	if (cfg.mode === "silent") return;
	for (;;) {
		let names = [];
		try {
			names = fs.readdirSync(path.join(dir, "inbox")).filter((n) => /\.json$/.test(n)).sort();
		} catch (_) {}
		for (const n of names) {
			const p = path.join(dir, "inbox", n);
			let msg;
			try {
				msg = JSON.parse(fs.readFileSync(p, "utf8"));
				fs.unlinkSync(p);
			} catch (_) {
				continue;
			}
			logCmd(msg);
			if (cfg.slowMs) await sleep(cfg.slowMs);
			let resp;
			if (Date.now() - msg.at > 120000) resp = { ok: false, error: "expired", detail: "2분이 지나 돌리지 않았다" };
			else if (msg.seqId !== undefined && msg.seqId !== fx.seqId) resp = { ok: false, error: "seq-mismatch", detail: "지금 시퀀스: " + fx.seqId };
			else {
				const r = fx.replies[msg.op];
				const byArg = r && r.byArg ? r.byArg[JSON.stringify(msg.args || {})] : null;
				resp = byArg || (r && r.default) || { ok: false, error: "bad-args", detail: "모르는 명령: " + msg.op };
				resp = JSON.parse(JSON.stringify(resp));
				if (msg.op === "status" && resp.ok) resp.data.coreHash = cfg.coreHash;
			}
			writeJsonAtomic(path.join(dir, "outbox", msg.id + ".json"), Object.assign({ v: 1, id: msg.id, op: msg.op, at: Date.now() }, resp));
		}
		await sleep(50);
	}
}

async function harness() {
	const { bootPanel, projKeyOf, seqKeyOf } = require("../lib/panelHarness");
	const S = require("./lib/session");
	const fx = S.build();
	const extDir = String(cfg.extPath).replace(/\\/g, "/");
	const cache = extDir + "/cache/" + projKeyOf(S.PROJ);
	const h = await bootPanel({
		seq: S.SEQ,
		extDir,
		mogrts: [{ name: fx.preset.name, path: fx.preset.mogrtPath }],
		files: { [cache + "/presets.json"]: { presets: { [fx.preset.id]: fx.preset }, presetTrash: [], nextPresetId: 4 }, [cache + "/" + seqKeyOf(S.PROJ, S.SEQ.seqId) + "/session.json"]: fx.session },
		node: { fs, env: { APPDATA: cfg.appdata } }
	});
	fx.HOST_FNS.forEach((fn) => {
		h.host.handlers["MI_" + fn] = (json) => fx.sim.callRaw("MI_" + fn, json === undefined ? undefined : JSON.stringify(json));
	});
	await h.advance(1000);
	const chk = h.$("aiLinkChk");
	chk.checked = true;
	h.change(chk);
	if (!h.win._mogrtDebug.inbox.on()) throw new Error("AI 연결을 켜지 못함: " + h.status().text);
	process.stdout.write("ready\n");
	let n = 0;
	for (;;) {
		await h.advance(50);
		if (cfg.snapFile && ++n % 6 === 0) {
			try {
				const bar = h.$("aiReqBar");
				const sb = h.$("btnSuggestions");
				const ui = {
					sugg: sb ? sb.textContent : "",
					suggShown: !!h.$("suggWrap") && h.$("suggWrap").style.display !== "none",
					aiReq: bar && bar.style.display !== "none" ? bar.querySelectorAll(".ai-req-text").map((e) => e.textContent) : []
				};
				writeJsonAtomic(cfg.snapFile, { snapshot: h.snapshot(), status: h.status(), ui, errors: h.errors().map((e) => String((e && e.message) || e)).slice(0, 5) });
			} catch (_) {}
		}
		await sleep(50);
	}
}

(cfg.mode === "harness" ? harness() : scripted()).catch((e) => {
	process.stderr.write("fake_panel 실패: " + (e && e.stack) + "\n");
	process.exit(1);
});
