"use strict";
/**
 * M5.4 하드: 실제 MCP SDK stdio ↔ bridge_dev ↔ DEV 패널의 가져오기/적용 승인 작업.
 * 실제 Claude 클라이언트 검증이 아니다. 실행: npm run hard -- s5_jobs
 * MI_test.prproj의 T_ 시퀀스를 복제하고 V2 이상만 비운다. 합성 SRT 두 파일, 네 줄만 사용한다.
 * 가져오기 거절/취소/확정, 적용 거절/점검 취소/확정, 작업 상태와 타임라인 ±1프레임을 확인한다.
 * 프로젝트 화자 기본값과 AI 연결 상태를 복원한다. 완료한 작업 기록은 DEV의 ai_jobs.json에 남는다.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const H = require("../lib/hard");
const M = require("../../mcp/lib/mcpClient");
const { linkOn } = require("./s5_mcp.case");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const WRITES = /^(?:MID_(?:placeChunk|removeClips|ensureVideoTracks|setMotion)|applyToTimeline|updateClipAtTime|removeNativeClipsAt)$/;
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "rejected", "expired"]);
const CUES = {
	C1: [[1, 2.5, "S5J 철수 첫 번째 합성 문장"], [10, 11.5, "S5J 철수 두 번째 합성 문장"]],
	C2: [[4, 5.5, "S5J 영희 첫 번째 합성 문장"], [13, 14.5, "S5J 영희 두 번째 합성 문장"]]
};

async function run(api) {
	const { panel, host, mi, assert, log } = api;
	await H.waitKeys(panel);
	await panel(H.pageSetMiCast(null));
	await panel(H.pageSetLegacyV28(null));
	M.sdk();
	const root = await H.devCacheRoot(panel);
	const before = await panel(SNAP);
	const defaults = path.join(root, before.keys.proj, "cast_defaults.json");
	const defaultsBefore = fs.existsSync(defaults) ? fs.readFileSync(defaults) : null;
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mi_s5_jobs_"));
	const files = Object.keys(CUES).map((key) => {
		const file = path.join(temp, key + ".srt");
		fs.writeFileSync(file, H.srtOf(CUES[key]), "utf8");
		return file;
	});
	const link = await linkOn(api);
	let connection;
	try {
		await H.withScratchSequence(api, "s5_jobs", async () => {
			const tracks = Number(await host("String(app.project.activeSequence.videoTracks.numTracks)"));
			for (let i = 1; i < tracks; i++) assert.equal(String(await host(H.jsxClearVideoTrack(i))), "0");
			assert.equal(await panel(H.pageSelectTrack(2)), "2");
			const pick = (list) => list.find((p) => !p.native && p.captionFid);
			let preset = pick((await panel(H.pageCmd("presets", {}))).data);
			if (!preset) {
				await H.ensurePreset(api);
				preset = pick((await panel(H.pageCmd("presets", {}))).data);
			}
			assert.ok(preset, "캡션 필드가 있는 AE 프리셋이 필요합니다");
			connection = await M.connect({ MI_BRIDGE_DIR: link.dir }, "mogrt-hard-test");
			const names = (await connection.client.listTools()).tools.map((t) => t.name);
			["request_apply", "import_srt", "wait_job"].forEach((n) => assert.ok(names.includes(n), n + " 도구"));
			const call = async (name, args) => {
				const r = await M.callJson(connection.client, name, args);
				assert.equal(r.isError, false, name + ": " + r.text);
				return r.json;
			};
			const status = await call("get_status", {});
			assert.equal(status.core.match, true, "설치된 DEV 패널 core 해시");
			const seq_id = status.seq_id;
			const jobState = async (job, expected, timeoutMs = 60000) => {
				const end = Date.now() + timeoutMs;
				let r;
				do {
					r = await call("wait_job", { job_id: job.job_id, wait_sec: 0 });
					if (r.state === expected) return r;
					if (TERMINAL.has(r.state)) break;
					await H.sleep(250);
				} while (Date.now() < end);
				assert.equal(r.state, expected, "작업 상태: " + JSON.stringify(r));
			};
			const decide = async (job, yes) => {
				const selector = '#aiReqBar .ai-req[data-rid="' + job.rid + '"] .' + (yes ? "ai-req-ok" : "ai-req-no");
				await H.waitFor(panel, "!!document.querySelector(" + JSON.stringify(selector) + ")", { what: "작업 승인 카드" });
				await panel("document.querySelector(" + JSON.stringify(selector) + ").click(), true");
			};
			const noWrites = async (label) => assert.deepEqual((await panel("window.__hostCalls.slice()")).filter((n) => WRITES.test(n)), [], label);
			const importRequest = () => call("import_srt", { seq_id, paths: files });
			const importOpen = () => H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 2 ? m : null; })()", { what: "AI 가져오기 창" });
			await panel(H.PAGE_RECORD_HOST_CALLS);
			const rows0 = (await panel(SNAP)).subtitles;

			// 가져오기 요청 자체와 거절은 목록·타임라인을 바꾸지 않는다.
			let j = await importRequest();
			assert.equal(j.state, "pending_approval");
			await jobState(j, "pending_approval");
			assert.deepEqual((await panel(SNAP)).subtitles, rows0);
			await decide(j, false);
			await jobState(j, "rejected");
			assert.deepEqual((await panel(SNAP)).subtitles, rows0);
			await noWrites("가져오기 거절 시 쓰기 없음");
			log("(1) import_srt → pending_approval → 거절 → rejected, 목록·타임라인 그대로");

			j = await importRequest();
			await decide(j, true);
			await importOpen();
			await jobState(j, "waiting_input");
			assert.deepEqual((await panel(SNAP)).subtitles, rows0, "창 승인 전에는 목록 그대로");
			await panel("document.getElementById('impCancel').click(), true");
			await jobState(j, "cancelled");
			assert.deepEqual((await panel(SNAP)).subtitles, rows0);
			log("(2) 가져오기 승인 → waiting_input → 창 취소 → cancelled");

			j = await importRequest();
			await decide(j, true);
			await importOpen();
			await panel("(() => { document.querySelectorAll('#impBody tr.imp-row').forEach((r) => { const p = r.querySelector('.imp-preset'); p.value = " + JSON.stringify(preset.id) + "; p.dispatchEvent(new Event('change')); }); document.getElementById('impOk').click(); return true; })()");
			await jobState(j, "succeeded");
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === 4 && s.subtitles.every((r) => (s.rowStates[r.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "네 줄과 속성" });
			await noWrites("SRT 가져오기는 타임라인 쓰기 없음");
			const imported = await panel(SNAP);
			assert.deepEqual(imported.mi.castOrder, ["C1", "C2"]);
			assert.equal(imported.subtitles.length, 4);
			const resetTracks = await panel(H.pageCmd("cast.set", { items: [{ key: "C1", track: null, pos: null }, { key: "C2", track: null, pos: null }] }));
			assert.equal(resetTracks.ok, true, "사용자 화자 기본값의 고정 트랙을 테스트에서 사용하지 않는다");
			log("(3) 가져오기 승인·창 확정 → succeeded, C1·C2 네 줄");

			const rows = (await call("get_rows", { count: 50 })).rows;
			const applyRequest = () => call("request_apply", { seq_id, scope: "rows", uids: rows.map((r) => r.uid) });
			j = await applyRequest();
			assert.equal(j.state, "pending_approval");
			await decide(j, false);
			await jobState(j, "rejected");
			await noWrites("적용 거절 시 호스트 쓰기 없음");
			log("(4) request_apply → 거절 → rejected, 타임라인 그대로");

			j = await applyRequest();
			await decide(j, true);
			await H.waitFor(panel, "document.getElementById('preflightModal').classList.contains('open')", { what: "AI 적용 전 점검" });
			await jobState(j, "waiting_input");
			await noWrites("점검 창 확인 전 호스트 쓰기 없음");
			await panel("document.getElementById('pfCancel').click(), true");
			await jobState(j, "cancelled");
			await noWrites("점검 취소 시 호스트 쓰기 없음");
			log("(5) 적용 승인 → 점검 창 취소 → cancelled");

			j = await applyRequest();
			await decide(j, true);
			await H.waitFor(panel, "document.getElementById('preflightModal').classList.contains('open')", { what: "AI 적용 전 점검" });
			await jobState(j, "waiting_input");
			await panel("document.getElementById('pfOk').click(), true");
			const result = await jobState(j, "succeeded", 120000);
			assert.equal(result.error, null);
			const ping = await mi("ping");
			const scan = await mi("getTracks", { seqId: ping.seqId, build: ping.build, tracks: null });
			assert.equal(scan.ok, true);
			const after = await panel(SNAP);
			const ix = CORE.scanIndex(scan, after.mi.salt);
			const clips = Object.values(ix.current);
			assert.equal(clips.length, 4, "uid마다 클립 하나");
			assert.equal(Object.keys(ix.dup).length, 0, "중복 없음");
			assert.equal(ix.stale.length, 0, "옛 gen 없음");
			const all = scan.tracks.flatMap((t) => t.clips.map((c) => Object.assign({ track: t.i }, c)));
			for (const row of after.subtitles) {
				const cue = CUES[row.spk].find((x) => x[2] === row.text);
				const clip = all.find((c) => String(c.name).includes("[MI:" + after.mi.salt + "-" + row.id + "."));
				assert.ok(clip, "클립 태그: " + row.id);
				assert.equal(clip.track, row.spk === "C1" ? 2 : 3, "화자별 V3·V4");
				const ft = Number(scan.frameTicks || ping.frameTicks);
				assert.ok(ft > 0, "frameTicks");
				assert.ok(Math.abs(clip.sf - Math.round(cue[0] * 254016000000 / ft)) <= 1, "시작 ±1프레임");
				assert.ok(Math.abs(clip.ef - Math.round(cue[1] * 254016000000 / ft)) <= 1, "끝 ±1프레임");
			}
			await panel(H.PAGE_RECORD_HOST_CALLS);
			await jobState(j, "succeeded");
			await noWrites("완료한 wait_job은 쓰기 없음");
			log("(6) 적용 승인·점검 확정 → succeeded, V3·V4 네 클립 ±1프레임, 완료 조회는 읽기만");
		});
	} finally {
		if (connection) await connection.close();
		if (defaultsBefore) fs.writeFileSync(defaults, defaultsBefore);
		else if (fs.existsSync(defaults)) fs.unlinkSync(defaults);
		await panel("window._mogrtDebug.inbox.set(" + (link.wasOn ? "true" : "false") + ")");
		await panel(H.pageSetMiCast(null));
		const resolved = path.resolve(temp);
		if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("mi_s5_jobs_")) throw new Error("임시 폴더 범위 확인 실패");
		fs.rmSync(resolved, { recursive: true, force: true });
	}
}

module.exports = { name: "M5.4 MCP 승인 작업: SRT 가져오기·타임라인 적용·상태 확인", run };
