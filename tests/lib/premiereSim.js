"use strict";
/**
 * 가짜 Premiere(ExtendScript DOM)에서 hostscript.jsx 전체를 node:vm으로 돌린다 (v28 MI_ 호스트 단위 테스트, S2-1/S2-2).
 * Premiere 없이 호스트 로직(가드, 스캔, 배치 순서, 범위 확인, 이웃 복원, 되읽기)을 확인하는 용도다.
 * Premiere에서의 실제 동작은 하드 케이스(tests/premiere/cases/s2_*.case.js)가 확인한다.
 *
 *   const sim = createSim();
 *   const seq = sim.addSequence({ name: "T_A", id: "seq-A", ft: FT.f23976, tracks: 4 });
 *   sim.addTemplate("C:/m/a.mogrt", { kind: "ae", name: "a", params: [aeText("텍스트", "기본"), num("크기", 50)] });
 *   const c = sim.place(seq, 2, "C:/m/a.mogrt", 100, 150, "철수 [MI:ab12-1.1]");   // 테스트가 직접 놓는 클립 (모델)
 *   sim.call("MI_ping")          // 호스트 함수 호출 → 파싱한 JSON (payload가 있으면 JSON 문자열 하나로 넘긴다)
 *
 * 흉내 내는 실측 (docs/spike_s0.md, docs/spike_s0_premiere2651.md):
 *   - importMGT·overwriteClip은 [S, S+D)를 덮어쓴다: 앞 클립은 끝이 잘리고, 통째로 덮인 클립은 지워지고,
 *     뒤 클립은 머리가 잘린다(start와 inPoint가 같이 밀린다, S0-3 b). 가운데가 덮이면 둘로 나뉜다.
 *   - 시작은 가장 가까운 프레임으로 맞춘다 (S0-3 q). 끝은 스냅하지 않는다 (p). D는 템플릿 길이(초)를 프레임으로 반올림 (c).
 *   - importMGT의 트랙 번호 ≥ 트랙 수면 마지막 트랙에 놓는다 (#14). 템플릿이 없는 경로는 null.
 *   - nodeId는 처음 읽을 때 발급한다 (S0-3 §3 7). 자르기(razor)는 뒤 조각에 새 nodeId, 이름은 같다 (#1b).
 *   - start·inPoint·end 대입은 그 값만 바꾼다 (S0-3 b). move(Δ)는 상대 이동, 겹침 검사 없음, 순서를 다시 매기지 않는다 (r).
 *   - remove(false,false)는 true, 두 번째는 false. 지운 클립 참조는 계속 읽힌다 (#6).
 *   - 키가 있는 속성(isTimeVarying)의 setValue·setColorValue는 무시된다 (#8, S0-3 g).
 *   - 네이티브: getMGTComponent() null, projectItem null, 이름 "Graphic", Source Text 초깃값은 한 글자 (#23, S0-3 w).
 *   - 같은 템플릿의 projectItem은 공유된다 (#7). overwriteClip(pi)은 템플릿의 oldParams(옛 구조)를 놓을 수 있다 (S0-3 x ③).
 *   - JSON은 hostscript의 ES3 폴리필을 쓴다 (vm의 JSON을 지운다 — Premiere ExtendScript에는 JSON이 없다).
 *   - QE: app.enableQE() 뒤 qe.project.getActiveSequence().addTracks(n, after, 0)은 비디오 트랙 n개를 끝에 더한다 (#3).
 * 호스트가 넘기는 래퍼 객체는 접근할 때마다 새로 만든다 (Premiere처럼 같은 클립이라도 === 로 같지 않다).
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HOST_JSX = path.resolve(__dirname, "..", "..", "extension", "jsx", "hostscript.jsx");
const TPS = 254016000000;
const FT = { f23976: 10594584000, f2997: 8475667200, f25: 10160640000, f5994: 4237833600 };
const IN_POINT = 3600 * TPS; // AE·네이티브 MOGRT 클립의 inPoint (S0-3 §3 12)

// ── 템플릿 속성 도우미 (테스트가 쓴다) ──
function aeTextValue(text) {
	return JSON.stringify({ capPropFontEdit: false, fontEditValue: ["Pretendard"], fontSizeEditValue: [60], fontTextRunLength: [String(text).length], textEditValue: String(text) });
}
const aeText = (displayName, text) => ({ displayName, value: aeTextValue(text) });
const num = (displayName, v) => ({ displayName, value: v });
const color = (displayName, argb) => ({ displayName, value: argb });
const bool = (displayName, v) => ({ displayName, value: !!v });
const point = (displayName, x, y) => ({ displayName, value: [x, y] });

class Time {
	constructor() { this._t = 0; }
	get ticks() { return String(this._t); }
	set ticks(v) { this._t = Math.round(Number(v)); }
	get seconds() { return this._t / TPS; }
	set seconds(v) { this._t = Math.round(Number(v) * TPS); }
}
function ticksOf(t) {
	if (t && typeof t === "object" && "_t" in t) return t._t;
	if (typeof t === "string") return Math.round(Number(t));
	if (typeof t === "number") return Math.round(t * TPS);
	throw new Error("시간 값이 아니다: " + t);
}
function T(ticks) {
	const t = new Time();
	t._t = ticks;
	return t;
}
function coll(arr, countKey) {
	const o = {};
	o[countKey || "numItems"] = arr.length;
	arr.forEach((x, i) => { o[i] = x; });
	return o;
}
const clone = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);

function createSim(opts = {}) {
	const S = {
		seqs: [],
		active: null,
		templates: {},
		pis: {},
		nodeNext: 0xf4246,
		docId: opts.docId || "doc-sim-1",
		misplaceNext: false,
		overwriteFails: false,
		counts: { importMGT: 0, overwriteClip: 0, setValue: 0, nativeTextWrites: 0, addTracks: 0 }
	};

	// ── 모델 ──
	function nodeIdOf(m) {
		if (!m.nodeId) m.nodeId = ("00000000" + (S.nodeNext++).toString(16)).slice(-8);
		return m.nodeId;
	}
	function param(p) {
		return { displayName: p.displayName, value: clone(p.value), keyed: !!p.keyed, numItems: p.numItems || 0, min: p.min, max: p.max };
	}
	function comp(matchName, displayName, props) {
		return { matchName, displayName, props };
	}
	function newClipM(sm, tr, tpl, s, e, useOld) {
		const m = { seq: sm, track: tr, s, e, inT: IN_POINT, nodeId: null, tpl, kind: tpl.kind, removed: false, name: "", comps: [], pi: null };
		const base = [comp("AE.ADBE Opacity", "Opacity", [param({ displayName: "Opacity", value: 100 })]), comp("AE.ADBE Motion", "Motion", [param({ displayName: "Position", value: [0.5, 0.5] }), param({ displayName: "Scale", value: 100 })])];
		if (tpl.kind === "ae") {
			const list = useOld && tpl.oldParams ? tpl.oldParams : tpl.params;
			m.comps = base.concat([comp("AE.ADBE Capsule", "Graphic Parameters", list.map(param))]);
			if (!S.pis[tpl.path]) S.pis[tpl.path] = { name: tpl.name, nodeId: ("00000000" + (S.nodeNext++).toString(16)).slice(-8), tpl };
			m.pi = S.pis[tpl.path];
			m.name = tpl.name;
		} else {
			const texts = [];
			for (let k = 0; k < (tpl.texts || 1); k++) {
				texts.push(comp("AE.ADBE Text", "Text", [param({ displayName: "Source Text", value: String.fromCharCode(0x188 + k) }), param({ displayName: "Transform", value: 0 })]));
			}
			m.comps = base.concat([comp("AE.ADBE Vector Motion", "Vector Motion", [])], texts, [comp("AE.ADBE Shape", "Shape", [])]);
			m.name = "Graphic";
		}
		return m;
	}
	function cloneClipM(c) {
		return Object.assign({}, c, { nodeId: null, comps: c.comps.map((cp) => comp(cp.matchName, cp.displayName, cp.props.map((p) => Object.assign({}, p, { value: clone(p.value) })))) });
	}
	function insertSorted(tr, m) {
		let i = 0;
		while (i < tr.clips.length && tr.clips[i].s <= m.s) i++;
		tr.clips.splice(i, 0, m);
		m.track = tr;
	}
	function removeClipM(m) {
		const i = m.track.clips.indexOf(m);
		if (i !== -1) m.track.clips.splice(i, 1);
		m.removed = true;
	}
	// [S, E)를 덮어쓴다 (새 클립을 넣기 전)
	function overwrite(tr, Sx, Ex) {
		for (const c of tr.clips.slice()) {
			if (c.e <= Sx || c.s >= Ex) continue;
			if (c.s >= Sx && c.e <= Ex) { removeClipM(c); continue; }
			if (c.s < Sx && c.e > Ex) {
				const tail = cloneClipM(c);
				tail.s = Ex;
				tail.inT = c.inT + (Ex - c.s);
				c.e = Sx;
				insertSorted(tr, tail);
				continue;
			}
			if (c.s < Sx) { c.e = Sx; continue; }
			c.inT += Ex - c.s;
			c.s = Ex;
		}
	}
	function durTicks(sm, tpl) {
		return Math.round(((tpl.durSec || 5.005) * TPS) / sm.ft) * sm.ft;
	}
	function doPlace(sm, ti, tpl, startT, useOld) {
		const tr = sm.tracks[ti];
		const s = Math.round(startT / sm.ft) * sm.ft;
		const e = s + durTicks(sm, tpl);
		overwrite(tr, s, e);
		const m = newClipM(sm, tr, tpl, s, e, useOld);
		insertSorted(tr, m);
		return m;
	}

	// ── 래퍼 ──
	function wrapParam(p, m) {
		const w = {
			displayName: p.displayName,
			numItems: p.numItems,
			getValue: () => clone(p.value),
			setValue: (v) => {
				S.counts.setValue++;
				if (m && m.kind === "native" && p.displayName === "Source Text") S.counts.nativeTextWrites++;
				if (p.keyed) return true;
				p.value = clone(v);
				return true;
			},
			setColorValue: (a, r, g, b) => {
				S.counts.setValue++;
				if (p.keyed) return true;
				p.value = ((a * 256 + r) * 256 + g) * 256 + b;
				return true;
			},
			isTimeVarying: () => p.keyed,
			setTimeVarying: (b) => { p.keyed = !!b; return true; },
			areKeyframesSupported: () => true,
			getMinValue: () => (p.min === undefined ? NaN : p.min),
			getMaxValue: () => (p.max === undefined ? NaN : p.max)
		};
		return w;
	}
	function wrapComp(c, m) {
		return { matchName: c.matchName, displayName: c.displayName, properties: coll(c.props.map((p) => wrapParam(p, m))) };
	}
	function wrapPI(pim) {
		const w = { name: pim.name, nodeId: pim.nodeId, type: 1 };
		Object.defineProperty(w, "__pim", { value: pim, enumerable: false });
		return w;
	}
	function wrapClip(m) {
		const w = { mediaType: "Video" };
		Object.defineProperties(w, {
			name: { get: () => m.name, set: (v) => { if (!m.removed) m.name = String(v); }, enumerable: true },
			nodeId: { get: () => nodeIdOf(m), enumerable: true },
			start: { get: () => T(m.s), set: (t) => { if (!m.removed) m.s = ticksOf(t); } },
			end: { get: () => T(m.e), set: (t) => { if (!m.removed) m.e = ticksOf(t); } },
			inPoint: { get: () => T(m.inT), set: (t) => { if (!m.removed) m.inT = ticksOf(t); } },
			projectItem: { get: () => (m.pi ? wrapPI(m.pi) : null) },
			components: { get: () => coll(m.comps.map((c) => wrapComp(c, m))) }
		});
		w.getMGTComponent = () => {
			const c = m.comps.find((x) => x.matchName === "AE.ADBE Capsule");
			return c ? wrapComp(c, m) : null;
		};
		w.move = (t) => {
			if (!m.removed) {
				const d = ticksOf(t);
				m.s += d;
				m.e += d;
			}
			return null;
		};
		w.remove = () => {
			if (m.removed) return false;
			removeClipM(m);
			return true;
		};
		Object.defineProperty(w, "__m", { value: m, enumerable: false });
		return w;
	}
	function wrapTrack(tr, i) {
		return {
			id: i,
			name: "Video " + (i + 1),
			isLocked: () => !!tr.locked,
			setLocked: (b) => { tr.locked = !!b; return true; },
			get clips() { return coll(tr.clips.map(wrapClip)); }
		};
	}
	function seqEnd(sm) {
		let e = 0;
		sm.tracks.forEach((tr) => tr.clips.forEach((c) => { if (c.e > e) e = c.e; }));
		return e;
	}
	function wrapSeq(sm) {
		const w = {};
		Object.defineProperties(w, {
			name: { get: () => sm.name, set: (v) => { sm.name = String(v); }, enumerable: true },
			sequenceID: { get: () => sm.id, enumerable: true },
			zeroPoint: { get: () => String(sm.zeroPoint || 0) },
			end: { get: () => String(seqEnd(sm)) },
			timebase: { get: () => String(sm.ft) },
			videoTracks: { get: () => coll(sm.tracks.map(wrapTrack), "numTracks") },
			audioTracks: { get: () => coll([], "numTracks") }
		});
		w.getSettings = () => ({ videoFrameRate: { ticks: String(sm.ft), seconds: sm.ft / TPS }, videoDisplayFormat: 110 });
		w.importMGT = (p, ticksStr, vIdx) => {
			S.counts.importMGT++;
			const tpl = S.templates[p];
			if (!tpl) return null;
			let ti = Number(vIdx);
			if (ti >= sm.tracks.length) ti = sm.tracks.length - 1;
			if (S.misplaceNext) {
				S.misplaceNext = false;
				ti = (ti + 1) % sm.tracks.length;
			}
			return wrapClip(doPlace(sm, ti, tpl, Number(ticksStr), false));
		};
		w.overwriteClip = (piW, time, vIdx) => {
			S.counts.overwriteClip++;
			if (S.overwriteFails) return false;
			const pim = piW && piW.__pim;
			if (!pim) return false;
			let ti = Number(vIdx);
			if (ti >= sm.tracks.length) ti = sm.tracks.length - 1;
			doPlace(sm, ti, pim.tpl, ticksOf(time), true);
			return true;
		};
		return w;
	}

	// ── 전역 ──
	const project = {};
	Object.defineProperties(project, {
		activeSequence: { get: () => (S.active ? wrapSeq(S.active) : null), set: (w) => { S.active = S.seqs.find((x) => x.id === (w && w.sequenceID)) || null; } },
		sequences: { get: () => coll(S.seqs.map(wrapSeq), "numSequences") },
		documentID: { get: () => S.docId },
		path: { get: () => "C:/sim/MI_test.prproj" }
	});
	const qeObj = {
		project: {
			getActiveSequence: () => ({
				addTracks: (nv) => {
					S.counts.addTracks++;
					if (!S.active) throw new Error("no active sequence");
					for (let k = 0; k < Number(nv); k++) S.active.tracks.push({ clips: [], locked: false });
					return true;
				},
				getVideoTrackAt: (i) => ({ razor: () => { throw new Error("sim: razor는 sim.razor로"); } })
			})
		}
	};
	const ctx = vm.createContext({
		console,
		Time,
		$: { getenv: () => "" },
		File: function File() {},
		Folder: function Folder() {},
		app: {
			project,
			enableQE: () => { ctx.qe = qeObj; return true; }
		}
	});
	vm.runInContext("delete this.JSON;", ctx);
	const src = fs.readFileSync(opts.hostFile || HOST_JSX, "utf8");
	vm.runInContext(src, ctx, { filename: "hostscript.jsx" });

	const api = {
		S,
		ctx,
		FT,
		TPS,
		addSequence(o) {
			const sm = { name: o.name || "T_sim", id: o.id || "seq-" + (S.seqs.length + 1), ft: o.ft || FT.f23976, zeroPoint: o.zeroPoint || 0, tracks: [] };
			for (let k = 0; k < (o.tracks || 4); k++) sm.tracks.push({ clips: [], locked: false });
			S.seqs.push(sm);
			if (!S.active || o.active) S.active = sm;
			return sm;
		},
		setActive(sm) { S.active = sm; },
		addTemplate(p, tpl) {
			S.templates[p] = Object.assign({ path: p, kind: "ae", name: path.basename(p, ".mogrt"), durSec: 5.005, params: [] }, tpl);
			return S.templates[p];
		},
		// 테스트가 직접 놓는다 (importMGT와 같은 덮어쓰기) → 모델 클립. texts: AE 텍스트 속성 값을 순서대로 바꾼다
		place(sm, ti, p, sf, ef, name, o = {}) {
			const tpl = S.templates[p];
			if (!tpl) throw new Error("템플릿 없음: " + p);
			const m = doPlace(sm, ti, tpl, sf * sm.ft, !!o.old);
			if (ef !== undefined && ef !== null) m.e = ef * sm.ft;
			if (name) m.name = name;
			if (o.texts) {
				const cap = m.comps.find((x) => x.matchName === "AE.ADBE Capsule");
				let k = 0;
				cap.props.forEach((pp) => {
					if (typeof pp.value === "string" && pp.value.indexOf("\"textEditValue\"") !== -1 && k < o.texts.length) pp.value = aeTextValue(o.texts[k++]);
				});
			}
			return m;
		},
		// 영상 같은 다른 클립 (MOGRT 아님)
		placeOther(sm, ti, sf, ef, name) {
			const tr = sm.tracks[ti];
			const m = { seq: sm, track: tr, s: sf * sm.ft, e: ef * sm.ft, inT: 0, nodeId: null, tpl: null, kind: "other", removed: false, name: name || "clip.mp4", comps: [comp("AE.ADBE Opacity", "Opacity", [param({ displayName: "Opacity", value: 100 })]), comp("AE.ADBE Motion", "Motion", [param({ displayName: "Position", value: [0.5, 0.5] })])], pi: null };
			overwrite(tr, m.s, m.e);
			insertSorted(tr, m);
			return m;
		},
		clips(sm, ti) { return sm.tracks[ti].clips.slice(); },
		all(sm) { return sm.tracks.reduce((n, tr) => n + tr.clips.length, 0); },
		nodeId: nodeIdOf,
		frames(m) { return { sf: m.s / m.seq.ft, ef: m.e / m.seq.ft }; },
		capsule(m) { return m.comps.find((x) => x.matchName === "AE.ADBE Capsule"); },
		prop(m, name) {
			for (const c of m.comps) for (const p of c.props) if (p.displayName === name) return p;
			return null;
		},
		textOf(m, name) {
			const p = api.prop(m, name);
			return p ? JSON.parse(p.value).textEditValue : undefined;
		},
		// 자르기: 트랙 ti에서 frame을 지나는 클립을 둘로 (앞 조각이 원래 nodeId, 뒤 조각은 새 nodeId·같은 이름)
		razor(sm, ti, frame) {
			const t = frame * sm.ft;
			const tr = sm.tracks[ti];
			const c = tr.clips.find((x) => x.s < t && x.e > t);
			if (!c) throw new Error("자를 클립 없음");
			nodeIdOf(c);
			const tail = cloneClipM(c);
			tail.s = t;
			tail.inT = c.inT + (t - c.s);
			c.e = t;
			insertSorted(tr, tail);
			return tail;
		},
		addEffect(m, matchName = "AE.ADBE Tint", displayName = "Tint") {
			m.comps.push(comp(matchName, displayName, [param({ displayName: "Amount", value: 100 })]));
		},
		keyMotion(m) {
			const mot = m.comps.find((x) => x.matchName === "AE.ADBE Motion");
			mot.props[0].keyed = true;
		},
		// 호스트 함수 호출: payload가 있으면 패널 _callMi처럼 JSON(U+2028/2029 이스케이프) 문자열 하나로 넘긴다 → 파싱한 결과
		callRaw(fn, argSrc) {
			const out = vm.runInContext(fn + "(" + (argSrc === undefined ? "" : argSrc) + ")", ctx);
			return String(out);
		},
		call(fn, payload) {
			let arg;
			if (payload !== undefined) {
				const json = JSON.stringify(payload).replace(new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g"), (ch) => "\\u" + ch.charCodeAt(0).toString(16));
				arg = JSON.stringify(json);
			}
			const raw = api.callRaw(fn, arg);
			if (!raw || /^ERROR/.test(raw)) throw new Error(fn + " 응답이 비었거나 ERROR로 시작한다: " + raw);
			return JSON.parse(raw);
		}
	};
	return api;
}

module.exports = { createSim, FT, TPS, IN_POINT, aeText, aeTextValue, num, color, bool, point };
