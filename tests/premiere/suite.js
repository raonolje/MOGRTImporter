#!/usr/bin/env node
"use strict";
/**
 * npm run hard — DEV 패널(7778)에서 하드 테스트 모음을 돌린다.
 *   1) 가드(MI_test.prproj, T_ 시퀀스)  2) smoke.expr.txt  3) cases/*.case.js (이름순)
 *
 *   npm run hard                         전체
 *   npm run hard -- s1_9 s2_              이름에 s1_9 또는 s2_ 가 들어간 케이스만 (스모크는 항상)
 *   npm run hard -- --port 7778 --timeout 300000
 * 케이스 목록은 단계마다 늘어난다(S3-4에서 전체 E2E로 확장).
 */
const fs = require("node:fs");
const path = require("node:path");
const { Cdp, checkPort, DEV_PORT } = require("./cdp");
const { runFile, evalScriptExpr } = require("./run");
const { guard, GuardError } = require("./lib/guard");

const DIR = __dirname;

function parse(argv) {
	const o = { port: DEV_PORT, timeoutMs: 120000, filters: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--port") o.port = Number(argv[++i]);
		else if (a === "--timeout") o.timeoutMs = Number(argv[++i]);
		else if (a.startsWith("--")) throw new Error("모르는 인자: " + a);
		else o.filters.push(a);
	}
	checkPort(o.port, {});
	return o;
}

function caseFiles(filters) {
	const dir = path.join(DIR, "cases");
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter((f) => /\.case\.js$/.test(f))
		.filter((f) => !filters.length || filters.some((x) => f.indexOf(x) !== -1))
		.sort()
		.map((f) => path.join(dir, f));
}

async function main(argv) {
	let o;
	try {
		o = parse(argv);
	} catch (e) {
		console.log("!! " + e.message);
		return 64;
	}
	let client;
	try {
		client = await Cdp.connect(o.port, { timeoutMs: o.timeoutMs });
	} catch (e) {
		console.log("!! " + e.message);
		return 2;
	}
	const results = [];
	try {
		const info = await guard((jsx) => client.evaluate(evalScriptExpr(jsx)));
		console.log("=== 가드 통과: " + info.projPath + " / " + info.seqName);
		const files = [path.join(DIR, "smoke.expr.txt")].concat(caseFiles(o.filters));
		for (const f of files) {
			const rel = path.relative(process.cwd(), f);
			const t0 = Date.now();
			console.log("--- " + rel);
			try {
				await runFile(client, f, { timeoutMs: o.timeoutMs });
				results.push({ rel, ok: true, ms: Date.now() - t0 });
				console.log("PASS " + rel + " (" + (Date.now() - t0) + "ms)");
			} catch (e) {
				results.push({ rel, ok: false, ms: Date.now() - t0, msg: e.message });
				console.log("FAIL " + rel + " — " + e.message);
				if (e instanceof GuardError) break; // 테스트가 시퀀스를 바꿨다면 더 진행하지 않는다
			}
		}
	} catch (e) {
		console.log("!! " + e.message);
		return e instanceof GuardError ? 3 : 1;
	} finally {
		client.close();
	}
	const bad = results.filter((r) => !r.ok);
	console.log("\n=== " + (results.length - bad.length) + "/" + results.length + " 통과" + (bad.length ? " — 실패: " + bad.map((r) => r.rel).join(", ") : ""));
	return bad.length ? 1 : 0;
}

if (require.main === module) {
	main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.log("FATAL " + e.stack); process.exitCode = 1; });
}

module.exports = { main, caseFiles, parse };
