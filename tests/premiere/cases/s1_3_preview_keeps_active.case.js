"use strict";
/**
 * 프리뷰 시퀀스가 없는 프로젝트에서 모달로 새 프리셋을 만들어도 활성 시퀀스와 목록이 그대로다.
 * (v27 setupPreviewSequence는 프리뷰를 새로 만들 때 프로젝트의 첫 시퀀스로 되돌린다 → 패널이 되돌린다. 2026-09-25)
 * 실행: npm run hard -- preview_keeps
 */
const H = require("../lib/hard");
const SRT = ["1", "00:00:01,000 --> 00:00:02,000", "재현 하나", "", "2", "00:00:03,000 --> 00:00:04,000", "재현 둘", ""].join("\n");
module.exports = {
	name: "프리뷰 생성 뒤 활성 시퀀스 유지",
	run: async (api) => {
		const { panel, host, log } = api;
		await H.waitKeys(panel);
		return H.withScratchSequence(api, "np", async () => {
			log("delete preview: " + await host(H.jsxDeletePreviewSequence()));
			await panel(H.pageDropSrt("np.srt", SRT));
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 2", { what: "rows" });
			const before = await panel(H.PAGE_PRESET_OPTIONS);
			const mogrts = await H.waitMogrts(panel, 2);
			const used = new Set((await panel("JSON.stringify(Object.values(window._mogrtDebug.snapshot().presets).map(p=>p.mogrtPath))")).length ? JSON.parse(await panel("JSON.stringify(Object.values(window._mogrtDebug.snapshot().presets).map(p=>p.mogrtPath))")) : []);
			const pick = mogrts.find((m) => !used.has(m[0]) && /라온올제/.test(m[1])) || mogrts.find((m) => !used.has(m[0]));
			log("options before: " + before.length + " ; creating preset for " + pick[1]);
			await H.createPresetViaModal(api, pick[0]);
			const scratchName = await host("app.project.activeSequence ? app.project.activeSequence.name : 'none'");
			const after = await H.waitFor(panel, "(() => { const o = " + H.PAGE_PRESET_OPTIONS + "; return o.length > " + before.length + " ? o : null; })()", { what: "행 select의 새 프리셋" });
			const rows = await panel("document.querySelectorAll('#listWrap .sub-row').length");
			const active = await host("app.project.activeSequence ? app.project.activeSequence.name : 'none'");
			log("options " + before.length + " → " + after.length + ", rows " + rows + ", active " + active);
			api.assert.equal(rows, 2, "목록 유지");
			api.assert.ok(/^T_scratch_/.test(active), "활성 시퀀스 유지: " + active + " (시작 " + scratchName + ")");
			log("preview exists: " + await host("findPreviewSequence() ? 'yes' : 'no'"));
		});
	}
};
