"use strict";
/**
 * MCP 테스트의 합성 세션 (합성 텍스트만): 2화자 24줄, 캡션 필드 T1 + 포인트 텍스트 T2 + 규칙 설명('최대 3개').
 * 템플릿 속성은 premiereSim(hostscript 전체)에서 읽어 패널 테스트(panel_commands)와 같은 모양이다.
 *
 *   const S = require("./lib/session");
 *   const fx = S.build();   // {sim, seq, preset, session, SEQ, PROJ, SALT}
 *   const fx1 = S.buildSingle();   // 같은 프리셋, 화자 없는 14줄 (v27 단일 화자 목록)
 */
const { createSim, FT, TPS, aeText, color } = require("../../lib/premiereSim");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/mcp_e2e.prproj";
const SEQ = { seqId: "seq-mcp-1", seqName: "T_MCP", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const SALT = "mc5e";
const RULE = "포인트 텍스트는 $$로 구분하며 최대 3개까지 입력 가능합니다.";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips", "setMotion"];

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}

// 줄 캡션: C1은 '날씨·맑음', C2는 '바다·이야기'가 들어 있다 (포인트 텍스트 제안 시험)
const captionOf = (spk, k) => (spk === "C1" ? "오늘 날씨 " + k + "번 하늘 맑음" : "영희의 바다 " + k + "번째 이야기");

function build() {
	const sim = createSim();
	const seq = sim.addSequence({ name: SEQ.seqName, id: SEQ.seqId, ft: F, tracks: 6 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294967295)] });
	const probe = sim.place(seq, 0, MOGRT, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	params.push({ index: 3, displayName: "포인트 텍스트 구분 방법", type: "comment", rawValue: RULE, value: RULE, group: "" });
	const preset = { id: "preset_3", name: "합성 자막", mogrtPath: MOGRT, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	const subtitles = [];
	const rowStates = {};
	let id = 1;
	for (let k = 1; k <= 12; k++) {
		for (const spk of ["C1", "C2"]) {
			const sf = 100 + (k - 1) * 150 + (spk === "C2" ? 80 : 0);
			const ef = sf + (spk === "C2" ? 50 : 60);
			const text = captionOf(spk, k);
			subtitles.push({ index: k, startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id, spk, srtNo: k });
			const all = JSON.parse(JSON.stringify(params));
			CORE.setTextValue(all[0], text);
			rowStates[id] = { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
			id++;
		}
	}
	const session = {
		subtitles, rowStates, trashBin: [], nextId: id,
		mi: { v: 1, salt: SALT, hwm: id - 1, legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0 }, C2: { name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1 } },
			stack: false, stackDy: 0.12, applied: {} }
	};
	return { sim, seq, preset, session, SEQ, PROJ, SALT, MOGRT, RULE, HOST_FNS, captionOf };
}

/** 화자 없는 목록 (v27 단일 화자: C 번호 없는 SRT 하나, 화자 표·salt 없음) n줄 → uid는 줄 id 숫자 ('12'), 캡션은 C1과 같다 */
function buildSingle(n = 14) {
	const fx = build();
	const subtitles = [];
	const rowStates = {};
	for (let k = 1; k <= n; k++) {
		const sf = 100 + (k - 1) * 150;
		const text = captionOf("C1", k);
		subtitles.push({ index: k, startTime: tc(sec(sf)), endTime: tc(sec(sf + 60)), startSec: sec(sf), endSec: sec(sf + 60), text, id: k });
		const all = JSON.parse(JSON.stringify(fx.preset.params));
		CORE.setTextValue(all[0], text);
		rowStates[k] = { presetId: fx.preset.id, params: all.filter((p) => fx.preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	}
	return Object.assign(fx, { session: { subtitles, rowStates, trashBin: [], nextId: n + 1 } });
}

module.exports = { build, buildSingle, SEQ, PROJ, SALT, RULE, captionOf, HOST_FNS };
