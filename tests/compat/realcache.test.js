"use strict";
// 운영 캐시 호환 (읽기 전용, S1-5): 실제 session.json과 히스토리 항목이 v28 패널을 거쳐도 그대로인가.
// MI_REAL_CACHE가 운영 캐시(%APPDATA%/Adobe/CEP/extensions/CEP_MogrtImporter/cache)를 가리킬 때만 돈다.
// 실제 파일은 읽어서 하네스의 메모리 cep.fs에만 넣는다 (디스크에 쓰지 않는다).
// 출력은 숫자·키 이름뿐이다 (자막 텍스트·프리셋 이름을 저장소나 로그에 남기지 않는다).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { loadRegions } = require("../lib/loadRegions");

const ROOT = process.env.MI_REAL_CACHE || "";
const skip = !ROOT || !fs.existsSync(ROOT) ? "MI_REAL_CACHE가 없다" : false;
const FAKE_PROJ = "C:/realcache/probe.prproj";
const FAKE_SEQ = { seqId: "real-0001", seqName: "T_REAL", projPath: FAKE_PROJ };
const KEYS4 = ["subtitles", "rowStates", "trashBin", "nextId"];

// [{proj, seq, dir, presets(원문|null)}] — session.json이나 히스토리가 있는 시퀀스 폴더
function sequences() {
	const out = [];
	for (const pe of fs.readdirSync(ROOT, { withFileTypes: true })) {
		if (!pe.isDirectory()) continue;
		const projDir = path.join(ROOT, pe.name);
		const presetsPath = path.join(projDir, "presets.json");
		const presets = fs.existsSync(presetsPath) ? fs.readFileSync(presetsPath, "utf8") : null;
		for (const se of fs.readdirSync(projDir, { withFileTypes: true })) {
			if (!se.isDirectory()) continue;
			out.push({ proj: pe.name, seq: se.name, dir: path.join(projDir, se.name), presets });
		}
	}
	return out;
}
const readText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const tag = (s) => s.proj + "/" + s.seq.slice(-8);

async function bootWith(s, files) {
	const all = Object.assign({}, files);
	if (s.presets) all[P.presets(FAKE_PROJ)] = s.presets;
	const h = await bootPanel({ seq: FAKE_SEQ, files: all });
	await h.advance(1000);
	return h;
}
function noErrors(h, what) {
	const errs = h.errors().map((e) => String(e.message || e).slice(0, 200));
	assert.deepEqual(errs, [], what + ": 패널 예외");
}

test("운영 캐시: 비어 있지 않은 session.json은 불러오고 저장해도 JSON이 같고 키 4개 (mi 없음)", { skip }, async (t) => {
	let n = 0;
	for (const s of sequences()) {
		const raw = readText(path.join(s.dir, "session.json"));
		if (!raw) continue;
		let orig;
		try { orig = JSON.parse(raw); } catch (_) { t.diagnostic(tag(s) + ": 읽지 못하는 session.json (건너뜀)"); continue; }
		if (!orig || !Array.isArray(orig.subtitles) || !orig.subtitles.length) continue;
		const h = await bootWith(s, { [P.session(FAKE_PROJ, FAKE_SEQ.seqId)]: raw });
		assert.equal(h.snapshot().subtitles.length, orig.subtitles.length, tag(s));
		h.win._mogrtDebug.saveSession();
		const saved = h.fs.readJson(P.session(FAKE_PROJ, FAKE_SEQ.seqId));
		assert.deepEqual(Object.keys(saved), KEYS4, tag(s) + ": 키");
		assert.deepEqual(saved, orig, tag(s) + ": 왕복");
		assert.equal(h.fs.files.has(P.cast(FAKE_PROJ, FAKE_SEQ.seqId)), false, tag(s) + ": cast.json을 만들지 않는다");
		noErrors(h, tag(s));
		t.diagnostic(tag(s) + ": " + orig.subtitles.length + "줄 왕복");
		n++;
	}
	t.diagnostic("비어 있지 않은 세션 " + n + "개");
});

test("운영 캐시: 히스토리 항목을 복원해도 목록·rowStates·휴지통이 같고, 저장은 키 4개 (mi 없음)", { skip }, async (t) => {
	let files = 0;
	let entries = 0;
	for (const s of sequences()) {
		for (const f of ["history_auto.json", "history_manual.json"]) {
			const raw = readText(path.join(s.dir, f));
			if (!raw) continue;
			let list;
			try { list = JSON.parse(raw); } catch (_) { t.diagnostic(tag(s) + "/" + f + ": 읽지 못함 (건너뜀)"); continue; }
			if (!Array.isArray(list)) continue;
			const target = f === "history_manual.json" ? P.historyManual(FAKE_PROJ, FAKE_SEQ.seqId) : P.historyAuto(FAKE_PROJ, FAKE_SEQ.seqId);
			const h = await bootWith(s, { [target]: raw });
			const sectionIdx = f === "history_manual.json" ? 0 : 2;
			let done = 0;
			for (let i = 0; i < list.length; i++) {
				const e = list[i];
				if (!e || !Array.isArray(e.subtitles) || !e.subtitles.length) continue;
				const dd = h.$("historyDropdown");
				if (!dd.classList.contains("open")) h.$("btnHistory").click();
				const items = dd.childNodes[sectionIdx].querySelectorAll(".history-item");
				assert.equal(items.length, list.length, tag(s) + "/" + f + ": 항목 수");
				items[i].childNodes[0].click();
				h.$("confirmYes").click();
				const saved = h.fs.readJson(P.session(FAKE_PROJ, FAKE_SEQ.seqId));
				const where = tag(s) + "/" + f + "#" + i;
				assert.deepEqual(Object.keys(saved), KEYS4, where + ": 키");
				assert.deepEqual({ subtitles: saved.subtitles, rowStates: saved.rowStates, trashBin: saved.trashBin }, { subtitles: e.subtitles, rowStates: e.rowStates, trashBin: e.trashBin || [] }, where + ": 왕복");
				assert.ok(saved.nextId >= (e.nextId || 1), where + ": nextId");
				done++;
			}
			noErrors(h, tag(s) + "/" + f);
			if (done) { files++; entries += done; }
		}
	}
	t.diagnostic("히스토리 파일 " + files + "개, 항목 " + entries + "개 복원");
});

test("운영 캐시: 줄마다 캡션 T-ID가 캡션 필드로 해석되고, v27 위험(isV27Unsafe)은 옛 구조 줄과 정확히 같다", { skip }, (t) => {
	const core = loadRegions(["src/mi/core.ts"]);
	let rows = 0;
	let stale = 0;
	let unsafe = 0;
	for (const s of sequences()) {
		const raw = readText(path.join(s.dir, "session.json"));
		if (!raw || !s.presets) continue;
		let sess;
		let presets;
		try { sess = JSON.parse(raw); presets = JSON.parse(s.presets).presets || {}; } catch (_) { continue; }
		for (const sub of sess.subtitles || []) {
			const rs = (sess.rowStates || {})[sub.id];
			const preset = rs && rs.presetId ? presets[rs.presetId] : null;
			if (!preset || !Array.isArray(rs._allParams) || !rs._allParams.length) continue;
			const cap = core.captionFid(preset);
			if (!cap) continue;
			rows++;
			const want = preset.params.find((p) => p.index === preset.textParamIndex);
			const got = core.resolveFid(rs._allParams, cap, preset.params);
			assert.ok(got, tag(s) + " id " + sub.id + ": 캡션 " + cap + "를 해석하지 못함");
			assert.equal(got.displayName, want.displayName, tag(s) + " id " + sub.id);
			const isStale = core.layoutMismatch(rs._allParams, preset.params);
			const isUnsafe = core.isV27Unsafe(rs, preset);
			if (isStale) stale++;
			if (isUnsafe) unsafe++;
			assert.equal(isUnsafe, isStale, tag(s) + " id " + sub.id + ": isV27Unsafe = 옛 구조");
		}
	}
	t.diagnostic("캡션이 있는 줄 " + rows + "개, 옛 구조 " + stale + "개, isV27Unsafe " + unsafe + "개");
});

test("운영 캐시 (S1-8): 세션마다 자기 자막을 다시 병합해도 아무것도 바뀌지 않고, 캡션을 바꾼 병합은 캡션이 아닌 속성을 건드리지 않는다", { skip }, (t) => {
	const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);
	const js = (v) => JSON.stringify(v);
	let sessions = 0;
	let changed = 0;
	for (const s of sequences()) {
		const raw = readText(path.join(s.dir, "session.json"));
		if (!raw) continue;
		let sess;
		let presets = {};
		try {
			sess = JSON.parse(raw);
			if (s.presets) presets = JSON.parse(s.presets).presets || {};
		} catch (_) { continue; }
		if (!sess || !Array.isArray(sess.subtitles) || !sess.subtitles.length) continue;
		const data = () => ({ subtitles: JSON.parse(js(sess.subtitles)), rowStates: JSON.parse(js(sess.rowStates || {})), trashBin: JSON.parse(js(sess.trashBin || [])), nextId: sess.nextId || 1, mi: core.miDefault() });
		// 레거시 목록을 v27이 읽은 그 SRT로 다시 병합 (parseSRT opts 결과 모양)
		const cues = sess.subtitles.map((x, i) => ({ index: i + 1, startTime: x.startTime, endTime: x.endTime, startSec: x.startSec, endSec: x.endSec, text: x.text, srtNo: x.index }));
		const d1 = data();
		const before = js(d1);
		core.importIntoData(d1, { files: [{ key: null, action: "merge", cues }] }, { now: 1, presets });
		assert.equal(js(d1), before, tag(s) + ": 같은 자막 병합은 변화 없음");
		// 모든 캡션 문장 끝에 글자 하나를 붙인 파일: 캡션이 아닌 속성은 그대로
		const d2 = data();
		const orig = JSON.parse(js(d2.rowStates));
		core.importIntoData(d2, { files: [{ key: null, action: "merge", cues: cues.map((c) => Object.assign({}, c, { text: c.text + "." })) }] }, { now: 1, presets });
		let n = 0;
		d2.subtitles.forEach((x) => {
			const rs = d2.rowStates[x.id];
			const o = orig[x.id];
			assert.ok(rs && o, tag(s) + " id " + x.id + ": 같은 id");
			const preset = o.presetId ? presets[o.presetId] : null;
			const f = preset ? core.resolveFid(o._allParams || [], core.captionFid(preset), preset.params) : null;
			const capIdx = f ? f.index : -999;
			const strip = (l) => (l || []).filter((p) => p && p.index !== capIdx);
			assert.equal(js(strip(rs._allParams)), js(strip(o._allParams)), tag(s) + " id " + x.id + ": 캡션이 아닌 속성");
			if (f) {
				assert.equal(core.rowCaptionValue(rs, preset), x.text, tag(s) + " id " + x.id + ": 캡션 필드 = 새 문장 (패널에서 고친 줄은 충돌 → 기본 SRT)");
				n++;
			}
		});
		assert.equal(d2.subtitles.length, sess.subtitles.length, tag(s) + ": 줄 수");
		sessions++;
		changed += n;
	}
	t.diagnostic("세션 " + sessions + "개, 캡션을 바꾼 줄 " + changed + "개");
});

test("운영 캐시 (S1-9): 병합으로 문장을 바꾼 줄은 안전 적용이 캡션을 이름(index -1)으로 보내고, 옛 구조 줄은 이름으로 쓸 수 있는 속성만 보낸다", { skip }, (t) => {
	const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);
	let text = 0;
	let named = 0;
	let staleRows = 0;
	const skips = {};
	for (const s of sequences()) {
		const raw = readText(path.join(s.dir, "session.json"));
		if (!raw || !s.presets) continue;
		let sess;
		let presets;
		try { sess = JSON.parse(raw); presets = JSON.parse(s.presets).presets || {}; } catch (_) { continue; }
		if (!sess || !Array.isArray(sess.subtitles) || !sess.subtitles.length) continue;
		const data = { subtitles: JSON.parse(JSON.stringify(sess.subtitles)), rowStates: JSON.parse(JSON.stringify(sess.rowStates || {})), trashBin: JSON.parse(JSON.stringify(sess.trashBin || [])), nextId: sess.nextId || 1, mi: core.miDefault() };
		const cues = data.subtitles.map((x, i) => ({ index: i + 1, startTime: x.startTime, endTime: x.endTime, startSec: x.startSec, endSec: x.endSec, text: x.text + ".", srtNo: x.index }));
		core.importIntoData(data, { files: [{ key: null, action: "merge", cues }] }, { now: 1, presets });
		const rows = data.subtitles.map((x) => {
			const rs = data.rowStates[x.id];
			return { sub: x, rs, preset: rs && rs.presetId ? presets[rs.presetId] || null : null, track: 2 };
		});
		const plan = core.legacySafePlan(rows, core.legacyNeighbors(data.subtitles, data.rowStates, data.trashBin, 2));
		plan.forEach((p, i) => {
			const r = rows[i];
			if (!r.preset || !core.captionFid(r.preset)) return;
			if (p.op === "skip") {
				skips[p.why] = (skips[p.why] || 0) + 1;
				assert.notEqual(p.why, "caption-name", tag(s) + " id " + p.id + ": 옛 구조 줄의 캡션을 이름으로 쓸 수 있어야 한다");
				return;
			}
			text++;
			const unsafe = core.isV27Unsafe(r.rs, r.preset);
			if (unsafe) staleRows++;
			const cap = p.params.find((x) => x.type === "text" && x.value === r.sub.text);
			assert.ok(cap, tag(s) + " id " + p.id + ": 캡션 속성을 보낸다");
			if (unsafe) assert.ok(p.params.every((x) => x.index === -1), tag(s) + " id " + p.id + ": 옛 구조 줄은 이름으로만");
			if (cap.index === -1) named++;
		});
	}
	t.diagnostic("안전 적용으로 보낼 줄 " + text + "개 (캡션 이름 쓰기 " + named + "개, 옛 구조 " + staleRows + "개), 건너뜀 " + JSON.stringify(skips));
});
