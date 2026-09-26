"use strict";
/**
 * S3-4 (8) 하드: 시드한 실제 세션 열기 → 합성 다시 내보내기(C1·C2) 병합 → T_ 스크래치 시퀀스에 ▶ (DEV 패널 + DEV 호스트 MID_).
 * 준비: tools/install_dev.sh --seed-cache — 운영 캐시를 DEV 캐시로 복사한다 (운영은 읽기만). 시드한 세션이 없으면 로그만 남기고 건너뛴다.
 * 이 케이스는 DEV 캐시(사본)만 읽는다. 운영 캐시(CEP_MogrtImporter)는 열지 않는다.
 * 세션 고르기·작업 파일·C1/C2 나누기는 tests/premiere/lib/realSessions.js — node tests/compat/realcache.test.js 'S3-4 (8)'이
 * 같은 함수로 같은 작업 파일·같은 SRT를 패널에 넣어 분배까지 본다 (여기는 그 뒤, 타임라인에 놓는 부분).
 *   고르기: DEV 캐시의 다른 프로젝트 폴더(MI_test.prproj 자신의 폴더는 뺀다)에 presets.json이 있고 session.json이 비어 있지 않은
 *   화자 없는 목록. 세션마다 앞 MAX_ROWS줄까지.
 * 프로젝트마다 스크래치 A(T_scratch_s3_4_real, V2 이상 비움)에서:
 *   그 프로젝트의 presets.json을 MI_test의 DEV presets.json 자리에 두고 패널을 새로 고친다 (세션 줄의 프리셋 id·속성이 그대로 맞는다).
 *   A(빈 목록)에서만 바꾼다 — 원본 T_ 시퀀스의 줄이 다른 프로젝트의 프리셋을 만나 프리셋 연결이 끊기지 않게.
 *   세션마다 A의 복제본 B(T_scratch_s3_4_real_k)에서:
 *     작업 파일로 불러오기(다른 시퀀스 → id 새로, 줄마다 프리셋 그대로) → 번갈아 C1·C2 합성 SRT → 분배 창(split, 짝 없는 줄 없음) → [가져오기]
 *     → 줄마다 화자 (제 화자가 아닌 줄은 '확인 필요' 수까지) → ▶ (점검 창이 뜨면 [적용], 옛 구조 줄은 이름으로)
 *     → 상태에 실패·중단 없음, 다시 계획하면 보낼 작업 0개·충돌 0개 (건너뛴 줄은 까닭별로 세고, 프리셋 없음·길이 0·캡션 필드 없음만 허용)
 *     → 줄마다 클립 시작·끝 = 화자별 프레임(core speakerFrames: 같은 화자 겹침은 앞 줄 끝을 맞춤) ±1프레임, C1은 기본 트랙 V3,
 *        화자마다 트랙 하나(서로 다름), 같은 태그 중복·옛 gen·목록에 없는 우리 클립·같은 트랙 겹침 없음
 *   끝나면 presets.json·cast_defaults.json을 시작 전 바이트로 되돌리고 A에서 새로 고친다 (프리셋 id 목록이 시작 전과 같은지 본다).
 * 로그·실패 문구에는 수·id·키만 남긴다 (자막 문장·프리셋 이름을 찍지 않는다 — 실제 텍스트는 저장소·로그 밖).
 * 무겁다 (세션 줄 수만큼 importMGT, 2026-09 운영 캐시 기준 4세션 129줄). 메모리 경고 모달은 docs/TESTING.md §5.
 * 실행: npm run hard -- s3_4_real
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const RS = require("../lib/realSessions");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const LONG = 300000;
const BASE = 2; // V3 (작업 파일 trackValue "2")
const click = (id) => "document.getElementById(" + JSON.stringify(id) + ").click(), true";
const JSX_NUM_TRACKS = "(function(){var s=app.project.activeSequence;return String(s.videoTracks.numTracks);})()";
// 분배 창 (수만: 확인 필요 줄의 글은 자막 문장이라 읽지 않는다) → {mode, info, amb, rows} | null
const PAGE_LEGACY_MODAL = "(() => { const m = document.getElementById('importModal'); const lg = document.getElementById('impLegacy');" +
	" if (!m || !m.classList.contains('open') || !lg || lg.style.display === 'none') return null;" +
	" return { mode: (document.getElementById('impLegacyMode') || {}).value || '', info: (document.getElementById('impLegacyInfo') || {}).textContent || ''," +
	"  amb: document.querySelectorAll('#impAmbList .imp-amb').length, rows: document.querySelectorAll('#impBody tr.imp-row').length }; })()";
// 줄 상태의 체크를 모두 푼다 (▶는 rowStates의 checked를 보고 '선택된 n개만?'을 묻는다. 그려지지 않은 줄도 있어 DOM이 아니라 상태로 본다)
const PAGE_UNCHECK_STATE = "(() => { const on = () => Object.values(window._mogrtDebug.snapshot().rowStates).some((rs) => rs && rs.checked);" +
	" if (on()) document.getElementById('btnToggleSelect').click(); return !on(); })()";
// 다시 계획에서 건너뛰어도 되는 까닭 (실제 세션의 모양 때문): 프리셋 없는 줄, 같은 화자 다음 줄과 시작이 같은 줄, 캡션 필드 없는 줄
const SKIP_OK = { "no-preset": true, "zero-length": true, "no-caption-field": true, "no-params": true };

module.exports = {
	name: "S3-4 (8) 시드한 실제 세션 → 합성 C1·C2 병합 → T_ 스크래치에 ▶",
	run: async (api) => {
		const { panel, host, mi, assert, log, reload } = api;
		await H.waitKeys(panel);
		const root = await H.devCacheRoot(panel);
		const rootFs = root.replace(/\//g, path.sep);
		const snap0 = await panel(SNAP);
		const projKey = snap0.keys.proj;
		const list = RS.seededSessions(rootFs, { skipProj: [projKey] });
		if (!list.length) {
			log("시드한 실제 세션이 없다 — 건너뜀 (tools/install_dev.sh --seed-cache로 운영 캐시를 DEV 캐시에 복사한 뒤 돌린다)");
			return "건너뜀 (시드 없음)";
		}
		assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
		const ok = await panel("await window._mogrtDebug.miHostOk()");
		assert.equal(ok.ok, true, "v28 호스트·같은 빌드: " + JSON.stringify(ok));
		// 세션 줄이 쓰는 MOGRT가 이 PC에 있어야 놓을 수 있다 (없으면 환경 문제로 알린다. 경로는 찍지 않는다)
		list.forEach((s) => {
			const used = {};
			s.session.subtitles.forEach((x) => {
				const rs = (s.session.rowStates || {})[x.id];
				const p = rs && rs.presetId ? s.presets[rs.presetId] : null;
				if (p) used[rs.presetId] = p.mogrtPath;
			});
			const missing = Object.keys(used).filter((id) => !used[id] || !fs.existsSync(used[id]));
			assert.deepEqual(missing, [], s.proj + "/" + s.seq.slice(-8) + ": 줄이 쓰는 프리셋의 MOGRT 파일이 없다 (프리셋 id)");
		});
		const presetsPath = path.join(rootFs, projKey, "presets.json");
		const defPath = path.join(rootFs, projKey, "cast_defaults.json");
		const presetsBefore = fs.existsSync(presetsPath) ? fs.readFileSync(presetsPath) : null;
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		const idsBefore = Object.keys(snap0.presets).sort();
		let swapped = false;
		// 프로젝트 파일을 시작 전 바이트로 (없었으면 지운다). 예외는 삼키고 로그 → 되돌렸으면 true
		const restoreFiles = () => {
			let good = true;
			[[presetsPath, presetsBefore, "presets.json"], [defPath, defBefore, "cast_defaults.json"]].forEach(([p, bytes, what]) => {
				try {
					if (bytes) fs.writeFileSync(p, bytes);
					else if (fs.existsSync(p)) fs.unlinkSync(p);
				} catch (e) {
					good = false;
					log("경고: " + what + "을 되돌리지 못했다 — " + e.message);
				}
			});
			if (good) swapped = false;
			return good;
		};
		const byProj = {};
		list.forEach((s) => (byProj[s.proj] = byProj[s.proj] || []).push(s));
		log("시드한 세션 " + list.length + "개 (프로젝트 " + Object.keys(byProj).length + "개, 줄 " + list.reduce((a, s) => a + Math.min(s.session.subtitles.length, RS.MAX_ROWS), 0) + "개)");

		// ── 세션 하나 (스크래치 B, 빈 목록·V2 이상 빔) ──
		const runSession = async (s, k) => {
			const where = "세션 " + (k + 1) + " (" + s.proj + "/" + s.seq.slice(-8) + ")";
			const { work, rows: n, capped } = RS.workOf(s, RS.MAX_ROWS);
			assert.equal(await panel(H.pageSelectTrack(BASE)), String(BASE));
			await panel(H.PAGE_CLEAR_STATUS);
			assert.equal(await panel(H.pageLoadWork("s3_4_real.json", work)), "sent");
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === " + n + " && document.querySelectorAll('#listWrap .sub-row').length === " + n + "; })()",
				{ timeoutMs: 60000, what: where + ": 작업 불러오기 " + n + "줄" });
			let snap = await panel(SNAP);
			assert.equal(snap.mi.remapped, true, where + ": 다른 시퀀스의 작업 (id 새로)");
			const pidOf = (rs) => (rs && rs.presetId && s.presets[rs.presetId] ? rs.presetId : "");
			assert.deepEqual(snap.subtitles.map((x) => pidOf(snap.rowStates[x.id])), work.subtitles.map((x) => pidOf(work.rowStates[x.id])), where + ": 줄마다 프리셋 그대로 (프리셋 id)");
			const noPreset = snap.subtitles.filter((x) => !pidOf(snap.rowStates[x.id])).length;

			// 번갈아 C1·C2로 다시 내보낸 SRT (합성) → 분배
			const sp = RS.splitByTurn(snap.subtitles, CORE.normText);
			assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: H.srtOf(sp.cues.C1) }, { name: "C2.srt", content: H.srtOf(sp.cues.C2) }])), "sent");
			const lg = await H.waitFor(panel, PAGE_LEGACY_MODAL, { what: where + ": 분배 모드 창" });
			assert.equal(lg.mode, "split", where + ": 분배 모드 " + lg.mode);
			assert.equal(lg.rows, 2, where + ": 파일 2개");
			assert.ok(lg.info.indexOf("기존 목록 (화자 없음, " + n + "줄) → ") === 0, where + ": " + lg.info);
			assert.doesNotMatch(lg.info, /짝 없음/, where + ": 짝 없는 줄 없음 — " + lg.info);
			await panel(click("impOk"));
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === " + n + " && s.subtitles.every((x) => x.spk === 'C1' || x.spk === 'C2'); })()",
				{ what: where + ": 화자가 붙은 " + n + "줄" });
			snap = await panel(SNAP);
			const wrong = snap.subtitles.filter((x) => x.spk !== sp.keyOf[x.id]).length;
			assert.ok(wrong <= lg.amb, where + ": 제 화자가 아닌 줄 " + wrong + "개 (확인 필요 " + lg.amb + "개까지)");
			assert.equal(snap.mi.legacyTrack, BASE, where + ": 옛 클립 트랙 = 기본 트랙");
			const perK = { C1: 0, C2: 0 };
			snap.subtitles.forEach((x) => perK[x.spk]++);

			// ▶ (실제 세션의 줄 상태에 체크가 남아 있을 수 있다 → 전체를 적용하게 체크를 푼다)
			assert.equal(await panel(PAGE_UNCHECK_STATE), true, where + ": 체크 풀기");
			let pfLines = null;
			const ra = await H.miApplyButton(api, async (pf) => { pfLines = pf.lines; }, { timeoutMs: LONG });
			assert.doesNotMatch(ra.status.text, /실패|중단|중지/, where + ": " + ra.status.text);
			// 다시 계획: 보낼 작업 0개, 충돌 0개. 건너뛴 줄은 까닭별로
			const pl = await panel(H.pageCmd("plan", {}));
			assert.equal(pl.ok, true, where + ": " + JSON.stringify(pl).slice(0, 300));
			assert.deepEqual([Object.keys(pl.data.plan.ops), pl.data.plan.conflicts.length], [[], 0], where + ": 다시 계획하면 0개 — " + JSON.stringify(pl.data.plan.ops) + ", 충돌 " + pl.data.plan.conflicts.length);
			const skipped = {};
			const why = {};
			pl.data.plan.skipped.forEach((x) => {
				skipped[x.id] = x.why;
				why[x.why] = (why[x.why] || 0) + 1;
			});
			assert.deepEqual(Object.keys(why).filter((w) => !SKIP_OK[w]), [], where + ": 건너뛴 까닭 " + JSON.stringify(why));
			assert.equal(why["no-preset"] || 0, noPreset, where + ": 프리셋 없는 줄만 no-preset");

			// 타임라인: 줄마다 화자별 프레임 ±1, 화자마다 트랙 하나
			const s1 = await panel(SNAP);
			const salt = s1.mi.salt;
			const p = await mi("ping");
			const scan = await mi("getTracks", { seqId: p.seqId, build: p.build, tracks: null });
			assert.equal(scan.ok, true, where + ": " + JSON.stringify(scan).slice(0, 300));
			const ft = Number(scan.frameTicks);
			const idx = CORE.scanIndex(scan, salt);
			assert.equal(idx.stale.length, 0, where + ": 옛 gen 없음");
			assert.deepEqual(Object.keys(idx.dup), [], where + ": 같은 태그 중복 없음");
			const live = {};
			s1.subtitles.forEach((x) => { live[salt + "-" + x.id] = true; });
			assert.deepEqual(Object.keys(idx.own).filter((u) => !live[u]), [], where + ": 목록에 없는 우리 클립 없음");
			const want = CORE.speakerFrames(s1.subtitles, ft);
			const bad = [];
			const tracksOf = {};
			let placed = 0;
			let clampedN = 0;
			s1.subtitles.forEach((x) => {
				const c = idx.current[salt + "-" + x.id];
				if (skipped[x.id]) {
					if (c) bad.push(x.spk + " 줄 " + x.id + " 건너뛴 줄(" + skipped[x.id] + ")에 클립");
					return;
				}
				if (!c) {
					bad.push(x.spk + " 줄 " + x.id + " 클립 없음");
					return;
				}
				const w = want[x.id];
				if (w.clamped) clampedN++;
				if (Math.abs(c.sf - w.sf) > 1 || Math.abs(c.ef - w.ef) > 1) bad.push(x.spk + " 줄 " + x.id + " " + c.sf + "~" + c.ef + " / 줄 " + w.sf + "~" + w.ef);
				const t = (tracksOf[x.spk] = tracksOf[x.spk] || []);
				if (t.indexOf(c.track) === -1) t.push(c.track);
				placed++;
			});
			assert.deepEqual(bad, [], where + ": 줄마다 클립 시작·끝 = 화자별 프레임 ±1 (잘린 클립 없음)");
			assert.ok(placed > 0, where + ": 놓은 줄이 있다");
			assert.deepEqual(tracksOf.C1 || [BASE], [BASE], where + ": C1은 기본 트랙 V" + (BASE + 1) + " " + JSON.stringify(tracksOf));
			assert.ok(!tracksOf.C2 || (tracksOf.C2.length === 1 && tracksOf.C2[0] !== BASE), where + ": C2는 자기 트랙 하나 " + JSON.stringify(tracksOf));
			scan.tracks.forEach((t) => {
				const c = t.clips.slice().sort((a, b) => a.sf - b.sf);
				for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].ef <= c[i].sf, where + ": V" + (t.i + 1) + " 겹침 " + c[i - 1].name + " / " + c[i].name);
			});
			log(where + ": " + n + "줄" + (capped ? " (앞 " + RS.MAX_ROWS + "줄만)" : "") + " → C1 " + perK.C1 + " · C2 " + perK.C2 + " (확인 필요 " + lg.amb + ", 제 화자가 아닌 줄 " + wrong + ")" +
				(pfLines ? " · 점검 창: " + pfLines.join(" | ") : " · 점검 창 없음") + " · " + ra.status.text + " (" + ra.ms + "ms)" +
				" · 놓은 줄 " + placed + "개 ±1프레임 (C1 V" + (BASE + 1) + (tracksOf.C2 ? " · C2 V" + (tracksOf.C2[0] + 1) : "") + ", 끝을 맞춘 줄 " + clampedN + ")" +
				" · 건너뜀 " + JSON.stringify(why) + " · 다시 계획 0개");
			return placed;
		};

		let total = 0;
		try {
			for (const proj of Object.keys(byProj)) {
				const group = byProj[proj];
				await H.withScratchSequence(api, "s3_4_real", async () => {
					// V2 이상 비움 (세션마다 만드는 복제본 B가 물려받는다)
					const nt = Number(await host(JSX_NUM_TRACKS));
					for (let i = 1; i < nt; i++) assert.match(String(await host(H.jsxClearVideoTrack(i))), /^0$/, "V" + (i + 1) + " 비우기");
					try {
						// 이 프로젝트의 프리셋을 MI_test 자리에 (A는 빈 목록이라 끊길 줄이 없다) → 새로 고침
						fs.writeFileSync(presetsPath, group[0].presetsText, "utf8");
						swapped = true;
						await H.reloadClean(reload, assert, log);
						await H.waitKeys(panel);
						const want = Object.keys(group[0].presets).sort();
						await H.waitFor(panel, "(() => { const k = Object.keys(" + SNAP + ".presets).sort(); return JSON.stringify(k) === " + JSON.stringify(JSON.stringify(want)) + "; })()",
							{ what: proj + " 프리셋 " + want.length + "개 로드" });
						assert.equal(await panel(H.pageSetMiCast(null)), true);
						log(proj + ": 프리셋 " + want.length + "개를 이 프로젝트 자리에 두고 새로 고침");
						for (let k = 0; k < group.length; k++) {
							total += await H.withScratchSequence(api, "s3_4_real_" + (k + 1), async () => runSession(group[k], k));
						}
					} finally {
						// A(빈 목록)에서 되돌리고 새로 고친다 → 원본 T_ 시퀀스로 돌아갈 때 패널은 시작 전 프리셋을 쓴다
						restoreFiles();
						try {
							await reload();
							await H.waitKeys(panel);
						} catch (e) {
							log("경고: 되돌린 뒤 새로 고침 실패 — " + e.message);
						}
					}
				});
				const idsAfter = Object.keys((await panel(SNAP)).presets).sort();
				assert.deepEqual(idsAfter, idsBefore, "프리셋 id 목록이 시작 전과 같다");
			}
		} finally {
			// 파일이 아직 바뀐 채면(되돌리기 실패) 한 번 더 되돌리고 새로 고친다
			if (swapped && restoreFiles()) {
				try {
					await reload();
					await H.waitKeys(panel);
				} catch (e) {
					log("경고: 새로 고침 실패 — " + e.message);
				}
			}
			// cast_defaults.json은 분배 가져오기가 쓴다 → 늘 시작 전으로
			restoreFiles();
			try {
				await panel(H.pageSetMiCast(null));
			} catch (e) {
				log("경고: 다화자 기본값 되돌리기 실패 — " + e.message);
			}
			log("presets.json·cast_defaults.json 되돌림 (DEV 캐시, 시작 전 바이트)");
		}
		return "실제 세션 " + list.length + "개 · 놓은 줄 " + total + "개";
	}
};
