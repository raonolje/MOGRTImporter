"use strict";
/**
 * S1-1 하드: core region을 넣은 DEV 패널이 v27과 똑같이 동작한다.
 *   새로 고침에 예외가 없고, SRT 하나 → 프리셋 → V3 적용이 자막 시간대로 놓인다(±1프레임). V1은 그대로.
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

module.exports = {
	name: "S1-1 core 스모크 (v27 동작 그대로)",
	run: async (api) => {
		const { panel, host, assert, log, reload } = api;
		await H.reloadClean(reload, assert, log);
		assert.equal(await panel("typeof window._mogrtDebug"), "object");
		await H.waitFor(panel, "(document.getElementById('activeSeqLabel') || {}).textContent.indexOf('T_') !== -1", { what: "시퀀스 키 확정" });

		const v1Before = JSON.parse(await host(H.jsxReadVideoTrack(0)));
		assert.equal(await host(H.jsxClearVideoTrack(TRACK)), "0", "V3 비우기");

		const sent = await panel(H.pageDropSrt("s1_1_smoke.srt", SRT));
		assert.equal(sent, "sent");
		await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "행 3개" });
		const rows = await panel(H.PAGE_ROWS);
		assert.deepEqual(rows.map((r) => r.text), ["하드 합성 하나", "하드 합성 둘", "하드 합성 셋"]);
		assert.deepEqual(rows.map((r) => r.num), ["1", "2", "3"]);

		const [pid, pname] = await H.ensurePreset(api);
		log("프리셋: " + pid + " " + pname);
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
		const v1After = JSON.parse(await host(H.jsxReadVideoTrack(0)));
		assert.deepEqual(v1After.clips, v1Before.clips, "V1 클립이 그대로다");
		return "V3 " + v3.clips.length + "개 · " + v3.seqName;
	}
};
