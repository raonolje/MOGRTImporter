#!/usr/bin/env node
"use strict";
/**
 * install_dev.sh / deploy_prod.sh가 임시 사본(stage)에 적용하는 텍스트 변환과 검증.
 * 셸 스크립트는 복사·백업·보호만 하고, 바꾸는 규칙은 모두 여기 있다(npm test로 검증).
 *
 *   node tools/lib/stamp.js dev   <stageDir> <build>     DEV 신원 + \bMI_→MID_ + @@BUILD@@
 *   node tools/lib/stamp.js prod  <stageDir> <build>     @@BUILD@@만
 *   node tools/lib/stamp.js verify-dev  <dir> <srcDir>   DEV 사본 검사 (문제가 있으면 종료 코드 1)
 *   node tools/lib/stamp.js verify-prod <dir>            운영 사본 검사
 *
 * <stageDir>/<dir>는 extension/ 과 같은 구조(CSXS, html, jsx, README.md, .debug)다.
 */
const fs = require("node:fs");
const path = require("node:path");

const PROD_BUNDLE = "com.raonolje.mogrtimporter";
const PROD_PANEL = "com.raonolje.mogrtimporter.panel";
const DEV_BUNDLE = "com.raonolje.mogrtimporter.dev";
const DEV_PANEL = "com.raonolje.mogrtimporter.dev.panel";
const MENU = "MOGRT Subtitle Importer";
const DEV_MENU = "MOGRT Subtitle Importer (DEV)";
const PROD_PORT = "7777";
const DEV_PORT = "7778";

// \bMI_ 이름 바꾸기와 빌드 스탬프를 적용하는 파일 (spec S0-2 (3)(4))
const CODE_FILES = ["jsx/hostscript.jsx", "html/js/app.js"];
const BUILD_TOKEN = "@@BUILD@@";
const BUILD_RE = /^(dev|prod)-[0-9a-f]{7,40}(-[0-9A-Za-z.]+)?$/;

function _count(s, needle) {
	return s.split(needle).length - 1;
}

function _replaceExact(s, from, to, expected, what) {
	const n = _count(s, from);
	if (n !== expected) throw new Error(what + ": '" + from + "'가 " + expected + "번 있어야 하는데 " + n + "번");
	return s.split(from).join(to);
}

/** 운영 manifest.xml → DEV (번들 id, 패널 id 2곳, 메뉴, 번들 이름) */
function devManifest(xml) {
	if (xml.indexOf(DEV_BUNDLE) !== -1) throw new Error("manifest: 이미 DEV 신원이다 (원본 manifest가 아님)");
	let s = xml;
	s = _replaceExact(s, "ExtensionBundleId=\"" + PROD_BUNDLE + "\"", "ExtensionBundleId=\"" + DEV_BUNDLE + "\"", 1, "manifest");
	s = _replaceExact(s, "Id=\"" + PROD_PANEL + "\"", "Id=\"" + DEV_PANEL + "\"", 2, "manifest");
	s = _replaceExact(s, "<Menu>" + MENU + "</Menu>", "<Menu>" + DEV_MENU + "</Menu>", 1, "manifest");
	s = _replaceExact(s, "ExtensionBundleName=\"" + MENU + "\"", "ExtensionBundleName=\"" + DEV_MENU + "\"", 1, "manifest");
	return s;
}

/** 운영 .debug → DEV (패널 id, 포트 7778) */
function devDebug(xml) {
	let s = xml;
	s = _replaceExact(s, "Id=\"" + PROD_PANEL + "\"", "Id=\"" + DEV_PANEL + "\"", 1, ".debug");
	s = _replaceExact(s, "Port=\"" + PROD_PORT + "\"", "Port=\"" + DEV_PORT + "\"", 1, ".debug");
	return s;
}

// \bMI_로 시작하지만 v28 식별자가 아닌 이름: 테스트 프로젝트(MI_test.prproj, MI_test/ 폴더)와
// 도구 환경 변수. DEV 사본·DEV용 .jsx에서도 그대로 둔다 (MI_test.prproj를 확인하는 코드가 DEV에서 늘 실패하지 않게)
const MI_KEEP = ["test", "REAL_CACHE", "CEP_EXT_DIR", "BACKUP_ROOT"];
const MI_IDENT_SRC = "\\bMI_(?!(?:" + MI_KEEP.join("|") + ")\\b)";

/**
 * \bMI_ → MID_ (MI__helper → MID__helper, "MI_" → "MID_").
 * 클립 태그 [MI: 는 밑줄이 없어서 그대로다. _MI_x, xMI_ 처럼 단어 중간은 건드리지 않는다.
 * MI_KEEP(MI_test, MI_REAL_CACHE …)은 식별자가 아니라서 그대로 둔다.
 * tests/premiere/run.js도 DEV용 .jsx를 이 함수로 바꾼다.
 */
function rewriteMiPrefix(src) {
	return String(src).replace(new RegExp(MI_IDENT_SRC, "g"), "MID_");
}

/** 바꿀 MI_ 식별자가 남아 있으면 그 첫 이름, 없으면 null */
function findMiIdent(src) {
	const m = String(src).match(new RegExp(MI_IDENT_SRC + "\\w*"));
	return m ? m[0] : null;
}

function checkBuild(build) {
	if (!BUILD_RE.test(String(build))) throw new Error("빌드 스탬프 형식이 아니다: " + build + " (dev-<sha>[-…] | prod-<sha>)");
	return build;
}

function stampBuild(src, build) {
	checkBuild(build);
	return src.split(BUILD_TOKEN).join(build);
}

function _rw(dir, rel, fn) {
	const f = path.join(dir, rel);
	if (!fs.existsSync(f)) return false;
	const before = fs.readFileSync(f, "utf8");
	const after = fn(before);
	if (after !== before) fs.writeFileSync(f, after, "utf8");
	return true;
}

/** stage를 DEV 사본으로 바꾼다 */
function stageDev(dir, build) {
	checkBuild(build);
	if (!/^dev-/.test(build)) throw new Error("DEV 빌드는 dev-로 시작해야 한다: " + build);
	if (!_rw(dir, "CSXS/manifest.xml", devManifest)) throw new Error("CSXS/manifest.xml 없음: " + dir);
	if (!_rw(dir, ".debug", devDebug)) throw new Error(".debug 없음: " + dir);
	for (const rel of CODE_FILES) {
		if (!_rw(dir, rel, (s) => stampBuild(rewriteMiPrefix(s), build))) throw new Error(rel + " 없음: " + dir);
	}
}

/** stage에 운영 빌드 스탬프만 찍는다 (MI_ 그대로, 신원 그대로) */
function stageProd(dir, build) {
	checkBuild(build);
	if (!/^prod-/.test(build)) throw new Error("운영 빌드는 prod-로 시작해야 한다: " + build);
	for (const rel of CODE_FILES) {
		if (!_rw(dir, rel, (s) => stampBuild(s, build))) throw new Error(rel + " 없음: " + dir);
	}
}

/** dir 아래 텍스트 코드 파일 (html, jsx의 .js/.jsx/.html) */
function _codeFiles(dir) {
	const out = [];
	const walk = (d) => {
		if (!fs.existsSync(d)) return;
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.(js|jsx|html)$/i.test(e.name)) out.push(p);
		}
	};
	walk(path.join(dir, "html"));
	walk(path.join(dir, "jsx"));
	return out;
}

function _read(dir, rel) {
	const f = path.join(dir, rel);
	return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}

/**
 * DEV 사본 검사. 문제 목록을 돌려준다(빈 배열이면 통과).
 * - \bMI_ 식별자가 하나도 없다 (html, jsx 전체. MI_test 같은 MI_KEEP 이름은 제외)
 * - [MI: 개수가 원본과 같다 (태그 정규식은 그대로)
 * - manifest/.debug가 DEV 신원·포트 7778이다
 * - @@BUILD@@가 남지 않았다
 */
function verifyDev(dir, srcDir) {
	const problems = [];
	for (const f of _codeFiles(dir)) {
		const s = fs.readFileSync(f, "utf8");
		const left = findMiIdent(s);
		if (left) problems.push("MI_ 식별자가 남았다: " + path.relative(dir, f) + " (" + left + ")");
		if (s.indexOf(BUILD_TOKEN) !== -1) problems.push("@@BUILD@@가 남았다: " + path.relative(dir, f));
	}
	if (srcDir) {
		for (const rel of CODE_FILES) {
			const a = _read(srcDir, rel);
			const b = _read(dir, rel);
			if (a === null || b === null) continue;
			if (_count(a, "[MI:") !== _count(b, "[MI:")) problems.push("[MI: 개수가 다르다: " + rel);
		}
	}
	const man = _read(dir, "CSXS/manifest.xml") || "";
	if (_count(man, "ExtensionBundleId=\"" + DEV_BUNDLE + "\"") !== 1) problems.push("manifest 번들 id가 " + DEV_BUNDLE + "가 아니다");
	if (_count(man, "Id=\"" + DEV_PANEL + "\"") !== 2) problems.push("manifest 패널 id 2곳이 " + DEV_PANEL + "가 아니다");
	if (man.indexOf("<Menu>" + DEV_MENU + "</Menu>") === -1) problems.push("manifest 메뉴가 '" + DEV_MENU + "'가 아니다");
	if (/"com\.raonolje\.mogrtimporter(\.panel)?"/.test(man)) problems.push("manifest에 운영 id가 남았다");
	const dbg = _read(dir, ".debug") || "";
	if (dbg.indexOf("Port=\"" + DEV_PORT + "\"") === -1 || dbg.indexOf("Port=\"" + PROD_PORT + "\"") !== -1) problems.push(".debug 포트가 " + DEV_PORT + "가 아니다");
	if (dbg.indexOf("Id=\"" + DEV_PANEL + "\"") === -1) problems.push(".debug 패널 id가 " + DEV_PANEL + "가 아니다");
	return problems;
}

/** 운영 사본 검사: 운영 신원·포트 7777, @@BUILD@@ 없음, MID_ 없음 */
function verifyProd(dir) {
	const problems = [];
	for (const f of _codeFiles(dir)) {
		const s = fs.readFileSync(f, "utf8");
		if (s.indexOf(BUILD_TOKEN) !== -1) problems.push("@@BUILD@@가 남았다: " + path.relative(dir, f));
		if (/\bMID_/.test(s)) problems.push("DEV 이름(MID_)이 섞였다: " + path.relative(dir, f));
	}
	const man = _read(dir, "CSXS/manifest.xml") || "";
	if (_count(man, "ExtensionBundleId=\"" + PROD_BUNDLE + "\"") !== 1) problems.push("manifest 번들 id가 " + PROD_BUNDLE + "가 아니다");
	if (man.indexOf(DEV_BUNDLE) !== -1) problems.push("manifest에 DEV id가 섞였다");
	const dbg = _read(dir, ".debug") || "";
	if (dbg.indexOf("Port=\"" + PROD_PORT + "\"") === -1) problems.push(".debug 포트가 " + PROD_PORT + "가 아니다");
	return problems;
}

/** 설치된 hostscript에서 빌드 스탬프 읽기 (S2-1 이후: var MI_BUILD = '…' / MID_BUILD) */
function buildOfHost(src) {
	const m = String(src || "").match(/\bMID?_BUILD\s*=\s*["']([^"']*)["']/);
	return m ? m[1] : null;
}

function main(argv) {
	const [cmd, a, b] = argv;
	try {
		if (cmd === "dev" && a && b) {
			stageDev(a, b);
		} else if (cmd === "prod" && a && b) {
			stageProd(a, b);
		} else if (cmd === "verify-dev" && a) {
			const p = verifyDev(a, b);
			p.forEach((x) => console.log("  !! " + x));
			if (p.length) return 1;
			console.log("  OK  DEV 사본 검사 통과 (" + a + ")");
		} else if (cmd === "verify-prod" && a) {
			const p = verifyProd(a);
			p.forEach((x) => console.log("  !! " + x));
			if (p.length) return 1;
			console.log("  OK  운영 사본 검사 통과 (" + a + ")");
		} else {
			console.error("사용법: stamp.js dev|prod <dir> <build> | verify-dev <dir> [srcDir] | verify-prod <dir>");
			return 2;
		}
	} catch (e) {
		console.error("stamp.js: " + e.message);
		return 1;
	}
	return 0;
}

if (require.main === module) {
	process.exitCode = main(process.argv.slice(2));
}

module.exports = {
	devManifest, devDebug, rewriteMiPrefix, findMiIdent, stampBuild, checkBuild, stageDev, stageProd, verifyDev, verifyProd, buildOfHost,
	MI_KEEP, PROD_BUNDLE, PROD_PANEL, DEV_BUNDLE, DEV_PANEL, DEV_MENU, PROD_PORT, DEV_PORT, CODE_FILES, BUILD_TOKEN
};
