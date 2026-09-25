"use strict";
/**
 * S3-1 하드: runCommand 전체 (DEV 패널, MI_test.prproj의 T_ 시퀀스 스크래치 사본). 타임라인은 바꾸지 않는다.
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다.
 *   C1(14줄)·C2(12줄)을 가져와 캡션 필드와 다른 텍스트 필드가 있는 AE 프리셋을 건다
 *   (1) presets: 프리셋의 fields(fid·caption)·notes가 줄 속성창 배지(T-ID·초록 캡션)와 맞는다
 *   (2) rows: 쪽 나누기(from·count)·화자·필터(changed·sugg)·라벨 'C1·1'
 *   (3) resolve('#12')는 두 화자에 있어 모호(bad-args), resolve('#13')은 C1만, resolve('C2·12')는 C2 12번째 줄
 *   (4) cast.set → 화자 표(이름 칸·칩)가 바뀌고 히스토리 '화자 표: …'
 *   (5) 캡션 필드에 suggest → 거절 (caption-field)
 *   (6) 낡은 서명 → fields-changed; 받는 제안은 rs.sugg에만 (속성 그대로), 무시하면 사라진다
 *   (7) agent의 apply → needs-approval(rid), 호스트 호출 없음 (MID_ 없음), 대기열에서 버린다
 * 실행: npm run hard -- s3_1
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");

const SNAP = "window._mogrtDebug.snapshot()";
const DOT = String.fromCharCode(0xb7);
const pageCmdAs = (source, op, args) => "await window._mogrtDebug.cmdAs(" + JSON.stringify(source) + ", " + JSON.stringify(op) + ", " + JSON.stringify(args || {}) + ")";
const pageImportPresets = (presetId) => "(() => { document.querySelectorAll('#impBody tr.imp-row').forEach((r) => { const p = r.querySelector('.imp-preset'); p.value = " + JSON.stringify(presetId) + "; p.dispatchEvent(new Event('change')); }); return true; })()";
const pageBadges = (id) => "Array.from(document.querySelectorAll('#params-" + Number(id) + " .fid-badge')).map((b) => ({ fid: b.textContent, cap: b.classList.contains('cap'), title: b.title }))";
const PAGE_CAST = "Array.from(document.querySelectorAll('#castRows .cast-row')).map((r) => ({ key: r.dataset.key, name: r.querySelector('.cast-name').value }))";
const PAGE_CHIPS = "Array.from(document.querySelectorAll('#speakerChips .spk-chip')).map((c) => c.textContent)";

module.exports = {
	name: "S3-1 runCommand 전체 (presets·rows·resolve·cast.set·suggest·needs-approval)",
	run: async (api) => {
		const { panel, assert, log } = api;
		await H.waitKeys(panel);
		assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
		const root = await H.devCacheRoot(panel);
		const snap0 = await panel(SNAP);
		const defPath = path.join(root.replace(/\//g, path.sep), snap0.keys.proj, "cast_defaults.json");
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		// 캡션 필드와 다른 텍스트 필드가 있는 AE 프리셋
		const pick = (list) => list.filter((p) => !p.native && p.captionFid && p.fields.some((f) => !f.caption)).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let P = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!P) {
			await H.ensurePreset(api, { prefer: /라온올제/ });
			P = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(P, "캡션 필드와 다른 텍스트 필드가 있는 AE 프리셋이 필요하다");
		const capF = P.fields.find((f) => f.caption);
		const other = P.fields.find((f) => !f.caption);
		log("프리셋 " + P.id + " " + P.name + " (" + P.fields.map((f) => f.fid + (f.caption ? "*" : "") + " " + f.label).join(" · ") + ")");
		try {
			await H.withScratchSequence(api, "s3_1", async () => {
				const c1 = [];
				const c2 = [];
				for (let k = 0; k < 14; k++) c1.push([1 + k * 3, 2.5 + k * 3, "S31 철수 " + (k + 1) + "번째 오늘 날씨 하늘"]);
				for (let k = 0; k < 12; k++) c2.push([2 + k * 3, 3 + k * 3, "S31 영희 " + (k + 1) + "번째 말"]);
				assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: H.srtOf(c1) }, { name: "C2.srt", content: H.srtOf(c2) }])), "sent");
				await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 2 ? m : null; })()", { what: "가져오기 창" });
				await panel(pageImportPresets(P.id));
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 26", { what: "26줄" });
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });

				// (1) presets ↔ 배지
				const pres = (await panel(H.pageCmd("presets", {}))).data.find((p) => p.id === P.id);
				const snap = await panel(SNAP);
				const first = snap.subtitles[0];
				await H.waitFor(panel, pageBadges(first.id) + ".length > 0", { timeoutMs: 60000, what: "속성창 배지" });
				const badges = await panel(pageBadges(first.id));
				assert.ok(badges.length > 0);
				badges.forEach((b) => {
					const f = pres.fields.find((x) => x.fid === b.fid);
					assert.ok(f, "배지 " + b.fid + "는 presets fields에 있다");
					assert.equal(b.cap, f.caption, b.fid + " 캡션 표시");
					if (f.caption) assert.match(b.title, /캡션 필드 \(SRT 문장\)/);
				});
				assert.equal(pres.captionFid, capF.fid);
				assert.ok(Array.isArray(pres.notes));
				log("(1) presets " + pres.fields.map((f) => f.fid + (f.caption ? "*" : "")).join(" ") + " ↔ 배지 " + badges.map((b) => b.fid + (b.cap ? "*" : "")).join(" ") + " · notes " + pres.notes.length);

				// (2) rows
				let r = await panel(H.pageCmd("rows", { from: 0, count: 5 }));
				assert.equal(r.ok, true);
				assert.deepEqual([r.data.total, r.data.rows.length], [26, 5]);
				assert.deepEqual(r.data.rows.slice(0, 2).map((x) => x.label), ["C1" + DOT + "1", "C2" + DOT + "1"]);
				assert.equal(r.data.rows[0].fields[capF.fid], c1[0][2]);
				r = await panel(H.pageCmd("rows", { from: 10, count: 200, spk: "C2" }));
				assert.deepEqual([r.data.total, r.data.rows.length, r.data.rows[0].label], [12, 2, "C2" + DOT + "11"]);
				assert.equal((await panel(H.pageCmd("rows", { filter: "changed" }))).data.total, 0);
				assert.equal((await panel(H.pageCmd("rows", { count: 201 }))).error, "bad-args");
				log("(2) rows 26줄, 쪽 나누기·화자·필터");

				// (3) resolve
				r = await panel(H.pageCmd("resolve", { label: "#12" }));
				assert.deepEqual([r.ok, r.error], [false, "bad-args"]);
				assert.match(r.detail, /C1·12, C2·12/);
				r = await panel(H.pageCmd("resolve", { label: "#13" }));
				assert.deepEqual([r.ok, r.data.label, r.data.text], [true, "C1" + DOT + "13", c1[12][2]]);
				r = await panel(H.pageCmd("resolve", { label: "C2" + DOT + "12 " + other.fid }));
				assert.deepEqual([r.ok, r.data.label, r.data.text, r.data.field.fid, r.data.field.caption], [true, "C2" + DOT + "12", c2[11][2], other.fid, false]);
				const uidC2 = r.data.uid;
				log("(3) resolve #12 모호, #13 → " + "C1" + DOT + "13, C2" + DOT + "12 → " + uidC2);

				// (4) cast.set → 화자 표
				r = await panel(H.pageCmd("cast.set", { items: [{ key: "C2", name: "S31 지영" }] }));
				assert.equal(r.ok, true, JSON.stringify(r));
				assert.deepEqual(await panel(PAGE_CAST), [{ key: "C1", name: snap.mi.cast.C1.name }, { key: "C2", name: "S31 지영" }]);
				assert.ok((await panel(PAGE_CHIPS)).indexOf("C2 S31 지영") !== -1, "칩도 바뀐다");
				const s2 = await panel(SNAP);
				const dir = path.join(root.replace(/\//g, path.sep), s2.keys.proj, s2.keys.seq);
				assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "history_auto.json"), "utf8"))[0].label, "화자 표: C2 이름 S31 지영");
				assert.equal((await panel(H.pageCmd("cast.set", { items: [{ key: "C2", track: 0 }] }))).error, "bad-args");
				log("(4) cast.set → 화자 표·칩·히스토리");

				// (5)(6) suggest
				const rows = (await panel(H.pageCmd("rows", { count: 3 }))).data.rows;
				const row = rows[0];
				const all0 = JSON.stringify((await panel(SNAP)).rowStates[row.id]._allParams);
				r = await panel(pageCmdAs("agent", "suggest", { items: [{ uid: row.uid, fid: capF.fid, value: "날씨", sig: row.sig, by: "codex" }] }));
				assert.deepEqual([r.ok, r.error, r.results[0].error], [false, "bad-args", "caption-field"]);
				r = await panel(pageCmdAs("agent", "suggest", { items: [{ uid: row.uid, fid: other.fid, value: "날씨", sig: row.sig + "|T9=x", by: "codex" }] }));
				assert.deepEqual([r.ok, r.error], [false, "fields-changed"]);
				r = await panel(pageCmdAs("agent", "suggest", { items: [{ uid: row.uid, fid: other.fid, value: "날씨$$하늘", sig: row.sig, by: "codex" }] }));
				assert.equal(r.ok, true, JSON.stringify(r));
				let s3 = await panel(SNAP);
				assert.equal(s3.rowStates[row.id].sugg[other.fid].v, "날씨$$하늘");
				assert.equal(JSON.stringify(s3.rowStates[row.id]._allParams), all0, "제안은 속성에 쓰지 않는다");
				r = await panel(H.pageCmd("sugg.reject", { all: true }));
				assert.deepEqual([r.ok, r.data.removed], [true, 1]);
				s3 = await panel(SNAP);
				assert.equal(s3.rowStates[row.id].sugg, undefined);
				log("(5)(6) 캡션 필드 거절 · 낡은 서명 fields-changed · 받은 제안은 대기열에만");

				// (7) agent의 apply
				await panel(H.PAGE_RECORD_HOST_CALLS);
				r = await panel(pageCmdAs("agent", "apply", {}));
				assert.deepEqual([r.ok, r.error], [false, "needs-approval"]);
				assert.match(String(r.rid), /^a/);
				const hostCalls = await panel("window.__hostCalls.slice()");
				assert.deepEqual(hostCalls.filter((n) => /^MID?_/.test(n)), [], "승인 전에는 호스트를 부르지 않는다");
				const q = (await panel(H.pageCmd("approvals.list", {}))).data;
				assert.deepEqual(q.map((x) => x.op), ["apply"]);
				r = await panel(H.pageCmd("approvals.reject", { rid: q[0].rid }));
				assert.equal(r.ok, true);
				assert.equal((await panel(H.pageCmd("approvals.list", {}))).data.length, 0);
				assert.equal((await panel(pageCmdAs("agent", "sugg.approve", { all: true }))).error, "needs-approval");
				log("(7) agent apply → needs-approval " + q[0].rid + " (호스트 호출 없음) → 버림");
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
