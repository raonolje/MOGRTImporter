"use strict";
// S4-2: core 화면 위치 — stackLevels(동시 발화 쌓기), rowMotions, castPosKind·roundPos·lineCount,
// 의도 해시(위치는 따로 얹는다: intentBase·motionHash), planPlacement의 위치(위치만 바뀐 줄 → 위치만 보내는 update, 다시 놓는 클립은 지난 위치,
// 쌓기가 풀리면 쌓기 전 자리), appliedEntryOf(mo·hb·mb, 위치를 쓰지 못하면 h 비움), buildUndoOps(위치 되돌리기).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");

const C = loadRegions(["src/mi/core.ts"]);
const TPS = 254016000000;
const FT = 10594584000; // 23.976
const SALT = "ab12";
const sec = (f) => (f * FT) / TPS;

function textRaw(t) {
	return JSON.stringify({ fontEditValue: ["X"], fontTextRunLength: [String(t).length], textEditValue: String(t) });
}
const T = (index, displayName, value) => ({ index, type: "text", displayName, value, rawValue: textRaw(value) });
const PRESET = { id: "preset_3", name: "p3", mogrtPath: "C:/m/a.mogrt", textParamIndex: 0, params: [T(0, "텍스트", "기본"), T(1, "포인트 텍스트", "")], exposedIndices: [0, 1], exposedFontFields: {} };
const sub = (id, spk, sf, ef, text) => ({ index: id, startTime: "", endTime: "", startSec: sec(sf), endSec: sec(ef), text: text || "자막 " + id, id, spk, srtNo: id });
function row(id, spk, sf, ef, text) {
	const s = sub(id, spk, sf, ef, text);
	const all = JSON.parse(JSON.stringify(PRESET.params));
	all[0].value = s.text;
	all[0].rawValue = textRaw(s.text);
	return { sub: s, rs: { presetId: PRESET.id, params: all, _allParams: all, open: false, checked: false }, preset: PRESET, baked: null, bakeWhy: null, oldBaked: null };
}
const cast3 = (pos) => ({
	C1: { name: "철수", track: null, autoTrack: null, presetId: "preset_3", color: 0, pos: (pos && pos.C1) || null },
	C2: { name: "영희", track: null, autoTrack: null, presetId: "preset_3", color: 1, pos: (pos && pos.C2) || null },
	C3: { name: "민수", track: null, autoTrack: null, presetId: "preset_3", color: 2, pos: (pos && pos.C3) || null }
});

test("stackLevels: 동시에 보이는 2·3화자는 castOrder 순서로 층 0/1/2, 맞닿은 줄·혼자인 줄은 쌓지 않는다", () => {
	const rows = [
		sub(1, "C1", 100, 200), sub(2, "C2", 150, 250), // 2화자 겹침
		sub(3, "C1", 400, 500), sub(4, "C2", 420, 480), sub(5, "C3", 450, 520), // 3화자 겹침
		sub(6, "C1", 700, 800), sub(7, "C2", 800, 900), // 맞닿음 (끝 = 시작)
		sub(8, "C3", 1000, 1100) // 혼자
	];
	const lv = plain(C.stackLevels(rows, cast3(), ["C1", "C2", "C3"], FT));
	assert.deepEqual(Object.keys(lv).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
	assert.deepEqual([lv[1].level, lv[2].level], [0, 1]);
	assert.deepEqual([lv[3].level, lv[4].level, lv[5].level], [0, 1, 2]);
	assert.notEqual(lv[1].group, lv[3].group);
	// castOrder가 층 순서다 (C번호 순이 아니다)
	const lv2 = plain(C.stackLevels(rows, cast3(), ["C3", "C1", "C2"], FT));
	assert.deepEqual([lv2[3].level, lv2[4].level, lv2[5].level], [1, 2, 0]);
	assert.deepEqual([lv2[1].level, lv2[2].level], [0, 1], "묶음에 있는 화자끼리만 층을 매긴다");
	// 같은 화자끼리 겹치면 (앞 줄 끝을 맞춘 뒤) 쌓지 않는다
	assert.deepEqual(plain(C.stackLevels([sub(1, "C1", 100, 200), sub(2, "C1", 150, 250)], cast3(), ["C1", "C2"], FT)), {});
	// 화자 표에 없는 화자·길이 0인 줄은 뺀다
	assert.deepEqual(plain(C.stackLevels([sub(1, "C1", 100, 200), sub(2, "C9", 150, 250)], cast3(), ["C1", "C2"], FT)), {});
	// 이어지는 겹침은 한 묶음 (A-B, B-C가 겹치면 A·B·C 한 묶음). 층은 줄마다 실제로 겹치는 앞 화자 줄 위로:
	// C2는 C1 위(1), C3는 겹치는 C2 위(2) — 동시에 보이는 둘은 늘 castOrder 순서로 아래에서 위로
	const chain = plain(C.stackLevels([sub(1, "C1", 100, 200), sub(2, "C2", 180, 300), sub(3, "C3", 280, 400)], cast3(), ["C1", "C2", "C3"], FT));
	assert.deepEqual([chain[1].level, chain[2].level, chain[3].level, chain[1].group === chain[3].group], [0, 1, 2, true]);
});

test("stackLevels: 사슬 묶음이어도 겹치지 않는 화자 때문에 더 올라가지 않는다 (세 사람 대화, 한 번에 둘까지)", () => {
	const order = ["C1", "C2", "C3"];
	// C3–C1, C1–C3, C3–C2가 2프레임씩 겹친다: 한 번에 보이는 자막은 둘까지 → 층 1까지 (C3만 위, C1·C2는 겹치지 않아 둘 다 0)
	const dlg = plain(C.stackLevels([sub(1, "C3", 0, 100), sub(2, "C1", 98, 200), sub(3, "C3", 198, 300), sub(4, "C2", 298, 400)], cast3(), order, FT));
	assert.deepEqual([1, 2, 3, 4].map((i) => dlg[i].level), [1, 0, 1, 0]);
	assert.equal(new Set([1, 2, 3, 4].map((i) => dlg[i].group)).size, 1, "한 묶음");
	// C1–C3, C3–C2만 겹친다 (C1·C2는 겹치지 않는다) → C3만 층 1
	const skip = plain(C.stackLevels([sub(1, "C1", 100, 200), sub(2, "C3", 180, 300), sub(3, "C2", 280, 400)], cast3(), order, FT));
	assert.deepEqual([skip[1].level, skip[2].level, skip[3].level], [0, 1, 0]);
	// 셋이 한꺼번에 겹치는 곳이 있으면 0/1/2 (그 뒤 C3와만 겹치는 C1도 0)
	const three = plain(C.stackLevels([sub(1, "C1", 100, 200), sub(2, "C2", 120, 220), sub(3, "C3", 150, 320), sub(4, "C1", 300, 400)], cast3(), order, FT));
	assert.deepEqual([1, 2, 3, 4].map((i) => three[i].level), [0, 1, 2, 0]);
	// 겹치는 줄끼리는 늘 층이 다르다 (무작위 대화 200줄)
	let seed = 7;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
	const rows = [];
	let t = 0;
	for (let i = 1; i <= 200; i++) {
		const K = "C" + (1 + Math.floor(rnd() * 3));
		const sf = t + Math.floor(rnd() * 40) - 20;
		rows.push(sub(i, K, Math.max(0, sf), Math.max(0, sf) + 30 + Math.floor(rnd() * 60)));
		t += 25 + Math.floor(rnd() * 30);
	}
	const lv = plain(C.stackLevels(rows, cast3(), order, FT));
	const fr = plain(C.speakerFrames(rows, FT));
	const rk = (K) => order.indexOf(K);
	for (const a of rows) for (const b of rows) {
		if (a.id >= b.id || a.spk === b.spk || fr[a.id].zero || fr[b.id].zero) continue;
		if (!(fr[a.id].sf < fr[b.id].ef && fr[b.id].sf < fr[a.id].ef)) continue;
		const [lo, hi] = rk(a.spk) < rk(b.spk) ? [a, b] : [b, a];
		assert.ok(lv[lo.id].level < lv[hi.id].level, "겹치는 " + lo.spk + "·" + hi.spk + " 줄 " + lo.id + "·" + hi.id + ": " + lv[lo.id].level + " < " + lv[hi.id].level);
	}
});

test("stackLevels·rowMotions: 여러 줄 자막은 묶음의 가장 긴 줄 수만큼 간격을 곱한다 · 위치 없는 화자는 (0.5, 0.5)에서 쌓는다", () => {
	const rows = [sub(1, "C1", 100, 200, "첫 줄\n둘째 줄"), sub(2, "C2", 150, 250, "한 줄"), sub(3, "C1", 400, 500, "a"), sub(4, "C2", 420, 480, "b")];
	const lv = plain(C.stackLevels(rows, cast3(), ["C1", "C2"], FT));
	assert.deepEqual([lv[1].lines, lv[2].lines, lv[3].lines], [2, 2, 1]);
	const mi = { cast: cast3({ C1: { x: 0.35, y: 0.5 } }), castOrder: ["C1", "C2"], stack: true, stackDy: 0.12 };
	const m = plain(C.rowMotions(rows, mi, FT));
	assert.deepEqual(m[1], { mo: { x: 0.35, y: 0.5 }, mb: null, level: 0 }, "층 0은 화자 위치 그대로");
	assert.deepEqual(m[2], { mo: { x: 0.5, y: 0.26 }, mb: { x: 0.5, y: 0.5 }, level: 1 }, "0.5 − 1 × 0.12 × 2줄");
	assert.deepEqual(m[4], { mo: { x: 0.5, y: 0.38 }, mb: { x: 0.5, y: 0.5 }, level: 1 });
	assert.deepEqual(m[3].mo, { x: 0.35, y: 0.5 });
	// 쌓기를 끄면 화자 위치만 (위치 없는 화자는 null = 건드리지 않는다)
	const off = plain(C.rowMotions(rows, Object.assign({}, mi, { stack: false }), FT));
	assert.deepEqual([off[1].mo, off[2].mo, off[2].mb], [{ x: 0.35, y: 0.5 }, null, null]);
	// 간격을 바꾸면 쌓은 줄만 바뀐다
	const wide = plain(C.rowMotions(rows, Object.assign({}, mi, { stackDy: 0.2 }), FT));
	assert.deepEqual([wide[2].mo, wide[4].mo, wide[1].mo], [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.3 }, { x: 0.35, y: 0.5 }]);
});

test("rowMotions: 위치가 '변경 안 함'인 화자의 쌓은 줄은 그 줄 클립의 지난 자리(applied: 쌓았던 줄은 mb, 아니면 mo)에서 쌓는다", () => {
	const rows = [sub(1, "C1", 100, 200), sub(2, "C2", 150, 250), sub(3, "C1", 400, 500), sub(4, "C2", 420, 480), sub(5, "C1", 700, 800), sub(6, "C2", 720, 780)];
	const mi = {
		salt: SALT, cast: cast3(), castOrder: ["C1", "C2"], stack: true, stackDy: 0.12,
		applied: {
			"ab12-2": { mo: { x: 0.65, y: 0.5 } }, // 지난번에 쌓지 않았다 → mo가 쌓기 전 자리
			"ab12-4": { mo: { x: 0.65, y: 0.38 }, mb: { x: 0.65, y: 0.5 } } // 지난번에 쌓았다 → mb
		}
	};
	const m = plain(C.rowMotions(rows, mi, FT));
	assert.deepEqual(m[2], { mo: { x: 0.65, y: 0.38 }, mb: { x: 0.65, y: 0.5 }, level: 1 }, "(0.5, 0.5)로 튀지 않는다");
	assert.deepEqual(m[4], { mo: { x: 0.65, y: 0.38 }, mb: { x: 0.65, y: 0.5 }, level: 1 });
	assert.deepEqual(m[6], { mo: { x: 0.5, y: 0.38 }, mb: { x: 0.5, y: 0.5 }, level: 1 }, "지난 자리가 없으면 (0.5, 0.5)");
	assert.deepEqual([m[1].mo, m[3].mo], [null, null], "층 0은 건드리지 않는다");
	// 화자 위치가 있으면 그것이 먼저
	mi.cast.C2.pos = { x: 0.35, y: 0.5 };
	assert.deepEqual(plain(C.rowMotions(rows, mi, FT))[4], { mo: { x: 0.35, y: 0.38 }, mb: { x: 0.35, y: 0.5 }, level: 1 });
	// salt가 다르면 지난 자리로 보지 않는다
	mi.cast.C2.pos = null;
	mi.salt = "zz99";
	assert.deepEqual(plain(C.rowMotions(rows, mi, FT))[2].mb, { x: 0.5, y: 0.5 });
});

test("castPosKind·roundPos·lineCount·samePos", () => {
	assert.equal(C.castPosKind(null), "");
	assert.equal(C.castPosKind({ x: 0.5, y: 0.5 }), "orig");
	assert.equal(C.castPosKind({ x: 0.35, y: 0.5 }), "left");
	assert.equal(C.castPosKind({ x: 0.65, y: 0.5 }), "right");
	assert.equal(C.castPosKind({ x: 0.5, y: 0.35 }), "top");
	assert.equal(C.castPosKind({ x: 0.2, y: 0.5 }), "custom");
	assert.equal(C.castPosKind({ x: "0.5", y: 0.5 }), "");
	assert.deepEqual(plain(C.roundPos({ x: 0.5 - 0.12 * 1, y: 0.3500000001 })), { x: 0.38, y: 0.35 });
	assert.equal(C.roundPos({ x: NaN, y: 1 }), null);
	assert.deepEqual([C.lineCount("a"), C.lineCount("a\r\nb"), C.lineCount("a\n\nb\n"), C.lineCount("")], [1, 2, 2, 1]);
	assert.equal(C.samePos({ x: 0.35, y: 0.5 }, { x: 0.35000001, y: 0.5 }), true);
	assert.equal(C.samePos(null, null), true);
	assert.equal(C.samePos(null, { x: 0.5, y: 0.5 }), false);
});

test("의도 해시: 위치가 없으면 v1.2(S2-4) 해시와 같고, 위치를 바꾸면 위치 부분만 바뀐다 (기본 해시 그대로)", () => {
	const o = { presetId: "p", sig: "s", fh: { 0: "x" }, track: 2, sf: 1, ef: 2, m: "C:/m/a.mogrt", name: "n" };
	// v1.2의 intentHash: 위치 칸 mo가 null인 stableJson의 fnv1a32
	const v12 = C.fnv1a32(C.stableJson({ p: "p", s: "s", f: { 0: "x" }, t: 2, sf: 1, ef: 2, m: "c:/m/a.mogrt", n: "n", mo: null }));
	assert.equal(C.intentHash(o), v12);
	assert.equal(C.intentBase(o), v12);
	const left = C.intentHash(Object.assign({}, o, { motion: { x: 0.35, y: 0.5 } }));
	const right = C.intentHash(Object.assign({}, o, { motion: { x: 0.65, y: 0.5 } }));
	assert.notEqual(left, v12);
	assert.notEqual(left, right);
	assert.equal(C.intentBase(Object.assign({}, o, { motion: { x: 0.65, y: 0.5 } })), v12, "기본 해시는 위치와 상관없다");
	assert.equal(C.motionHash(v12, { x: 0.35, y: 0.5 }), left);
	assert.equal(C.motionHash(v12, { x: 0.35000000004, y: 0.5 }), left, "부동소수 잡음은 같은 위치");
	assert.equal(C.motionHash(v12, null), v12);
	assert.notEqual(C.intentHash(Object.assign({}, o, { name: "m", motion: { x: 0.35, y: 0.5 } })), left, "위치 밖이 바뀌면 다르다");
});

// ── planPlacement의 위치 ──
// 계획 → 호스트 결과를 흉내 내 스캔·applied에 반영한다 (모든 작업 성공, motion은 applied)
function planOf(rows, mi, scan, details, opts) {
	return plain(C.planPlacement({ rows, allRows: rows.map((r) => r.sub), trash: {}, base: 2, mi, scan, details, durs: { "c:/m/a.mogrt": 5.005 }, opts: opts || {} }));
}
function runPlan(p, mi, scan, details, o) {
	const x = o || {};
	let n = x.n || 100;
	p.ops.forEach((op) => {
		const tr = scan.tracks.find((t) => t.i === op.track) || (scan.tracks.push({ i: op.track, locked: false, clips: [] }), scan.tracks[scan.tracks.length - 1]);
		let nodeId;
		if (C.opCreates(op)) {
			if (op.own) {
				const ot = scan.tracks.find((t) => t.i === op.own.track);
				ot.clips = ot.clips.filter((c) => c.nodeId !== op.own.nodeId);
			}
			nodeId = "n" + n++;
			tr.clips.push({ sf: op.sf, ef: op.ef, nodeId, name: op.name });
		} else {
			nodeId = op.own.nodeId;
			const c = tr.clips.find((cl) => cl.nodeId === nodeId);
			if (op.name) c.name = op.name;
			if (!op.keepTime) c.ef = op.ef;
		}
		const texts = [op.params && op.params.length ? String(op.params[0].value) : details[nodeId] ? details[nodeId].texts[0] : "", ""];
		details[nodeId] = { found: true, kind: "ae", pin: "a", texts, lay: [["텍스트", "t"], ["포인트 텍스트", "t"]], deco: { comps: 3, keyed: [] } };
		const mstat = x.motion && x.motion[op.id] ? x.motion[op.id] : op.motion ? "applied" : "none";
		const r = { status: C.opCreates(op) ? "placed" : "updated", g: op.g, texts, lay: details[nodeId].lay, kind: "ae", ef: op.ef, nodeId, motion: mstat };
		mi.applied[op.uid] = plain(C.appliedEntryOf(op, r, mi.applied[op.uid]));
	});
	return n;
}
const scanEmpty = () => ({ ok: true, frameTicks: String(FT), numVideoTracks: 6, tracks: [{ i: 2, locked: false, clips: [] }, { i: 3, locked: false, clips: [] }, { i: 4, locked: false, clips: [] }] });

test("planPlacement: 위치가 없으면 motion 없음·항목 모양 v1.2 · 화자 위치를 바꾸면 위치만 보내는 update (속성·이름 없음, keepTime, 되읽기 없음) → 다시 계획하면 그대로", () => {
	const rows = [row(1, "C1", 100, 160), row(2, "C2", 130, 190), row(3, "C1", 400, 460)];
	const mi = { salt: SALT, cast: cast3(), castOrder: ["C1", "C2"], applied: {}, legacyTrack: null, stack: false, stackDy: 0.12 };
	const scan = scanEmpty();
	const details = {};
	let p = planOf(rows, mi, scan, details);
	assert.deepEqual(p.ops.map((o) => [o.op, o.id, o.motion]), [["place", 1, null], ["place", 2, null], ["place", 3, null]]);
	assert.deepEqual(plain(C.hostItemOf(p.ops[0], {})).motion, null);
	runPlan(p, mi, scan, details);
	assert.deepEqual(Object.keys(mi.applied["ab12-1"]).sort(), ["cef", "ef", "fh", "g", "h", "k", "ls", "m", "rh", "sf", "t"], "위치가 없던 항목에는 mo·hb·mb가 없다");
	p = planOf(rows, mi, scan, details);
	assert.deepEqual([p.ops.length, p.none.length], [0, 3]);
	// C1 왼쪽, C2 오른쪽
	mi.cast.C1.pos = { x: 0.35, y: 0.5 };
	mi.cast.C2.pos = { x: 0.65, y: 0.5 };
	const reads0 = Object.keys(details).length;
	p = planOf(rows, mi, scan, {});
	assert.deepEqual(p.needReads, [], "위치만 바뀐 줄은 되읽지 않는다");
	assert.deepEqual(plain(p.motionOnly).sort(), [1, 2, 3]);
	assert.deepEqual(p.ops.map((o) => [o.op, o.id, o.keepTime, o.params.length, o.name, plain(o.motion)]), [
		["update", 1, true, 0, null, { x: 0.35, y: 0.5 }], ["update", 2, true, 0, null, { x: 0.65, y: 0.5 }], ["update", 3, true, 0, null, { x: 0.35, y: 0.5 }]
	]);
	assert.deepEqual(plain(C.hostItemOf(p.ops[1], {})).motion, { x: 0.65, y: 0.5 });
	assert.equal(Object.keys(details).length, reads0);
	runPlan(p, mi, scan, details);
	const a1 = mi.applied["ab12-1"];
	assert.deepEqual([plain(a1.mo), typeof a1.hb, a1.mb], [{ x: 0.35, y: 0.5 }, "string", undefined]);
	assert.equal(a1.h, C.motionHash(a1.hb, { x: 0.35, y: 0.5 }));
	p = planOf(rows, mi, scan, details);
	assert.deepEqual([p.ops.length, p.none.length], [0, 3], "다시 계획하면 그대로");
	// '변경 안 함'으로 되돌려도 클립은 그대로 (보내지 않는다)
	mi.cast.C1.pos = null;
	p = planOf(rows, mi, scan, details);
	assert.deepEqual([p.ops.length, p.none.length], [0, 3]);
	// 문장이 바뀐 줄: 속성 update에 위치도 싣는다 (위치가 없으면 보내지 않는다 — 클립에 있는 지난 위치가 해시에 이어진다)
	rows[1].rs._allParams[0].value = "바뀐 영희";
	rows[1].rs.params = rows[1].rs._allParams;
	rows[0].rs._allParams[0].value = "바뀐 철수";
	rows[0].rs.params = rows[0].rs._allParams;
	p = planOf(rows, mi, scan, details);
	const u1 = p.ops.find((o) => o.id === 1);
	const u2 = p.ops.find((o) => o.id === 2);
	assert.deepEqual([u1.op, u1.motion, plain(u1.mo)], ["update", null, { x: 0.35, y: 0.5 }], "C1 위치 없음: 보내지 않고 지난 위치를 이어 받는다");
	assert.deepEqual([u2.op, plain(u2.motion), u2.motionOnly], ["update", { x: 0.65, y: 0.5 }, undefined]);
	assert.equal(u1.params.length, 1);
});

test("planPlacement: 다시 놓는 클립(moveRegen)은 위치가 '변경 안 함'이어도 지난 위치(applied.mo)를 다시 보낸다 · 새로 놓는 줄은 원하는 위치", () => {
	const rows = [row(1, "C1", 100, 160), row(2, "C2", 130, 190)];
	const mi = { salt: SALT, cast: cast3({ C2: { x: 0.65, y: 0.5 } }), castOrder: ["C1", "C2"], applied: {}, legacyTrack: null, stack: false, stackDy: 0.12 };
	const scan = scanEmpty();
	const details = {};
	let p = planOf(rows, mi, scan, details);
	assert.deepEqual(p.ops.map((o) => [o.op, o.id, plain(o.motion)]), [["place", 1, null], ["place", 2, { x: 0.65, y: 0.5 }]]);
	runPlan(p, mi, scan, details);
	// C2를 V5에 고정하고 위치는 '변경 안 함' → 다른 트랙 moveRegen, 새 클립에 지난 위치
	mi.cast.C2.pos = null;
	mi.cast.C2.track = 4;
	p = planOf(rows, mi, scan, details);
	const op = p.ops.find((o) => o.id === 2);
	assert.deepEqual([op.op, op.track, plain(op.motion)], ["moveRegen", 4, { x: 0.65, y: 0.5 }]);
});

test("planPlacement: 쌓기 — 켜면 층 1 이상인 줄만 위치를 보내고(mb 기억), 끄면 그 줄만 쌓기 전 자리로 되돌린다", () => {
	const rows = [row(1, "C1", 100, 200), row(2, "C2", 150, 250), row(3, "C1", 400, 460)];
	const mi = { salt: SALT, cast: cast3(), castOrder: ["C1", "C2"], applied: {}, legacyTrack: null, stack: false, stackDy: 0.12 };
	const scan = scanEmpty();
	const details = {};
	runPlan(planOf(rows, mi, scan, details), mi, scan, details);
	mi.stack = true;
	let p = planOf(rows, mi, scan, details);
	assert.deepEqual(p.ops.map((o) => [o.op, o.id, plain(o.motion), plain(o.mb)]), [["update", 2, { x: 0.5, y: 0.38 }, { x: 0.5, y: 0.5 }]]);
	assert.deepEqual(plain(p.motionOnly), [2]);
	runPlan(p, mi, scan, details);
	assert.deepEqual(plain(mi.applied["ab12-2"].mb), { x: 0.5, y: 0.5 });
	assert.equal(planOf(rows, mi, scan, details).ops.length, 0);
	mi.stack = false;
	p = planOf(rows, mi, scan, details);
	assert.deepEqual(p.ops.map((o) => [o.op, o.id, plain(o.motion), o.mb]), [["update", 2, { x: 0.5, y: 0.5 }, null]], "쌓기 전 자리로");
	runPlan(p, mi, scan, details);
	assert.deepEqual([plain(mi.applied["ab12-2"].mo), mi.applied["ab12-2"].mb], [{ x: 0.5, y: 0.5 }, undefined]);
	assert.equal(planOf(rows, mi, scan, details).ops.length, 0);
});

test("planPlacement: 쌓은 화자를 '변경 안 함'으로 되돌려도 쌓은 줄은 그대로, 쌓기를 끄면 그 화자의 지난 자리로 (원래 자리로 튀지 않는다)", () => {
	const rows = [row(1, "C1", 100, 200), row(2, "C2", 150, 250), row(3, "C2", 400, 460)];
	const mi = { salt: SALT, cast: cast3({ C2: { x: 0.65, y: 0.5 } }), castOrder: ["C1", "C2"], applied: {}, legacyTrack: null, stack: true, stackDy: 0.12 };
	const scan = scanEmpty();
	const details = {};
	const byId = (p) => p.ops.slice().sort((a, b) => a.id - b.id).map((o) => [o.op, o.id, plain(o.motion)]);
	let p = planOf(rows, mi, scan, details);
	assert.deepEqual(byId(p), [["place", 1, null], ["place", 2, { x: 0.65, y: 0.38 }], ["place", 3, { x: 0.65, y: 0.5 }]]);
	runPlan(p, mi, scan, details);
	mi.cast.C2.pos = null;
	p = planOf(rows, mi, scan, details);
	assert.deepEqual(byId(p), [], "'변경 안 함': 쌓은 줄도 그대로 (x 0.5로 옮기지 않는다)");
	mi.stack = false;
	p = planOf(rows, mi, scan, details);
	assert.deepEqual(byId(p), [["update", 2, { x: 0.65, y: 0.5 }]], "쌓기 전 자리 = 오른쪽 (한 화자의 줄이 두 x로 갈리지 않는다)");
	runPlan(p, mi, scan, details);
	assert.equal(planOf(rows, mi, scan, details).ops.length, 0);
	// 다시 쌓으면 (위치 '변경 안 함') 지난 자리 오른쪽에서 쌓는다
	mi.stack = true;
	p = planOf(rows, mi, scan, details);
	assert.deepEqual(byId(p), [["update", 2, { x: 0.65, y: 0.38 }]]);
	assert.deepEqual(plain(p.ops[0].mb), { x: 0.65, y: 0.5 });
});

test("appliedEntryOf·planPlacement: 위치를 쓰지 못하면(키프레임) h를 비우고 지난 위치 → 다음 계획이 위치만 다시 보낸다", () => {
	const rows = [row(1, "C1", 100, 160)];
	const mi = { salt: SALT, cast: cast3(), castOrder: ["C1"], applied: {}, legacyTrack: null, stack: false, stackDy: 0.12 };
	const scan = scanEmpty();
	const details = {};
	runPlan(planOf(rows, mi, scan, details), mi, scan, details);
	const h0 = mi.applied["ab12-1"].h;
	mi.cast.C1.pos = { x: 0.35, y: 0.5 };
	let p = planOf(rows, mi, scan, details);
	runPlan(p, mi, scan, details, { motion: { 1: "keyframed" } });
	const a = mi.applied["ab12-1"];
	assert.deepEqual([a.h, a.hb, a.mo], ["", h0, undefined], "h 비움, 기본 해시는 그대로, 위치는 지난 값(없음)");
	p = planOf(rows, mi, scan, details);
	assert.deepEqual(p.ops.map((o) => [o.op, o.motionOnly, plain(o.motion)]), [["update", true, { x: 0.35, y: 0.5 }]], "위치만 다시");
	// partial(속성을 못 썼다)이면 기본 해시도 두지 않는다
	const e = C.appliedEntryOf(Object.assign({}, p.ops[0]), { status: "partial", skipped: ["텍스트"], texts: ["x"], motion: "applied" }, a);
	assert.deepEqual([e.h, e.hb, plain(e.mo)], ["", undefined, { x: 0.35, y: 0.5 }]);
});

test("buildUndoOps: 같은 클립의 위치를 바꾼 기록(pos0)은 update에 그 위치, 다시 놓는 옛 클립은 스냅숏 위치(원래 자리가 아닐 때만)", () => {
	const scan = { ok: true, frameTicks: String(FT), numVideoTracks: 5, tracks: [{ i: 2, locked: false, clips: [{ sf: 100, ef: 160, nodeId: "n1", name: "철수 [MI:ab12-1.1]" }, { sf: 300, ef: 360, nodeId: "n9", name: "철수 [MI:ab12-2.2]" }] }] };
	const details = { n1: { found: true, kind: "ae", texts: ["a"] }, n9: { found: true, kind: "ae", texts: ["b"] } };
	const la = {
		seqId: "s", salt: SALT, prev: {},
		updated: [{ key: "ab12-1", g: 1, track: 2, sf: 100, ef: 160, nodeId: "n1", rh: C.textsHash(["a"]), n: 0, id: 1, op: "motion", k: "ae", m: "C:/m/a.mogrt", before: [], from: { track: 2, sf: 100, ef: 160, name: "철수 [MI:ab12-1.1]" }, pos0: [0.35, 0.5] }],
		moved: [{ key: "ab12-2", g: 2, track: 2, sf: 300, ef: 360, nodeId: "n9", rh: C.textsHash(["b"]), n: 1, id: 2, op: "moveRegen", k: "ae", m: "C:/m/a.mogrt",
			from: { nodeId: "n8", track: 2, sf: 200, ef: 260, g: 1, name: "철수 [MI:ab12-2.1]", kind: "ae", m: "C:/m/a.mogrt", pi: null, params: [], pos: [0.65, 0.5], posKeyed: false } }],
		created: [], adopted: [], replaced: [], removed: []
	};
	const u = C.buildUndoOps({ la, scan, details, durs: { "c:/m/a.mogrt": 5.005 } });
	const byKey = {};
	u.ops.forEach((o) => { byKey[o.key] = o; });
	assert.deepEqual([byKey["ab12-1"].op, byKey["ab12-1"].keepTime, byKey["ab12-1"].params, byKey["ab12-1"].name, plain(byKey["ab12-1"].motion)], ["update", true, [], null, { x: 0.35, y: 0.5 }]);
	assert.deepEqual([byKey["ab12-2"].op, plain(byKey["ab12-2"].motion)], ["replace", { x: 0.65, y: 0.5 }]);
	// 원래 자리였거나 키가 있던 옛 클립은 위치를 보내지 않는다 (템플릿 기본 = 원래 자리)
	la.moved[0].from.pos = [0.5, 0.5];
	assert.equal(C.buildUndoOps({ la, scan, details, durs: {} }).ops.find((o) => o.key === "ab12-2").motion, null);
	la.moved[0].from.pos = [0.2, 0.5];
	la.moved[0].from.posKeyed = true;
	assert.equal(C.buildUndoOps({ la, scan, details, durs: {} }).ops.find((o) => o.key === "ab12-2").motion, null);
	// pos0가 없는 기록(위치를 바꾸지 않았다)은 위치를 보내지 않는다
	delete la.updated[0].pos0;
	assert.equal(C.buildUndoOps({ la, scan, details, durs: {} }).ops.find((o) => o.key === "ab12-1").motion, null);
});

test("importIntoData: 새 화자는 프로젝트 cast_defaults의 위치를 기본값으로 받는다 (없으면 null = 건드리지 않음)", () => {
	const data = { subtitles: [], rowStates: {}, trashBin: [], nextId: 1, mi: C.miDefault() };
	const cues = [{ index: 1, srtNo: 1, startTime: "00:00:01.000", endTime: "00:00:02.000", startSec: 1, endSec: 2, text: "하나" }];
	const job = { files: [{ idx: 0, key: "C1", cues, name: "", file: { name: "C1.srt" } }, { idx: 1, key: "C2", cues, name: "", file: { name: "C2.srt" } }] };
	C.importIntoData(data, job, { now: 1, salt: "ab12", presets: {}, castDefaults: C.castDefaultsOf({ C2: { name: "영희", presetId: "", color: 3, pos: { x: 0.65, y: 0.5 } } }) });
	const mi = plain(data.mi);
	assert.deepEqual([mi.cast.C1.pos, mi.cast.C2.pos, mi.cast.C2.name], [null, { x: 0.65, y: 0.5 }, "영희"]);
});

test("rowMotions: 쌓은 y는 -1에서 멈춘다 (호스트는 ±10 밖을 받지 않는다)", () => {
	const rows = [sub(1, "C1", 100, 200, "1\n2\n3\n4"), sub(2, "C2", 110, 200, "a"), sub(3, "C3", 120, 200, "b")];
	const m = plain(C.rowMotions(rows, { cast: cast3(), castOrder: ["C1", "C2", "C3"], stack: true, stackDy: 0.5 }, FT));
	assert.deepEqual([m[1].mo, m[2].mo, m[3].mo], [null, { x: 0.5, y: -1 }, { x: 0.5, y: -1 }]);
});
