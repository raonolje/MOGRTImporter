"use strict";
/**
 * S1-9 하드: 레거시 목록 안전 적용 — 바꾸지 않은 v27 호스트 (DEV 패널, MI_test.prproj의 T_ 시퀀스).
 * 스크래치 사본(T_scratch_s1_9a/b/c)에서 V3(트랙 2)를 비우고 돈다. 플래그는 끈다 (운영과 같은 경로:
 * 프리셋이 걸린 목록에 C번호 없는 SRT를 열면 S1-9부터 [병합] [교체] [취소]를 묻는다).
 * 프리셋은 '[라온올제] 자동 줄바꿈 박스 자막'(15속성) 것을 쓴다 (없으면 모달로 만든다).
 *   (1) 20줄을 v27 ▶로 놓고 → 문장 3개만 바꾼 SRT를 병합 → ▶ 확인창 [안전하게 적용 (3)]
 *       → 그 3개 클립의 캡션만 바뀌고, 클립 수·nodeId·시작·끝이 그대로(머리 잘림 없음), 나머지 속성 그대로, mm이 지워진다
 *   (3) 한 줄 병합 → 그 줄만 체크 → ▶ → [지금 방식으로 전체 적용]: 진짜 v27 applyToTimeline 결과에
 *       ' (실패 1개: 하드 강제)'를 덧붙이면 mm이 남고 상태 줄에 실패 수 (강제 실패는 페이지 스텁)
 *   (2) 옛 8속성 구조 클립(tests/fixtures/mogrt/make_old_mogrt.js가 저장소 밖에 만든 사본을 importMGT) +
 *       15속성 프리셋 줄 → 문장 병합 → [안전하게 적용] → 캡션이 옛 클립의 '전체 텍스트'(idx 0)에 들어가고
 *       '박스 색상'·'서브 포인트 텍스트' 등 나머지 7개 속성은 그대로 (되읽기). v27 index 쓰기였다면 idx 4
 *       '서브 포인트 텍스트'에 들어갔다 (S0-3 x)
 *   (5) 평소 ▶ (병합 표시·위험한 줄 없음): 확인창 없이 v27과 같은 페이로드 (호스트를 부르지 않는 스텁으로 잡는다), ap 없음
 *   (4) 0.3초 옆에 다른 줄이 있는 줄은 건너뛴다: updateClipAtTime 1번(떨어진 줄)만, 건너뛴 줄 클립은 그대로,
 *       줄에 '근처에 다른 줄이 있어 건너뜀', mm 유지
 * 실행: npm run hard -- s1_9
 */
const H = require("../lib/hard");
const MOGRT = require("../../fixtures/mogrt/make_old_mogrt");

const TRACK = 2; // V3
const SNAP = "window._mogrtDebug.snapshot()";

const { jsxTrackProps, jsxPlaceMogrt, waitConfirm, PAGE_CLEAR_STATUS, pageSelectTrack, pageCheckRow, srtOf, pickPresetForMogrt, loadRowsWithPreset, safeApplyClick } = H;
const base = (p) => String(p || "").replace(/\\/g, "/").split("/").pop();
const valOf = H.propValue;
const click = (id) => "document.getElementById(" + JSON.stringify(id) + ").click(), true";
const pageRowRes = (id) => "(() => { const el = document.querySelector('#row-" + Number(id) + " .sub-res'); return el ? el.textContent : null; })()";

/**
 * v27 applyToTimeline 스텁 (CSInterface.prototype.evalScript를 감싼다. 다른 호출은 그대로 지나간다).
 *   "fake": 호스트를 부르지 않고 페이로드만 window.__s19payloads에 잡는다
 *   "fail": 진짜로 부르고 결과에 ' (실패 1개: 하드 강제)'를 덧붙인다
 */
function pageStubApply(mode) {
	const tail = mode === "fake"
		? " setTimeout(() => cb && cb('SUCCESS: MOGRT 0개 + 텍스트 레이어 0개 배치 완료 (하드 스텁)'), 0); return;"
		: " return orig.call(this, script, (res) => cb && cb(String(res) + ' (실패 1개: 하드 강제)'));";
	return "(() => { const P = CSInterface.prototype; if (!window.__s19orig) window.__s19orig = P.evalScript; const orig = window.__s19orig; window.__s19payloads = [];" +
		" P.evalScript = function (script, cb) { const m = /^applyToTimeline\\(decodeURIComponent\\(\"(.*)\"\\)\\)$/.exec(String(script));" +
		" if (!m) return orig.call(this, script, cb); window.__s19payloads.push(JSON.parse(decodeURIComponent(m[1])));" + tail + " }; return true; })()";
}
const PAGE_UNSTUB = "(() => { if (window.__s19orig) { CSInterface.prototype.evalScript = window.__s19orig; delete window.__s19orig; } return true; })()";

// 평소 ▶ (체크 없음) → v27 결과 상태
async function applyPlain(api) {
	const { panel } = api;
	await panel(PAGE_CLEAR_STATUS);
	await panel(click("btnApply"));
	return H.waitStatus(panel, /배치 완료/, { timeoutMs: 120000 });
}
// 프리셋이 걸린 목록에 C번호 없는 SRT → [병합 (후반 작업 유지)]
async function mergeLegacy(api, name, cues) {
	const { panel, assert } = api;
	await panel(PAGE_CLEAR_STATUS);
	assert.equal(await panel(H.pageDropSrt(name, srtOf(cues))), "sent");
	const c = await waitConfirm(panel);
	assert.match(c.msg, /^이미 후반 작업\(프리셋\)이 있는 자막 목록입니다/);
	assert.equal(c.yes, "병합 (후반 작업 유지)");
	await panel(click("confirmYes"));
	return H.waitStatus(panel, /^SRT 병합: /);
}
module.exports = {
	name: "S1-9 레거시 안전 적용 (v27 호스트 그대로)",
	run: async (api) => {
		const { panel, host, assert, log } = api;
		await H.waitKeys(panel);
		assert.equal(await panel(H.pageSetMiCast(false)), false, "운영처럼 플래그를 끈다");
		const fx = MOGRT.makeOldLayoutMogrt({});
		log("옛 구조 MOGRT: " + base(fx.source) + " → " + fx.path + " (" + fx.oldNames.length + "속성, 새 버전 " + fx.newNames.length + "속성)");
		const P = await pickPresetForMogrt(api, fx.newPath);
		const capParam = P.params.find((x) => x.index === P.textParamIndex);
		assert.ok(capParam, "프리셋 " + P.id + "에 캡션 필드가 있어야 한다");
		const CAP = capParam.displayName;
		assert.ok(fx.oldNames.indexOf(CAP) !== -1, "캡션 필드 이름 '" + CAP + "'이 옛 구조에도 있다");
		log("프리셋 " + P.id + " " + P.name + " — 캡션 '" + CAP + "' (idx " + P.textParamIndex + ")");
		try {
			// ── (1) 20줄 → 문장 3개 병합 → 안전하게 적용 (3) / (3) 강제 실패 ──
			await H.withScratchSequence(api, "s1_9a", async () => {
				assert.equal(await host(H.jsxClearVideoTrack(TRACK)), "0", "V3 비우기");
				assert.equal(await panel(pageSelectTrack(TRACK)), String(TRACK));
				const cues = Array.from({ length: 20 }, (_, i) => [1 + 2 * i, 2.5 + 2 * i, "S19 합성 줄 " + (i + 1)]);
				const ids = await loadRowsWithPreset(api, "s1_9_twenty.srt", cues, P.id);
				const st0 = await applyPlain(api);
				assert.equal(st0.cls, "ok", st0.text);
				const before = JSON.parse(await host(jsxTrackProps(TRACK)));
				assert.equal(before.length, 20, "v27로 20개");
				before.forEach((c, i) => assert.equal(valOf(c, CAP), "T:" + cues[i][2], "클립 " + i + " 캡션"));
				const CH = [3, 9, 15];
				const v2 = cues.map((c, i) => (CH.indexOf(i) !== -1 ? [c[0], c[1], c[2] + " (고침)"] : c));
				await mergeLegacy(api, "s1_9_twenty_v2.srt", v2);
				let s = await panel(SNAP);
				assert.deepEqual(ids.map((id) => s.rowStates[id].mm || "").filter(Boolean), ["text", "text", "text"], "문장 3개만 mm");
				const r1 = await safeApplyClick(api, 3);
				assert.match(r1.confirm.msg, /^바뀐 줄 3개가 있습니다\./);
				assert.equal(r1.status.text, "안전하게 적용: 갱신 3", r1.status.text);
				const after = JSON.parse(await host(jsxTrackProps(TRACK)));
				assert.equal(after.length, 20, "클립 수 그대로");
				after.forEach((c, i) => {
					const b = before[i];
					assert.deepEqual([c.nodeId, c.s, c.e], [b.nodeId, b.s, b.e], "클립 " + i + " 그대로 (머리 잘림 없음)");
					assert.equal(valOf(c, CAP), "T:" + v2[i][2], "클립 " + i + " 캡션");
					assert.deepEqual(c.props.filter((p) => p[0] !== CAP), b.props.filter((p) => p[0] !== CAP), "클립 " + i + " 나머지 속성 그대로");
				});
				s = await panel(SNAP);
				assert.ok(ids.every((id) => !s.rowStates[id].mm), "mm 모두 지움");
				CH.forEach((i) => assert.equal(s.rowStates[ids[i]].ap.cap, v2[i][2], "ap 기록 " + i));
				log("(1) 20줄 중 3개만 갱신, 클립 수·시작·끝·나머지 속성 그대로");

				// (3) 한 줄 병합 → 그 줄만 → 지금 방식 + 강제 실패
				const v3 = v2.map((c, i) => (i === 1 ? [c[0], c[1], c[2] + " (다시)"] : c));
				await mergeLegacy(api, "s1_9_twenty_v3.srt", v3);
				assert.equal((await panel(SNAP)).rowStates[ids[1]].mm, "text");
				assert.equal(await panel(pageCheckRow(ids[1])), true);
				await panel(pageStubApply("fail"));
				await panel(PAGE_CLEAR_STATUS);
				await panel(click("btnApply"));
				const sel = await waitConfirm(panel);
				assert.match(sel.msg, /^1개 자막이 선택되어 있습니다/);
				await panel(click("confirmYes"));
				const ch = await waitConfirm(panel);
				assert.match(ch.msg, /^바뀐 줄 1개가 있습니다\./);
				await panel(click("confirmAlt"));
				const st3 = await H.waitStatus(panel, /실패/, { timeoutMs: 60000 });
				assert.equal(st3.cls, "err", st3.text);
				assert.match(st3.text, /— 실패 1개가 있어 바뀐 줄 1개의 표시를 남겼습니다$/);
				const sent = await panel("window.__s19payloads");
				assert.equal(sent.length, 1);
				assert.deepEqual(sent[0].subtitles.map((x) => x.text), [v3[1][2]], "체크한 줄만 v27로");
				s = await panel(SNAP);
				assert.equal(s.rowStates[ids[1]].mm, "text", "실패가 있으면 mm이 남는다");
				assert.equal(s.rowStates[ids[1]].ap, undefined);
				log("(3) 강제 실패: " + st3.text);
			});
		} finally {
			await panel(PAGE_UNSTUB);
		}

		// ── (2) 옛 8속성 구조 클립 + 15속성 줄 → 안전하게 적용 ──
		await H.withScratchSequence(api, "s1_9b", async () => {
			assert.equal(await host(H.jsxClearVideoTrack(TRACK)), "0", "V3 비우기");
			assert.equal(await panel(pageSelectTrack(TRACK)), String(TRACK));
			const cues = [[2, 4, "S19 옛 구조 하나"], [6, 8, "S19 옛 구조 둘"]];
			const ids = await loadRowsWithPreset(api, "s1_9_old.srt", cues, P.id);
			for (const c of cues) assert.equal(await host(jsxPlaceMogrt(fx.path, TRACK, c[0], c[1])), "ok", "옛 구조 클립 놓기");
			const before = JSON.parse(await host(jsxTrackProps(TRACK)));
			assert.equal(before.length, 2);
			assert.deepEqual(before[0].props.map((p) => p[0]), fx.oldNames, "옛 8속성 구조 클립");
			assert.notEqual(before[0].props.map((p) => p[0]).indexOf(CAP), P.textParamIndex, "캡션 자리가 프리셋 index와 다르다 (index로 쓰면 틀린 속성)");
			const v2 = [[2, 4, "S19 옛 구조 하나 고침"], cues[1]];
			await mergeLegacy(api, "s1_9_old_v2.srt", v2);
			const r = await safeApplyClick(api, 1);
			assert.equal(r.status.text, "안전하게 적용: 갱신 1");
			const after = JSON.parse(await host(jsxTrackProps(TRACK)));
			assert.equal(after.length, 2);
			assert.deepEqual([after[0].nodeId, after[0].s, after[0].e], [before[0].nodeId, before[0].s, before[0].e]);
			assert.equal(valOf(after[0], CAP), "T:" + v2[0][2], "캡션이 옛 클립의 '" + CAP + "'에");
			after[0].props.forEach((p, k) => {
				if (p[0] !== CAP) assert.deepEqual(p, before[0].props[k], "'" + p[0] + "' 그대로");
			});
			assert.deepEqual(after[1].props, before[1].props, "바뀌지 않은 줄의 클립 그대로");
			const s = await panel(SNAP);
			assert.equal(s.rowStates[ids[0]].mm, undefined);
			log("(2) 옛 구조 클립: '" + CAP + "' = " + valOf(after[0], CAP) + ", 박스 색상 " + valOf(after[0], "박스 색상") + " 그대로");
		});

		// ── (5) 평소 ▶ 페이로드 = v27 / (4) 근처 줄 건너뜀 ──
		try {
			await H.withScratchSequence(api, "s1_9c", async () => {
				assert.equal(await host(H.jsxClearVideoTrack(TRACK)), "0", "V3 비우기");
				assert.equal(await panel(pageSelectTrack(TRACK)), String(TRACK));
				const cues = [[2, 3.8, "S19 근처 가"], [2.3, 4, "S19 근처 나"], [6, 7.5, "S19 근처 다"]];
				const ids = await loadRowsWithPreset(api, "s1_9_near.srt", cues, P.id);
				// (5)
				await panel(pageStubApply("fake"));
				await panel(PAGE_CLEAR_STATUS);
				await panel(click("btnApply"));
				await H.waitStatus(panel, /하드 스텁/);
				assert.equal(await panel("document.getElementById('confirmModal').classList.contains('open')"), false, "확인창 없음");
				const got = await panel("window.__s19payloads");
				await panel(PAGE_UNSTUB);
				let s = await panel(SNAP);
				assert.equal(got.length, 1);
				assert.deepEqual(got[0], {
					videoTrackIndex: TRACK,
					subtitles: s.subtitles.map((x) => {
						const rs = s.rowStates[x.id];
						return { mogrtPath: s.presets[rs.presetId].mogrtPath, startSec: x.startSec, endSec: x.endSec, text: x.text, params: rs._allParams.length > 0 ? rs._allParams : rs.params };
					})
				}, "v27과 같은 페이로드");
				assert.ok(ids.every((id) => s.rowStates[id].ap === undefined && s.rowStates[id].mm === undefined), "ap·mm 없음 (v27 모양)");
				log("(5) 평소 ▶ 페이로드 = v27 (" + got[0].subtitles.length + "줄)");

				// (4)
				const st0 = await applyPlain(api);
				assert.equal(st0.cls, "ok", st0.text);
				const before = JSON.parse(await host(jsxTrackProps(TRACK)));
				assert.equal(before.length, 3);
				const v2 = [[2, 3.8, "S19 근처 가 고침"], cues[1], [6, 7.5, "S19 근처 다 고침"]];
				await mergeLegacy(api, "s1_9_near_v2.srt", v2);
				await panel(H.PAGE_RECORD_HOST_CALLS);
				const r = await safeApplyClick(api, 1);
				assert.match(r.confirm.msg, /0\.5초 안에 다른 줄이 있는 1개는 건너뜁니다/);
				assert.equal(r.status.text, "안전하게 적용: 갱신 1 · 근처 줄 1");
				const calls = await panel("window.__hostCalls.slice()");
				assert.deepEqual(calls.filter((c) => c === "updateClipAtTime" || c === "applyToTimeline"), ["updateClipAtTime"], "떨어진 줄 하나만: " + calls.join(","));
				const after = JSON.parse(await host(jsxTrackProps(TRACK)));
				assert.equal(after.length, 3);
				assert.deepEqual(after.slice(0, 2), before.slice(0, 2), "근처 두 줄의 클립 그대로");
				assert.equal(valOf(after[2], CAP), "T:" + v2[2][2]);
				s = await panel(SNAP);
				assert.equal(s.rowStates[ids[0]].mm, "text", "건너뛴 줄은 mm 유지");
				assert.equal(await panel(pageRowRes(ids[0])), "근처에 다른 줄이 있어 건너뜀");
				log("(4) 근처 줄 건너뜀, 떨어진 줄만 갱신");
			});
		} finally {
			await panel(PAGE_UNSTUB);
		}
	}
};
