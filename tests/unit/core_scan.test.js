"use strict";
// S2-1: core scanIndex — 호스트 트랙 스캔을 태그로 나눈다 (현재·옛 gen·자르기 중복·다른 salt·태그 없음).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");

const C = loadRegions(["src/mi/core.ts"]);
const clip = (sf, ef, nodeId, name) => ({ sf, ef, nodeId, name });
const ids = (list) => Array.from(list, (c) => c.nodeId);

test("parseClipTag / makeClipTag: uid = salt-id, 이름 끝의 태그만", () => {
	assert.deepEqual(plain(C.parseClipTag("철수 [MI:k7q2-57.2]")), { salt: "k7q2", id: 57, g: 2, uid: "k7q2-57" });
	assert.equal(C.parseClipTag("[MI:k7q2-57.2] 뒤에 글자"), null);
	assert.equal(C.parseClipTag("v27 클립"), null);
	assert.equal(C.parseClipTag(null), null);
	assert.equal(C.makeClipTag("ab12", 3, 1), "[MI:ab12-3.1]");
});

test("scanIndex: 현재·옛 gen·다른 salt·태그 없음·salt별 개수", () => {
	const scan = {
		ok: true,
		tracks: [
			{ i: 2, locked: false, clips: [clip(10, 40, "v27a", "[라온올제] 자막"), clip(50, 90, "a1", "철수 [MI:k7q2-1.1]"), clip(100, 140, "a2", "철수 [MI:k7q2-2.1]")] },
			{ i: 4, locked: true, clips: [clip(50, 90, "b1", "철수 [MI:k7q2-1.2]"), clip(200, 240, "f1", "영희 [MI:zz99-7.1]"), clip(300, 340, "b3", "영희 [MI:k7q2-3.1]")] }
		]
	};
	const x = C.scanIndex(scan, "k7q2");
	assert.deepEqual(Object.keys(x.own).sort(), ["k7q2-1", "k7q2-2", "k7q2-3"]);
	assert.deepEqual(ids(x.own["k7q2-1"]), ["b1", "a1"], "gen 내림차순");
	assert.deepEqual(plain(x.current["k7q2-1"]), { track: 4, sf: 50, ef: 90, nodeId: "b1", name: "철수 [MI:k7q2-1.2]", salt: "k7q2", id: 1, g: 2, uid: "k7q2-1" });
	assert.equal(x.current["k7q2-2"].nodeId, "a2");
	assert.equal(x.current["k7q2-3"].track, 4);
	assert.deepEqual(ids(x.stale), ["a1"], "낮은 gen은 정리 대상");
	assert.deepEqual(plain(x.dup), {});
	assert.deepEqual(ids(x.foreignMi), ["f1"]);
	assert.deepEqual(ids(x.untagged), ["v27a"]);
	assert.equal(x.untagged[0].track, 2);
	assert.deepEqual(plain(x.salts), { k7q2: 4, zz99: 1 });
});

test("scanIndex: 자르기(같은 이름 두 조각) → dup, current에 없음, 옛 gen은 여전히 stale", () => {
	const tracks = [{ i: 3, locked: false, clips: [
		clip(100, 150, "n1", "철수 [MI:ab12-5.2]"),
		clip(150, 220, "n9", "철수 [MI:ab12-5.2]"),
		clip(100, 220, "old", "철수 [MI:ab12-5.1]")
	] }];
	const x = C.scanIndex(tracks, "ab12");
	assert.equal(x.current["ab12-5"], undefined);
	assert.deepEqual(ids(x.dup["ab12-5"]).sort(), ["n1", "n9"]);
	assert.deepEqual(ids(x.stale), ["old"]);
});

test("scanIndex: salt가 비어 있으면 태그 클립은 모두 foreignMi (salt 복구 전)", () => {
	const scan = { tracks: [{ i: 2, clips: [clip(0, 10, "a", "x [MI:ab12-1.1]"), clip(20, 30, "b", "y [MI:cd34-2.1]"), clip(40, 50, "c", "z")] }] };
	const x = C.scanIndex(scan, "");
	assert.deepEqual(plain(x.own), {});
	assert.deepEqual(ids(x.foreignMi), ["a", "b"]);
	assert.deepEqual(plain(x.salts), { ab12: 1, cd34: 1 });
	assert.deepEqual(ids(x.untagged), ["c"]);
});

test("scanIndex: 태그는 이름에서 다시 읽는다 (호스트가 준 salt·id·g는 믿지 않는다), 빈 입력", () => {
	const scan = { tracks: [{ i: 2, clips: [{ sf: 0, ef: 10, nodeId: "a", name: "이름 바뀜", salt: "ab12", id: 1, g: 1 }] }] };
	const x = C.scanIndex(scan, "ab12");
	assert.deepEqual(ids(x.untagged), ["a"]);
	const e = C.scanIndex(null, "ab12");
	assert.deepEqual(plain(e), { own: {}, current: {}, stale: [], dup: {}, foreignMi: [], untagged: [], salts: {} });
});
