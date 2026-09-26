"use strict";
/**
 * MOGRT Subtitle Importer 패널과 파일 다리로 이야기하는 node 쪽 (의존성 없음, CommonJS).
 * MCP 서버(mcp/server.mjs)·MCP 테스트(tests/mcp)·하드 케이스(tests/premiere/cases/s5_inbox)가 같이 쓴다.
 *
 * 다리 폴더 (패널 app.js의 src/mi/inbox.ts와 같은 약속):
 *   <APPDATA>/MogrtImporter/bridge/       (DEV 패널은 bridge_dev, 환경 변수 MI_BRIDGE_DIR로 바꾼다)
 *     inbox/<id>.json    여기서 쓴다: <id>.json.tmp에 쓰고 rename. {v: 1, id, op, args, at, seqId?, build?, by?}
 *     outbox/<id>.json   패널이 쓴다. 읽고 지운다. {v: 1, id, op, at, ok, data | error, detail, rid?, results?, dup?}
 *     heartbeat.json     패널이 2초마다 ({state: "on", …}), 끄면 {state: "off"}, 켠 채 닫으면 {state: "closed"}
 *   패널은 'AI 연결 허용'이 켜져 있을 때만 이 폴더를 읽고 쓴다. 명령은 2분이 지나면 돌리지 않는다(expired).
 *
 *   const B = require("./lib/bridge");
 *   const dir = B.bridgeDir();
 *   const p = await B.checkPanel(dir);            // {ok: true, hb, age} | {ok: false, code, message, hint}
 *   const r = await B.call(dir, "status", {}, { by: "codex", timeoutMs: 15000 });   // 패널 응답 (시간 초과는 BridgeError)
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const HB_FRESH_MS = 5000; // heartbeat가 이만큼 안에 쓰였으면 패널이 살아 있다 (패널은 2초마다 쓴다)
const HB_WAIT_MS = 5000; // 신호가 없거나 낡았으면 이만큼 새 신호를 기다린다
const CALL_TIMEOUT_MS = 15000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

class BridgeError extends Error {
	constructor(code, message, extra) {
		super(message);
		this.code = code;
		Object.assign(this, extra || {});
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 다리 폴더: MI_BRIDGE_DIR, 아니면 %APPDATA%/MogrtImporter/bridge (APPDATA가 없으면 macOS ~/Library/Application Support, 그 밖은 ~/.config) */
function bridgeDir(env = process.env) {
	if (env.MI_BRIDGE_DIR) return path.resolve(env.MI_BRIDGE_DIR);
	const base = env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
	return path.join(base, "MogrtImporter", "bridge");
}

/** 명령 id: 시각(정렬용)·프로세스·무작위 — 파일 이름에 쓸 수 있는 글자만 */
function newId() {
	return "m" + Date.now().toString(36) + "-" + process.pid.toString(36) + "-" + crypto.randomBytes(4).toString("hex");
}

/** tmp에 쓰고 rename (패널이 반쯤 쓴 파일을 읽지 않게) */
function writeJsonAtomic(file, obj) {
	const tmp = file + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
	fs.renameSync(tmp, file);
}

/** JSON 파일 → 값 | null (없거나 아직 쓰는 중) */
function tryReadJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (_) {
		return null;
	}
}

/** heartbeat.json → {hb, age(ms)} | {hb: null} */
function readHeartbeat(dir) {
	const hb = tryReadJson(path.join(dir, "heartbeat.json"));
	if (!hb || typeof hb !== "object") return { hb: null, age: null };
	const at = Number(hb.at);
	const age = isFinite(at) ? Math.max(0, Date.now() - at) : Infinity;
	return { hb, age };
}

const PANEL_HINT = "Premiere Pro에서 창 > 확장 > MOGRT Subtitle Importer 패널을 열고, 패널 위쪽의 'AI 연결 허용'을 켜 주세요.";

/**
 * 패널이 살아 있고 'AI 연결 허용'이 켜져 있는가. 신호가 없거나 낡았으면 waitMs 동안 새 신호를 기다린다
 * ('off'는 기다리지 않는다 — 사용자가 켜야 한다).
 * → {ok: true, hb, age} | {ok: false, code: ai-link-off|panel-closed|panel-not-responding|no-heartbeat, message, hint, age}
 */
async function checkPanel(dir, opts = {}) {
	const freshMs = opts.freshMs || HB_FRESH_MS;
	const waitMs = opts.waitMs === undefined ? HB_WAIT_MS : opts.waitMs;
	const deadline = Date.now() + waitMs;
	let last;
	for (;;) {
		last = readHeartbeat(dir);
		const hb = last.hb;
		if (hb && hb.state === "on" && last.age <= freshMs) return { ok: true, hb, age: last.age };
		if (hb && hb.state === "off") {
			return { ok: false, code: "ai-link-off", message: "패널의 'AI 연결 허용'이 꺼져 있습니다.", hint: "MOGRT Subtitle Importer 패널 위쪽의 'AI 연결 허용'을 켜 주세요. 켜기 전에는 패널이 AI 요청을 읽지 않습니다.", age: last.age };
		}
		if (Date.now() >= deadline) break;
		await sleep(opts.stepMs || 200);
	}
	const hb = last.hb;
	if (hb && hb.state === "closed") return { ok: false, code: "panel-closed", message: "MOGRT Subtitle Importer 패널이 닫혀 있습니다.", hint: PANEL_HINT, age: last.age };
	if (hb) {
		const s = Math.round(last.age / 1000);
		return {
			ok: false, code: "panel-not-responding",
			message: "패널 신호가 끊겼습니다 (마지막 신호 " + (isFinite(s) ? s + "초 전" : "시각 모름") + ").",
			hint: "Premiere가 멈췄거나(모달 창·긴 작업) 패널이 닫혔을 수 있습니다. Premiere 화면을 확인하고 패널을 연 뒤 'AI 연결 허용'을 켜 주세요.",
			age: last.age
		};
	}
	return { ok: false, code: "no-heartbeat", message: "패널 신호가 없습니다 (" + path.join(dir, "heartbeat.json") + ").", hint: PANEL_HINT, age: null };
}

/**
 * 명령 하나를 보내고 응답을 기다린다 → 패널 응답 {v, id, op, at, ok, data | error, detail, …}.
 * opts {seqId, build, by, id, timeoutMs(기본 15초), pollMs}
 * seqId는 문자열이면 빈 문자열("" = 시퀀스 없음)도 싣는다 — 패널이 지금 시퀀스와 맞춘다 (빈 seq_id로 확인을 건너뛰지 못하게).
 * build·by는 비어 있으면 싣지 않는다.
 * 시간 안에 응답이 없으면 BridgeError("timeout"): 패널이 아직 가져가지 않은 명령은 거둬서(withdrawn) 나중에 돌지 않게 한다.
 */
async function call(dir, op, args, opts = {}) {
	const id = opts.id || newId();
	if (!ID_RE.test(id)) throw new BridgeError("bad-args", "명령 id 형식이 아니다: " + id);
	const msg = { v: 1, id, op, args: args || {}, at: Date.now() };
	if (typeof opts.seqId === "string") msg.seqId = opts.seqId;
	["build", "by"].forEach((k) => { if (typeof opts[k] === "string" && opts[k]) msg[k] = opts[k]; });
	const inbox = path.join(dir, "inbox");
	const outFile = path.join(dir, "outbox", id + ".json");
	fs.mkdirSync(inbox, { recursive: true });
	writeJsonAtomic(path.join(inbox, id + ".json"), msg);
	const timeoutMs = opts.timeoutMs || CALL_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const resp = tryReadJson(outFile);
		if (resp && resp.id === id) {
			try {
				fs.unlinkSync(outFile);
			} catch (_) {}
			return resp;
		}
		if (Date.now() >= deadline) break;
		await sleep(opts.pollMs || 50);
	}
	let withdrawn = false;
	try {
		fs.unlinkSync(path.join(inbox, id + ".json"));
		withdrawn = true;
	} catch (_) {}
	const s = Math.round(timeoutMs / 1000);
	throw new BridgeError("timeout", withdrawn
		? "패널이 " + s + "초 안에 명령을 가져가지 않았습니다 (명령을 거뒀습니다)."
		: "패널이 " + s + "초 안에 답하지 않았습니다 (아직 처리 중일 수 있습니다).", { id, withdrawn });
}

module.exports = { bridgeDir, newId, writeJsonAtomic, tryReadJson, readHeartbeat, checkPanel, call, BridgeError, HB_FRESH_MS, HB_WAIT_MS, CALL_TIMEOUT_MS, ID_RE };
