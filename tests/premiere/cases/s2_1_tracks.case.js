"use strict";
/**
 * S2-1 하드: 읽기 전용 v28 호스트(MID_ping, MID_getTracks, MID_readClipTexts)와 가드, 패널 어댑터.
 * DEV(MID_) 호스트를 case의 mi()로 직접 부른다. JSX를 바꿨으므로 Premiere를 다시 시작한 뒤 돌린다.
 * 스크래치 사본(T_scratch_s2_1)에서:
 *   준비: V2(트랙 1)에 v27 모양 클립 2개(태그 없음, 48~120f · 144~216f), V3(트랙 2)에 '철수 [MI:ab12-1.1]'(240~336f,
 *         캡션 'S21 하드 캡션'), V4(트랙 3) 잠금
 *   (1) MID_ping: v 28, prefix MID_, 설치된 DEV 빌드 = 패널 status.panel.build = _miHostOk().ok
 *   (2) getTracks(null): V1 빼고 전부, numVideoTracks·frameTicks = 시퀀스 직접 읽기 (T_23976이면 10594584000), V4 잠김,
 *       V2 태그 없는 클립 2개, V3 클립의 태그 읽기(salt ab12, id 1, g 1). 범위 130~250f는 V2 144f·V3 240f만
 *   (4) readClipTexts 두 번 → texts 같음(캡션 포함), lay 이름 = 프리셋 속성 이름(index 순), params에 type·colorHex 없음
 *   (3) V3 태그 클립을 288f에서 자름(QE razor) → getTracks + core scanIndex → dup["ab12-1"] 2개, current 없음
 *   (5) 프리뷰 시퀀스를 활성으로 → preview-active (같은 JSX 안에서 스크래치로 되돌린다)
 *   (6) 틀린 seqId → seq-mismatch, (7) 틀린 build → build-mismatch
 *   (+) 패널 어댑터(window._mogrtDebug.callMi)로 U+2028이 든 payload → ok (이스케이프 없이는 호스트 eval 파싱이 깨진다)
 *   (8) 운영 호스트(MI_ping)가 로드돼 있으면 운영 빌드(prod-…)를, DEV는 DEV 빌드를 돌려준다 (없으면 건너뛴다고 적는다)
 * 실행: npm run hard -- s2_1
 */
const H = require("../lib/hard");
const { hostCallSource, expectedBuild } = require("../run");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const V2 = 1;
const V3 = 2;
const V4 = 3;
const CAP = "S21 하드 캡션";
const TAG_NAME = "철수 [MI:ab12-1.1]";

/** 활성 스크래치 사본의 트랙 ti에 MOGRT를 sf 프레임에 importMGT, 끝 ef 프레임, 이름·캡션(선택) → JSON {nodeId, name} */
function jsxPlaceNamed(mogrtPath, ti, sf, ef, name, capIdx, capText) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + H.SCRATCH_PREFIX + "')!==0)return JSON.stringify({error:'not-scratch'});" +
		"var ft=Number(seq.getSettings().videoFrameRate.ticks);var c=seq.importMGT(" + JSON.stringify(mogrtPath) + ",String(" + Number(sf) + "*ft)," + Number(ti) + ",0);" +
		"if(!c)return JSON.stringify({error:'import-null'});var t=new Time();t.ticks=String(" + Number(ef) + "*ft);c.end=t;" +
		(name ? "c.name=" + JSON.stringify(name) + ";" : "") +
		(capIdx >= 0 ? "applyParamsToItem(c,[{index:" + Number(capIdx) + ",type:'text',value:" + JSON.stringify(capText) + ",rawValue:''}]);" : "") +
		"return JSON.stringify({nodeId:String(c.nodeId),name:String(c.name)});})()";
}
/** 트랙 잠금 (스크래치만) → "true"/"false" */
function jsxSetLocked(ti, on) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + H.SCRATCH_PREFIX + "')!==0)return 'not-scratch';" +
		"var t=seq.videoTracks[" + Number(ti) + "];t.setLocked(" + (on ? "1" : "0") + ");return String(t.isLocked());})()";
}
/** 활성 시퀀스 직접 읽기 → JSON {numTracks, frameTicks, name} */
const JSX_SEQ_FACTS = "(function(){var s=app.project.activeSequence;return JSON.stringify({numTracks:s.videoTracks.numTracks,frameTicks:String(s.getSettings().videoFrameRate.ticks),name:String(s.name)});})()";
/** 트랙 ti를 frame에서 QE razor (스크래치만) → "ok" | 까닭 */
function jsxRazor(ti, frame) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + H.SCRATCH_PREFIX + "')!==0)return 'not-scratch';" +
		"app.enableQE();var ft=Number(seq.getSettings().videoFrameRate.ticks);var t=new Time();t.ticks=String(" + Number(frame) + "*ft);" +
		"var tc=t.getFormatted(seq.getSettings().videoFrameRate,seq.getSettings().videoDisplayFormat);" +
		"qe.project.getActiveSequence().getVideoTrackAt(" + Number(ti) + ").razor(tc);return 'ok';})()";
}
/**
 * 프리뷰 시퀀스(없으면 v27 setupPreviewSequence로 만든다)를 잠깐 활성으로 두고 MID_getTracks(payload)를 부른 뒤
 * 원래 시퀀스(스크래치)로 되돌린다 — 한 JSX 안이라 패널이 끼어들지 않는다 → 호스트 응답 글자
 */
function jsxCallWhilePreview(mogrtPath, payload) {
	return "(function(){var p=app.project;var orig=p.activeSequence;if(String(orig.name).indexOf('" + H.SCRATCH_PREFIX + "')!==0)return 'not-scratch';" +
		"var prev=findPreviewSequence();if(!prev){setupPreviewSequence(" + JSON.stringify(JSON.stringify({ mogrtPath, durationSec: 5 })) + ");prev=findPreviewSequence();}" +
		"if(!prev){setActiveSequence(orig);return 'no-preview';}setActiveSequence(prev);var r='';" +
		"try{r=" + hostCallSource("MID_getTracks", payload) + ";}finally{setActiveSequence(orig);}" +
		"return String(r)+'|active='+String(p.activeSequence.name);})()";
}
/** AE 프리셋 하나 (캡션 필드가 있는 것) → {id, mogrtPath, params, textParamIndex} */
async function aePreset(api) {
	const { panel } = api;
	const pick = async () => {
		const s = await panel(SNAP);
		const id = Object.keys(s.presets).find((k) => {
			const p = s.presets[k];
			return p.mogrtPath && (p.params || []).length && !(p.params || []).some((x) => x.nativeText) && typeof p.textParamIndex === "number" && p.textParamIndex >= 0;
		});
		return id ? Object.assign({ id }, s.presets[id]) : null;
	};
	let P = await pick();
	if (!P) {
		await H.ensurePreset(api, { prefer: /라온올제/ });
		P = await pick();
	}
	if (!P) throw new Error("캡션 필드가 있는 AE 프리셋이 없다");
	return P;
}

/**
 * 스크래치 시퀀스가 활성인 상태에서 도는 단계 (가짜 Premiere로 미리 돌려 볼 수 있게 따로 내보낸다).
 * env = {host, mi, panel(없으면 패널 어댑터 확인을 건너뛴다), assert, log, P: {mogrtPath, params, textParamIndex}, info: {orig: {id, name}, clone: {id, name}}}
 */
async function steps(env) {
	const { host, mi, panel, assert, log, P, info } = env;
	const byIdx = P.params.slice().sort((a, b) => a.index - b.index);
	const ping = await mi("ping");
	assert.equal(ping.seqId, info.clone.id);
	const base = { seqId: ping.seqId, build: ping.build };
	for (const ti of [V2, V3]) assert.equal(await host(H.jsxClearVideoTrack(ti)), "0", "V" + (ti + 1) + " 비우기");
	assert.equal(await host(jsxSetLocked(V4, false)), "false");
	const a1 = JSON.parse(await host(jsxPlaceNamed(P.mogrtPath, V2, 48, 120, null, -1)));
	const a2 = JSON.parse(await host(jsxPlaceNamed(P.mogrtPath, V2, 144, 216, null, -1)));
	const tagged = JSON.parse(await host(jsxPlaceNamed(P.mogrtPath, V3, 240, 336, TAG_NAME, P.textParamIndex, CAP)));
	assert.ok(!a1.error && !a2.error && !tagged.error, JSON.stringify([a1, a2, tagged]));
	assert.equal(tagged.name, TAG_NAME);
	assert.equal(await host(jsxSetLocked(V4, true)), "true");
	const facts = JSON.parse(await host(JSX_SEQ_FACTS));

	// ── (2) getTracks ──
	const r = await mi("getTracks", Object.assign({}, base, { tracks: null }));
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.equal(r.numVideoTracks, facts.numTracks);
	assert.equal(r.frameTicks, facts.frameTicks);
	if (info.orig.name === "T_23976") assert.equal(r.frameTicks, "10594584000");
	const tr = (x, i) => x.tracks.find((t) => t.i === i);
	assert.ok(!r.tracks.some((t) => t.i === 0), "V1은 스캔하지 않는다");
	assert.deepEqual(r.tracks.map((t) => t.i), Array.from({ length: facts.numTracks - 1 }, (_, k) => k + 1));
	assert.deepEqual([tr(r, V2).locked, tr(r, V3).locked, tr(r, V4).locked], [false, false, true]);
	assert.deepEqual(tr(r, V2).clips.map((c) => [c.sf, c.ef, c.nodeId, c.salt]), [[48, 120, a1.nodeId, undefined], [144, 216, a2.nodeId, undefined]]);
	assert.deepEqual(tr(r, V3).clips, [{ sf: 240, ef: 336, nodeId: tagged.nodeId, name: TAG_NAME, salt: "ab12", id: 1, g: 1 }]);
	const w = await mi("getTracks", Object.assign({}, base, { tracks: [V2, V3], fromFrame: 130, toFrame: 250 }));
	assert.deepEqual(w.tracks.map((t) => [t.i, t.clips.map((c) => c.sf)]), [[V2, [144]], [V3, [240]]]);
	log("(2) 트랙 " + r.numVideoTracks + "개, frameTicks " + r.frameTicks + ", " + r.ms + "ms");

	// ── (4) readClipTexts ──
	const req = Object.assign({}, base, { items: [{ track: V3, nodeId: tagged.nodeId }, { track: V2, nodeId: a1.nodeId }], want: { texts: true, lay: true, deco: true, params: true } });
	const ra = await mi("readClipTexts", req);
	const rb = await mi("readClipTexts", req);
	assert.equal(ra.ok, true, JSON.stringify(ra).slice(0, 300));
	const x = ra.results[0];
	assert.deepEqual([x.found, x.kind, x.sf, x.ef, x.name], [true, "ae", 240, 336, TAG_NAME]);
	assert.deepEqual(rb.results[0].texts, x.texts, "두 번 읽어도 같다");
	assert.ok(x.texts.indexOf(CAP) !== -1, "캡션이 텍스트에 있다: " + JSON.stringify(x.texts));
	assert.deepEqual(x.lay.map((l) => l[0]), byIdx.map((p) => p.displayName), "lay 이름 = 프리셋 속성 이름");
	assert.deepEqual(x.lay.map((l) => l[1]), byIdx.map((p) => (p.type === "text" ? "t" : "o")), "lay 텍스트 여부 = 프리셋 type");
	assert.equal(x.params.length, byIdx.length);
	assert.ok(x.params.every((p) => typeof p.type === "string" && p.type && !("colorHex" in p)), "type 있음, colorHex 없음");
	assert.equal(x.params.find((p) => p.index === P.textParamIndex).value, CAP);
	assert.equal(typeof x.deco.comps, "number");
	assert.equal(ra.results[1].found, true);
	log("(4) 텍스트 " + JSON.stringify(x.texts) + ", 속성 " + x.params.length + "개, 컴포넌트 " + x.deco.comps + ", " + ra.ms + "ms");

	// ── (3) 자르기 → dup ──
	assert.equal(await host(jsxRazor(V3, 288)), "ok");
	const r3 = await mi("getTracks", Object.assign({}, base, { tracks: [V3] }));
	const idx = CORE.scanIndex(r3, "ab12");
	const dup = idx.dup["ab12-1"] || [];
	assert.equal(dup.length, 2, "같은 태그 두 조각: " + JSON.stringify(r3.tracks[0].clips));
	assert.equal(idx.current["ab12-1"], undefined);
	assert.ok(dup.some((c) => c.nodeId === tagged.nodeId), "원래 조각은 nodeId 그대로 (spike #1b)");
	assert.deepEqual(Array.from(dup, (c) => c.name), [TAG_NAME, TAG_NAME]);
	log("(3) 자르기 → dup " + dup.map((c) => c.nodeId + "@" + c.sf).join(", "));

	// ── (5) 프리뷰 활성 → preview-active ──
	const pv = await host(jsxCallWhilePreview(P.mogrtPath, Object.assign({}, base, { tracks: [V3] })));
	assert.ok(pv !== "no-preview" && pv !== "not-scratch", pv);
	const [pvRes, activeAfter] = pv.split("|active=");
	assert.equal(JSON.parse(pvRes).error, "preview-active", pvRes);
	assert.equal(activeAfter, info.clone.name, "스크래치로 되돌렸다");
	// ── (6) seq-mismatch, (7) build-mismatch ──
	assert.equal((await mi("getTracks", Object.assign({}, base, { seqId: "not-this-seq" }))).error, "seq-mismatch");
	assert.equal((await mi("readClipTexts", Object.assign({}, base, { seqId: info.orig.id, items: [] }))).error, "seq-mismatch", "원본 시퀀스 id도 활성이 아니면 거부");
	assert.equal((await mi("getTracks", Object.assign({}, base, { build: base.build + "-wrong" }))).error, "build-mismatch");
	assert.equal((await mi("getTracks", { seqId: base.seqId, tracks: null })).error, "build-mismatch", "빌드 없음");
	log("(5)(6)(7) preview-active · seq-mismatch · build-mismatch");

	// ── (+) 패널 어댑터: U+2028이 든 payload (build·seqId는 어댑터가 붙인다) ──
	if (!panel) return;
	const viaPanel = await panel("await window._mogrtDebug.callMi('getTracks', { tracks: [" + V3 + "], note: 'a' + String.fromCharCode(0x2028) + 'b' + String.fromCharCode(0x2029) })");
	assert.equal(viaPanel.ok, true, JSON.stringify(viaPanel).slice(0, 300));
	assert.equal(viaPanel.tracks[0].clips.length, 2);
	log("(+) 패널 어댑터 U+2028 payload → ok");
}

module.exports = {
	name: "S2-1 읽기 전용 MI_ 호스트 (ping·트랙 스캔·되읽기·가드·어댑터)",
	steps,
	run: async (api) => {
		const { panel, host, mi, assert, log } = api;
		await H.waitKeys(panel);
		const P = await aePreset(api);
		const byIdx = P.params.slice().sort((a, b) => a.index - b.index);
		log("프리셋 " + P.id + " " + P.name + " — 속성 " + byIdx.length + "개, 캡션 idx " + P.textParamIndex);

		// ── (1) ping ──
		const exp = expectedBuild();
		const ping0 = await mi("ping");
		assert.equal(ping0.ok, true, JSON.stringify(ping0));
		assert.deepEqual([ping0.v, ping0.prefix], [28, "MID_"]);
		assert.match(String(ping0.build), /^dev-[0-9a-f]{7,40}/);
		if (exp.build) assert.equal(ping0.build, exp.build, "설치 빌드(" + exp.source + ")와 같다 — 다르면 Premiere를 다시 시작한다");
		const st = await panel(H.pageCmd("status", {}));
		assert.equal(st.data.panel.build, ping0.build, "패널 MID_BUILD_PANEL = 호스트 MID_BUILD");
		assert.equal(st.data.host && st.data.host.build, ping0.build, "status.host = ping");
		const ok = await panel("await window._mogrtDebug.miHostOk()");
		assert.equal(ok.ok, true, JSON.stringify(ok));
		log("(1) ping v28 " + ping0.build + " (" + ping0.seqName + ")");

		await H.withScratchSequence(api, "s2_1", async (info) => {
			await steps({ host, mi, panel, assert, log, P, info });
		});

		// ── (8) 운영(MI_)과 DEV(MID_) 호스트가 같이 로드돼 있으면 각자 자기 빌드 ──
		const prodRaw = await host("typeof MI_ping === 'function' ? MI_ping() : '__NONE__'");
		const devAgain = await mi("ping");
		assert.equal(devAgain.build, ping0.build);
		if (prodRaw === "__NONE__") {
			log("(8) 운영 호스트에 MI_ping이 없다 (운영은 v27 호스트이거나 운영 패널이 닫혀 있다) — DEV만 확인: " + devAgain.prefix + " " + devAgain.build);
		} else {
			const prod = JSON.parse(prodRaw);
			assert.equal(prod.prefix, "MI_");
			assert.match(String(prod.build), /^prod-/);
			assert.notEqual(prod.build, devAgain.build);
			log("(8) 운영 " + prod.prefix + " " + prod.build + " / DEV " + devAgain.prefix + " " + devAgain.build);
		}
	}
};
