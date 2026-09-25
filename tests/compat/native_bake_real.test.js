"use strict";
// S1-11 호환 (읽기 전용): 설치된 Premiere 네이티브 템플릿에 core 굽기 함수를 그대로 돌린다.
// MOGRT 폴더(MI_MOGRT_ROOT, 기본 %APPDATA%/Adobe/Common/Motion Graphics Templates)가 있을 때만 돈다.
// 파일은 메모리에서만 풀고 고친다 (디스크에 쓰지 않는다). 출력은 템플릿 이름과 개수뿐이다.
//   - Classic Lower Third Two Lines: definition TextLayer 2개, 모든 project*.prgraphic(지역화 포함)의 Source Text 2개를
//     순서대로 바꾸고(한글), 텍스트가 아닌 블롭은 그대로, 빈 요소 참조가 끊기지 않는다
//   - authorApp "ppro" 템플릿 전부: prgraphic마다 찾은 Source Text 블롭 수가 TextLayer 수와 같거나 0(새 이진 형식 → 굽지 않는다)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { loadRegions } = require("../lib/loadRegions");
const M = require("../fixtures/mogrt/make_old_mogrt");
const N = require("../fixtures/mogrt/make_native_mogrt");

const core = loadRegions(["src/mi/core.ts"]);
const ROOT = M.mogrtRoot();
const CLASSIC = path.join(ROOT, "Lower Thirds", "Classic Lower Third Two Lines.mogrt");

// .mogrt → {def 글자, graphics: [{name, xml}]}
function openMogrt(file) {
	const entries = M.readZip(fs.readFileSync(file));
	const d = entries.find((e) => e.name === "definition.json");
	const graphics = [];
	entries.filter((e) => /(^|\/)project[^/]*\.prgraphic$/i.test(e.name)).forEach((e) => {
		M.readZip(e.data).filter((ie) => /\.prproj$/i.test(ie.name)).forEach((ie) => {
			const gz = ie.data[0] === 0x1f && ie.data[1] === 0x8b;
			graphics.push({ name: e.name, entry: ie.name, xml: (gz ? zlib.gunzipSync(ie.data) : ie.data).toString("utf8") });
		});
	});
	return { def: d ? d.data.toString("utf8") : null, graphics };
}

test("설치된 Classic Lower Third Two Lines: definition·모든 prgraphic(지역화 포함)의 문구 두 개를 순서대로 굽는다", { skip: fs.existsSync(CLASSIC) ? false : "템플릿 없음: " + CLASSIC }, () => {
	const m = openMogrt(CLASSIC);
	const texts = ["구운 이름 합성 가나다", "구운 제목\n두 줄 합성"];
	const def = core.patchNativeDefinition(m.def, texts, core.uuidFromHash(core.nativeBakeKey(CLASSIC, 1, texts)));
	assert.equal(def.textLayers, 2);
	const d = JSON.parse(def.json);
	assert.match(d.capsuleName, / \[MI\]$/);
	assert.deepEqual(d.clientControls.filter((c) => c.type === 6).map((c) => c.value.strDB[0].str), ["구운 이름 합성 가나다", "구운 제목\r두 줄 합성"]);
	assert.ok(m.graphics.length >= 2, "project.prgraphic과 지역화 파일");
	m.graphics.forEach((g) => {
		const before = N.xmlTexts(g.xml);
		assert.equal(before.texts.length, 2, g.name + " Source Text 2개 (지역화 파일은 이름이 번역되어 있다)");
		const r = core.patchPrprojTexts(g.xml, texts);
		assert.deepEqual([r.count, r.patched], [2, 2], g.name);
		const after = N.xmlTexts(r.xml);
		assert.deepEqual(after.texts, ["구운 이름 합성 가나다", "구운 제목\r두 줄 합성"], g.name + " 순서");
		after.refs.forEach((h) => assert.ok(h in after.full, g.name + " 끊긴 참조 없음"));
		// 텍스트가 아닌 블롭(Path, Appearance …)은 그대로
		const others = (x) => Object.keys(x.full).filter((h) => N.blobText(x.full[h]) === null).map((h) => h + "=" + x.full[h]).sort();
		assert.deepEqual(others(after), others(before), g.name + " 다른 블롭 그대로");
	});
});

test("설치된 네이티브 템플릿 전부: prgraphic마다 Source Text 블롭 수 = TextLayer 수, 아니면 0 (새 이진 형식은 굽지 않는다)", { skip: fs.existsSync(ROOT) ? false : "MOGRT 폴더 없음: " + ROOT }, () => {
	const files = M.listMogrts(ROOT, 0);
	let native = 0;
	const unbakeable = [];
	files.forEach((f) => {
		let m;
		try {
			m = openMogrt(f);
		} catch (_) {
			return;
		}
		let def;
		try {
			def = JSON.parse(String(m.def || "").replace(/^\uFEFF/, ""));
		} catch (_) {
			return;
		}
		if (!def || def.authorApp !== "ppro") return;
		native++;
		const layers = (def.clientControls || []).filter((c) => c && Number(c.type) === 6).length;
		const counts = m.graphics.map((g) => core.patchPrprojTexts(g.xml, []).count);
		counts.forEach((n, k) => assert.ok(n === layers || n === 0, path.relative(ROOT, f) + " " + m.graphics[k].name + ": Source Text " + n + " · TextLayer " + layers));
		if (counts.some((n) => n !== layers)) unbakeable.push(path.relative(ROOT, f));
	});
	console.log("네이티브 템플릿 " + native + "개, 굽지 못하는 것(새 형식) " + unbakeable.length + "개" + (unbakeable.length ? ": " + unbakeable.join(", ") : ""));
});
