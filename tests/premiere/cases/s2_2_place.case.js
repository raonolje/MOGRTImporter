"use strict";
/**
 * S2-2 하드: 쓰기 호스트 MID_ensureVideoTracks · MID_placeChunk · MID_removeClips (T1~T17). JSX를 바꿨으므로 Premiere를 다시 시작한 뒤 돌린다.
 * DEV(MID_) 호스트를 case의 mi()로 직접 부른다. 스크래치 사본(T_scratch_s2_2)에서만 쓴다 (V3~V5를 비우고, 트랙을 둘 더한다).
 * 프리셋: '[라온올제] 자동 줄바꿈 박스 자막'(없으면 모달로 만든다)과 그 옛 8속성 버전(tests/fixtures/mogrt/make_old_mogrt.js),
 * 네이티브: 'Lower Thirds/Classic Lower Third Two Lines.mogrt'를 패널 bakeNative로 구운 사본 둘.
 *   T6  ensure 없이 트랙 번호 = 트랙 수 → failed no-track, 어느 트랙에도 클립이 생기지 않는다 (importMGT는 마지막 트랙에 놓는다, #14)
 *   T1  ensure(+1) → 새 트랙에 3개 place: 태그 .1, 시작 ticks = sf × frameTicks, 끝 ticks = ef × frameTicks, dur ≈ 5.005
 *   T2  같은 3개 update → nodeId 그대로, before는 타입 있는 ParamDef. before를 다시 쓰면 모든 MGT 속성 raw 값이 update 전과 같다.
 *       네이티브: 구운 사본을 놓고 되읽은 params로 update → updated, Source Text raw 값 그대로 (호스트는 네이티브 텍스트를 쓰지 않는다)
 *   T3  (sf, ef) 안에서 시작하는 guard 이웃 → 끝을 이웃 시작에 맞춤(clamped), 이웃 그대로
 *   T11 guard 이웃이 S+1초 → 머리가 잘렸다가 되돌아온다(R: nodeId·시작·끝·inPoint 그대로). 통째로 덮인 guard → damaged(C)
 *   T4  남의 클립: 시작을 덮으면 occupied, 뒤쪽이면 tail — 클립 수 그대로
 *   T5  잠긴 트랙 → locked
 *   T7  moveRegen V4 → V5 → V5에 gen 2, V4의 옛 클립은 지워진다
 *   T8  중단(gen 2를 놓고 gen 1이 남음) → getTracks + core scanIndex → stale
 *   T9  자르기 → ambiguous
 *   T10 removeClips: nodeId + expectName → removed(before 포함), 이름이 다르면 notOurs
 *   T12 replace를 없는 경로로 → 옛 템플릿을 되놓는다: AE(projectItem) restored-old + 속성·이름 그대로, 네이티브(own.m) restored-old,
 *       네이티브에 own.m이 없으면 template-unknown(클립 그대로), 구운 다른 사본으로는 replaced
 *   T13 원본 시퀀스 id → seq-mismatch
 *   T14 새 트랙에 8개 → 기본 예산 안에 done 8 (ms를 적는다)
 *   T15 MGT 속성에 키프레임 → partial + keyed, 값 그대로
 *   T16 옛 8속성 클립 + 15속성 프리셋 params → 캡션은 옛 클립의 캡션 이름 속성에, 색은 이름으로 찾은 속성에, 새 전용 속성은 skipped
 *   T17 move → nodeId·효과(Tint)·Motion 키프레임 그대로, 시작 = sf, 끝 = ef
 * 실행: npm run hard -- s2_2
 * 단계 함수 steps(env)는 가짜 Premiere(tests/lib/premiereSim.js)로 미리 돌려 볼 수 있게 따로 내보낸다.
 */
const H = require("../lib/hard");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const TPS = 254016000000;
const SALT = "hd22";
const NATIVE_REL = "Lower Thirds/Classic Lower Third Two Lines.mogrt";
const BAD_PATH = "C:/nope_mogrt/없는 템플릿.mogrt";
const V3 = 2;
const V4 = 3;
const V5 = 4;
const norm = (p) => String(p || "").replace(/\\/g, "/");
const SCR = H.SCRATCH_PREFIX;
const tag = (n, g) => "철수 [MI:" + SALT + "-" + n + "." + g + "]";
const bigTicks = (frame, ft) => String(BigInt(frame) * BigInt(ft));

// ── 호스트 JSX (ES3, 스크래치 사본만) ──

/** 트랙 ti 클립 [{s, e, inT (ticks 글자), nodeId, name, comps, props: [[이름, 값, 키]], native: [값], motionKeyed}] */
function jsxClipsFull(ti) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return MID__json({error:'not-scratch'});" +
		"var t=seq.videoTracks[" + Number(ti) + "];if(!t)return MID__json({error:'no-track'});var out=[];" +
		"for(var k=0;k<t.clips.numItems;k++){var c=t.clips[k];var o={s:String(c.start.ticks),e:String(c.end.ticks),inT:String(c.inPoint.ticks),nodeId:String(c.nodeId),name:String(c.name),comps:c.components.numItems,props:[],native:[],motionKeyed:false};" +
		"var mg=null;try{mg=c.getMGTComponent();}catch(e0){}" +
		"if(mg){for(var j=0;j<mg.properties.numItems;j++){var p=mg.properties[j];var v='';try{v=String(p.getValue());}catch(e1){v='?';}var tv=false;try{tv=p.isTimeVarying()===true;}catch(e2){}o.props.push([String(p.displayName),v,tv]);}}" +
		"else{var nt=collectNativeTextProps(c);for(var q=0;q<nt.length;q++){var nv='';try{nv=String(nt[q].getValue());}catch(e3){}o.native.push(nv);}}" +
		"for(var ci=0;ci<c.components.numItems;ci++){var cp=c.components[ci];if(String(cp.matchName)==='AE.ADBE Motion'){try{o.motionKeyed=cp.properties[0].isTimeVarying()===true;}catch(e4){}}}" +
		"out.push(o);}return MID__json(out);})()";
}
/** 트랙마다 클립 수 "n0,n1,…" */
const JSX_COUNTS = "(function(){var s=app.project.activeSequence;var a=[];for(var i=0;i<s.videoTracks.numTracks;i++)a.push(s.videoTracks[i].clips.numItems);return a.join(',');})()";
/** 트랙 ti의 sf 프레임에 MOGRT를 importMGT, 끝 ef 프레임, 이름 → MID__json {nodeId} */
function jsxPlaceNamed(mogrtPath, ti, sf, ef, name) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return MID__json({error:'not-scratch'});" +
		"var ft=Number(seq.getSettings().videoFrameRate.ticks);var c=seq.importMGT(" + JSON.stringify(mogrtPath) + ",MID__ticks(" + Number(sf) + ",ft)," + Number(ti) + ",0);" +
		"if(!c)return MID__json({error:'import-null'});c.end=MID__at(" + Number(ef) + ",ft);" + (name ? "c.name=" + JSON.stringify(name) + ";" : "") +
		"return MID__json({nodeId:String(c.nodeId)});})()";
}
function jsxSetLocked(ti, on) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"var t=seq.videoTracks[" + Number(ti) + "];t.setLocked(" + (on ? "true" : "false") + ");return String(t.isLocked());})()";
}
function jsxRazor(ti, frame) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"app.enableQE();var ft=Number(seq.getSettings().videoFrameRate.ticks);var t=MID__at(" + Number(frame) + ",ft);" +
		"var tc=t.getFormatted(seq.getSettings().videoFrameRate,seq.getSettings().videoDisplayFormat);" +
		"qe.project.getActiveSequence().getVideoTrackAt(" + Number(ti) + ").razor(tc);return 'ok';})()";
}
/** nodeId 클립의 MGT 속성 name에 키프레임 두 개 (inPoint + 12f, + 72f, 지금 값으로, S0-3 g) → "true" | 까닭 */
function jsxKeyParam(ti, nodeId, name) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"var ft=Number(seq.getSettings().videoFrameRate.ticks);var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return 'no-clip';" +
		"var mg=c.getMGTComponent();var p=null;for(var j=0;j<mg.properties.numItems;j++){if(String(mg.properties[j].displayName)===" + JSON.stringify(name) + "){p=mg.properties[j];break;}}if(!p)return 'no-prop';" +
		"var v=p.getValue();var inT=Number(c.inPoint.ticks);p.setTimeVarying(true);" +
		"var k1=MID__T(inT+12*ft);var k2=MID__T(inT+72*ft);p.addKey(k1);p.setValueAtKey(k1,v,true);p.addKey(k2);p.setValueAtKey(k2,v,true);" +
		"return String(p.isTimeVarying());})()";
}
/** nodeId 클립: QE로 Tint 효과를 붙이고 Motion Position에 키 두 개 (S0-3 r과 같은 방법) → "ok …" | 까닭 */
function jsxDecorate(ti, nodeId) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"var ft=Number(seq.getSettings().videoFrameRate.ticks);var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return 'no-clip';" +
		"var st=Number(c.start.ticks);var mot=null;for(var ci=0;ci<c.components.numItems;ci++){if(String(c.components[ci].matchName)==='AE.ADBE Motion')mot=c.components[ci];}" +
		"var pos=mot.properties[0];var inT=Number(c.inPoint.ticks);pos.setTimeVarying(true);var k1=MID__T(inT+12*ft);var k2=MID__T(inT+72*ft);" +
		"pos.addKey(k1);pos.setValueAtKey(k1,[0.3,0.5],true);pos.addKey(k2);pos.setValueAtKey(k2,[0.7,0.5],true);" +
		"app.enableQE();var qtr=qe.project.getActiveSequence().getVideoTrackAt(" + Number(ti) + ");var fx='none';" +
		"for(var i=0;i<qtr.numItems;i++){var it=qtr.getItemAt(i);if(!it||String(it.type)==='Empty')continue;" +
		"if(Math.abs(Number(it.start.ticks)-st)<ft/2){it.addVideoEffect(qe.project.getVideoEffectByName('Tint'));fx='tint';break;}}" +
		"return 'ok '+fx+' comps='+c.components.numItems;})()";
}
/** 활성 시퀀스 사실 → {numTracks, frameTicks} */
const JSX_FACTS = "(function(){var s=app.project.activeSequence;return MID__json({numTracks:s.videoTracks.numTracks,frameTicks:String(s.getSettings().videoFrameRate.ticks),name:String(s.name)});})()";

async function hostJson(host, jsx, what) {
	const raw = await host(jsx);
	try {
		return JSON.parse(raw);
	} catch (_) {
		throw new Error("호스트 결과를 읽지 못함 (" + what + "): " + String(raw).slice(0, 300));
	}
}
const propMap = (clip) => {
	const m = {};
	(clip.props || []).forEach((p) => { m[p[0]] = p[1]; });
	return m;
};
const textOfRaw = (raw) => {
	try { return JSON.parse(raw).textEditValue; } catch (_) { return undefined; }
};

/**
 * 테스트 단계 (스크래치 시퀀스가 활성인 상태에서).
 * env = {host, mi, assert, log, P: {mogrtPath, params, textParamIndex}, old: {path, oldNames}, nat: [{path, durSec}, {path, durSec}], origSeqId}
 */
async function steps(env) {
	const { host, mi, assert, log, P, old, nat } = env;
	const ping = await mi("ping");
	assert.equal(ping.ok, true, JSON.stringify(ping));
	assert.equal(ping.seqName.indexOf(SCR), 0, "스크래치 사본에서만");
	const base = { seqId: ping.seqId, build: ping.build };
	const FT = Number(ping.frameTicks);
	const DUR = 5.005;
	const chunk = async (items, extra) => {
		const r = await mi("placeChunk", Object.assign({ frameTicks: FT, budgetMs: 7000, items }, base, extra || {}));
		assert.equal(r.ok, true, "placeChunk: " + JSON.stringify(r).slice(0, 400));
		return r;
	};
	const clips = async (ti) => hostJson(host, jsxClipsFull(ti), "트랙 " + ti);
	const counts = async () => String(await host(JSX_COUNTS));
	const capIdx = P.textParamIndex;
	const capName = (P.params.find((p) => p.index === capIdx) || {}).displayName;
	const withCap = (text) => P.params.map((p) => (p.index === capIdx ? Object.assign({}, p, { value: text }) : Object.assign({}, p)));
	const item = (n, op, track, sf, ef, extra) => Object.assign({ key: SALT + "-" + n, op, g: 1, track, sf, ef, mogrtPath: P.mogrtPath, durSec: DUR, params: [], name: tag(n, 1), guard: [], motion: null, removeAfter: null, own: null }, extra || {});
	const ownOf = (x, track) => ({ track, sf: x.sf, nodeId: x.nodeId });
	for (const ti of [V3, V4, V5]) assert.equal(await host(H.jsxClearVideoTrack(ti)), "0", "V" + (ti + 1) + " 비우기");
	const facts = await hostJson(host, JSX_FACTS, "facts");
	const N = facts.numTracks;
	log("스크래치 " + facts.name + ": 비디오 트랙 " + N + "개, frameTicks " + FT);

	// ── T6: ensure 없이 트랙 번호 = 트랙 수 ──
	const c6 = await counts();
	let r = await chunk([item(60, "place", N, 24, 72)]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["failed", "no-track"]);
	assert.equal(await counts(), c6, "어느 트랙에도 클립이 생기지 않았다");
	log("T6 no-track, 클립 수 그대로 (" + c6 + ")");

	// ── T1: ensure → 새 트랙에 3개 ──
	let e = await mi("ensureVideoTracks", Object.assign({ minCount: N + 1 }, base));
	assert.deepEqual(e, { ok: true, before: N, after: N + 1, added: 1 });
	e = await mi("ensureVideoTracks", Object.assign({ minCount: N }, base));
	assert.deepEqual([e.ok, e.added], [true, 0]);
	const NT = N;
	const T1 = [[24, 72], [719, 767], [1440, 1500]];
	r = await chunk(T1.map(([sf, ef], i) => item(i + 1, "place", NT, sf, ef, { params: withCap("하드 T1 캡션 " + (i + 1)) })));
	const t1 = r.results;
	assert.deepEqual(t1.map((x) => x.status), ["placed", "placed", "placed"], JSON.stringify(t1.map((x) => [x.status, x.reason, x.detail])));
	let live = await clips(NT);
	assert.equal(live.length, 3);
	T1.forEach(([sf, ef], i) => {
		assert.equal(live[i].s, bigTicks(sf, FT), "T1 시작 ticks " + i);
		assert.equal(live[i].e, bigTicks(ef, FT), "T1 끝 ticks " + i);
		assert.equal(live[i].name, tag(i + 1, 1));
		assert.equal(live[i].nodeId, t1[i].nodeId);
		assert.equal(textOfRaw(propMap(live[i])[capName]), "하드 T1 캡션 " + (i + 1));
		assert.ok(t1[i].texts.indexOf("하드 T1 캡션 " + (i + 1)) !== -1);
	});
	const dur = r.dur[P.mogrtPath];
	assert.ok(Math.abs(dur - DUR) < 0.05, "dur " + dur);
	assert.equal(typeof r.comps[P.mogrtPath], "number");
	log("T1 새 트랙 V" + (NT + 1) + "에 3개, dur " + dur + ", comps " + r.comps[P.mogrtPath] + ", " + r.ms + "ms");

	// ── T2: update → before 다시 쓰기 ──
	const snapA = live.map((c) => c.props);
	const upd = (x, i, params, extra) => Object.assign(item(i + 1, "update", NT, x.sf, x.ef, { own: ownOf(x, NT), params }), extra || {});
	r = await chunk(t1.map((x, i) => upd(x, i, withCap("하드 T2 바뀐 캡션 " + (i + 1)))));
	assert.deepEqual(r.results.map((x) => [x.status, x.nodeId]), t1.map((x) => ["updated", x.nodeId]), "nodeId 그대로");
	const befores = r.results.map((x) => x.before);
	befores.forEach((b, i) => {
		assert.ok(Array.isArray(b) && b.length === snapA[i].length, "before 길이");
		assert.ok(b.every((p) => typeof p.type === "string" && p.type && typeof p.rawValue === "string" && !("colorHex" in p)), "타입 있는 ParamDef, colorHex 없음");
		assert.equal(b.find((p) => p.index === capIdx).value, "하드 T1 캡션 " + (i + 1));
	});
	live = await clips(NT);
	assert.equal(textOfRaw(propMap(live[0])[capName]), "하드 T2 바뀐 캡션 1");
	r = await chunk(t1.map((x, i) => upd(x, i, befores[i])));
	assert.deepEqual(r.results.map((x) => x.status), ["updated", "updated", "updated"], JSON.stringify(r.results.map((x) => [x.status, x.skipped, x.keyed])));
	live = await clips(NT);
	live.forEach((c, i) => {
		const diff = c.props.map((p, k) => (p[1] === snapA[i][k][1] ? null : p[0] + ": " + snapA[i][k][1].slice(0, 80) + " → " + p[1].slice(0, 80))).filter(Boolean);
		assert.deepEqual(diff, [], "클립 " + i + " 모든 속성 raw 값이 update 전과 같다");
	});
	log("T2 update 3개 nodeId 그대로, before 다시 쓰기로 속성 " + snapA[0].length + "개 × 3 정확히 복원");
	// 네이티브
	r = await chunk([item(20, "place", NT, 3000, 3060, { mogrtPath: nat[0].path, durSec: nat[0].durSec })]);
	const n20 = r.results[0];
	assert.deepEqual([n20.status, n20.kind], ["placed", "native"], JSON.stringify(n20));
	const nClip0 = (await clips(NT)).find((c) => c.nodeId === n20.nodeId);
	const rt = await mi("readClipTexts", Object.assign({ items: [{ track: NT, nodeId: n20.nodeId }], want: { params: true } }, base));
	r = await chunk([Object.assign(item(20, "update", NT, 3000, 3060, { own: ownOf(n20, NT), params: rt.results[0].params, name: tag(20, 1) }))]);
	assert.deepEqual([r.results[0].status, r.results[0].skipped], ["updated", []]);
	const nClip1 = (await clips(NT)).find((c) => c.nodeId === n20.nodeId);
	assert.deepEqual(nClip1.native, nClip0.native, "네이티브 Source Text raw 값 그대로");
	log("T2 네이티브 before 다시 쓰기: updated, Source Text " + nClip1.native.length + "개 그대로");

	// ── T3: 안쪽에서 시작하는 guard 이웃 → 끝 맞춤 ──
	const nb3 = await hostJson(host, jsxPlaceNamed(P.mogrtPath, NT, 5050, 5400, tag(50, 1)), "T3 이웃");
	const nb3a = (await clips(NT)).find((c) => c.nodeId === nb3.nodeId);
	r = await chunk([item(4, "place", NT, 5000, 5100, { guard: [nb3.nodeId] })]);
	assert.deepEqual([r.results[0].status, r.results[0].clamped, r.results[0].ef], ["placed", true, 5050], JSON.stringify(r.results[0]));
	const nb3b = (await clips(NT)).find((c) => c.nodeId === nb3.nodeId);
	assert.deepEqual([nb3b.s, nb3b.e, nb3b.inT], [nb3a.s, nb3a.e, nb3a.inT], "이웃 그대로 (머리를 되돌렸다)");
	assert.deepEqual(r.damaged, []);
	log("T3 끝 맞춤 5100 → 5050, 이웃 그대로");

	// ── T11: 이웃 S+1초 (R) / 통째로 덮인 이웃 (C) ──
	const oneSec = Math.round(TPS / FT);
	const nb11 = await hostJson(host, jsxPlaceNamed(P.mogrtPath, NT, 6000 + oneSec, 6400, tag(51, 1)), "T11 이웃");
	const nb11a = (await clips(NT)).find((c) => c.nodeId === nb11.nodeId);
	const cov = await hostJson(host, jsxPlaceNamed(P.mogrtPath, NT, 7030, 7080, tag(52, 1)), "T11 덮일 이웃");
	r = await chunk([item(11, "place", NT, 6000, 6000 + oneSec, { guard: [nb11.nodeId] }), item(12, "place", NT, 7000, 7020, { guard: [cov.nodeId] })]);
	assert.deepEqual(r.results.map((x) => x.status), ["placed", "placed"], JSON.stringify(r.results));
	const nb11b = (await clips(NT)).find((c) => c.nodeId === nb11.nodeId);
	assert.ok(nb11b, "S+1초 이웃이 남아 있다");
	assert.deepEqual([nb11b.s, nb11b.e, nb11b.inT, nb11b.name], [nb11a.s, nb11a.e, nb11a.inT, nb11a.name], "머리 되돌림 (R): 시작·끝·inPoint·이름");
	assert.deepEqual(r.damaged, [cov.nodeId], "통째로 덮인 이웃 → damaged (C)");
	log("T11 R: 이웃 머리 되돌림, C: damaged " + r.damaged.join(","));

	// ── T4: 남의 클립 ──
	await hostJson(host, jsxPlaceNamed(P.mogrtPath, NT, 8000, 8100, "남의 클립"), "T4 남의 클립");
	const c4 = await counts();
	r = await chunk([item(40, "place", NT, 8050, 8090), item(41, "place", NT, 7900, 7950)]);
	assert.deepEqual(r.results.map((x) => [x.status, x.reason]), [["conflict", "occupied"], ["conflict", "tail"]]);
	assert.equal(await counts(), c4, "클립 수 그대로");
	log("T4 occupied · tail, 클립 수 그대로");

	// ── T5: 잠긴 트랙 ──
	assert.equal(await host(jsxSetLocked(V3, true)), "true");
	r = await chunk([item(5, "place", V3, 24, 72)]);
	assert.equal(r.results[0].status, "locked");
	assert.equal(await host(jsxSetLocked(V3, false)), "false");
	assert.equal((await clips(V3)).length, 0);
	log("T5 locked");

	// ── T7: moveRegen V4 → V5 ──
	r = await chunk([item(7, "place", V4, 9000, 9048)]);
	const g1 = r.results[0];
	assert.equal(g1.status, "placed");
	r = await chunk([item(7, "moveRegen", V5, 9500, 9548, { g: 2, own: ownOf(g1, V4), name: tag(7, 2), params: withCap("하드 T7") })]);
	const m7 = r.results[0];
	assert.deepEqual([m7.status, m7.reason, m7.track, m7.name], ["moved", "", V5, tag(7, 2)], JSON.stringify(m7));
	assert.deepEqual([m7.before.track, m7.before.sf, m7.before.g, m7.before.name], [V4, 9000, 1, tag(7, 1)]);
	assert.ok(!(await clips(V4)).some((c) => c.nodeId === g1.nodeId), "V4의 옛 클립은 지워졌다");
	assert.ok((await clips(V5)).some((c) => c.nodeId === m7.nodeId && c.name === tag(7, 2)));
	log("T7 moveRegen V4 → V5 gen 2");

	// ── T8: 중단 → stale ──
	await chunk([item(8, "place", V4, 10000, 10048)]);
	await chunk([item(8, "place", V5, 10000, 10048, { g: 2, name: tag(8, 2) })]);
	const scan8 = await mi("getTracks", Object.assign({ tracks: [V4, V5] }, base));
	const idx8 = CORE.scanIndex(scan8, SALT);
	assert.deepEqual(Array.from(idx8.stale, (c) => c.name), [tag(8, 1)]);
	assert.equal(idx8.current[SALT + "-8"].track, V5);
	log("T8 stale " + idx8.stale.map((c) => c.name).join(","));

	// ── T9: 자르기 → ambiguous ──
	r = await chunk([item(9, "place", V3, 11000, 11100)]);
	const c9 = r.results[0];
	assert.equal(await host(jsxRazor(V3, 11050)), "ok");
	r = await chunk([item(9, "update", V3, 11000, 11100, { keepTime: true, own: ownOf(c9, V3) })]);
	assert.equal(r.results[0].status, "ambiguous", JSON.stringify(r.results[0]));
	log("T9 ambiguous (" + (r.results[0].detail || "") + ")");

	// ── T10: removeClips ──
	const rm = await mi("removeClips", Object.assign({ items: [
		{ key: SALT + "-1", track: NT, nodeId: t1[0].nodeId, expectName: tag(1, 1) },
		{ key: SALT + "-3", track: NT, nodeId: t1[2].nodeId, expectName: "다른 이름 [MI:" + SALT + "-3.1]" },
		{ key: SALT + "-99", track: NT, nodeId: "ffffffff", expectName: null }
	] }, base));
	assert.deepEqual(rm.results.map((x) => x.status), ["removed", "notOurs", "notFound"]);
	const bf = rm.results[0].before;
	assert.deepEqual([bf.track, bf.sf, bf.ef, bf.g, bf.name, bf.kind], [NT, 24, 72, 1, tag(1, 1), "ae"]);
	assert.ok(bf.params.length > 0 && typeof bf.pi === "string");
	assert.ok(!(await clips(NT)).some((c) => c.nodeId === t1[0].nodeId));
	log("T10 removed · notOurs · notFound");

	// ── T12: replace 실패 → 옛 템플릿 되놓기 ──
	live = await clips(NT);
	const a12 = live.find((c) => c.nodeId === t1[1].nodeId);
	r = await chunk([item(2, "replace", NT, 719, 767, { g: 2, own: ownOf(t1[1], NT), mogrtPath: BAD_PATH, name: tag(2, 2) })]);
	let x12 = r.results[0];
	assert.deepEqual([x12.status, x12.reason], ["failed", "restored-old"], JSON.stringify(x12));
	const b12 = (await clips(NT)).find((c) => c.nodeId === x12.nodeId);
	assert.ok(b12, "되놓은 클립");
	assert.deepEqual([b12.s, b12.e, b12.name], [a12.s, a12.e, a12.name], "자리·이름 그대로");
	assert.deepEqual(b12.props.map((p) => [p[0], p[1]]), a12.props.map((p) => [p[0], p[1]]), "속성 그대로");
	// 네이티브: 없는 경로 → own.m(옛 구운 사본)으로 되놓기
	r = await chunk([item(21, "place", NT, 12000, 12060, { mogrtPath: nat[0].path, durSec: nat[0].durSec })]);
	const n21 = r.results[0];
	assert.equal(n21.status, "placed");
	r = await chunk([item(21, "replace", NT, 12000, 12060, { g: 2, own: Object.assign(ownOf(n21, NT), { m: nat[0].path }), mogrtPath: BAD_PATH, name: tag(21, 2) })]);
	x12 = r.results[0];
	assert.deepEqual([x12.status, x12.reason, x12.kind, x12.name], ["failed", "restored-old", "native", tag(21, 1)], JSON.stringify(x12));
	// 네이티브, own.m 없음 → 시작하지 않는다
	r = await chunk([item(21, "replace", NT, 12000, 12060, { g: 2, own: ownOf(x12, NT), mogrtPath: nat[1].path, durSec: nat[1].durSec, name: tag(21, 2) })]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["conflict", "template-unknown"]);
	assert.ok((await clips(NT)).some((c) => c.nodeId === x12.nodeId), "클립 그대로");
	// 구운 다른 사본으로 교체
	r = await chunk([item(21, "replace", NT, 12000, 12060, { g: 2, own: Object.assign(ownOf(x12, NT), { m: nat[0].path }), mogrtPath: nat[1].path, durSec: nat[1].durSec, name: tag(21, 2) })]);
	assert.deepEqual([r.results[0].status, r.results[0].name, r.results[0].before.m], ["replaced", tag(21, 2), nat[0].path]);
	log("T12 AE restored-old(속성 그대로) · 네이티브 restored-old · template-unknown · replaced");

	// ── T13 ──
	if (env.origSeqId) {
		const bad = await mi("placeChunk", Object.assign({}, base, { seqId: env.origSeqId, frameTicks: FT, items: [item(13, "place", NT, 13000, 13048)] }));
		assert.equal(bad.error, "seq-mismatch");
		log("T13 seq-mismatch");
	}

	// ── T14: 8개, 예산 안 ──
	e = await mi("ensureVideoTracks", Object.assign({ minCount: N + 2 }, base));
	assert.deepEqual([e.ok, e.after], [true, N + 2]);
	const NT2 = N + 1;
	r = await chunk(Array.from({ length: 8 }, (_, i) => item(140 + i, "place", NT2, 24 + i * 300, 72 + i * 300, { params: withCap("하드 T14 " + (i + 1)) })));
	assert.deepEqual([r.done, r.results.filter((x) => x.status === "placed").length], [8, 8], JSON.stringify(r.results.map((x) => [x.status, x.reason])));
	assert.ok(r.ms < 7000, "예산 안 (" + r.ms + "ms)");
	const t14 = r.results;
	log("T14 8개 " + r.ms + "ms");

	// ── T15: 키프레임 → partial + keyed ──
	const kp = P.params.find((p) => (p.type === "number" || p.type === "color") && p.index !== capIdx);
	if (!kp) {
		log("T15 건너뜀: 프리셋에 숫자·색 속성이 없다");
	} else {
		assert.equal(await host(jsxKeyParam(NT2, t14[0].nodeId, kp.displayName)), "true");
		const k0 = propMap((await clips(NT2)).find((c) => c.nodeId === t14[0].nodeId))[kp.displayName];
		const changed = withCap("하드 T15").map((p) => {
			if (p.index !== kp.index) return p;
			return kp.type === "color" ? Object.assign({}, p, { value: "#12ab34", colorHex: "#12ab34" }) : Object.assign({}, p, { value: String(Number(p.value || 0) + 7) });
		});
		r = await chunk([item(140, "update", NT2, 24, 72, { own: ownOf(t14[0], NT2), params: changed, name: tag(140, 1) })]);
		assert.deepEqual([r.results[0].status, r.results[0].keyed], ["partial", [kp.displayName]], JSON.stringify(r.results[0]));
		const k1 = (await clips(NT2)).find((c) => c.nodeId === t14[0].nodeId);
		assert.equal(propMap(k1)[kp.displayName], k0, "키 있는 속성 값 그대로");
		assert.equal(textOfRaw(propMap(k1)[capName]), "하드 T15", "나머지는 썼다");
		log("T15 partial keyed " + kp.displayName);
	}

	// ── T16: 옛 8속성 클립 + 15속성 params ──
	const o16 = await hostJson(host, jsxPlaceNamed(old.path, V3, 13000, 13100, tag(16, 1)), "T16 옛 클립");
	const before16 = (await clips(V3)).find((c) => c.nodeId === o16.nodeId);
	assert.deepEqual(before16.props.map((p) => p[0]), old.oldNames, "옛 구조 클립");
	const colorP = P.params.find((p) => p.type === "color" && old.oldNames.indexOf(p.displayName) !== -1);
	const params16 = withCap("하드 T16 옛 클립 캡션").map((p) => (colorP && p.index === colorP.index ? Object.assign({}, p, { value: "#ff00ff", colorHex: "#ff00ff" }) : p));
	r = await chunk([item(16, "update", V3, 13000, 13100, { keepTime: true, own: { track: V3, sf: 13000, nodeId: o16.nodeId }, params: params16, name: tag(16, 1) })]);
	const x16 = r.results[0];
	const expectSkipped = P.params.filter((p) => p.type !== "group" && p.type !== "textsetting" && old.oldNames.indexOf(p.displayName) === -1).map((p) => p.displayName);
	assert.deepEqual(x16.skipped.slice().sort(), expectSkipped.slice().sort(), "새 버전 전용 속성은 쓰지 않는다");
	assert.equal(x16.status, expectSkipped.length ? "partial" : "updated");
	const after16 = (await clips(V3)).find((c) => c.nodeId === o16.nodeId);
	assert.equal(textOfRaw(propMap(after16)[capName]), "하드 T16 옛 클립 캡션", "캡션이 옛 클립의 '" + capName + "'에");
	// index로 썼다면 캡션이 옛 클립의 capIdx 자리(다른 이름의 속성)에 들어갔다 (S0-3 x)
	const wrong = after16.props[capIdx];
	if (wrong && wrong[0] !== capName) assert.notEqual(textOfRaw(wrong[1]), "하드 T16 옛 클립 캡션", "'" + wrong[0] + "'(index " + capIdx + ")에 캡션이 들어가지 않았다");
	if (colorP) {
		const oi = old.oldNames.indexOf(colorP.displayName);
		assert.notEqual(after16.props[oi][1], before16.props[oi][1], "색은 이름으로 찾은 '" + colorP.displayName + "'에 들어갔다");
	}
	// 프리셋에 없는 이름의 속성은 아무도 쓰지 않았다
	const writable = P.params.filter((q) => q.type !== "group" && q.type !== "textsetting").map((q) => q.displayName);
	after16.props.forEach((p, k) => {
		if (writable.indexOf(p[0]) === -1) assert.equal(p[1], before16.props[k][1], "'" + p[0] + "' 그대로");
	});
	log("T16 옛 구조: 캡션 → '" + capName + "', skipped " + x16.skipped.length + "개");

	// ── T17: move ──
	r = await chunk([item(17, "place", NT2, 5000, 5048)]);
	const c17 = r.results[0];
	const deco = await host(jsxDecorate(NT2, c17.nodeId));
	assert.match(deco, /^ok /);
	const d0 = (await clips(NT2)).find((c) => c.nodeId === c17.nodeId);
	r = await chunk([item(17, "move", NT2, 5100, 5160, { own: ownOf(c17, NT2) })]);
	assert.deepEqual([r.results[0].status, r.results[0].nodeId, r.results[0].sf, r.results[0].ef], ["moved", c17.nodeId, 5100, 5160], JSON.stringify(r.results[0]));
	const d1 = (await clips(NT2)).find((c) => c.nodeId === c17.nodeId);
	assert.deepEqual([d1.s, d1.e], [bigTicks(5100, FT), bigTicks(5160, FT)]);
	assert.deepEqual([d1.comps, d1.motionKeyed, d1.name], [d0.comps, true, d0.name], "효과·키프레임·이름 그대로");
	assert.deepEqual(d1.props.map((p) => p[1]), d0.props.map((p) => p[1]), "속성 그대로");
	log("T17 move: nodeId·효과(" + deco + ")·Motion 키 그대로");
	return { NT, NT2 };
}

module.exports = {
	name: "S2-2 쓰기 호스트 (ensure·place·update·replace·move·moveRegen·remove, T1~T17)",
	steps,
	run: async (api) => {
		const { panel, host, mi, assert, log } = api;
		const MOGRT = require("../../fixtures/mogrt/make_old_mogrt");
		await H.waitKeys(panel);
		const fx = MOGRT.makeOldLayoutMogrt({});
		log("옛 구조 MOGRT: " + fx.path + " (" + fx.oldNames.length + "속성, 새 버전 " + fx.newNames.length + "속성)");
		const P = await H.pickPresetForMogrt(api, fx.newPath);
		assert.ok(P && typeof P.textParamIndex === "number" && P.textParamIndex >= 0, "캡션 필드가 있는 AE 프리셋");
		log("프리셋 " + P.id + " " + P.name + " — 캡션 idx " + P.textParamIndex);
		const mogrts = await H.waitMogrts(panel, 1);
		const hit = mogrts.find((m) => norm(m[0]).slice(-NATIVE_REL.length) === NATIVE_REL);
		assert.ok(hit, "MOGRT 목록에 " + NATIVE_REL + "이 있어야 한다");
		const bake = async (texts) => {
			const b = await panel("await window._mogrtDebug.bakeNative(" + JSON.stringify(hit[0]) + ", " + JSON.stringify(texts) + ")");
			assert.equal(b && b.ok, true, "굽기: " + JSON.stringify(b));
			return { path: b.path, durSec: b.durSec || 5.005 };
		};
		const nat = [await bake(["하드 S22 네이티브 하나", "둘째 줄"]), await bake(["하드 S22 네이티브 둘", "둘째 줄"])];
		log("구운 네이티브: " + nat.map((n) => n.path + " (" + n.durSec + "s)").join(" / "));
		await H.withScratchSequence(api, "s2_2", async (info) => {
			await steps({ host, mi, assert, log, P, old: fx, nat, origSeqId: info.orig.id });
		});
	}
};
