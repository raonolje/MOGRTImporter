"use strict";
/**
 * 시드한 실제 세션 (S3-4 (8)): tools/install_dev.sh --seed-cache가 운영 캐시를 DEV 캐시로 복사해 둔 세션을 고르고,
 * 번갈아 C1·C2로 나눈 합성 다시 내보내기를 만든다.
 * 하드 케이스 s3_4_real(DEV 캐시)과 node tests/compat/realcache.test.js(MI_REAL_CACHE, 읽기 전용)가 같이 쓴다 —
 * 고르는 규칙과 나누는 규칙이 같아야 node가 본 분배를 하드가 타임라인에 놓는다.
 * 읽기만 한다. 자막 문장은 돌려주기만 한다: 부르는 쪽도 로그·파일에는 수와 id만 남긴다 (실제 텍스트는 저장소에 넣지 않는다).
 */
const fs = require("node:fs");
const path = require("node:path");

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
// 세션 하나에서 싣는 줄 수 상한 (하드 케이스의 importMGT 수를 묶는다. 2026-09 운영 캐시는 세션 4개 · 14~61줄)
const MAX_ROWS = 70;

/**
 * root(캐시 루트) 아래 프로젝트 폴더(proj_…)마다 presets.json이 있고, 시퀀스 폴더의 session.json이 비어 있지 않은
 * 화자 없는 목록(레거시)인 세션 → [{proj, seq, presetsText, presets, session}] (프로젝트·시퀀스 이름순).
 * opts.skipProj: 뺄 프로젝트 키 (하드 케이스는 MI_test.prproj 자신의 폴더를 뺀다). 읽지 못하는 파일은 건너뛴다
 */
function seededSessions(root, opts = {}) {
	const skip = new Set(opts.skipProj || []);
	const out = [];
	if (!root || !fs.existsSync(root)) return out;
	for (const pe of fs.readdirSync(root, { withFileTypes: true }).sort(byName)) {
		if (!pe.isDirectory() || !/^proj_/.test(pe.name) || skip.has(pe.name)) continue;
		const projDir = path.join(root, pe.name);
		const pp = path.join(projDir, "presets.json");
		if (!fs.existsSync(pp)) continue;
		let presetsText;
		let presets;
		try {
			presetsText = fs.readFileSync(pp, "utf8");
			presets = JSON.parse(presetsText).presets || {};
		} catch (_) { continue; }
		for (const se of fs.readdirSync(projDir, { withFileTypes: true }).sort(byName)) {
			if (!se.isDirectory()) continue;
			const sp = path.join(projDir, se.name, "session.json");
			if (!fs.existsSync(sp)) continue;
			let session;
			try { session = JSON.parse(fs.readFileSync(sp, "utf8")); } catch (_) { continue; }
			if (!session || !Array.isArray(session.subtitles) || !session.subtitles.length) continue;
			if (session.subtitles.some((x) => !x || x.spk)) continue;
			out.push({ proj: pe.name, seq: se.name, presetsText, presets, session });
		}
	}
	return out;
}

/**
 * 세션 → 작업 파일 (#workInput). sequenceKey가 지금 시퀀스와 달라 패널은 다른 시퀀스의 작업으로 받는다 (id를 새로 매김).
 * maxRows를 넘으면 목록 앞의 maxRows줄만 싣는다 (줄 상태도 그 줄만, 휴지통은 그대로) → {work, rows, capped}
 */
function workOf(s, maxRows) {
	const all = s.session.subtitles;
	const subs = maxRows > 0 && all.length > maxRows ? all.slice(0, maxRows) : all.slice();
	const rsIn = s.session.rowStates || {};
	const rowStates = {};
	subs.forEach((x) => { if (rsIn[x.id] !== undefined) rowStates[x.id] = rsIn[x.id]; });
	const work = JSON.parse(JSON.stringify({
		version: 2,
		savedAt: "2026-09-26T00:00:00.000Z",
		sequenceKey: "s3_4_real:" + s.seq,
		subtitles: subs,
		rowStates,
		trashBin: s.session.trashBin || [],
		nextId: s.session.nextId || 1,
		trackValue: "2"
	}));
	return { work, rows: subs.length, capped: subs.length < all.length };
}

/**
 * 레거시 목록을 차례대로 번갈아 C1·C2로 나눈 합성 다시 내보내기. 시작과 문장(normText)이 같은 줄(중복)은 같은 화자로 둔다
 * (두 파일에 같은 자막이 있으면 어느 화자인지 가릴 수 없다). normText는 core의 것을 넘긴다.
 * → {keyOf: {줄 id: "C1"|"C2"}, cues: {C1: [[시작, 끝, 문장]], C2: [...]} (시작순), dups}
 */
function splitByTurn(subtitles, normText) {
	const keyOf = {};
	const first = {};
	let dups = 0;
	subtitles.forEach((x, i) => {
		const k = x.startSec + "|" + normText(x.text);
		if (first[k] === undefined) first[k] = i;
		else dups++;
		keyOf[x.id] = first[k] % 2 ? "C2" : "C1";
	});
	const cues = { C1: [], C2: [] };
	subtitles.slice().sort((a, b) => a.startSec - b.startSec).forEach((x) => cues[keyOf[x.id]].push([x.startSec, x.endSec, x.text]));
	return { keyOf, cues, dups };
}

module.exports = { seededSessions, workOf, splitByTurn, MAX_ROWS };
