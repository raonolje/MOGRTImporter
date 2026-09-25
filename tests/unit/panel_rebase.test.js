"use strict";
// S1-10: 프리셋 저장의 T-ID 구조 맞춤(후반 작업 유지), 못 옮긴 텍스트, '현재 구조로 맞추기'(옛 구조 줄), 학습 필드 — panelHarness
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/rebase.prproj";
const A = { seqId: "rbse-0001", seqName: "T_RB", projPath: PROJ };
const clone = (v) => JSON.parse(JSON.stringify(v));
const pick = (list, idx) => list.find((p) => p.index === idx);

function sub(id, index, text) {
	const tc = (x) => "00:00:" + String(Math.floor(x)).padStart(2, "0") + ".000";
	return { index, startTime: tc(index * 2), endTime: tc(index * 2 + 1), startSec: index * 2, endSec: index * 2 + 1, text, id };
}
// 프리셋에서 채운 줄 (캡션 = 문장), edit(all)로 값을 고친다
function rowOf(preset, text, setText, edit) {
	const all = clone(preset.params);
	const cap = pick(all, preset.textParamIndex);
	if (cap) setText(cap, text);
	if (edit) edit(all);
	return { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
}
function setText(p, text) {
	p.value = text;
	if (typeof p.rawValue === "string" && p.rawValue.indexOf("textEditValue") !== -1) {
		const r = JSON.parse(p.rawValue);
		r.textEditValue = text;
		r.fontTextRunLength = [text.length];
		p.rawValue = JSON.stringify(r);
	}
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
const safetyList = (h) => h.fs.readJson(P.historySafety(PROJ, A.seqId)) || [];
const confirmOpen = (h) => h.$("confirmModal").classList.contains("open");
async function boot(presets, sess, extra) {
	const h = await bootPanel(Object.assign({
		seq: A,
		mogrts: Object.values(presets).map((p) => ({ name: p.name, path: p.mogrtPath })),
		params: Object.fromEntries(Object.values(presets).map((p) => [p.mogrtPath, clone(p.params)])),
		files: { [P.presets(PROJ)]: { presets, presetTrash: [], nextPresetId: 9 }, [P.session(PROJ, A.seqId)]: sess }
	}, extra || {}));
	await h.advance(1000);
	return h;
}
async function openEdit(h, name) {
	const cards = h.$("presetList").querySelectorAll("button").filter((b) => b.textContent === "편집");
	const names = Object.values(h.snapshot().presets).map((p) => p.name);
	cards[name ? names.indexOf(name) : 0].click();
	await h.flush();
	await h.advance(10);
}

test("프리셋 저장: 줄의 T2(후반 작업)·캡션이 남고 노출 안 된 속성만 프리셋 값 (v27은 T2를 지웠다)", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const sess = {
		subtitles: [sub(1, 1, "밴드 캡션 하나"), sub(2, 2, "밴드 캡션 둘")],
		rowStates: {
			1: rowOf(p3, "밴드 캡션 하나", setText, (all) => { setText(pick(all, 2), "캡션$$하나"); pick(all, 3).colorHex = "#00ff00"; }),
			2: rowOf(p3, "패널에서 고친 캡션", setText)
		},
		trashBin: [],
		nextId: 3
	};
	const h = await boot({ preset_3: p3 }, sess);
	await openEdit(h);
	h.$("presetNameInput").value = "고친 밴드";
	h.$("btnSaveDefault").click();
	assert.equal(confirmOpen(h), true);
	const msg = h.$("confirmMessage").textContent;
	assert.match(msg, /^이 프리셋은 현재 2개의 자막에 사용 중입니다\.\n저장하면 해당 자막의 속성이 업데이트됩니다\.\n텍스트 필드와 줄마다 바꾼 노출 속성은 유지됩니다\.\n계속하시겠습니까\?$/);
	h.$("confirmYes").click();
	await h.flush();
	const s = h.snapshot();
	const r1 = s.rowStates[1]._allParams;
	assert.equal(pick(r1, 2).value, "캡션$$하나", "T2 그대로 (v27은 프리셋 기본값 '" + pick(p3.params, 2).value + "')");
	assert.equal(pick(r1, 1).value, "밴드 캡션 하나");
	assert.equal(pick(r1, 3).colorHex, pick(p3.params, 3).colorHex, "노출 안 된 밴드 색상은 프리셋 값");
	assert.equal(pick(s.rowStates[2]._allParams, 1).value, "패널에서 고친 캡션", "캡션은 줄의 캡션 필드 (sub.text가 아니다)");
	assert.ok(s.rowStates[1].params.every((p) => p.type === "text"), "노출 목록 다시 고름");
	assert.equal(s.rowStates[1].psOld, undefined, "구조가 같으면 psOld 없음");
	assert.equal(s.rowStates[1].orphanFields, undefined);
	assert.deepEqual(safetyList(h).map((e) => e.label), ["프리셋 저장 전: 고친 밴드"]);
	const saved = h.fs.readJson(P.session(PROJ, A.seqId));
	assert.equal(pick(saved.rowStates[1]._allParams, 2).value, "캡션$$하나", "session.json에도");
	assert.deepEqual(Object.keys(saved), ["subtitles", "rowStates", "trashBin", "nextId"]);
	assert.equal(s.presets.preset_3.name, "고친 밴드");
	noErrors(h);
});

test("구조가 바뀐 MOGRT로 저장: 이름이 바뀐 텍스트는 못 옮김(확인창에 개수, 줄에 표시), psOld, 표시를 눌러 지운다", async () => {
	const { presets } = build();
	const p6 = presets.preset_6;
	const sess = {
		subtitles: [sub(1, 1, "첫 줄 캡션")],
		rowStates: { 1: rowOf(p6, "첫 줄 캡션", setText, (all) => setText(pick(all, 2), "둘째 줄 후반")) },
		trashBin: [],
		nextId: 2
	};
	const renamed = clone(p6.params);
	pick(renamed, 2).displayName = "두 번째 자막";
	const h = await boot({ preset_6: p6 }, sess, { params: { [p6.mogrtPath]: renamed } });
	await openEdit(h);
	h.$("btnSaveDefault").click();
	assert.match(h.$("confirmMessage").textContent, /\n자리를 찾지 못한 텍스트 1개는 줄에 따로 남깁니다\.\n계속하시겠습니까\?$/);
	h.$("confirmYes").click();
	await h.flush();
	const rs = h.snapshot().rowStates[1];
	assert.deepEqual(rs.orphanFields, [{ displayName: "자막 2 텍스트", value: "둘째 줄 후반" }]);
	assert.match(rs.psOld, /^[0-9a-f]{8}$/, "구조가 바뀌어 psOld");
	assert.equal(pick(rs._allParams, 2).displayName, "두 번째 자막");
	assert.equal(pick(rs._allParams, 0).value, "첫 줄 캡션");
	const orph = h.$("row-1").querySelector(".sub-orph");
	assert.equal(orph.textContent, "못 옮김 1");
	assert.match(orph.title, /자막 2 텍스트: 둘째 줄 후반/);
	orph.click();
	assert.match(h.$("confirmMessage").textContent, /^구조를 맞출 때 자리를 찾지 못한 텍스트 1개:\n\n자막 2 텍스트: 둘째 줄 후반\n/);
	assert.deepEqual([h.$("confirmYes").textContent, h.$("confirmNo").textContent], ["목록에서 지우기", "그대로 두기"]);
	h.$("confirmYes").click();
	assert.equal(h.snapshot().rowStates[1].orphanFields, undefined);
	assert.equal(h.$("row-1").querySelector(".sub-orph"), null);
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).rowStates[1].orphanFields, undefined, "저장");
	noErrors(h);
});

test("옛 구조 줄: '구조' 표시와 '옛 구조 줄 N개 맞추기' → 안전 지점 '구조 맞춤 전', 15속성·T1 캡션·psOld, 적용은 부르지 않고 ▶는 이름으로", async () => {
	const { presets, STALE_1 } = build();
	const p1 = presets.preset_1;
	const staleRow = (text, point) => {
		const all = clone(STALE_1);
		setText(all[0], text);
		setText(all[2], point);
		return { presetId: "preset_1", params: all.filter((p) => p.type === "text"), _allParams: all, open: false, checked: false };
	};
	const sess = { subtitles: [sub(1, 1, "옛 캡션 하나"), sub(2, 2, "옛 캡션 둘")], rowStates: { 1: staleRow("옛 캡션 하나", "캡션$$하나"), 2: staleRow("옛 캡션 둘", "캡션$$둘") }, trashBin: [], nextId: 3 };
	const h = await boot({ preset_1: p1 }, sess);
	const btn = h.$("btnRebaseStale");
	assert.deepEqual([btn.style.display, btn.textContent], ["", "옛 구조 줄 2개 맞추기"]);
	assert.equal(h.$("row-1").querySelector(".sub-struct").textContent, "구조");
	// 한 줄만 (표시)
	h.$("row-1").querySelector(".sub-struct").click();
	assert.match(h.$("confirmMessage").textContent, /^#1 줄의 속성을 지금 프리셋 구조로 맞춥니다\./);
	assert.equal(h.$("confirmYes").textContent, "현재 구조로 맞추기");
	h.$("confirmYes").click();
	await h.flush();
	let s = h.snapshot();
	assert.deepEqual(s.rowStates[1]._allParams.map((p) => [p.index, p.displayName]), p1.params.map((p) => [p.index, p.displayName]));
	assert.deepEqual([pick(s.rowStates[1]._allParams, 4).value, pick(s.rowStates[1]._allParams, 6).value], ["옛 캡션 하나", "캡션$$하나"], "T1 캡션·T2");
	assert.match(s.rowStates[1].psOld, /^[0-9a-f]{8}$/);
	assert.equal(s.rowStates[2]._allParams.length, STALE_1.length, "다른 줄은 그대로");
	assert.equal(h.$("row-1").querySelector(".sub-struct"), null, "맞춘 줄은 표시 없음");
	assert.equal(btn.textContent, "옛 구조 줄 1개 맞추기");
	assert.deepEqual(h.fs.readJson(P.historySafety(PROJ, A.seqId)).map((e) => e.label), ["구조 맞춤 전"]);
	// 나머지 전부 (버튼)
	btn.click();
	assert.match(h.$("confirmMessage").textContent, /^옛 구조 줄 1개의 속성을 지금 프리셋 구조로 맞춥니다\./);
	h.$("confirmYes").click();
	await h.flush();
	s = h.snapshot();
	assert.equal(s.rowStates[2]._allParams.length, p1.params.length);
	assert.equal(btn.style.display, "none");
	assert.equal(h.status().text, "구조 맞춤: 1줄");
	assert.deepEqual(h.host.calls.filter((c) => /^(applyToTimeline|updateClipAtTime)$/.test(c.fn)), [], "적용은 부르지 않는다");
	// ▶: psOld → 구조가 바뀐 줄 → 안전하게 적용은 이름으로만
	h.host.handlers.updateClipAtTime = () => "SUCCESS: 클립 업데이트 완료";
	h.$("btnApply").click();
	await h.flush();
	assert.match(h.$("confirmMessage").textContent, /^구조가 바뀐 줄 2개가 있습니다\./);
	h.$("confirmYes").click();
	for (let i = 0; i < 4; i++) await h.flush();
	const sent = h.host.calls.filter((c) => c.fn === "updateClipAtTime").map((c) => JSON.parse(c.args[0]));
	assert.equal(sent.length, 2);
	sent.forEach((p, k) => {
		assert.equal(p.mogrtPath, "");
		assert.ok(p.params.every((x) => x.index === -1), "이름으로만");
		assert.equal(p.params.find((x) => x.displayName === "전체 텍스트").value, ["옛 캡션 하나", "옛 캡션 둘"][k]);
	});
	assert.ok(h.snapshot().rowStates[1].psOld, "적용 뒤에도 psOld (클립은 여전히 옛 구조)");
	noErrors(h);
});

test("프리셋 저장은 배치에서 배운 필드(mogrtItemName 등)를 MOGRT가 같을 때만 가져간다", async () => {
	const { presets } = build();
	const p3 = Object.assign(clone(presets.preset_3), { mogrtItemName: "합성 항목", mogrtDurSec: 5.005, mogrtLs: "5b1f0e2d", mogrtBaseComps: 3 });
	const other = { name: "다른 MOGRT", path: "D:/MOGRT/다른.mogrt" };
	const h = await boot({ preset_3: p3 }, { subtitles: [], rowStates: {}, trashBin: [], nextId: 1 }, { mogrts: [{ name: p3.name, path: p3.mogrtPath }, other], params: { [p3.mogrtPath]: clone(p3.params), [other.path]: clone(p3.params) } });
	await openEdit(h);
	h.$("btnSaveDefault").click();
	let saved = h.snapshot().presets.preset_3;
	assert.deepEqual([saved.mogrtItemName, saved.mogrtDurSec, saved.mogrtLs, saved.mogrtBaseComps], ["합성 항목", 5.005, "5b1f0e2d", 3]);
	await openEdit(h);
	h.$("defaultMogrtSel").value = other.path;
	h.$("btnSaveDefault").click();
	saved = h.snapshot().presets.preset_3;
	assert.equal(saved.mogrtPath, other.path);
	assert.deepEqual([saved.mogrtItemName, saved.mogrtDurSec, saved.mogrtLs, saved.mogrtBaseComps], [undefined, undefined, undefined, undefined], "다른 MOGRT면 버린다");
	noErrors(h);
});
