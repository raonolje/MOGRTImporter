"use strict";
/**
 * S1-10 하드: T-ID 기준 구조 맞춤 (DEV 패널, MI_test.prproj의 T_ 시퀀스). 스크래치 사본(T_scratch_s1_10a/b)에서 돈다.
 *   (1) 텍스트 필드가 2개 이상이고 노출하지 않은 색상 속성이 있는 프리셋: 줄 두 개에 걸고 한 줄의 후반 작업 필드(Tp)를 쓴 뒤
 *       프리셋 편집 모달에서 그 색상을 바꿔 저장 → 확인창 '텍스트 필드와 줄마다 바꾼 노출 속성은 유지됩니다'
 *       → 줄의 Tp가 남고(v27은 지웠다) 줄의 그 색상은 새 프리셋 값. 끝나면 프리셋 색상을 원래대로 되돌린다 (DEV 프리셋)
 *   (2) 옛 구조 세션(옛 8속성 _allParams를 가진 줄, 작업 파일로 넣음)을 '옛 구조 줄 1개 맞추기'로 맞추면
 *       15속성·T1 캡션·T2·T3가 옮겨지고 psOld가 남으며 호스트 적용은 부르지 않는다 → 옛 구조 클립
 *       (tests/fixtures/mogrt/make_old_mogrt.js 사본을 importMGT)에 ▶ [안전하게 적용 (1)]
 *       → 캡션이 옛 클립의 '전체 텍스트'(idx 0)에, '서브 포인트 텍스트'(idx 4)에는 T3 값이 들어간다 (이름 쓰기)
 *   (3) v1.1.7 배포는 선택이라 여기서 하지 않는다 (운영 설치·캐시는 건드리지 않는다)
 * 실행: npm run hard -- s1_10
 */
const H = require("../lib/hard");
const MOGRT = require("../../fixtures/mogrt/make_old_mogrt");

const TRACK = 2; // V3
const SNAP = "window._mogrtDebug.snapshot()";
const click = (id) => "document.getElementById(" + JSON.stringify(id) + ").click(), true";
// 프리셋 목록의 '편집' 버튼 (snapshot().presets 키 순서 = 목록 순서)
const pageOpenEdit = (pid) => "(() => { const ids = Object.keys(window._mogrtDebug.snapshot().presets); const k = ids.indexOf(" + JSON.stringify(pid) + ");" +
	" const btns = Array.from(document.querySelectorAll('#presetList button')).filter((b) => b.textContent === '편집'); if (k < 0 || !btns[k]) return false; btns[k].click(); return true; })()";
// 모달에서 이름이 name인 색상 속성의 견본을 눌러 색상 선택기를 연다 → 선택기의 지금 hex | null
const pageOpenModalColor = (name) => "(() => { const row = Array.from(document.querySelectorAll('#defaultModalBody .modal-mogrt-row')).find((r) => { const l = r.querySelector('.modal-mogrt-label'); return l && l.textContent === " + JSON.stringify(name) + " && r.querySelector('.mogrt-color-swatch-wrap'); });" +
	" if (!row) return null; row.querySelector('.mogrt-color-swatch-wrap').click(); return document.getElementById('cpHexInput').value; })()";
// 색상 선택기에 hex를 넣고(change) 닫는다
const pageSetPickerHex = (hex) => "(() => { const i = document.getElementById('cpHexInput'); i.value = " + JSON.stringify(hex) + "; i.dispatchEvent(new Event('change'));" +
	" document.getElementById('customColorPicker').classList.remove('open'); return i.value; })()";

// 프리셋 편집 모달을 열고 색상 name을 hex로 바꿔 저장한다 (줄이 쓰는 프리셋이면 확인창을 넘긴다).
// out.was(바꾸기 전 hex)는 바꾸기 전에 채운다 (도중에 실패해도 되돌릴 수 있게) → 확인창 문구 | null
async function saveColor(api, pid, name, hex, out) {
	const { panel, assert } = api;
	assert.equal(await panel(pageOpenEdit(pid)), true, "편집 버튼");
	const was = await H.waitFor(panel, pageOpenModalColor(name), { timeoutMs: 120000, stepMs: 500, what: "모달 색상 '" + name + "'" });
	if (out) out.was = was;
	assert.equal(String(await panel(pageSetPickerHex(hex))).toLowerCase(), hex.toLowerCase());
	await panel(H.PAGE_CLEAR_STATUS);
	await panel(click("btnSaveDefault"));
	const got = await H.waitFor(panel, "(() => { const m = document.getElementById('confirmModal'); if (m && m.classList.contains('open')) return { confirm: document.getElementById('confirmMessage').textContent };" +
		" return /^프리셋 저장: /.test(document.getElementById('statusBar').textContent) ? { saved: true } : null; })()", { what: "저장 확인창 또는 저장" });
	if (got.confirm !== undefined) {
		await panel(click("confirmYes"));
		await H.waitStatus(panel, /^프리셋 저장: /);
	}
	return got.confirm === undefined ? null : got.confirm;
}

module.exports = {
	name: "S1-10 T-ID 구조 맞춤·못 옮긴 텍스트",
	run: async (api) => {
		const { panel, host, assert, log } = api;
		await H.waitKeys(panel);
		assert.equal(await panel(H.pageSetMiCast(false)), false);

		// ── (1) 노출 안 된 색상을 바꿔 프리셋 저장 → 줄의 후반 작업 필드가 남는다 ──
		const snap0 = await panel(SNAP);
		// 캡션 + 속성창에 노출된 후반 작업 텍스트 필드 + 노출 안 된 색상이 있는 AE 프리셋 (텍스트 필드가 많은 것부터)
		const candidates = Object.keys(snap0.presets).map((id) => Object.assign({}, snap0.presets[id], { id })).filter((p) => {
			const texts = p.params.filter((x) => x.type === "text");
			const cap = p.params.find((x) => x.index === p.textParamIndex);
			const post = texts.some((x) => x.index !== p.textParamIndex && p.exposedIndices.indexOf(x.index) !== -1);
			const color = p.params.find((x) => x.type === "color" && p.exposedIndices.indexOf(x.index) === -1 && x.displayName);
			return !texts.some((x) => x.nativeText) && cap && cap.type === "text" && post && color;
		}).sort((a, b) => b.params.filter((x) => x.type === "text").length - a.params.filter((x) => x.type === "text").length);
		const P = candidates[0] || null;
		assert.ok(P, "캡션·노출된 후반 작업 텍스트 필드·노출 안 된 색상이 있는 프리셋이 필요하다 (DEV 캐시의 프리셋: " + Object.keys(snap0.presets).join(",") + ")");
		const color = P.params.find((x) => x.type === "color" && P.exposedIndices.indexOf(x.index) === -1 && x.displayName);
		log("프리셋 " + P.id + " " + P.name + " — 노출 안 된 색상 '" + color.displayName + "' (idx " + color.index + ")");
		await H.withScratchSequence(api, "s1_10a", async () => {
			const orig = {};
			try {
				const ids = await H.loadRowsWithPreset(api, "s1_10_rows.srt", [[1, 2.5, "S110 합성 줄 하나"], [4, 5.5, "S110 합성 줄 둘"]], P.id);
				await H.waitFor(panel, "document.querySelectorAll('#params-" + ids[0] + " .fid-badge').length > 0", { timeoutMs: 60000, what: "속성창 배지" });
				const badges = await panel("Array.from(document.querySelectorAll('#params-" + ids[0] + " .fid-badge')).map((b) => ({ fid: b.textContent, cap: b.classList.contains('cap') }))");
				const Tp = (badges.find((b) => !b.cap) || {}).fid;
				assert.ok(Tp, "속성창에 캡션이 아닌 텍스트 필드가 있어야 한다: " + JSON.stringify(badges));
				assert.equal(await panel(H.pageTypeField(ids[0], Tp, "후반$$작업")), true);
				const tpIdx = (await panel(H.pageCmd("presets", {}))).data.find((x) => x.id === P.id).fields.find((f) => f.fid === Tp).index;
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; const p = s.rowStates[" + ids[0] + "]._allParams.find((x) => x.index === " + tpIdx + "); return p && p.value === '후반$$작업'; })()", { what: Tp + " 값" });
				const NEW_HEX = "#13579b";
				const msg = await saveColor(api, P.id, color.displayName, NEW_HEX, orig);
				assert.match(String(msg), /텍스트 필드와 줄마다 바꾼 노출 속성은 유지됩니다/);
				const s = await panel(SNAP);
				assert.equal(String(s.presets[P.id].params.find((x) => x.index === color.index).colorHex).toLowerCase(), NEW_HEX, "프리셋 색상");
				const row0 = s.rowStates[ids[0]]._allParams;
				assert.equal(row0.find((x) => x.index === tpIdx).value, "후반$$작업", Tp + " 그대로 (v27은 프리셋 기본값으로 지웠다)");
				ids.forEach((id) => assert.equal(String(s.rowStates[id]._allParams.find((x) => x.index === color.index).colorHex).toLowerCase(), NEW_HEX, "줄의 노출 안 된 색상 = 새 프리셋 값"));
				assert.equal(s.rowStates[ids[0]]._allParams.find((x) => x.index === P.textParamIndex).value, "S110 합성 줄 하나", "캡션 그대로");
				assert.equal(s.rowStates[ids[0]].psOld, undefined, "구조가 같으면 psOld 없음");
				log("(1) 색상 " + orig.was + " → " + NEW_HEX + " 저장, " + Tp + " 유지");
			} finally {
				// 프리셋(DEV 캐시)의 색상을 되돌린다 (스크래치 사본 안에서: 원본 시퀀스의 줄은 건드리지 않는다)
				if (orig.was) {
					await panel("(() => { ['btnClosePresetEdit', 'btnCloseModal'].forEach((id) => { const b = document.getElementById(id); if (b) b.click(); }); return true; })()");
					await saveColor(api, P.id, color.displayName, orig.was);
					log("(1) 프리셋 색상 되돌림: " + orig.was);
				}
			}
		});

		// ── (2) 옛 구조 세션 → '옛 구조 줄 1개 맞추기' → 옛 구조 클립에 안전하게 적용 ──
		const fx = MOGRT.makeOldLayoutMogrt({});
		const P15 = await H.pickPresetForMogrt(api, fx.newPath);
		const CAP = P15.params.find((x) => x.index === P15.textParamIndex).displayName;
		assert.ok(fx.oldNames.indexOf(CAP) !== -1, "캡션 '" + CAP + "'이 옛 구조에도 있다");
		await H.withScratchSequence(api, "s1_10b", async () => {
			assert.equal(await host(H.jsxClearVideoTrack(TRACK)), "0", "V3 비우기");
			assert.equal(await panel(H.pageSelectTrack(TRACK)), String(TRACK));
			// 옛 8속성 _allParams: 새 프리셋의 같은 이름 속성을 옛 순서(index)로 (실제 옛 구조 줄 94개와 같은 모양)
			const setText = (p, text) => {
				p.value = text;
				if (typeof p.rawValue === "string" && p.rawValue.indexOf("textEditValue") !== -1) {
					const raw = JSON.parse(p.rawValue);
					raw.textEditValue = text;
					raw.fontTextRunLength = [text.length];
					p.rawValue = JSON.stringify(raw);
				}
			};
			const stale = fx.oldNames.map((name, i) => {
				const q = P15.params.find((x) => x.displayName === name);
				assert.ok(q, "새 프리셋에 '" + name + "'이 있다");
				return Object.assign(JSON.parse(JSON.stringify(q)), { index: i });
			});
			const texts = stale.filter((p) => p.type === "text");
			assert.equal(texts.length, 3, "옛 구조 텍스트 3개");
			setText(texts[0], "S110 옛 구조 캡션");
			setText(texts[1], "옛$$구조");
			setText(texts[2], "S110 서브");
			const keys = (await panel(SNAP)).keys;
			const work = {
				version: 2, savedAt: new Date().toISOString(), sequenceKey: keys.seq,
				subtitles: [{ index: 1, startTime: "00:00:02.000", endTime: "00:00:04.000", startSec: 2, endSec: 4, text: "S110 옛 구조 캡션", id: 9101 }],
				rowStates: { 9101: { presetId: P15.id, params: texts, _allParams: stale, open: false, checked: false } },
				trashBin: [], nextId: 9102, trackValue: String(TRACK)
			};
			assert.equal(await panel(H.pageLoadWork("s1_10_stale.json", work)), "sent");
			await H.waitFor(panel, "!!document.querySelector('#row-9101 .sub-struct')", { what: "옛 구조 표시" });
			assert.equal(await panel("document.getElementById('btnRebaseStale').textContent"), "옛 구조 줄 1개 맞추기");
			assert.equal(await host(H.jsxPlaceMogrt(fx.path, TRACK, 2, 4)), "ok", "옛 구조 클립");
			const before = JSON.parse(await host(H.jsxTrackProps(TRACK)));
			assert.equal(before.length, 1);
			assert.deepEqual(before[0].props.map((p) => p[0]), fx.oldNames, "옛 8속성 클립");
			// 맞추기 (적용은 부르지 않는다)
			await panel(H.PAGE_RECORD_HOST_CALLS);
			await panel(H.PAGE_CLEAR_STATUS);
			await panel(click("btnRebaseStale"));
			const c = await H.waitConfirm(panel);
			assert.match(c.msg, /^옛 구조 줄 1개의 속성을 지금 프리셋 구조로 맞춥니다\./);
			await panel(click("confirmYes"));
			await H.waitStatus(panel, /^구조 맞춤: 1줄/);
			let s = await panel(SNAP);
			const rs = s.rowStates[9101];
			assert.deepEqual(rs._allParams.map((p) => [p.index, p.displayName]), P15.params.map((p) => [p.index, p.displayName]), "지금 구조");
			assert.equal(rs._allParams.find((p) => p.index === P15.textParamIndex).value, "S110 옛 구조 캡션", "T1 캡션");
			assert.match(rs.psOld, /^[0-9a-f]{8}$/, "psOld");
			assert.equal(await panel("!!document.querySelector('#row-9101 .sub-struct')"), false);
			const calls = await panel("window.__hostCalls.slice()");
			assert.deepEqual(calls.filter((x) => /^(applyToTimeline|updateClipAtTime)$/.test(x)), [], "맞추기는 적용을 부르지 않는다");
			assert.deepEqual(JSON.parse(await host(H.jsxTrackProps(TRACK))), before, "타임라인 그대로");
			// ▶ 안전하게 적용
			const r = await H.safeApplyClick(api, 1);
			assert.match(r.confirm.msg, /^구조가 바뀐 줄 1개가 있습니다\./);
			assert.equal(r.status.text, "안전하게 적용: 갱신 1");
			const after = JSON.parse(await host(H.jsxTrackProps(TRACK)));
			assert.equal(after.length, 1);
			assert.deepEqual([after[0].nodeId, after[0].s, after[0].e], [before[0].nodeId, before[0].s, before[0].e]);
			assert.deepEqual(after[0].props.map((p) => p[0]), fx.oldNames, "여전히 옛 구조 클립");
			assert.equal(H.propValue(after[0], CAP), "T:S110 옛 구조 캡션", "캡션은 옛 클립의 '" + CAP + "'에");
			assert.equal(H.propValue(after[0], texts[1].displayName), "T:옛$$구조");
			assert.equal(H.propValue(after[0], texts[2].displayName), "T:S110 서브", "idx 4 '" + texts[2].displayName + "'에는 캡션이 아니라 제 값");
			s = await panel(SNAP);
			assert.ok(s.rowStates[9101].psOld, "psOld는 남는다 (클립은 여전히 옛 구조)");
			log("(2) 옛 구조 클립: " + after[0].props.filter((p) => /^T:/.test(p[1])).map((p) => p[0] + "=" + p[1].slice(2)).join(" · "));
		});
	}
};
