#!/usr/bin/env node
"use strict";
/**
 * '옛 버전 MOGRT' 픽스처 만들기 (하드 테스트용). 합성 텍스트가 아니라 사용자의 템플릿이 들어 있으므로
 * 만든 .mogrt는 저장소에 넣지 않는다: 테스트할 때마다 설치된 MOGRT에서 저장소 밖 임시 폴더로 만든다
 * (기본 <os.tmpdir()>/mi_mogrt_fixtures, 저장소 안의 폴더는 거부한다. 이 폴더의 .gitignore도 *.mogrt).
 *
 * 무엇을 흉내 내나 (docs/spike_s0.md 결정 16, S0-3 x):
 *   MOGRT를 다시 저장하면 타임라인에 이미 있는 클립은 옛 구조로 남는다. 실제 캐시의 옛 구조 줄 94개가 그렇다
 *   ('[라온올제] 자동 줄바꿈 박스 자막' 15속성 ← 그 전 8속성). S0-3은 옛 구조가 그대로 남아 있는
 *   'Project_MOGRT/기본 자막.mogrt'(텍스트 이름이 같고 속성 8개)를 복사해 옛 버전 클립을 놓았다.
 *   findOldVersion은 이 짝을 이름으로 찾는다: 텍스트 컨트롤(type 6) 이름이 순서대로 같고 컨트롤 목록은 다른 MOGRT.
 *
 *   const M = require("../../fixtures/mogrt/make_old_mogrt");
 *   const fx = M.makeOldLayoutMogrt({ newName: /자동 줄바꿈 박스/ });
 *   // fx = {path: 임시 사본, source, oldNames, newNames, newPath}
 *
 *   node tests/fixtures/mogrt/make_old_mogrt.js [--out <폴더>] [--new <이름 정규식>]   → JSON 한 줄
 *
 * 환경 변수: MI_MOGRT_ROOT (MOGRT 폴더, 기본 %APPDATA%/Adobe/Common/Motion Graphics Templates),
 *            MI_OLD_MOGRT (옛 버전 원본을 직접 지정, 찾기를 건너뛴다).
 * 의존성 없음: zip은 이 파일의 작은 읽기·쓰기(저장·deflate)로 다룬다.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const REPO = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_OUT = path.join(os.tmpdir(), "mi_mogrt_fixtures");

// ── zip (저장 0 · deflate 8) ──

/** zip 바이트 → [{name, method, data}] (data는 풀린 Buffer) */
function readZip(buf) {
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error("zip이 아니다 (EOCD 없음)");
	const count = buf.readUInt16LE(eocd + 10);
	let p = buf.readUInt32LE(eocd + 16);
	const out = [];
	for (let k = 0; k < count; k++) {
		if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip 중앙 디렉터리가 깨졌다");
		const flags = buf.readUInt16LE(p + 8);
		const method = buf.readUInt16LE(p + 10);
		const csize = buf.readUInt32LE(p + 20);
		const nlen = buf.readUInt16LE(p + 28);
		const xlen = buf.readUInt16LE(p + 30);
		const clen = buf.readUInt16LE(p + 32);
		const lho = buf.readUInt32LE(p + 42);
		const name = buf.slice(p + 46, p + 46 + nlen).toString(flags & 0x800 ? "utf8" : "latin1");
		if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error("zip 로컬 헤더가 깨졌다: " + name);
		const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
		const raw = buf.slice(start, start + csize);
		let data;
		if (method === 0) data = Buffer.from(raw);
		else if (method === 8) data = zlib.inflateRawSync(raw);
		else throw new Error("지원하지 않는 압축 방식 " + method + ": " + name);
		out.push({ name, method, data });
		p += 46 + nlen + xlen + clen;
	}
	return out;
}

const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();
function crc32(buf) {
	if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

/** [{name, data, method?}] → zip 바이트 (기본 deflate, 시각 0) */
function writeZip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	entries.forEach((e) => {
		const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), "utf8");
		const method = e.method === 0 ? 0 : 8;
		const comp = method === 8 ? zlib.deflateRawSync(data) : data;
		const name = Buffer.from(e.name, "utf8");
		const flags = /[^\x20-\x7e]/.test(e.name) ? 0x800 : 0;
		const crc = crc32(data);
		const lh = Buffer.alloc(30);
		lh.writeUInt32LE(0x04034b50, 0);
		lh.writeUInt16LE(20, 4);
		lh.writeUInt16LE(flags, 6);
		lh.writeUInt16LE(method, 8);
		lh.writeUInt32LE(crc, 14);
		lh.writeUInt32LE(comp.length, 18);
		lh.writeUInt32LE(data.length, 22);
		lh.writeUInt16LE(name.length, 26);
		const ch = Buffer.alloc(46);
		ch.writeUInt32LE(0x02014b50, 0);
		ch.writeUInt16LE(20, 4);
		ch.writeUInt16LE(20, 6);
		ch.writeUInt16LE(flags, 8);
		ch.writeUInt16LE(method, 10);
		ch.writeUInt32LE(crc, 16);
		ch.writeUInt32LE(comp.length, 20);
		ch.writeUInt32LE(data.length, 24);
		ch.writeUInt16LE(name.length, 28);
		ch.writeUInt32LE(offset, 42);
		locals.push(lh, name, comp);
		centrals.push(ch, name);
		offset += lh.length + name.length + comp.length;
	});
	const cd = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat(locals.concat([cd, end]));
}

// ── definition.json ──

function mogrtRoot() {
	if (process.env.MI_MOGRT_ROOT) return process.env.MI_MOGRT_ROOT;
	return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Adobe", "Common", "Motion Graphics Templates");
}
function readDefinition(file) {
	const e = readZip(fs.readFileSync(file)).find((x) => x.name === "definition.json");
	if (!e) throw new Error("definition.json 없음: " + file);
	return JSON.parse(e.data.toString("utf8").replace(/^\uFEFF/, ""));
}
/** 컨트롤 [{type, name}] (uiName의 첫 문구) */
function controlNames(def) {
	return (def.clientControls || []).map((c) => ({
		type: Number(c.type),
		name: String((((c.uiName || {}).strDB || [])[0] || {}).str || "")
	}));
}
function textNames(def) {
	return controlNames(def).filter((c) => c.type === 6).map((c) => c.name);
}
/** 폴더 아래 .mogrt 경로 (깊이 제한) */
function listMogrts(dir, depth) {
	const out = [];
	let ents = [];
	try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
	ents.forEach((e) => {
		const p = path.join(dir, e.name);
		if (e.isDirectory() && (depth || 0) < 3) out.push(...listMogrts(p, (depth || 0) + 1));
		else if (e.isFile() && /\.mogrt$/i.test(e.name)) out.push(p);
	});
	return out;
}
/**
 * newPath의 '옛 버전'을 찾는다: 텍스트 컨트롤 이름이 순서대로 같고(2개 이상), 컨트롤 목록은 다르고,
 * capsuleID가 다른 AE MOGRT (옛 버전이 따로 저장되어 남아 있는 경우). 여럿이면 컨트롤이 가장 적은 것.
 * → {path, def} | null
 */
function findOldVersion(newPath, opts) {
	const root = (opts && opts.root) || mogrtRoot();
	const nd = readDefinition(newPath);
	const want = textNames(nd).join("\n");
	if (textNames(nd).length < 2) return null;
	const sig = (d) => controlNames(d).map((c) => c.type + ":" + c.name).join("\n");
	const hits = [];
	listMogrts(root).forEach((p) => {
		if (path.resolve(p) === path.resolve(newPath)) return;
		let d;
		try { d = readDefinition(p); } catch (_) { return; }
		if (d.capsuleID === nd.capsuleID) return;
		if (textNames(d).join("\n") !== want || sig(d) === sig(nd)) return;
		hits.push({ path: p, def: d });
	});
	hits.sort((a, b) => (a.def.clientControls || []).length - (b.def.clientControls || []).length);
	return hits[0] || null;
}
function assertOutsideRepo(dir) {
	const rel = path.relative(REPO, path.resolve(dir));
	if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error("사용자 템플릿 사본을 저장소 안에 만들지 않는다: " + dir);
}

/**
 * 옛 구조 MOGRT 사본을 저장소 밖에 만든다 (바이트 그대로 복사).
 * opts.newName: 새 버전 이름 정규식(기본 /자동 줄바꿈 박스/), opts.newPath: 새 버전 경로, opts.outDir
 * → {path, source, newPath, oldNames: [이름…], newNames: [이름…]}
 */
function makeOldLayoutMogrt(opts) {
	const o = opts || {};
	const outDir = o.outDir || DEFAULT_OUT;
	assertOutsideRepo(outDir);
	const root = o.root || mogrtRoot();
	let newPath = o.newPath || null;
	if (!newPath) {
		const re = o.newName || /자동 줄바꿈 박스/;
		newPath = listMogrts(root).find((p) => re.test(path.basename(p))) || null;
		if (!newPath) throw new Error("새 버전 MOGRT를 찾지 못했다 (" + re + ", " + root + ")");
	}
	let source = process.env.MI_OLD_MOGRT || null;
	if (!source) {
		const hit = findOldVersion(newPath, { root });
		if (!hit) throw new Error("옛 버전 MOGRT를 찾지 못했다: " + path.basename(newPath) + " (MI_OLD_MOGRT로 지정할 수 있다)");
		source = hit.path;
	}
	fs.mkdirSync(outDir, { recursive: true });
	// 이름은 원본 경로의 해시 (한글 이름을 그대로 쓰지 않는다)
	const out = path.join(outDir, "old_layout_" + crypto.createHash("sha1").update(path.resolve(source)).digest("hex").slice(0, 8) + ".mogrt");
	fs.copyFileSync(source, out);
	return {
		path: out.split(path.sep).join("/"),
		source: source.split(path.sep).join("/"),
		newPath: newPath.split(path.sep).join("/"),
		oldNames: controlNames(readDefinition(out)).map((c) => c.name),
		newNames: controlNames(readDefinition(newPath)).map((c) => c.name)
	};
}
/**
 * 같은 capsuleID로 컨트롤 이름만 바꾼 사본 (S0-3 x ②: importMGT는 같은 프로젝트 항목을 쓰면서 새 이름을 놓는다).
 * renames {옛 이름: 새 이름} → 만든 경로
 */
function makeRenamedMogrt(src, renames, outPath) {
	assertOutsideRepo(path.dirname(outPath));
	const entries = readZip(fs.readFileSync(src)).map((e) => {
		if (e.name !== "definition.json") return { name: e.name, data: e.data };
		const d = JSON.parse(e.data.toString("utf8").replace(/^\uFEFF/, ""));
		(d.clientControls || []).forEach((c) => (((c.uiName || {}).strDB) || []).forEach((s) => {
			if (s && Object.prototype.hasOwnProperty.call(renames, s.str)) s.str = renames[s.str];
		}));
		return { name: e.name, data: Buffer.from(JSON.stringify(d), "utf8") };
	});
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, writeZip(entries));
	return outPath.split(path.sep).join("/");
}

if (require.main === module) {
	const argv = process.argv.slice(2);
	const o = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--out") o.outDir = argv[++i];
		else if (argv[i] === "--new") o.newName = new RegExp(argv[++i]);
	}
	try {
		console.log(JSON.stringify(makeOldLayoutMogrt(o)));
	} catch (e) {
		console.error("!! " + e.message);
		process.exit(1);
	}
}

module.exports = { readZip, writeZip, crc32, mogrtRoot, readDefinition, controlNames, textNames, listMogrts, findOldVersion, makeOldLayoutMogrt, makeRenamedMogrt, DEFAULT_OUT };
