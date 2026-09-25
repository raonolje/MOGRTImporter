"use strict";
/**
 * S3-2 하드: AI 제안 대기열 (DEV 패널, MI_test.prproj의 T_ 시퀀스 스크래치 사본). 타임라인은 바꾸지 않는다
 * (레거시 ▶의 applyToTimeline은 페이지에서 가로채 페이로드만 받고 호스트로 보내지 않는다).
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다.
 *   (1) 단일 화자 목록: 제안(agent suggest) 전과 뒤의 _allParams와 ▶ 페이로드(applyToTimeline 인자)가 바이트까지 같다
 *   (2) 2화자 목록: 속성창 .sugg-box 'AI 제안 (Codex): 날씨$$하늘 — ✓ 본문에 있음' [적용] → T2 값, 안전 지점 'AI 제안 적용 전',
 *       줄 변경 표시(mm text, .sub-mm.mm-text), 행 머리 'AI'가 사라진다
 *   (3) 캡션을 바꾸는 병합(mergeCommit)은 그 줄의 대기 중인 제안을 지우고, 시간만 바뀐 줄의 제안은 둔다
 * 실행: npm run hard -- s3_2
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");

const SNAP = "window._mogrtDebug.snapshot()";
const pageCmdAs = (source, op, args) => "await window._mogrtDebug.cmdAs(" + JSON.stringify(source) + ", " + JSON.stringify(op) + ", " + JSON.stringify(args || {}) + ")";
const pageImportPresets = (presetId) => "(() => { document.querySelectorAll('#impBody tr.imp-row').forEach((r) => { const p = r.querySelector('.imp-preset'); p.value = " + JSON.stringify(presetId) + "; p.dispatchEvent(new Event('change')); }); return true; })()";
// applyToTimeline을 가로챈다 (페이로드 글자를 window.__applyPayloads에, 호스트로는 보내지 않고 SUCCESS로 답한다) / 되돌린다
const PAGE_TRAP_APPLY = "(() => { window.__applyPayloads = []; if (!window.__applyTrapOrig) { const orig = CSInterface.prototype.evalScript; window.__applyTrapOrig = orig;" +
	" CSInterface.prototype.evalScript = function (script, cb) { const s = String(script); if (/^\\s*applyToTimeline\\(/.test(s)) { window.__applyPayloads.push(s); if (cb) setTimeout(() => cb('SUCCESS: 0개 배치 (하드 테스트 가로챔)'), 0); return; } return orig.call(this, script, cb); }; }" +
	" return true; })()";
const PAGE_UNTRAP_APPLY = "(() => { if (window.__applyTrapOrig) { CSInterface.prototype.evalScript = window.__applyTrapOrig; delete window.__applyTrapOrig; } return true; })()";
const pageBoxes = (id) => "Array.from(document.querySelectorAll('#params-" + Number(id) + " .sugg-box')).map((b) => ({ fid: b.dataset.fid, text: b.querySelector('.sugg-text').textContent, cls: b.className, ok: !b.querySelector('.sugg-ok').disabled }))";
const pageBoxClick = (id, fid, cls) => "(() => { const b = Array.from(document.querySelectorAll('#params-" + Number(id) + " .sugg-box')).find((x) => x.dataset.fid === " + JSON.stringify(fid) + "); if (!b) return false; b.querySelector(" + JSON.stringify(cls) + ").click(); return true; })()";

module.exports = {
	name: "S3-2 AI 제안 대기열 (페이로드 그대로·[적용]·병합이 제안을 지움)",
	run: async (api) => {
		const { panel, assert, log } = api;
		await H.waitKeys(panel);
		assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
		const root = await H.devCacheRoot(panel);
		const snap0 = await panel(SNAP);
		const defPath = path.join(root.replace(/\//g, path.sep), snap0.keys.proj, "cast_defaults.json");
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		const pick = (list) => list.filter((p) => !p.native && p.captionFid && p.fields.some((f) => !f.caption)).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let P = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!P) {
			await H.ensurePreset(api, { prefer: /라온올제/ });
			P = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(P, "캡션 필드와 다른 텍스트 필드가 있는 AE 프리셋이 필요하다");
		const other = P.fields.find((f) => !f.caption);
		log("프리셋 " + P.id + " " + P.name + ", 제안 필드 " + other.fid + " " + other.label);
		const rowsOf = async () => (await panel(H.pageCmd("rows", {}))).data.rows;
		try {
			// ═══ (1) 단일 화자: 제안 전후의 ▶ 페이로드 ═══
			await H.withScratchSequence(api, "s3_2a", async () => {
				const ids = await H.loadRowsWithPreset(api, "S32 단일.srt", [[1, 2.5, "S32 오늘 날씨가 좋고 하늘이 맑다"], [4, 5.5, "S32 둘째 줄 문장"]], P.id);
				assert.equal(await panel(H.PAGE_UNCHECK_ALL), true);
				await panel(PAGE_TRAP_APPLY);
				try {
					await panel(H.PAGE_CLEAR_STATUS);
					await panel("document.getElementById('btnApply').click(), true");
					await H.waitFor(panel, "window.__applyPayloads.length === 1", { what: "첫 ▶ 페이로드" });
					const all0 = JSON.stringify((await panel(SNAP)).rowStates[ids[0]]._allParams);
					const rows = await rowsOf();
					const r = await panel(pageCmdAs("agent", "suggest", { items: [{ uid: rows[0].uid, fid: other.fid, value: "날씨$$하늘", sig: rows[0].sig, by: "codex" }, { uid: rows[1].uid, fid: other.fid, value: "문장", sig: rows[1].sig, by: "codex" }] }));
					assert.equal(r.ok, true, JSON.stringify(r));
					assert.equal(JSON.stringify((await panel(SNAP)).rowStates[ids[0]]._allParams), all0, "_allParams 그대로");
					await panel("document.getElementById('btnApply').click(), true");
					await H.waitFor(panel, "window.__applyPayloads.length === 2", { what: "둘째 ▶ 페이로드" });
					const pl = await panel("window.__applyPayloads.slice()");
					assert.equal(pl[1], pl[0], "제안은 ▶ 페이로드에 실리지 않는다");
					const json = decodeURIComponent(/decodeURIComponent\("([^"]*)"\)/.exec(pl[1])[1]);
					assert.equal(JSON.parse(json).subtitles.length, 2);
					assert.equal(json.indexOf("날씨$$하늘"), -1);
					assert.equal(json.indexOf("sugg"), -1);
					log("(1) 제안 전후 _allParams·▶ 페이로드(" + pl[0].length + "자) 같음");
				} finally {
					await panel(PAGE_UNTRAP_APPLY);
				}
			});

			// ═══ (2)(3) 2화자: [적용]과 병합 ═══
			await H.withScratchSequence(api, "s3_2b", async () => {
				const c1 = [[1, 2.5, "S32 오늘 날씨가 좋고 하늘이 맑다"], [4, 5.5, "S32 내일은 비가 온다고 한다"], [7, 8.5, "S32 셋째 줄은 그대로"]];
				const c2 = [[2, 3, "S32 영희 첫 말"], [5, 6, "S32 영희 둘째 말"]];
				assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: H.srtOf(c1) }, { name: "C2.srt", content: H.srtOf(c2) }])), "sent");
				await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 2 ? m : null; })()", { what: "가져오기 창" });
				await panel(pageImportPresets(P.id));
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 5", { what: "5줄" });
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });
				const rows = await rowsOf();
				const c1rows = rows.filter((x) => x.spk === "C1");
				const [a, b] = c1rows;
				let r = await panel(pageCmdAs("agent", "suggest", { items: [
					{ uid: a.uid, fid: other.fid, value: "날씨$$하늘", sig: a.sig, by: "codex" },
					{ uid: b.uid, fid: other.fid, value: "비", sig: b.sig, by: "codex" },
					{ uid: c1rows[2].uid, fid: other.fid, value: "셋째", sig: c1rows[2].sig, by: "codex" }] }));
				assert.equal(r.ok, true, JSON.stringify(r));
				await H.waitFor(panel, pageBoxes(a.id) + ".length === 1", { timeoutMs: 30000, what: "제안 칸 (" + other.fid + " 아래 또는 속성창 맨 위)" });
				const box = (await panel(pageBoxes(a.id)))[0];
				assert.deepEqual([box.fid, box.text, box.ok], [other.fid, "AI 제안 (Codex): 날씨$$하늘 — ✓ 본문에 있음", true]);
				assert.equal(await panel("!!document.querySelector('#row-" + a.id + " .sub-sugg')"), true, "행 머리 'AI'");
				assert.equal(await panel("document.getElementById('btnSuggestions').textContent"), "AI 제안 (3)");
				// (2) [적용]
				assert.equal(await panel(pageBoxClick(a.id, other.fid, ".sugg-ok")), true);
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return !s.rowStates[" + a.id + "].sugg; })()", { what: "제안 적용" });
				const s = await panel(SNAP);
				const t = s.rowStates[a.id]._allParams.filter((p) => p.type === "text");
				const fIdx = P.fields.findIndex((f) => f.fid === other.fid);
				assert.equal(t[fIdx].value, "날씨$$하늘", other.fid + " 값");
				assert.equal(s.rowStates[a.id].mm, "text");
				assert.equal(await panel("!!document.querySelector('#row-" + a.id + " .sub-mm.mm-text')"), true, "변경 점");
				assert.equal(await panel("!!document.querySelector('#row-" + a.id + " .sub-sugg')"), false, "'AI'가 사라진다");
				const dir = path.join(root.replace(/\//g, path.sep), s.keys.proj, s.keys.seq);
				const safety = JSON.parse(fs.readFileSync(path.join(dir, "history_safety.json"), "utf8"));
				assert.equal(safety[0].label, "AI 제안 적용 전");
				assert.equal(safety[0].rowStates[a.id].sugg[other.fid].v, "날씨$$하늘", "안전 지점은 적용 전");
				log("(2) [적용] → " + other.fid + " 값·mm text·안전 지점 'AI 제안 적용 전'");
				// (3) 캡션을 바꾸는 병합
				const edited = [[1, 2.5, c1[0][2]], [4, 5.5, "S32 내일은 눈이 온다고 한다"], [7.4, 8.9, c1[2][2]]];
				r = await panel(H.pageCmd("mergeCommit", { files: [{ name: "C1.srt", b64: Buffer.from(H.srtOf(edited), "utf8").toString("base64") }] }));
				assert.equal(r.ok, true, JSON.stringify(r));
				const s2 = await panel(SNAP);
				assert.equal(s2.rowStates[b.id].sugg, undefined, "캡션이 바뀐 줄의 제안은 지운다");
				assert.equal(s2.rowStates[c1rows[2].id].sugg[other.fid].v, "셋째", "시간만 바뀐 줄은 둔다");
				assert.equal(await panel("document.getElementById('btnSuggestions').textContent"), "AI 제안 (1)");
				log("(3) 병합: 캡션이 바뀐 줄의 제안 지움, 시간만 바뀐 줄은 남음 (" + r.data.files[0].statsText + ")");
				await panel(H.pageCmd("sugg.reject", { all: true }));
			});
		} finally {
			try {
				if (defBefore) fs.writeFileSync(defPath, defBefore);
				else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
			} catch (e) {
				log("cast_defaults 되돌리기 경고: " + e.message);
			}
			await panel(H.pageSetMiCast(null));
		}
	}
};
