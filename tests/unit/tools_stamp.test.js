"use strict";
// S0-2: install_dev.sh / deploy_prod.sh가 쓰는 변환(tools/lib/stamp.js). 셸 스크립트 자체는 실행하지 않는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = require("../../tools/lib/stamp");
const { ROOT } = require("../lib/loadRegions");

const EXT = path.join(ROOT, "extension");
const read = (rel, base = EXT) => fs.readFileSync(path.join(base, rel), "utf8");

// v28 코드를 흉내 낸 조각 (S2-1 이후 모습): 호스트 MI_ 구역과 패널 상수·태그 정규식
const HOST_V28 = [
	"/* MI:BEGIN v28 */",
	"var MI_VERSION = 28, MI_BUILD = '@@BUILD@@';",
	"/* MI_PURE_BEGIN */",
	"function MI__json(v) { return String(v); }",
	"function MI__parseTag(name) { var m = String(name).match(/\\[MI:([0-9a-z]+)-(\\d+)\\.(\\d+)\\]/); return m; }",
	"/* MI_PURE_END */",
	"function MI_ping() { return MI__json({ build: MI_BUILD, prefix: \"MI_\" }); }",
	"/* MI:END */",
	""
].join("\n");
const PANEL_V28 = [
	"\tconst MI_PREFIX = \"MI_\";",
	"\tconst MI_BUILD_PANEL = \"@@BUILD@@\";",
	"\tconst MI_TAG_RE = /\\[MI:([0-9a-z]+)-(\\d+)\\.(\\d+)\\]/;",
	"\tfunction _callMi(name) { return MI_PREFIX + name; } // [MI:ab12-1.1] 태그는 그대로",
	""
].join("\n");

// full: extension 전체(벤더 js 포함) 복사. 아니면 변환 대상 파일만 (테스트 속도)
function tmpCopy(inject, full) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi_stamp_"));
	const items = full ? ["CSXS", "html", "jsx", "README.md", ".debug"] : ["CSXS/manifest.xml", ".debug", "jsx/hostscript.jsx", "html/js/app.js"];
	for (const item of items) {
		fs.cpSync(path.join(EXT, item), path.join(dir, item), { recursive: true });
	}
	if (inject) {
		fs.appendFileSync(path.join(dir, "jsx/hostscript.jsx"), "\n" + HOST_V28);
		const app = path.join(dir, "html/js/app.js");
		fs.writeFileSync(app, fs.readFileSync(app, "utf8").replace("(function() {\n", "(function() {\n" + PANEL_V28));
	}
	return dir;
}
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test("devManifest: 번들 id, 패널 id 2곳, 메뉴(DEV); 운영 id가 남지 않는다", () => {
	const out = S.devManifest(read("CSXS/manifest.xml"));
	assert.match(out, /ExtensionBundleId="com\.raonolje\.mogrtimporter\.dev"/);
	assert.equal(out.split("Id=\"com.raonolje.mogrtimporter.dev.panel\"").length - 1, 2);
	assert.match(out, /<Menu>MOGRT Subtitle Importer \(DEV\)<\/Menu>/);
	assert.doesNotMatch(out, /"com\.raonolje\.mogrtimporter(\.panel)?"/);
	assert.throws(() => S.devManifest(out), /이미 DEV/);
});

test("devDebug: 포트 7778, 패널 id .dev.panel", () => {
	const out = S.devDebug(read(".debug"));
	assert.match(out, /Port="7778"/);
	assert.doesNotMatch(out, /7777/);
	assert.match(out, /Id="com\.raonolje\.mogrtimporter\.dev\.panel"/);
	assert.throws(() => S.devDebug(out), /\.debug/);
});

test("rewriteMiPrefix: MI_test.prproj·도구 환경 변수는 식별자가 아니라 그대로", () => {
	const src = "if (String(app.project.path).indexOf(\"MI_test.prproj\") < 0) throw \"not test\"; var d = \"C:/x/MI_test/\"; " +
		"$.getenv(\"MI_REAL_CACHE\"); MI_CEP_EXT_DIR; MI_BACKUP_ROOT; MI_getTracks(p); MI_tests(); MI_test_x();";
	assert.equal(S.rewriteMiPrefix(src), "if (String(app.project.path).indexOf(\"MI_test.prproj\") < 0) throw \"not test\"; var d = \"C:/x/MI_test/\"; " +
		"$.getenv(\"MI_REAL_CACHE\"); MI_CEP_EXT_DIR; MI_BACKUP_ROOT; MID_getTracks(p); MID_tests(); MID_test_x();");
	assert.equal(S.findMiIdent("\"MI_test.prproj\" MI_REAL_CACHE"), null);
	assert.equal(S.findMiIdent("\"MI_test.prproj\" MI__json(1)"), "MI__json");
});

test("rewriteMiPrefix: MI_ 식별자 → MID_, [MI: 태그와 단어 중간은 그대로", () => {
	const src = "MI_ping(); MI__json(x); var p = \"MI_\"; var t = \"철수 [MI:ab12-1.1]\"; _MI_x; xMI_y; /* MI_PURE_BEGIN */";
	const out = S.rewriteMiPrefix(src);
	assert.equal(out, "MID_ping(); MID__json(x); var p = \"MID_\"; var t = \"철수 [MI:ab12-1.1]\"; _MI_x; xMI_y; /* MID_PURE_BEGIN */");
	assert.doesNotMatch(out, /\bMI_/);
});

test("stampBuild / checkBuild", () => {
	assert.equal(S.stampBuild("a @@BUILD@@ b @@BUILD@@", "dev-0aa8b82"), "a dev-0aa8b82 b dev-0aa8b82");
	assert.equal(S.checkBuild("dev-0aa8b82-d20260925120000"), "dev-0aa8b82-d20260925120000");
	assert.equal(S.checkBuild("prod-3f2a1c9"), "prod-3f2a1c9");
	for (const bad of ["", "dev-", "dev-xyz1234", "beta-0aa8b82", "prod-0aa8b82 rm -rf"]) {
		assert.throws(() => S.checkBuild(bad), /빌드 스탬프/, bad);
	}
});

// 임시 사본은 Windows에서 만들기가 느리다 → 한 번씩만 만들어 여러 테스트가 같이 쓴다
const D = {};
test.before(() => {
	D.orig = tmpCopy(true); // v28 모양, 변환 전
	D.dev = tmpCopy(true); // v28 모양 → stageDev
	D.prod = tmpCopy(true); // v28 모양 → stageProd
	D.v27 = tmpCopy(false, true); // 지금 extension 전체 → stageDev
	S.stageDev(D.dev, "dev-0aa8b82");
	S.stageProd(D.prod, "prod-3f2a1c9");
	S.stageDev(D.v27, "dev-0aa8b82-d20260925120000");
});
test.after(() => Object.values(D).forEach(rm));

test("stageDev: v28 모양 사본에서 MI_ 식별자가 사라지고 [MI: 태그 정규식은 남는다", () => {
	assert.deepEqual(S.verifyDev(D.dev, D.orig), []);
	const host = read("jsx/hostscript.jsx", D.dev);
	const app = read("html/js/app.js", D.dev);
	for (const s of [host, app]) {
		assert.doesNotMatch(s, /\bMI_/);
		assert.ok(s.includes("[MI:"), "태그 정규식의 [MI: 가 남아야 한다");
		assert.doesNotMatch(s, /@@BUILD@@/);
	}
	assert.match(host, /var MID_VERSION = 28, MID_BUILD = 'dev-0aa8b82';/);
	assert.match(host, /function MID_ping\(\)/);
	assert.ok(host.includes("match(/\\[MI:([0-9a-z]+)-"), "호스트 태그 정규식 그대로");
	assert.match(app, /const MID_PREFIX = "MID_";/);
	assert.match(app, /const MID_BUILD_PANEL = "dev-0aa8b82";/);
	assert.ok(app.includes("const MID_TAG_RE = /\\[MI:("), "패널 태그 정규식 그대로");
	assert.equal(S.buildOfHost(host), "dev-0aa8b82");
	// 저장소 파일은 그대로다
	assert.doesNotMatch(read("CSXS/manifest.xml"), /\.dev/);
});

test("verifyDev: [MI: 개수가 원본과 다르면 잡는다", () => {
	const src = fs.mkdtempSync(path.join(os.tmpdir(), "mi_stamp_src_"));
	try {
		fs.mkdirSync(path.join(src, "html", "js"), { recursive: true });
		fs.writeFileSync(path.join(src, "html", "js", "app.js"), read("html/js/app.js", D.orig) + "// [MI:extra]\n");
		assert.ok(S.verifyDev(D.dev, src).some((p) => /\[MI: 개수/.test(p)));
	} finally { rm(src); }
});

test("verifyDev: MI_ 가 남거나 신원이 운영이면 잡는다", () => {
	const p = S.verifyDev(D.orig, null);
	assert.ok(p.some((x) => /MI_ 식별자/.test(x)));
	assert.ok(p.some((x) => /번들 id/.test(x)));
	assert.ok(p.some((x) => /포트/.test(x)));
	assert.ok(p.some((x) => /@@BUILD@@/.test(x)));
});

test("stageDev: 지금 사본도 통과한다 (MI_ → MID_와 빌드 스탬프 말고는 그대로, 벤더 js 포함)", () => {
	const build = "dev-0aa8b82-d20260925120000";
	assert.deepEqual(S.verifyDev(D.v27, EXT), []);
	// S2-1부터 호스트에 MI_ 구역(MI_BUILD = "@@BUILD@@")이 있다 → DEV 사본은 MID_ + 스탬프
	const host = read("jsx/hostscript.jsx", D.v27);
	assert.equal(host, S.stampBuild(S.rewriteMiPrefix(read("jsx/hostscript.jsx")), build));
	assert.match(host, /function MID_ping\(\)/);
	assert.equal(S.buildOfHost(host), build);
	// 패널 상수 MI_CAST_ENABLED(S1-7)·MI_PREFIX·MI_BUILD_PANEL(S2-1)도 DEV에서는 MID_…가 된다 (파일 안에서 한결같이 바뀐다)
	const app = read("html/js/app.js", D.v27);
	assert.equal(app, S.stampBuild(S.rewriteMiPrefix(read("html/js/app.js")), build));
	assert.match(app, /const MID_PREFIX = "MID_";/);
	assert.match(app, new RegExp("const MID_BUILD_PANEL = \"" + build + "\";"));
	assert.equal(read("html/CSInterface.js", D.v27), read("html/CSInterface.js"));
});

test("stageProd: 스탬프만 찍고 MI_·신원·포트는 그대로", () => {
	assert.deepEqual(S.verifyProd(D.prod), []);
	const host = read("jsx/hostscript.jsx", D.prod);
	assert.match(host, /MI_BUILD = 'prod-3f2a1c9'/);
	assert.match(host, /function MI_ping\(\)/);
	assert.equal(read("CSXS/manifest.xml", D.prod), read("CSXS/manifest.xml"));
	assert.equal(read(".debug", D.prod), read(".debug"));
	assert.throws(() => S.stageProd(D.orig, "dev-3f2a1c9"), /prod-/);
	assert.throws(() => S.stageDev(D.orig, "prod-3f2a1c9"), /dev-/);
});

test("verifyProd: DEV 사본은 운영으로 통과하지 못한다", () => {
	const p = S.verifyProd(D.dev);
	assert.ok(p.some((x) => /MID_/.test(x)));
	assert.ok(p.some((x) => /번들 id|DEV id/.test(x)));
	assert.ok(p.some((x) => /포트/.test(x)));
});

test("CLI: 사용법 오류는 종료 코드 2", () => {
	assert.equal(S.CODE_FILES.length, 2);
	const { spawnSync } = require("node:child_process");
	const r = spawnSync(process.execPath, [path.join(ROOT, "tools/lib/stamp.js")], { encoding: "utf8" });
	assert.equal(r.status, 2);
});

test("셸 스크립트: 운영 경로에 쓰는 명령이 없다 (정적 검사)", () => {
	const inst = read("tools/install_dev.sh", ROOT);
	const dep = read("tools/deploy_prod.sh", ROOT);
	// install_dev: 쓰기 명령(cp/mv/mkdir/rm)의 마지막 인자(대상)가 $PROD 인 줄이 없어야 한다 (운영은 읽기 원본으로만)
	for (const ln of inst.split("\n")) {
		if (/^\s*#/.test(ln)) continue;
		const m = ln.match(/\b(cp|mv|mkdir|rm)\b[^;|&]*/);
		if (!m) continue;
		const args = m[0].trim().split(/\s+/);
		const dest = args[args.length - 1];
		assert.ok(!/\$PROD|\$\{PROD\}/.test(dest), "install_dev.sh가 운영 경로에 쓴다: " + ln.trim());
	}
	assert.match(inst, /CEP_MogrtImporter_dev/);
	assert.match(inst, /--uninstall/);
	// deploy_prod: 백업은 extensions/ 밖, Premiere 실행 중 거부, dry-run, rollback, 운영 폴더를 지우지 않는다
	assert.match(dep, /MOGRT_Importer_backup/);
	assert.match(dep, /Adobe Premiere Pro\.exe/);
	assert.match(dep, /--dry-run/);
	assert.match(dep, /--rollback/);
	assert.doesNotMatch(dep, /\brm\s+-rf?\s+(--\s+)?"?\$PROD/);
});
