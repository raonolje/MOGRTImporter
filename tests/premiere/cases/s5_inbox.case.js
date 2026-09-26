"use strict";
/**
 * M5.1 하드: 파일 인박스와 heartbeat (DEV 패널 ↔ %APPDATA%/MogrtImporter/bridge_dev, node 쪽은 mcp/lib/bridge.js).
 * 타임라인·목록은 바꾸지 않는다 (승인 대기열에 넣은 요청은 끝에 버린다). 'AI 연결 허용'은 끝나면 시작 전 상태로 되돌린다.
 *   (0) DEV 패널의 다리 폴더는 bridge_dev다 (운영 다리 bridge에는 절대 쓰지 않는다). 꺼져 있으면 명령 파일을 가져가지 않는다
 *   (1) 'AI 연결 허용' 칸을 누르면 heartbeat.json: state on, extPath = DEV 설치 폴더, build = 패널 빌드,
 *       coreHash = 설치된 app.js의 src/mi/core.ts 해시(node regionHash), seqId = 패널 시퀀스, 약 2초 간격
 *   (2) status 왕복 (coreHash·빌드가 heartbeat와 같다)
 *   (3) seqId가 다르면 seq-mismatch
 *   (4) 2분 지난 명령은 expired (승인 대기열에 들어가지 않는다)
 *   (5) 같은 id를 두 번: 한 번만 돌고 두 번째는 같은 rid에 dup (대기열에 하나) → 패널에서 버린다
 *   (6) 한국어 왕복: needs-approval 문구, by 'codex'가 대기열에 그대로
 *   (7) 끄면 heartbeat state off, 명령 파일을 가져가지 않는다
 * 실행: npm run hard -- s5_inbox
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const B = require("../../../mcp/lib/bridge");
const { regionHash } = require("../../lib/loadRegions");

const SNAP = "window._mogrtDebug.snapshot()";

module.exports = {
	name: "M5.1 인박스·heartbeat (bridge_dev: 기본 꺼짐, status 왕복, seq 다름, 2분 지남, 같은 id 한 번, 끄기)",
	run: async (api) => {
		const { panel, assert, log } = api;
		await H.waitKeys(panel);
		const root = await H.devCacheRoot(panel);
		const extPath = root.replace(/\/cache$/, "");
		const dirPosix = String(await panel("window._mogrtDebug.inbox.dir()"));
		assert.match(dirPosix, /\/MogrtImporter\/bridge_dev$/, "DEV 패널은 bridge_dev (운영 다리에 쓰지 않는다)");
		const dir = dirPosix.replace(/\//g, path.sep);
		const inbox = path.join(dir, "inbox");
		const wasOn = await panel("window._mogrtDebug.inbox.on()");
		const made = [];
		const rawSend = (msg) => {
			fs.mkdirSync(inbox, { recursive: true });
			const p = path.join(inbox, msg.id + ".json");
			B.writeJsonAtomic(p, msg);
			made.push(p);
			return p;
		};
		const waitReply = async (id, ms = 10000) => {
			const f = path.join(dir, "outbox", id + ".json");
			const t0 = Date.now();
			while (Date.now() - t0 < ms) {
				const r = B.tryReadJson(f);
				if (r) {
					try { fs.unlinkSync(f); } catch (_) {}
					return r;
				}
				await H.sleep(50);
			}
			throw new Error("시간 초과: 응답 " + id);
		};
		const approvals = async () => (await panel(H.pageCmd("approvals.list", {}))).data;
		const q0 = (await approvals()).map((x) => x.rid);
		try {
			// (0) 꺼져 있으면 가져가지 않는다
			if (wasOn) await panel("window._mogrtDebug.inbox.set(false)");
			assert.equal(await panel("document.getElementById('aiLinkChk').checked"), false);
			const idle = { v: 1, id: B.newId(), op: "status", args: {}, at: Date.now() };
			const idleFile = rawSend(idle);
			await H.sleep(1500);
			assert.ok(fs.existsSync(idleFile), "꺼져 있으면 명령 파일을 가져가지 않는다");
			fs.unlinkSync(idleFile);
			log("(0) 다리 " + dirPosix + " · 꺼져 있으면 가져가지 않음");

			// (1) 켜기 → heartbeat
			await panel("document.getElementById('aiLinkChk').click(), true");
			await H.waitFor(panel, "window._mogrtDebug.inbox.on()", { what: "AI 연결 켜짐" });
			const pc = await B.checkPanel(dir);
			assert.ok(pc.ok, "heartbeat: " + JSON.stringify(pc));
			const hb = pc.hb;
			const snap = await panel(SNAP);
			const installedApp = path.join(extPath.replace(/\//g, path.sep), "html", "js", "app.js");
			assert.equal(hb.state, "on");
			assert.equal(String(hb.extPath).toLowerCase(), extPath.toLowerCase(), "extPath = DEV 설치 폴더");
			assert.equal(hb.coreHash, regionHash("src/mi/core.ts", installedApp), "coreHash = 설치된 app.js core 해시");
			assert.equal(hb.seqId, snap.keys.seqId);
			assert.match(String(hb.build), /^dev-/);
			assert.equal(hb.busy, false);
			const ats = [];
			const t0 = Date.now();
			while (Date.now() - t0 < 7000) {
				const r = B.readHeartbeat(dir);
				if (r.hb && r.hb.state === "on" && ats.indexOf(r.hb.at) === -1) ats.push(r.hb.at);
				await H.sleep(100);
			}
			const gaps = ats.slice(1).map((a, i) => a - ats[i]);
			assert.ok(gaps.length >= 2, "7초 동안 heartbeat 3번 이상: " + JSON.stringify(gaps));
			assert.ok(gaps.every((g) => g >= 1500 && g <= 4000), "약 2초 간격: " + JSON.stringify(gaps));
			log("(1) heartbeat build " + hb.build + " · coreHash " + hb.coreHash + " · 간격 " + gaps.join("/") + "ms");

			// (2) status 왕복
			const st = await B.call(dir, "status", {}, { by: "codex" });
			assert.equal(st.ok, true, JSON.stringify(st));
			assert.deepEqual([st.data.coreHash, st.data.panel.build, st.data.seq.id], [hb.coreHash, hb.build, snap.keys.seqId]);
			log("(2) status 왕복 · 줄 " + st.data.rows + " · 화자 " + st.data.speakers.length);

			// (3) seq 다름
			const sm = await B.call(dir, "rows", {}, { seqId: "다른-시퀀스" });
			assert.deepEqual([sm.ok, sm.error], [false, "seq-mismatch"]);
			const sOk = await B.call(dir, "rows", { count: 1 }, { seqId: snap.keys.seqId });
			assert.equal(sOk.ok, true);
			log("(3) seq-mismatch");

			// (4) 2분 지난 명령
			const old = { v: 1, id: B.newId(), op: "cast.set", args: { items: [{ key: "C1", name: "S5 오래됨" }] }, at: Date.now() - 121000, by: "codex" };
			rawSend(old);
			const ro = await waitReply(old.id);
			assert.deepEqual([ro.ok, ro.error], [false, "expired"]);
			assert.deepEqual((await approvals()).map((x) => x.rid), q0, "대기열에 들어가지 않았다");
			log("(4) expired: " + ro.detail);

			// (5)(6) 같은 id 두 번 · 한국어
			const dup = { v: 1, id: B.newId(), op: "cast.set", args: { items: [{ key: "C1", name: "S5 한국어 이름 ✓" }] }, at: Date.now(), by: "codex" };
			rawSend(dup);
			const r1 = await waitReply(dup.id);
			assert.deepEqual([r1.ok, r1.error], [false, "needs-approval"]);
			assert.match(r1.detail, /패널에서 승인해야 합니다/);
			rawSend(dup);
			const r2 = await waitReply(dup.id);
			assert.deepEqual([r2.error, r2.rid, r2.dup], ["needs-approval", r1.rid, true]);
			const q = (await approvals()).filter((x) => q0.indexOf(x.rid) === -1);
			assert.deepEqual(q.map((x) => [x.rid, x.op, x.by, x.args.items[0].name]), [[r1.rid, "cast.set", "codex", "S5 한국어 이름 ✓"]], "한 번만 들어갔다");
			const rj = await panel(H.pageCmd("approvals.reject", { rid: r1.rid }));
			assert.equal(rj.ok, true);
			log("(5)(6) 같은 id 한 번 (" + r1.rid + ", dup) · 한국어 그대로 → 버림");

			// (7) 끄기
			await panel("document.getElementById('aiLinkChk').click(), true");
			await H.waitFor(panel, "!window._mogrtDebug.inbox.on()", { what: "AI 연결 꺼짐" });
			assert.equal(B.readHeartbeat(dir).hb.state, "off");
			const late = { v: 1, id: B.newId(), op: "status", args: {}, at: Date.now() };
			const lateFile = rawSend(late);
			await H.sleep(1500);
			assert.ok(fs.existsSync(lateFile), "끄면 가져가지 않는다");
			const off = await B.checkPanel(dir, { waitMs: 0 });
			assert.equal(off.code, "ai-link-off");
			log("(7) 끄기 → state off, 명령을 가져가지 않음");
		} finally {
			made.forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
			try {
				for (const x of await approvals()) if (q0.indexOf(x.rid) === -1) await panel(H.pageCmd("approvals.reject", { rid: x.rid }));
			} catch (e) {
				log("대기열 정리 경고: " + e.message);
			}
			await panel("window._mogrtDebug.inbox.set(" + (wasOn ? "true" : "false") + ")");
		}
	}
};
