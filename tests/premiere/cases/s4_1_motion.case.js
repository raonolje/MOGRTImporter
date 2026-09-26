"use strict";
/**
 * S4-1 하드: 화면 위치 호스트 MID_setMotion · MID_placeChunk의 motion (DEV 호스트, MI_test.prproj의 T_ 시퀀스).
 * JSX를 바꿨으므로 Premiere를 다시 시작한 뒤 돌린다. 스크래치 사본(T_scratch_s4_1)에서만 쓴다 (V3~V5를 비운다).
 * 프리셋: 캡션이 있는 AE 프리셋(없으면 모달로 만든다)과 네이티브 'Lower Thirds/Classic Lower Third Two Lines.mogrt'를 패널 bakeNative로 구운 사본.
 *   (1) 되읽기: AE 클립 4개를 원래 자리·왼쪽(0.35, 0.5)·오른쪽(0.65, 0.5)·위(0.5, 0.35)로 place+motion → motion applied,
 *       JSX로 읽은 Motion Position(matchName 'AE.ADBE Motion'의 첫 속성)이 ±0.001. 네이티브 구운 사본도 같다
 *       (템플릿에 Opacity 키가 있어도 Position에 키가 없으면 쓴다 — 로그에 deco.keyed).
 *       각 클립 가운데 프레임을 %TEMP%\mi_s4_1_*.png로 내보내 경로를 찍는다 → 메인 세션이 눈으로 확인한다
 *       (왼쪽·오른쪽·위로 옮겨 보여야 한다. 값은 화면 좌표가 아니라 MOGRT 자체 레이아웃 기준이다)
 *   (2) 키가 있는 Position (키 2개 [0.3, 0.5]·[0.7, 0.5]) → setMotion과 placeChunk update 모두 keyframed, 키 수·키 값·isTimeVarying 그대로
 *   (3) 40개: V5에 AE 클립 40개(위치 없음)를 놓고 → setMotion 한 번(40개) < 10초, 모두 applied, 텍스트 되읽기 그대로, 이름·시작·끝 그대로
 *   (4) moveRegen: (1)의 왼쪽 클립을 V4 다른 시간으로 moveRegen + motion → 새 클립 Position (0.35, 0.5), 옛 클립은 지워짐.
 *       motion 없이 moveRegen하면 새 클립은 템플릿 기본 (0.5, 0.5) — 그래서 다시 놓는 작업은 늘 위치를 다시 보낸다 (로그)
 * 실행: npm run hard -- s4_1     (PNG 경로는 로그의 'PNG' 줄)
 * 단계 함수 steps(env)는 따로 내보낸다 (env.png가 거짓이면 PNG를 내보내지 않는다).
 */
const fs = require("node:fs");
const H = require("../lib/hard");

const SCR = H.SCRATCH_PREFIX;
const TPS = 254016000000;
const SALT = "hd41";
const NATIVE_REL = "Lower Thirds/Classic Lower Third Two Lines.mogrt";
const V3 = 2;
const V4 = 3;
const V5 = 4;
const EPS = 0.001;
const norm = (p) => String(p || "").replace(/\\/g, "/");
const tag = (n, g) => "위치 [MI:" + SALT + "-" + n + "." + g + "]";
const POS = { orig: { x: 0.5, y: 0.5 }, left: { x: 0.35, y: 0.5 }, right: { x: 0.65, y: 0.5 }, top: { x: 0.5, y: 0.35 } };

// ── 호스트 JSX (ES3, 스크래치 사본만) ──

/** nodeId 클립의 Motion Position → MID__json {pos, keyed, keys: 키 수 | null, kv: [키 값…], name, s, e} | {error} */
function jsxMotion(ti, nodeId) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return MID__json({error:'not-scratch'});" +
		"var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return MID__json({error:'no-clip'});" +
		"var pr=MID__motionProp(c);if(!pr)return MID__json({error:'no-motion'});var o={pos:null,keyed:false,keys:null,kv:[],name:String(c.name),s:String(c.start.ticks),e:String(c.end.ticks)};" +
		"try{o.pos=MID__vec2(pr.getValue());}catch(e1){}try{o.keyed=pr.isTimeVarying()===true;}catch(e2){}" +
		"if(o.keyed){var ks=null;try{ks=pr.getKeys();}catch(e3){ks=null;}if(ks){o.keys=ks.length;for(var i=0;i<ks.length;i++){var v=null;try{v=MID__vec2(pr.getValueAtKey(ks[i]));}catch(e4){}o.kv.push(v);}}}" +
		"return MID__json(o);})()";
}
/** nodeId 클립의 Motion Position에 키 두 개 (inPoint + 12f = [0.3, 0.5], + 72f = [0.7, 0.5], S0-3 r과 같은 방법) → "true" | 까닭 */
function jsxKeyPosition(ti, nodeId) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"var ft=Number(seq.getSettings().videoFrameRate.ticks);var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return 'no-clip';" +
		"var pos=MID__motionProp(c);if(!pos)return 'no-motion';var inT=Number(c.inPoint.ticks);pos.setTimeVarying(true);var k1=MID__T(inT+12*ft);var k2=MID__T(inT+72*ft);" +
		"pos.addKey(k1);pos.setValueAtKey(k1,[0.3,0.5],true);pos.addKey(k2);pos.setValueAtKey(k2,[0.7,0.5],true);return String(pos.isTimeVarying());})()";
}
/** 스크래치 사본의 sec초 프레임을 %TEMP%\<name>.png로 내보낸다 (역슬래시, 확장자 없이: S0-3 §3 10) → 경로 | 'ERR …' */
function jsxExportFrame(sec, name) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"app.enableQE();var t=new Time();t.seconds=" + Number(sec) + ";seq.setPlayerPosition(String(t.ticks));var qs=qe.project.getActiveSequence();" +
		"var f=Folder.temp.fsName+'\\\\" + String(name).replace(/[^A-Za-z0-9_]/g, "_") + "';try{qs.exportFramePNG(qs.CTI.timecode,f);}catch(e){return 'ERR '+e.message;}return f+'.png';})()";
}
async function waitFile(p, ms) {
	const t0 = Date.now();
	while (Date.now() - t0 < (ms || 30000)) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).size > 0) return true;
		} catch (_) {}
		await H.sleep(300);
	}
	return false;
}
async function hostJson(host, jsx, what) {
	const raw = await host(jsx);
	try {
		return JSON.parse(raw);
	} catch (_) {
		throw new Error("호스트 결과를 읽지 못함 (" + what + "): " + String(raw).slice(0, 300));
	}
}
const close = (v, want) => Array.isArray(v) && Math.abs(v[0] - want.x) <= EPS && Math.abs(v[1] - want.y) <= EPS;

/**
 * 테스트 단계 (스크래치 시퀀스가 활성인 상태에서).
 * env = {host, mi, assert, log, P: {mogrtPath, params, textParamIndex}, nat: {path, durSec} | null, png: bool}
 */
async function steps(env) {
	const { host, mi, assert, log, P, nat } = env;
	const ping = await mi("ping");
	assert.equal(ping.ok, true, JSON.stringify(ping));
	assert.equal(ping.seqName.indexOf(SCR), 0, "스크래치 사본에서만");
	const base = { seqId: ping.seqId, build: ping.build };
	const FT = Number(ping.frameTicks);
	const fOf = (sec) => Math.round((sec * TPS) / FT);
	const secOf = (f) => (f * FT) / TPS;
	const DUR = 5.005;
	const chunk = async (items) => {
		const r = await mi("placeChunk", Object.assign({ frameTicks: FT, budgetMs: 7000, items }, base));
		assert.equal(r.ok, true, "placeChunk: " + JSON.stringify(r).slice(0, 400));
		return r;
	};
	const setMotion = async (items) => {
		const r = await mi("setMotion", Object.assign({ items }, base));
		assert.equal(r.ok, true, "setMotion: " + JSON.stringify(r).slice(0, 400));
		return r;
	};
	const motionOf = async (ti, nodeId) => {
		const m = await hostJson(host, jsxMotion(ti, nodeId), "Motion " + nodeId);
		assert.ok(!m.error, "Motion 읽기: " + JSON.stringify(m));
		return m;
	};
	const capIdx = P.textParamIndex;
	const withCap = (text) => P.params.map((p) => (p.index === capIdx ? Object.assign({}, p, { value: text }) : Object.assign({}, p)));
	const item = (n, op, track, sf, ef, extra) => Object.assign({ key: SALT + "-" + n, op, g: 1, track, sf, ef, mogrtPath: P.mogrtPath, durSec: DUR, params: [], name: tag(n, 1), guard: [], motion: null, removeAfter: null, own: null }, extra || {});
	for (const ti of [V3, V4, V5]) assert.equal(await host(H.jsxClearVideoTrack(ti)), "0", "V" + (ti + 1) + " 비우기");
	// 예열: 다시 시작한 뒤 첫 AE importMGT는 약 9초 (S0-3 결정 5)
	let r = await chunk([item(99, "place", V5, fOf(900), fOf(901))]);
	assert.equal(r.results[0].status, "placed", JSON.stringify(r.results[0]));
	assert.equal(await host(H.jsxClearVideoTrack(V5)), "0", "예열 클립 지우기");

	// ── (1) 되읽기: AE 원래 자리·왼쪽·오른쪽·위 + 네이티브 ──
	const kinds = ["orig", "left", "right", "top"];
	const at = { orig: 10, left: 20, right: 30, top: 40 };
	r = await chunk(kinds.map((k, i) => item(i + 1, "place", V3, fOf(at[k]), fOf(at[k] + 3), { params: withCap("하드 S4-1 위치 " + k), motion: POS[k] })));
	const one = {};
	for (let i = 0; i < kinds.length; i++) {
		const x = r.results[i];
		const k = kinds[i];
		assert.deepEqual([x.status, x.motion], ["placed", "applied"], k + ": " + JSON.stringify([x.status, x.reason, x.detail, x.motion, x.motionDetail]));
		assert.ok(close(x.pos, POS[k]), k + " 결과 pos " + JSON.stringify(x.pos));
		const m = await motionOf(V3, x.nodeId);
		assert.ok(close(m.pos, POS[k]), k + " JSX 되읽기 " + JSON.stringify(m.pos));
		assert.equal(m.keyed, false);
		one[k] = x;
	}
	log("(1) AE 되읽기: " + kinds.map((k) => k + " " + JSON.stringify(one[k].pos)).join(" · "));
	if (nat) {
		r = await chunk([item(5, "place", V4, fOf(50), fOf(53), { mogrtPath: nat.path, durSec: nat.durSec, motion: POS.right })]);
		const x = r.results[0];
		assert.deepEqual([x.status, x.kind, x.motion], ["placed", "native", "applied"], JSON.stringify([x.status, x.reason, x.detail, x.motion, x.motionDetail]));
		const m = await motionOf(V4, x.nodeId);
		assert.ok(close(m.pos, POS.right), "네이티브 JSX 되읽기 " + JSON.stringify(m.pos));
		log("(1) 네이티브 되읽기 " + JSON.stringify(m.pos) + " (템플릿 키: " + JSON.stringify(x.deco && x.deco.keyed) + ")");
		one.native = x;
	}
	if (env.png) {
		const shots = kinds.map((k) => [k, V3, at[k] + 1.5]).concat(nat ? [["native_right", V4, 51.5]] : []);
		for (const [k, , sec] of shots) {
			const p = await host(jsxExportFrame(sec, "mi_s4_1_" + k));
			assert.ok(!/^(ERR|not-scratch)/.test(p), "exportFramePNG: " + p);
			const ok = await waitFile(p, 30000);
			log("PNG " + k + " (" + sec + "s, 기대: " + (POS[k] ? "Position " + POS[k].x + ", " + POS[k].y : "네이티브 오른쪽 0.65, 0.5") + "): " + p + (ok ? "" : "  ← 파일이 아직 없다"));
			assert.ok(ok, "PNG 파일 " + p);
		}
	}

	// ── (2) 키가 있는 Position ──
	r = await chunk([item(6, "place", V3, fOf(60), fOf(63), { params: withCap("하드 S4-1 키") })]);
	const k6 = r.results[0];
	assert.equal(k6.status, "placed", JSON.stringify(k6));
	assert.equal(await host(jsxKeyPosition(V3, k6.nodeId)), "true", "Position 키 2개");
	const m0 = await motionOf(V3, k6.nodeId);
	assert.equal(m0.keyed, true);
	let s = await setMotion([{ key: SALT + "-6", g: 1, track: V3, nodeId: k6.nodeId, x: 0.65, y: 0.5 }]);
	assert.equal(s.results[0].status, "keyframed", JSON.stringify(s.results[0]));
	r = await chunk([{ key: SALT + "-6", op: "update", g: 1, track: V3, keepTime: true, own: { track: V3, sf: k6.sf, nodeId: k6.nodeId }, params: [], name: null, guard: [], motion: { x: 0.65, y: 0.5 }, removeAfter: null }]);
	assert.deepEqual([r.results[0].status, r.results[0].motion], ["updated", "keyframed"], JSON.stringify(r.results[0]));
	const m1 = await motionOf(V3, k6.nodeId);
	assert.deepEqual([m1.keyed, m1.keys, m1.kv], [m0.keyed, m0.keys, m0.kv], "키 수·키 값 그대로");
	assert.deepEqual(m1.pos, m0.pos, "값 그대로");
	log("(2) 키 있는 Position: keyframed, 키 " + m1.keys + "개 " + JSON.stringify(m1.kv) + " 그대로");

	// ── (3) 40개 < 10초, 텍스트 그대로 ──
	const N = 40;
	const forty = [];
	for (let i = 0; i < N; i++) forty.push(item(100 + i, "place", V5, fOf(100 + i * 6), fOf(100 + i * 6 + 3), { params: withCap("하드 S4-1 사십 " + (i + 1)) }));
	const placed = [];
	for (let i = 0; i < N; i += 8) {
		let part = forty.slice(i, i + 8);
		while (part.length) {
			const rr = await chunk(part);
			placed.push(...rr.results);
			part = part.slice(rr.done);
		}
	}
	assert.equal(placed.filter((x) => x.status === "placed").length, N, JSON.stringify(placed.filter((x) => x.status !== "placed").map((x) => [x.key, x.status, x.reason])));
	const readAll = async () => {
		const rd = await mi("readClipTexts", Object.assign({ items: placed.map((x) => ({ track: V5, nodeId: x.nodeId })), want: { texts: true, lay: false, deco: false, params: false, pos: true } }, base));
		assert.equal(rd.ok, true, JSON.stringify(rd).slice(0, 300));
		return rd.results;
	};
	const before = await readAll();
	const t0 = Date.now();
	s = await setMotion(placed.map((x) => ({ key: x.key, g: 1, track: V5, nodeId: x.nodeId, x: POS.left.x, y: POS.left.y })));
	const ms = Date.now() - t0;
	assert.equal(s.done, N, "한 번에 40개");
	assert.deepEqual(s.results.filter((x) => x.status !== "applied").map((x) => [x.key, x.status, x.detail]), []);
	assert.ok(ms < 10000, "40개 " + ms + "ms (10초 안)");
	const after = await readAll();
	after.forEach((x, i) => {
		assert.deepEqual([x.found, x.texts, x.name, x.sf, x.ef], [true, before[i].texts, before[i].name, before[i].sf, before[i].ef], "텍스트·이름·자리 그대로 " + x.nodeId);
		assert.ok(close(x.pos, POS.left), "위치 " + JSON.stringify(x.pos));
	});
	log("(3) setMotion 40개 " + ms + "ms (호스트 " + s.ms + "ms), 텍스트·이름·자리 그대로");

	// ── (4) moveRegen이 위치를 다시 쓴다 ──
	const L = one.left;
	r = await chunk([item(2, "moveRegen", V4, fOf(70), fOf(73), { g: 2, own: { track: V3, sf: L.sf, nodeId: L.nodeId }, params: withCap("하드 S4-1 위치 left"), name: tag(2, 2), motion: POS.left })]);
	const g2 = r.results[0];
	assert.deepEqual([g2.status, g2.motion, g2.track, g2.name], ["moved", "applied", V4, tag(2, 2)], JSON.stringify([g2.status, g2.reason, g2.detail, g2.motion]));
	assert.ok(close((await motionOf(V4, g2.nodeId)).pos, POS.left), "새 클립 위치 = 왼쪽");
	assert.ok(g2.before && close(g2.before.pos, POS.left) && g2.before.posKeyed === false, "before 스냅숏에 옛 클립 위치: " + JSON.stringify(g2.before && g2.before.pos));
	const gone = await hostJson(host, jsxMotion(V3, L.nodeId), "옛 클립");
	assert.equal(gone.error, "no-clip", "옛 클립은 지워졌다");
	// motion 없이 다시 놓으면 템플릿 기본으로 돌아간다 (다시 놓는 작업이 늘 위치를 보내야 하는 까닭)
	const R = one.right;
	r = await chunk([item(3, "moveRegen", V4, fOf(80), fOf(83), { g: 2, own: { track: V3, sf: R.sf, nodeId: R.nodeId }, params: withCap("하드 S4-1 위치 right"), name: tag(3, 2) })]);
	assert.deepEqual([r.results[0].status, r.results[0].motion], ["moved", "none"]);
	const plain = await motionOf(V4, r.results[0].nodeId);
	log("(4) moveRegen + motion → " + JSON.stringify((await motionOf(V4, g2.nodeId)).pos) + " · motion 없이 → " + JSON.stringify(plain.pos) + " (템플릿 기본)");
}

module.exports = {
	name: "S4-1 화면 위치 호스트 (되읽기·키 보존·40개·다시 놓은 클립)",
	steps,
	run: async (api) => {
		const { panel, host, mi, assert, log } = api;
		await H.waitKeys(panel);
		const pick = (list) => list.filter((p) => !p.native && p.captionFid).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let PC = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!PC) {
			await H.ensurePreset(api);
			PC = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(PC, "캡션 필드가 있는 AE 프리셋이 필요하다");
		const P = (await panel("window._mogrtDebug.snapshot()")).presets[PC.id];
		assert.ok(P && typeof P.textParamIndex === "number" && P.textParamIndex >= 0, "캡션 필드가 있는 AE 프리셋");
		log("프리셋 " + PC.id + " " + P.name + " — 캡션 idx " + P.textParamIndex);
		let nat = null;
		const mogrts = await H.waitMogrts(panel, 1);
		const hit = mogrts.find((m) => norm(m[0]).slice(-NATIVE_REL.length) === NATIVE_REL);
		if (hit) {
			const b = await panel("await window._mogrtDebug.bakeNative(" + JSON.stringify(hit[0]) + ", " + JSON.stringify(["하드 S4-1 네이티브", "오른쪽"]) + ")");
			assert.equal(b && b.ok, true, "굽기: " + JSON.stringify(b));
			nat = { path: b.path, durSec: b.durSec || 5.005 };
			log("구운 네이티브: " + nat.path);
		} else log("네이티브 템플릿 없음 — 네이티브 되읽기는 건너뛴다: " + NATIVE_REL);
		await H.withScratchSequence(api, "s4_1", async () => {
			await steps({ host, mi, assert, log, P, nat, png: true });
		});
	}
};
