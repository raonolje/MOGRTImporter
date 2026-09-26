"use strict";
/**
 * S1-1 하드: core region을 넣은 DEV 패널이 v27과 똑같이 동작한다 (S3-4 spec (1) 단일 화자 골든: 가져오기·프리셋·적용·↑).
 *   새로 고침에 예외가 없고, SRT 하나 → 프리셋(캡션 필드가 있는 AE 프리셋) → V3 적용이 자막 시간대로 놓인다(±1프레임). V1은 그대로.
 *   ↑ (S3-4 리뷰): 2번 줄 캡션 필드를 고치고 ↑ → v27 updateClipAtTime이 그 클립만 제자리에서 갱신한다
 *   (세 클립의 시작·끝·nodeId 그대로, 2번 클립 캡션 = 고친 문장, 1·3번 클립 속성 그대로). 호스트 페이로드가 v27과 같은지는
 *   node tests/unit/panel_golden.test.js가 v27 app.js와 나란히 돌려 본다.
 *   활성 T_ 시퀀스의 복제본(T_scratch_s1_1)에서 돌고 끝나면 지운다 (원본의 S0-3 클립을 건드리지 않는다).
 * 실행: npm run hard -- s1_1   (MI_test.prproj의 T_ 시퀀스 하나를 활성으로)
 * 운영과 눈으로 비교하려면 같은 SRT(아래 SRT)를 운영 패널로 다른 T_ 시퀀스에 적용해 본다.
 */
const H = require("../lib/hard");

const TPS = 254016000000;
const SRT = [
	"1", "00:00:01,000 --> 00:00:02,500", "하드 합성 하나", "",
	"2", "00:00:03,000 --> 00:00:04,000", "하드 합성 둘", "",
	"3", "00:00:05,005 --> 00:00:06,506", "하드 합성 셋", ""
].join("\n");
const CUES = [[1, 2.5], [3, 4], [5.005, 6.506]];
const TRACK = 2; // V3
const UP_TEXT = "하드 합성 둘 (↑로 고침)";

module.exports = {
	name: "S1-1 core 스모크 (v27 동작 그대로)",
	run: async (api) => {
		const { panel, host, assert, log, reload } = api;
		await H.reloadClean(reload, assert, log);
		assert.equal(await panel("typeof window._mogrtDebug"), "object");
		await H.waitKeys(panel);

		// 원본 T_ 시퀀스에는 S0-3 수동 확인용 클립이 있다 → 복제본(T_scratch_s1_1)에서 V3를 비우고 적용한다
		return H.withScratchSequence(api, "s1_1", async () => {
			const v1Before = JSON.parse(await host(H.jsxReadVideoTrack(0)));
			assert.equal(await host(H.jsxClearVideoTrack(TRACK)), "0", "V3 비우기");

			const sent = await panel(H.pageDropSrt("s1_1_smoke.srt", SRT));
			assert.equal(sent, "sent");
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "행 3개" });
			const rows = await panel(H.PAGE_ROWS);
			assert.deepEqual(rows.map((r) => r.text), ["하드 합성 하나", "하드 합성 둘", "하드 합성 셋"]);
			assert.deepEqual(rows.map((r) => r.num), ["1", "2", "3"]);

			// ↑가 캡션 필드를 고칠 수 있게 캡션이 있는 AE 프리셋을 쓴다 (없으면 모달로 만든 뒤 다시 찾는다)
			const pick = (list) => list.filter((p) => !p.native && p.captionFid)[0] || null;
			let P = pick((await panel(H.pageCmd("presets", {}))).data);
			if (!P) {
				await H.ensurePreset(api);
				P = pick((await panel(H.pageCmd("presets", {}))).data);
			}
			assert.ok(P, "캡션 필드가 있는 AE 프리셋이 필요하다");
			const pid = P.id;
			const capF = P.fields.find((f) => f.caption);
			log("프리셋: " + pid + " " + P.name + " (캡션 " + capF.fid + ")");
			for (const r of await panel(H.PAGE_ROWS)) assert.equal(await panel(H.pageSetRowPreset(r.id, pid)), pid);
			assert.ok(await panel(H.PAGE_UNCHECK_ALL));
			await panel("(() => { const t = document.getElementById('trackSel'); t.value = '" + TRACK + "'; t.dispatchEvent(new Event('change')); return t.value; })()");

			await panel("document.getElementById('btnApply').click(), true");
			const st = await H.waitFor(panel, "(() => { const s = " + H.PAGE_STATUS + "; return s && (s.cls === 'ok' || s.cls === 'err') && !/배치 중/.test(s.text) ? s : null; })()", { timeoutMs: 60000, what: "적용 결과" });
			log("상태: " + st.text);
			assert.equal(st.cls, "ok", st.text);

			const v3 = JSON.parse(await host(H.jsxReadVideoTrack(TRACK)));
			assert.equal(v3.clips.length, CUES.length, "V3 클립 수");
			v3.clips.forEach((c, i) => {
				const sf = H.ticksToFrame(c.s, v3.timebase);
				const ef = H.ticksToFrame(c.e, v3.timebase);
				const wantS = Math.round((CUES[i][0] * TPS) / Number(v3.timebase));
				const wantE = Math.round((CUES[i][1] * TPS) / Number(v3.timebase));
				log("V3[" + i + "] " + c.name + " 프레임 " + sf + "~" + ef + " (자막 " + wantS + "~" + wantE + ")");
				assert.ok(Math.abs(sf - wantS) <= 1, "시작 프레임 " + sf + " vs " + wantS);
				assert.ok(Math.abs(ef - wantE) <= 1, "끝 프레임 " + ef + " vs " + wantE);
			});

			// ↑: 2번 줄 캡션을 고치고 그 줄만 갱신 (v27 updateClipAtTime, 제자리)
			const id2 = rows[1].id;
			await H.waitFor(panel, "document.querySelectorAll('#params-" + id2 + " .fid-badge').length > 0", { timeoutMs: 60000, what: "2번 줄 속성창 배지" });
			assert.equal(await panel(H.pageTypeField(id2, capF.fid, UP_TEXT)), true, "2번 줄 캡션 필드 " + capF.fid);
			const beforeUp = JSON.parse(await host(H.jsxTrackProps(TRACK)));
			assert.equal(beforeUp.length, CUES.length);
			await panel(H.PAGE_CLEAR_STATUS);
			await panel("document.querySelector('#row-" + id2 + " .btn-update').click(), true");
			const up = await H.waitFor(panel, "(() => { const s = " + H.PAGE_STATUS + "; return s && (s.cls === 'ok' || s.cls === 'err') && !/업데이트 중/.test(s.text) ? s : null; })()", { timeoutMs: 60000, what: "↑ 결과" });
			log("↑: " + up.text);
			assert.equal(up.cls, "ok", up.text);
			assert.match(up.text, /^\[2\] /, up.text);
			const afterUp = JSON.parse(await host(H.jsxTrackProps(TRACK)));
			assert.deepEqual(afterUp.map((c) => [c.s, c.e, c.nodeId]), beforeUp.map((c) => [c.s, c.e, c.nodeId]), "세 클립의 시작·끝·nodeId 그대로 (제자리 갱신)");
			assert.ok(afterUp[1].props.some((p) => p[1] === "T:" + UP_TEXT), "2번 클립 캡션 = 고친 문장");
			assert.deepEqual([afterUp[0].props, afterUp[2].props], [beforeUp[0].props, beforeUp[2].props], "1·3번 클립 속성 그대로");

			const v1After = JSON.parse(await host(H.jsxReadVideoTrack(0)));
			assert.deepEqual(v1After.clips, v1Before.clips, "V1 클립이 그대로다");
			return "V3 " + v3.clips.length + "개 · ↑ 제자리 갱신 · " + v3.seqName;
		});
	}
};
