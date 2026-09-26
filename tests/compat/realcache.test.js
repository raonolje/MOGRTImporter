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

test("운영 캐시 (S1-10): 옛 구조 줄을 지금 프리셋 구조로 맞추면 구조가 같아지고 캡션·텍스트 필드 값이 T-ID대로 옮겨진다", { skip }, (t) => {
	const core = loadRegions(["src/mi/core.ts"]);
	let stale = 0;
	let orphans = 0;
	let rebasedAll = 0;
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
			const cap = core.rowCaptionValue(rs, preset);
			const r = core.rebaseRowParams(rs._allParams, preset, { rowExposed: rs.params || [], caption: cap !== null ? cap : sub.text });
			const where = tag(s) + " id " + sub.id;
			assert.equal(core.layoutMismatch(r.params, preset.params), false, where + ": 지금 구조");
			const res = core.resolveFields(rs._allParams, preset.params);
			Object.keys(res).forEach((fid) => {
				const got = core.resolveFid(r.params, fid, preset.params);
				assert.equal(String(got.param.value), String(res[fid].param.value), where + " " + fid);
			});
			if (cap !== null) assert.equal(core.rowCaptionValue({ _allParams: r.params }, preset), cap, where + ": 캡션");
			if (core.layoutMismatch(rs._allParams, preset.params)) stale++;
			orphans += r.orphanFields.length;
			rebasedAll++;
		}
	}
	t.diagnostic("맞춘 줄 " + rebasedAll + "개 (옛 구조 " + stale + "개), 못 옮긴 텍스트 " + orphans + "개");
});

test("운영 캐시 (S3-4): 레거시 목록을 화자로 나눈다 — 세션 자막을 번갈아 C1·C2 파일로 다시 내보낸 것(합성)으로 분배하면 줄마다 제 화자, id·시간·문장·후반 작업 그대로, 같은 파일을 다시 가져오면 변화 없음", { skip }, (t) => {
	const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);
	const js = (v) => JSON.stringify(v);
	const clone = (v) => JSON.parse(js(v));
	// 한 화자의 합성 SRT (parseSRT opts 결과 모양, 번호는 그 파일 안에서 1부터)
	const cuesOf = (rows) => rows.slice().sort((a, b) => a.startSec - b.startSec).map((x, j) => ({ index: j + 1, startTime: x.startTime, endTime: x.endTime, startSec: x.startSec, endSec: x.endSec, text: x.text, srtNo: j + 1 }));
	let sessions = 0;
	let rows = 0;
	let dups = 0;
	let ambiguous = 0;
	let trashAssigned = 0;
	for (const s of sequences()) {
		const raw = readText(path.join(s.dir, "session.json"));
		if (!raw) continue;
		let sess;
		let presets = {};
		try {
			sess = JSON.parse(raw);
			if (s.presets) presets = JSON.parse(s.presets).presets || {};
		} catch (_) { continue; }
		if (!sess || !Array.isArray(sess.subtitles) || !sess.subtitles.length || sess.subtitles.some((x) => x.spk)) continue;
		const where = tag(s);
		// 차례마다 번갈아 C1·C2. 시작과 문장이 같은 줄(중복)은 같은 화자로 둔다 (두 파일에 같은 자막이 있으면 어느 화자인지 가릴 수 없다)
		const keyOf = {};
		const first = {};
		sess.subtitles.forEach((x, i) => {
			const k = x.startSec + "|" + core.normText(x.text);
			if (first[k] === undefined) first[k] = i;
			else dups++;
			keyOf[x.id] = first[k] % 2 ? "C2" : "C1";
		});
		const files = ["C1", "C2"].map((K) => ({ key: K, name: "", action: "new", cues: cuesOf(sess.subtitles.filter((x) => keyOf[x.id] === K)) })).filter((f) => f.cues.length);
		const data = { subtitles: clone(sess.subtitles), rowStates: clone(sess.rowStates || {}), trashBin: clone(sess.trashBin || []), nextId: sess.nextId || 1, mi: core.miDefault() };
		const rep = core.importIntoData(data, { files: clone(files), legacy: { mode: "split", oneKey: "", assign: {} } }, { now: 1, presets, salt: "ab12", trackValue: 2 });
		assert.ok(rep.legacy && rep.legacy.total === sess.subtitles.length, where + ": 분배한 줄 수");
		assert.equal(rep.legacy.unmatched, 0, where + ": 짝 없는 줄(휴지통으로 간 줄) 없음");
		ambiguous += rep.legacy.ambiguous.length;
		trashAssigned += rep.legacy.trashAssigned;
		assert.ok(rep.files.every((f) => f.action === "merge"), where + ": 화자마다 나눈 줄에 병합 " + js(rep.files.map((f) => f.action)));
		rep.files.forEach((f) => {
			const st = f.stats;
			assert.ok(st && st.same === f.count && st.text + st.time + st.both + st.check + st.new + st.removed + st.conflict + st.restored === 0, where + " " + f.key + ": 제 파일과는 모두 같음 " + js({ same: st && st.same, count: f.count, text: st && st.text, time: st && st.time, check: st && st.check, new: st && st.new, removed: st && st.removed }));
		});
		assert.equal(data.subtitles.length, sess.subtitles.length, where + ": 줄 수 (새 줄·빠진 줄 없음)");
		assert.equal(data.trashBin.length, (sess.trashBin || []).length, where + ": 휴지통 수");
		const orig = {};
		sess.subtitles.forEach((x) => { orig[x.id] = x; });
		const bad = { spk: 0, sub: 0, rs: 0 };
		data.subtitles.forEach((x) => {
			const o = orig[x.id];
			if (!o || x.spk !== keyOf[x.id]) bad.spk++;
			if (!o || x.text !== o.text || x.startSec !== o.startSec || x.endSec !== o.endSec || x.startTime !== o.startTime || x.endTime !== o.endTime) bad.sub++;
			if (js(data.rowStates[x.id]) !== js((sess.rowStates || {})[x.id])) bad.rs++;
		});
		assert.deepEqual(bad, { spk: 0, sub: 0, rs: 0 }, where + ": 제 화자·id·시간·문장·줄 상태(프리셋·후반 작업) 그대로");
		assert.equal(js(data.mi.castOrder), js(files.map((f) => f.key)), where + ": 화자 표");
		assert.equal(data.mi.legacyTrack, 2, where + ": 옛 클립 트랙");
		// 화자 안 번호는 1부터 차례대로
		files.forEach((f) => {
			const idx = data.subtitles.filter((x) => x.spk === f.key).map((x) => x.index);
			assert.ok(idx.every((v, i) => v === i + 1), where + " " + f.key + ": 번호");
		});
		// 같은 파일을 다시 가져오면 (이제 화자 줄이 있다 → 화자마다 병합) 아무것도 바뀌지 않는다
		const again = js(data);
		const rep2 = core.importIntoData(data, { files: clone(files).map((f) => Object.assign(f, { action: "merge" })) }, { now: 2, presets });
		assert.ok(rep2.legacy === null && rep2.files.every((f) => f.action === "merge"), where + ": 다시 가져오기는 병합");
		assert.ok(js(data) === again, where + ": 같은 파일 다시 가져오기는 변화 없음");
		sessions++;
		rows += sess.subtitles.length;
	}
	t.diagnostic("나눈 세션 " + sessions + "개, 줄 " + rows + "개 (시작·문장 중복 " + dups + "개, 확인 필요 " + ambiguous + "개, 휴지통 항목 배정 " + trashAssigned + "개)");
});

test("운영 캐시 (S3-4 (8), 하드 s3_4_real 준비): 같은 규칙으로 고른 세션을 작업 파일로 불러오고(다른 시퀀스 → id 새로) 번갈아 C1·C2 합성 SRT를 가져오면 분배 창이 뜨고 짝 없는 줄 없이 줄마다 제 화자, 프리셋·후반 작업 그대로", { skip }, async (t) => {
	// 하드 케이스는 DEV 캐시(--seed-cache로 복사한 운영 캐시)에서 같은 함수로 세션을 고르고, 같은 작업 파일·같은 SRT를 CDP로 넣은 뒤
	// ▶로 T_ 스크래치 시퀀스에 놓는다. 여기서는 Premiere 없이 그 앞까지(패널 전체 + 메모리 cep.fs) — 분배 결과가 하드의 전제다
	const core = loadRegions(["src/mi/core.ts"]);
	const RS = require("../premiere/lib/realSessions");
	const { srtOf } = require("../premiere/lib/hard");
	const FT = 10594584000; // 23.976 (T_23976)
	let sessions = 0;
	let rows = 0;
	let amb = 0;
	let changed = 0;
	let clamped = 0;
	let zero = 0;
	for (const s of RS.seededSessions(ROOT)) {
		const where = s.proj + "/" + s.seq.slice(-8);
		const { work, rows: n, capped } = RS.workOf(s, RS.MAX_ROWS);
		const h = await bootPanel({ seq: FAKE_SEQ, files: { [P.presets(FAKE_PROJ)]: s.presetsText } });
		await h.advance(1000);
		await h.dropWork("s3_4_real.json", work);
		let snap = h.snapshot();
		assert.equal(snap.subtitles.length, n, where + ": 불러온 줄 수");
		assert.equal(snap.mi.remapped, true, where + ": 다른 시퀀스의 작업 (id 새로)");
		const pidOf = (rs) => (rs && rs.presetId && s.presets[rs.presetId] ? rs.presetId : "");
		assert.deepEqual(snap.subtitles.map((x) => pidOf(snap.rowStates[x.id])), work.subtitles.map((x) => pidOf(work.rowStates[x.id])), where + ": 줄마다 프리셋 그대로");
		const before = {};
		const pidBefore = {};
		snap.subtitles.forEach((x) => {
			before[x.id] = JSON.stringify(snap.rowStates[x.id]._allParams || []);
			pidBefore[x.id] = pidOf(snap.rowStates[x.id]);
		});
		const sp = RS.splitByTurn(snap.subtitles, core.normText);
		await h.dropSrts([{ name: "C1.srt", content: srtOf(sp.cues.C1) }, { name: "C2.srt", content: srtOf(sp.cues.C2) }]);
		assert.ok(h.$("importModal").classList.contains("open"), where + ": 가져오기 창");
		assert.equal(h.$("impLegacyMode").value, "split", where + ": 분배 모드");
		const info = h.$("impLegacyInfo").textContent;
		assert.ok(info.indexOf("기존 목록 (화자 없음, " + n + "줄) → ") === 0, where + ": " + info);
		assert.doesNotMatch(info, /짝 없음/, where + ": 짝 없는 줄 없음");
		const a = h.$("impAmbList").querySelectorAll(".imp-amb").length;
		h.$("impOk").click();
		await h.flush();
		snap = h.snapshot();
		assert.equal(snap.subtitles.length, n, where + ": 줄 수 그대로");
		const wrong = snap.subtitles.filter((x) => x.spk !== sp.keyOf[x.id]).length;
		assert.ok(snap.subtitles.every((x) => x.spk === "C1" || x.spk === "C2"), where + ": 줄마다 화자");
		assert.ok(wrong <= a, where + ": 제 화자가 아닌 줄 " + wrong + "개 (확인 필요 " + a + "개까지)");
		snap.subtitles.forEach((x) => {
			const rs = snap.rowStates[x.id];
			assert.ok(rs && pidOf(rs) === pidBefore[x.id], where + " id " + x.id + ": 프리셋");
			// 캡션 필드는 병합이 SRT 문장으로 다시 쓸 수 있다 (태그 지우기 등). 캡션이 아닌 속성은 그대로
			const preset = rs.presetId ? s.presets[rs.presetId] : null;
			const f = preset ? core.resolveFid(JSON.parse(before[x.id]), core.captionFid(preset), preset.params) : null;
			const strip = (l) => l.filter((p) => p && (!f || p.index !== f.index));
			assert.equal(JSON.stringify(strip(rs._allParams || [])), JSON.stringify(strip(JSON.parse(before[x.id]))), where + " id " + x.id + ": 캡션이 아닌 속성");
			if (rs.mm) changed++;
		});
		// ▶가 놓을 프레임 (화자 안 겹침은 앞 줄 끝을 맞추고, 길이가 0이면 건너뛴다)
		const fr = core.speakerFrames(snap.subtitles, FT);
		Object.keys(fr).forEach((id) => { if (fr[id].zero) zero++; else if (fr[id].clamped) clamped++; });
		noErrors(h, where);
		t.diagnostic(where + ": " + n + "줄" + (capped ? " (앞 " + RS.MAX_ROWS + "줄만)" : "") + ", C1 " + sp.cues.C1.length + " · C2 " + sp.cues.C2.length + ", 확인 필요 " + a);
		sessions++;
		rows += n;
		amb += a;
	}
	t.diagnostic("세션 " + sessions + "개, 줄 " + rows + "개 (확인 필요 " + amb + "개, 병합 표시가 붙은 줄 " + changed + "개, 화자 안 겹침으로 끝을 맞출 줄 " + clamped + "개, 길이 0 " + zero + "개)");
});

test("운영 캐시 (S3-4 (8), premiereSim): 하드 s3_4_real과 같은 흐름 — 실제 세션을 불러와 C1·C2로 나누고 ▶ → 줄마다 화자별 프레임 ±1프레임, 화자마다 트랙 하나, 다시 계획 0개 (Premiere 없이)", { skip }, async (t) => {
	// 가짜 Premiere(premiereSim)의 템플릿은 실제 프리셋의 지금 속성 목록(이름·순서·기본값)으로 만든다. 옛 구조 줄은 이름으로 쓴다.
	// 네이티브 프리셋 줄이 있는 세션은 굽기(실제 .mogrt)가 필요해 여기서는 건너뛰고 수만 센다 (하드 케이스는 놓는다)
	const core = loadRegions(["src/mi/core.ts"]);
	const RS = require("../premiere/lib/realSessions");
	const { srtOf } = require("../premiere/lib/hard");
	const { createSim, FT, aeTextValue } = require("../lib/premiereSim");
	const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];
	const F = FT.f23976;
	const tplParams = (preset) => preset.params.slice().sort((a, b) => a.index - b.index).map((p) => {
		const ty = String(p.type || "").toLowerCase();
		if (ty === "text") return { displayName: p.displayName, value: typeof p.rawValue === "string" && p.rawValue.indexOf("\"textEditValue\"") !== -1 ? p.rawValue : aeTextValue(p.value) };
		if (ty === "color") return { displayName: p.displayName, value: Number(p.rawValue) || 4294967295 };
		if (ty === "boolean") return { displayName: p.displayName, value: String(p.value) === "true" };
		const v = Number(p.value);
		return { displayName: p.displayName, value: String(p.value == null ? "" : p.value) !== "" && isFinite(v) ? v : String(p.value == null ? "" : p.value) };
	});
	const settle = async (h) => {
		for (let i = 0; i < 4000; i++) {
			await h.flush();
			if (h.$("preflightModal").classList.contains("open") || !h.win._mogrtDebug.miBusy()) return;
		}
		throw new Error("적용이 끝나지 않았다");
	};
	let sessions = 0;
	let placedAll = 0;
	let nativeSkipped = 0;
	for (const s of RS.seededSessions(ROOT)) {
		const where = s.proj + "/" + s.seq.slice(-8);
		const { work, rows: n } = RS.workOf(s, RS.MAX_ROWS);
		const used = {};
		work.subtitles.forEach((x) => {
			const rs = work.rowStates[x.id];
			if (rs && rs.presetId && s.presets[rs.presetId]) used[rs.presetId] = s.presets[rs.presetId];
		});
		if (Object.keys(used).some((id) => core.isNativeList(used[id].params))) {
			nativeSkipped++;
			t.diagnostic(where + ": 네이티브 프리셋 줄이 있어 건너뜀 (하드 케이스 몫)");
			continue;
		}
		const sim = createSim();
		const seq = sim.addSequence({ name: FAKE_SEQ.seqName, id: FAKE_SEQ.seqId, ft: F, tracks: 7 });
		const tpls = {};
		Object.keys(used).forEach((id) => {
			const m = used[id].mogrtPath;
			if (tpls[m]) return;
			tpls[m] = true;
			sim.addTemplate(m, { kind: "ae", name: used[id].name, params: tplParams(used[id]) });
		});
		const h = await bootPanel({ seq: FAKE_SEQ, files: { [P.presets(FAKE_PROJ)]: s.presetsText } });
		HOST_FNS.forEach((fn) => {
			h.host.handlers["MI_" + fn] = (json) => sim.callRaw("MI_" + fn, json === undefined ? undefined : JSON.stringify(json));
		});
		await h.advance(1000);
		h.$("trackSel").value = "2";
		h.change(h.$("trackSel"));
		await h.dropWork("s3_4_real.json", work);
		let snap = h.snapshot();
		const sp = RS.splitByTurn(snap.subtitles, core.normText);
		await h.dropSrts([{ name: "C1.srt", content: srtOf(sp.cues.C1) }, { name: "C2.srt", content: srtOf(sp.cues.C2) }]);
		h.$("impOk").click();
		await h.flush();
		// 하드 케이스와 같이: 줄 상태의 체크를 풀고 ▶ (점검 창이 뜨면 [적용])
		if (Object.values(h.snapshot().rowStates).some((rs) => rs && rs.checked)) h.$("btnToggleSelect").click();
		h.$("btnApply").click();
		await settle(h);
		let pf = null;
		if (h.$("preflightModal").classList.contains("open")) {
			pf = h.$("pfSummary").querySelectorAll(".pf-line").map((e) => e.textContent);
			h.$("pfOk").click();
			await settle(h);
		}
		const status = h.status().text;
		assert.doesNotMatch(status, /실패|중단|중지/, where + ": " + status);
		const pl = JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd("plan", {})));
		assert.equal(pl.ok, true, where + ": " + JSON.stringify(pl).slice(0, 300));
		assert.deepEqual([Object.keys(pl.data.plan.ops), pl.data.plan.conflicts.length], [[], 0], where + ": 다시 계획하면 0개 " + JSON.stringify(pl.data.plan.ops));
		const skipped = {};
		const why = {};
		pl.data.plan.skipped.forEach((x) => { skipped[x.id] = x.why; why[x.why] = (why[x.why] || 0) + 1; });
		assert.deepEqual(Object.keys(why).filter((w) => ["no-preset", "zero-length", "no-caption-field", "no-params"].indexOf(w) === -1), [], where + ": 건너뛴 까닭 " + JSON.stringify(why));
		snap = h.snapshot();
		const salt = snap.mi.salt;
		const scan = sim.call("MI_getTracks", { seqId: seq.id, build: "@@BUILD@@", tracks: null });
		const idx = core.scanIndex(scan, salt);
		assert.deepEqual([idx.stale.length, Object.keys(idx.dup).length], [0, 0], where + ": 옛 gen·같은 태그 중복 없음");
		const want = core.speakerFrames(snap.subtitles, F);
		const bad = [];
		const tracksOf = {};
		let placed = 0;
		snap.subtitles.forEach((x) => {
			const c = idx.current[salt + "-" + x.id];
			if (skipped[x.id]) {
				if (c) bad.push(x.id + " 건너뛴 줄에 클립");
				return;
			}
			if (!c) { bad.push(x.id + " 클립 없음"); return; }
			const w = want[x.id];
			if (Math.abs(c.sf - w.sf) > 1 || Math.abs(c.ef - w.ef) > 1) bad.push(x.id + " " + c.sf + "~" + c.ef + " / " + w.sf + "~" + w.ef);
			(tracksOf[x.spk] = tracksOf[x.spk] || {})[c.track] = true;
			placed++;
		});
		assert.deepEqual(bad, [], where + ": 줄마다 화자별 프레임 ±1");
		assert.equal(Object.keys(idx.own).length, placed, where + ": 남은 우리 클립 없음");
		assert.deepEqual(Object.keys(tracksOf.C1 || { 2: true }), ["2"], where + ": C1은 기본 트랙 V3");
		assert.ok(!tracksOf.C2 || (Object.keys(tracksOf.C2).length === 1 && !tracksOf.C2[2]), where + ": C2는 자기 트랙 하나");
		seq.tracks.forEach((tr, ti) => {
			const c = tr.clips.slice().sort((a, b) => a.s - b.s);
			for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].e <= c[i].s, where + ": V" + (ti + 1) + " 겹침");
		});
		noErrors(h, where);
		t.diagnostic(where + ": " + n + "줄 → 놓음 " + placed + (pf ? " · 점검 창 " + pf.length + "줄" : "") + " · 건너뜀 " + JSON.stringify(why) + " · " + status);
		sessions++;
		placedAll += placed;
	}
	t.diagnostic("세션 " + sessions + "개 적용 (네이티브라 건너뜀 " + nativeSkipped + "), 놓은 줄 " + placedAll + "개");
});
