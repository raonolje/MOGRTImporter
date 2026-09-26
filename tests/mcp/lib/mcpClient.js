"use strict";
/**
 * MCP 테스트 도우미: 진짜 서버(mcp/server.mjs)를 SDK Client(stdio)로 띄우고, 가짜 패널(tests/mcp/fake_panel.js)을 별도 프로세스로 띄운다.
 * SDK는 mcp/node_modules에서 읽는다 (없으면 `cd mcp && npm install` 안내).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const { regionHash } = require("../../lib/loadRegions");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SERVER = path.join(ROOT, "mcp", "server.mjs");
const FAKE = path.join(__dirname, "..", "fake_panel.js");

let SDK = null;
function sdk() {
	if (SDK) return SDK;
	const req = createRequire(path.join(ROOT, "mcp", "package.json"));
	try {
		SDK = {
			Client: req("@modelcontextprotocol/sdk/client/index.js").Client,
			StdioClientTransport: req("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport,
			getDefaultEnvironment: req("@modelcontextprotocol/sdk/client/stdio.js").getDefaultEnvironment
		};
	} catch (e) {
		throw new Error("MCP SDK가 없습니다 — `cd mcp && npm install` 뒤 `npm run test:mcp` (" + e.message + ")");
	}
	return SDK;
}

function tmpDir(tag) {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mi_mcp_" + tag + "_"));
}

/** 설치본 흉내: <tmp>/ext/html/js/app.js = 저장소 app.js 사본 → {extPath, coreHash} */
function makeExt(tmp) {
	const extPath = path.join(tmp, "ext");
	fs.mkdirSync(path.join(extPath, "html", "js"), { recursive: true });
	const file = path.join(extPath, "html", "js", "app.js");
	fs.copyFileSync(path.join(ROOT, "extension", "html", "js", "app.js"), file);
	return { extPath, coreHash: regionHash("src/mi/core.ts", file) };
}

/** 가짜 패널을 띄우고 "ready"를 기다린다 → {proc, stop()} */
function startFake(tmp, cfg, timeoutMs = 30000) {
	const cfgFile = path.join(tmp, "fake_" + cfg.mode + "_" + Date.now() + ".json");
	fs.writeFileSync(cfgFile, JSON.stringify(cfg));
	const proc = spawn(process.execPath, [FAKE, cfgFile], { stdio: ["ignore", "pipe", "pipe"] });
	let err = "";
	proc.stderr.on("data", (d) => { err += d; });
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => { proc.kill(); reject(new Error("가짜 패널이 준비되지 않음: " + err)); }, timeoutMs);
		let out = "";
		proc.stdout.on("data", (d) => {
			out += d;
			if (/ready/.test(out)) {
				clearTimeout(t);
				resolve({ proc, stop: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once("exit", () => r()); proc.kill(); }), stderr: () => err });
			}
		});
		proc.once("exit", (code) => { clearTimeout(t); if (!/ready/.test(out)) reject(new Error("가짜 패널이 끝남 (" + code + "): " + err)); });
	});
}

/** 서버를 띄워 붙는다 → {client, close(), stderr()} */
async function connect(env, clientName = "codex-mcp-client") {
	const { Client, StdioClientTransport, getDefaultEnvironment } = sdk();
	const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: Object.assign({}, getDefaultEnvironment(), env), stderr: "pipe" });
	let err = "";
	if (transport.stderr) transport.stderr.on("data", (d) => { err += d; });
	const client = new Client({ name: clientName, version: "0.0.1" });
	await client.connect(transport);
	return { client, close: () => client.close(), stderr: () => err };
}

/** 도구 호출 → {isError, json, text, ms} (content[0].text의 JSON) */
async function callJson(client, name, args) {
	const t0 = Date.now();
	const r = await client.callTool({ name, arguments: args || {} });
	const text = r.content && r.content[0] && r.content[0].text;
	let json = null;
	try {
		json = JSON.parse(text);
	} catch (_) {}
	return { isError: !!r.isError, json, text, ms: Date.now() - t0, raw: r };
}

function readLog(file) {
	if (!fs.existsSync(file)) return [];
	return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

module.exports = { ROOT, SERVER, sdk, tmpDir, makeExt, startFake, connect, callJson, readLog };
