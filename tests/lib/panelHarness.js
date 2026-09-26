"use strict";
/**
 * 패널 부팅 하네스: app.js 전체(IIFE)를 node:vm에서 돌린다. 브라우저가 아니다.
 * app.js가 실제로 지나가는 경로에 필요한 만큼만 흉내 낸다.
 *
 *   const h = await bootPanel({ seq: { seqId: "A", seqName: "T_A", projPath: "C:/p/one.prproj" }, files: {...} });
 *   await h.advance(2000);            // 가짜 시계 (setTimeout/setInterval)
 *   h.snapshot()                      // window._mogrtDebug.snapshot()
 *   h.fs.files                        // 메모리 cep.fs (경로 → 문자열)
 *   h.host.calls                      // 호스트 호출 기록 [{fn, args}]
 *   h.nodeFs                          // opts.node일 때 require("fs") 메모리 파일 (경로 → {data, mtimeMs})
 *
 * - DOM: index.html을 간단한 파서로 읽어 트리를 만든다 (id·class·label 부모·select 옵션).
 *   innerHTML에 넣은 마크업도 같은 파서로 자식을 만든다. 스타일·레이아웃은 없다.
 * - 호스트: CSInterface.evalScript(스크립트)의 함수 이름으로 h.host.handlers[이름](...인자)을 부른다.
 *   처리기가 없으면 빈 문자열(전송 실패)을 돌려준다. 맨 앞이 /*host:이름 인자*\/인 ExtendScript 식은 그 이름으로 부른다.
 * - Node: opts.node = {files}이면 require("fs"|"zlib"|"path")와 JSZip(jszip.min.js)을 넣는다 (fs는 메모리, zlib는 진짜).
 * - 시계: 타이머는 h.advance(ms)로만 돈다. Date는 진짜다 (5분 무작업 자동저장은 돌지 않는다).
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");
const APP_JS = path.join(ROOT, "extension", "html", "js", "app.js");
const INDEX_HTML = path.join(ROOT, "extension", "html", "index.html");
const JSZIP_JS = path.join(ROOT, "extension", "html", "js", "jszip.min.js");
const EXT_DIR = "C:/fake/extensions/CEP_MogrtImporter_dev";
const CACHE_ROOT = EXT_DIR + "/cache";
// CSInterface.getSystemPath(SystemPath.USER_DATA) (5단계 AI 연결 다리 폴더의 대체 경로. node.env.APPDATA가 있으면 그쪽이 먼저다)
const USER_DATA_DIR = "C:/fake/AppData/Roaming";

const VOID = new Set(["input", "br", "img", "hr", "meta", "link", "source", "wbr", "area", "base", "col", "embed", "param", "track"]);

// ── DOM ──

class ClassList {
	constructor(el) { this.el = el; }
	_list() { return String(this.el.className || "").split(/\s+/).filter(Boolean); }
	contains(c) { return this._list().indexOf(c) !== -1; }
	add(...cs) { const l = this._list(); cs.forEach((c) => { if (l.indexOf(c) === -1) l.push(c); }); this.el.className = l.join(" "); }
	remove(...cs) { this.el.className = this._list().filter((c) => cs.indexOf(c) === -1).join(" "); }
	toggle(c, force) {
		const has = this.contains(c);
		const want = force === undefined ? !has : !!force;
		if (want && !has) this.add(c);
		if (!want && has) this.remove(c);
		return want;
	}
}

class FakeEl {
	constructor(doc, tag) {
		this.ownerDocument = doc;
		this.tagName = String(tag).toUpperCase();
		this.nodeType = 1;
		this.childNodes = [];
		this.parentNode = null;
		this._attrs = {};
		this._text = "";
		this.className = "";
		this.id = "";
		this.title = "";
		this.style = { cssText: "" };
		this.dataset = {};
		this.classList = new ClassList(this);
		this._listeners = {};
		this.value = "";
		this.checked = false;
		this.disabled = false;
		this.selected = false;
		this.files = null;
		this.type = "";
		this.htmlFor = "";
		this.onclick = null;
		this.offsetWidth = 0;
		this.offsetHeight = 0;
		this.scrollTop = 0;
		this.scrollHeight = 0;
		this.clientHeight = 0;
		if (this.tagName === "SELECT") {
			Object.defineProperty(this, "value", {
				get() {
					const opts = this.options;
					let sel = null;
					opts.forEach((o) => { if (o.selected) sel = o; });
					if (!sel && opts.length && this._selIdx !== -1) sel = opts[0];
					return sel ? sel.value : "";
				},
				set(v) {
					let hit = false;
					this.options.forEach((o) => { o.selected = !hit && o.value === String(v); if (o.selected) hit = true; });
					this._selIdx = hit ? 0 : -1;
				},
				configurable: true
			});
		}
		if (this.tagName === "OPTION") {
			Object.defineProperty(this, "value", {
				get() { return this._attrs.value !== undefined ? this._attrs.value : this.textContent; },
				set(v) { this._attrs.value = String(v); },
				configurable: true
			});
		}
	}
	get children() { return this.childNodes; }
	get firstChild() { return this.childNodes[0] || null; }
	get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
	get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
	get options() { return this.tagName === "SELECT" ? this._descendants().filter((n) => n.tagName === "OPTION") : undefined; }
	get selectedIndex() { const o = this.options || []; for (let i = 0; i < o.length; i++) if (o[i].selected) return i; return o.length ? 0 : -1; }
	get textContent() { return this._text + this.childNodes.map((c) => c.textContent).join(""); }
	set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; this._text = String(v == null ? "" : v); }
	get innerHTML() { return this._html || this.textContent; }
	set innerHTML(v) {
		this.textContent = "";
		this._html = String(v == null ? "" : v);
		parseInto(this.ownerDocument, this, this._html);
	}
	get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null; }
	appendChild(c) {
		if (c.parentNode) c.parentNode.removeChild(c);
		c.parentNode = this;
		this.childNodes.push(c);
		return c;
	}
	insertBefore(c, ref) {
		if (!ref) return this.appendChild(c);
		if (c.parentNode) c.parentNode.removeChild(c);
		const i = this.childNodes.indexOf(ref);
		c.parentNode = this;
		this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c);
		return c;
	}
	removeChild(c) {
		const i = this.childNodes.indexOf(c);
		if (i !== -1) this.childNodes.splice(i, 1);
		c.parentNode = null;
		return c;
	}
	replaceChild(n, old) { this.insertBefore(n, old); this.removeChild(old); return old; }
	replaceWith(n) { if (this.parentNode) this.parentNode.replaceChild(n, this); }
	remove() { if (this.parentNode) this.parentNode.removeChild(this); }
	contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
	cloneNode(deep) {
		const c = new FakeEl(this.ownerDocument, this.tagName);
		Object.assign(c._attrs, this._attrs);
		c.className = this.className; c.id = this.id; c._text = this._text; c.title = this.title; c.type = this.type;
		c.style = Object.assign({}, this.style);
		if (deep) this.childNodes.forEach((k) => c.appendChild(k.cloneNode(true)));
		return c;
	}
	setAttribute(k, v) {
		this._attrs[k] = String(v);
		if (k === "id") this.id = String(v);
		else if (k === "class") this.className = String(v);
		else if (k === "type") this.type = String(v);
		else if (k === "title") this.title = String(v);
		else if (k === "style") this.style.cssText = String(v);
		else if (k === "disabled") this.disabled = true;
		else if (k === "checked") this.checked = true;
		else if (k === "selected") this.selected = true;
		else if (k.indexOf("data-") === 0) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v);
		else if (k === "value" && this.tagName !== "OPTION") this.value = String(v);
	}
	getAttribute(k) {
		// data-* 는 dataset과 같은 값 (브라우저처럼: el.dataset.key = "C2" → [data-key=C2] 선택자)
		if (String(k).indexOf("data-") === 0) {
			const dk = String(k).slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
			if (this.dataset[dk] !== undefined) return String(this.dataset[dk]);
		}
		return k === "id" ? this.id : k === "class" ? this.className : this._attrs[k] !== undefined ? this._attrs[k] : null;
	}
	hasAttribute(k) { return this.getAttribute(k) !== null; }
	removeAttribute(k) { delete this._attrs[k]; if (k === "disabled") this.disabled = false; }
	addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
	removeEventListener(t, fn) { const l = this._listeners[t] || []; const i = l.indexOf(fn); if (i !== -1) l.splice(i, 1); }
	dispatchEvent(ev) { return dispatch(this, ev); }
	click() {
		if (this.disabled) return;
		dispatch(this, makeEvent("click", { bubbles: true }));
	}
	focus() {} blur() {} select() {} scrollIntoView() {}
	getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
	getContext() { return null; }
	_descendants() { const out = []; const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } }); walk(this); return out; }
	querySelectorAll(sel) { return querySelectorAll(this, sel); }
	querySelector(sel) { return querySelectorAll(this, sel)[0] || null; }
	closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matches(x, sel)) return x; return null; }
	matches(sel) { return matches(this, sel); }
}

function makeEvent(type, init) {
	return Object.assign({
		type, bubbles: false, _stop: false, defaultPrevented: false,
		stopPropagation() { this._stop = true; }, stopImmediatePropagation() { this._stop = true; },
		preventDefault() { this.defaultPrevented = true; }
	}, init || {});
}

function dispatch(target, ev) {
	if (!ev.target) ev.target = target;
	const chain = [];
	for (let x = target; x; x = x.parentNode) chain.push(x);
	if (target.ownerDocument && chain[chain.length - 1] !== target.ownerDocument) chain.push(target.ownerDocument);
	const bubbles = ev.bubbles || ev.type === "click";
	for (let i = 0; i < chain.length; i++) {
		const node = chain[i];
		ev.currentTarget = node;
		(node._listeners && node._listeners[ev.type] ? node._listeners[ev.type].slice() : []).forEach((fn) => fn.call(node, ev));
		if (i === 0 && ev.type === "click" && typeof node.onclick === "function") node.onclick(ev);
		if (ev._stop || !bubbles) break;
	}
	return !ev.defaultPrevented;
}

// ── 선택자 (app.js가 쓰는 만큼: 합성 tag#id.class[attr=v]:checked, 자손 공백, 쉼표) ──

function parseCompound(s) {
	const c = { tag: null, id: null, classes: [], attrs: [], checked: false };
	const re = /([a-zA-Z][a-zA-Z0-9]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]|:checked/g;
	let m;
	while ((m = re.exec(s))) {
		if (m[1]) c.tag = m[1].toUpperCase();
		else if (m[2]) c.id = m[2];
		else if (m[3]) c.classes.push(m[3]);
		else if (m[4]) c.attrs.push([m[4], m[5]]);
		else c.checked = true;
	}
	return c;
}
function matchCompound(el, c) {
	if (el.nodeType !== 1) return false;
	if (c.tag && el.tagName !== c.tag) return false;
	if (c.id && el.id !== c.id) return false;
	for (const k of c.classes) if (!el.classList.contains(k)) return false;
	for (const [k, v] of c.attrs) {
		const have = k === "type" ? el.type || el._attrs.type : el.getAttribute(k);
		if (have === null || have === undefined) return false;
		if (v !== undefined && String(have) !== v) return false;
	}
	if (c.checked && !el.checked) return false;
	return true;
}
function matches(el, sel) {
	return String(sel).split(",").some((one) => {
		const parts = one.trim().split(/\s+/).map(parseCompound);
		if (!matchCompound(el, parts[parts.length - 1])) return false;
		let x = el.parentNode;
		for (let i = parts.length - 2; i >= 0; i--) {
			while (x && !(x.nodeType === 1 && matchCompound(x, parts[i]))) x = x.parentNode;
			if (!x) return false;
			x = x.parentNode;
		}
		return true;
	});
}
function querySelectorAll(root, sel) {
	const all = root._descendants();
	return all.filter((el) => matches(el, sel));
}

// ── 아주 작은 HTML 파서 (index.html과 innerHTML 마크업용) ──

function parseAttrs(el, s) {
	const re = /([a-zA-Z_:@][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
	let m;
	while ((m = re.exec(s))) {
		const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
		el.setAttribute(m[1], decodeEntities(v));
	}
}
function decodeEntities(s) {
	return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function parseInto(doc, parent, html) {
	const src = String(html)
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
	const re = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*>|<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
	const stack = [parent];
	let m;
	while ((m = re.exec(src))) {
		const top = stack[stack.length - 1];
		if (m[1]) {
			const t = m[1].toUpperCase();
			for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === t) { stack.length = i; break; }
		} else if (m[2]) {
			const el = new FakeEl(doc, m[2]);
			let attrs = m[3] || "";
			const selfClose = /\/\s*$/.test(attrs);
			if (selfClose) attrs = attrs.replace(/\/\s*$/, "");
			parseAttrs(el, attrs);
			top.appendChild(el);
			if (!selfClose && !VOID.has(m[2].toLowerCase())) stack.push(el);
		} else if (m[4]) {
			const txt = decodeEntities(m[4]);
			if (txt.trim()) top._text += txt.trim();
		}
	}
}

class FakeDocument {
	constructor() {
		this.nodeType = 9;
		this._listeners = {};
		this.childNodes = [];
		this.documentElement = new FakeEl(this, "html");
		this.documentElement.parentNode = this;
		this.childNodes.push(this.documentElement);
		this.body = new FakeEl(this, "body");
		this.documentElement.appendChild(this.body);
		this.head = new FakeEl(this, "head");
	}
	createElement(tag) { return new FakeEl(this, tag); }
	createTextNode(t) { const e = new FakeEl(this, "#text"); e.nodeType = 3; e._text = String(t); return e; }
	getElementById(id) { return this.body._descendants().find((e) => e.id === id) || null; }
	querySelectorAll(sel) { return querySelectorAll(this.body, sel); }
	querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
	addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
	removeEventListener(t, fn) { const l = this._listeners[t] || []; const i = l.indexOf(fn); if (i !== -1) l.splice(i, 1); }
	elementFromPoint() { return null; }
	get activeElement() { return this.body; }
}

function buildDocument() {
	const doc = new FakeDocument();
	const html = fs.readFileSync(INDEX_HTML, "utf8");
	const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
	parseInto(doc, doc.body, body);
	return doc;
}

// ── cep.fs (메모리) ──

/** EXT_DIR/html/… → 저장소 extension/html/… 내용 (없으면 null). 쓰기·목록에는 나타나지 않는다 */
function extFile(p, extDir = EXT_DIR) {
	const pre = extDir + "/html/";
	if (String(p).indexOf(pre) !== 0) return null;
	const rel = String(p).slice(pre.length);
	if (!rel || rel.split("/").indexOf("..") !== -1) return null;
	const real = path.join(ROOT, "extension", "html", ...rel.split("/"));
	return fs.existsSync(real) && fs.statSync(real).isFile() ? fs.readFileSync(real, "utf8") : null;
}

function makeFs(initial, extDir = EXT_DIR) {
	const files = new Map(Object.entries(initial || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
	const dirs = new Set();
	const writes = [];
	const norm = (p) => String(p).replace(/\\/g, "/");
	const api = {
		NO_ERROR: 0, ERR_UNKNOWN: 1, ERR_INVALID_PARAMS: 2, ERR_NOT_FOUND: 3, ERR_CANT_READ: 4,
		files, dirs, writes, unreadable: new Set(), renameFails: false,
		stat(p) {
			p = norm(p);
			if (files.has(p)) return { err: 0, data: { isFile: () => true, isDirectory: () => false } };
			if (dirs.has(p) || [...files.keys()].some((k) => k.indexOf(p + "/") === 0)) return { err: 0, data: { isFile: () => false, isDirectory: () => true } };
			return { err: 3 };
		},
		readFile(p) {
			p = norm(p);
			if (api.unreadable.has(p)) return { err: 4, data: "" };
			if (files.has(p)) return { err: 0, data: files.get(p) };
			// 설치 폴더의 패널 파일(html/…)은 저장소 extension/html/…을 읽는다 (runCommand status의 coreHash 등)
			const ext = extFile(p, extDir);
			if (ext !== null) return { err: 0, data: ext };
			return { err: 3, data: "" };
		},
		writeFile(p, data) { p = norm(p); files.set(p, String(data)); writes.push(p); return { err: 0 }; },
		makedir(p) { dirs.add(norm(p)); return { err: 0 }; },
		deleteFile(p) { files.delete(norm(p)); return { err: 0 }; },
		/** 바로 아래 이름들 (파일·폴더) */
		readdir(p) {
			p = norm(p).replace(/\/$/, "");
			const pre = p + "/";
			const names = new Set();
			for (const k of [...files.keys(), ...dirs]) if (k.indexOf(pre) === 0) names.add(k.slice(pre.length).split("/")[0]);
			names.delete("");
			if (!names.size && !dirs.has(p)) return { err: 3, data: [] };
			return { err: 0, data: [...names] };
		},
		/** 파일만 옮긴다. api.renameFails가 참이면 실패(err 1) */
		rename(a, b) {
			a = norm(a); b = norm(b);
			if (api.renameFails) return { err: 1 };
			if (!files.has(a)) return { err: 3 };
			if (files.has(b)) return { err: 1 };
			files.set(b, files.get(a));
			files.delete(a);
			api.unreadable.delete(a);
			return { err: 0 };
		},
		readJson(p) { const d = files.get(norm(p)); return d === undefined ? undefined : JSON.parse(d); }
	};
	return api;
}

// ── Node fs (메모리, opts.node) ──

/**
 * 패널이 require("fs")로 쓰는 만큼의 메모리 파일 시스템 (S1-11 구운 사본). 경로 구분자는 /로 맞춘다.
 * initial: {경로: Buffer|Uint8Array|문자열|{data, mtimeMs}}
 */
function makeNodeFs(initial) {
	const norm = (p) => String(p).replace(/\\/g, "/");
	const files = new Map();
	const dirs = new Set();
	const enoent = (p) => Object.assign(new Error("ENOENT: no such file or directory, '" + p + "'"), { code: "ENOENT" });
	const bytes = (v) => (typeof v === "string" ? Buffer.from(v, "utf8") : Buffer.from(v));
	Object.entries(initial || {}).forEach(([p, v]) => {
		const o = v && typeof v === "object" && !ArrayBuffer.isView(v) && v.data !== undefined ? v : { data: v };
		files.set(norm(p), { data: bytes(o.data), mtimeMs: o.mtimeMs !== undefined ? o.mtimeMs : Date.now() });
	});
	const api = {
		files, dirs, writes: [], unlinks: [],
		statSync(p) {
			p = norm(p);
			const f = files.get(p);
			if (f) return { mtimeMs: f.mtimeMs, size: f.data.length, isFile: () => true, isDirectory: () => false };
			if (dirs.has(p)) return { mtimeMs: 0, size: 0, isFile: () => false, isDirectory: () => true };
			throw enoent(p);
		},
		existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p); },
		readFileSync(p) {
			const f = files.get(norm(p));
			if (!f) throw enoent(p);
			return Buffer.from(f.data);
		},
		writeFileSync(p, d) { p = norm(p); files.set(p, { data: bytes(d), mtimeMs: Date.now() }); api.writes.push(p); },
		renameSync(a, b) {
			a = norm(a); b = norm(b);
			const f = files.get(a);
			if (!f) throw enoent(a);
			files.set(b, f);
			files.delete(a);
		},
		mkdirSync(p) { dirs.add(norm(p).replace(/\/$/, "")); },
		readdirSync(p) {
			p = norm(p).replace(/\/$/, "");
			const pre = p + "/";
			const names = new Set();
			for (const k of files.keys()) if (k.indexOf(pre) === 0) names.add(k.slice(pre.length).split("/")[0]);
			if (!names.size && !dirs.has(p)) throw enoent(p);
			return [...names];
		},
		unlinkSync(p) { p = norm(p); if (!files.delete(p)) throw enoent(p); api.unlinks.push(p); },
		// vm 쪽 Date는 이쪽 Date의 instanceof가 아니다 → getTime으로 본다
		utimesSync(p, a, m) {
			const f = files.get(norm(p));
			if (!f) throw enoent(p);
			f.mtimeMs = m && typeof m.getTime === "function" ? m.getTime() : Number(m) * 1000;
		}
	};
	return api;
}

// ── 호스트 흉내 ──

function makeHost(opts) {
	const host = {
		seq: opts.seq || null,                          // getActiveSequenceInfo 결과 (null = 시퀀스 없음)
		mogrts: opts.mogrts || [{ name: "합성 A", path: "D:/MOGRT/합성 A.mogrt" }],
		previewExists: !!opts.previewExists,
		previewSetupOk: opts.previewSetupOk !== false,
		params: opts.params || {},                      // mogrtPath → ParamDef[]
		calls: [],
		handlers: {}
	};
	host.handlers.getActiveSequenceInfo = () => JSON.stringify(host.seq || { seqId: "", seqName: "", projPath: "" });
	host.handlers.getMogrtScanDirs = () => JSON.stringify(["D:/MOGRT"]);
	host.handlers.scanMogrtFolder = () => JSON.stringify(host.mogrts);
	host.handlers.getMogrtFolderTree = () => JSON.stringify({ name: "MOGRT", path: "D:/MOGRT", children: [], mogrts: host.mogrts });
	host.handlers.getSystemFonts = () => "[]";
	host.handlers.setupPreviewSequence = () => {
		if (!host.previewSetupOk) return "ERROR: 프리뷰 시퀀스 생성 실패 (하네스)";
		host.previewExists = true;
		return "SUCCESS";
	};
	host.handlers.findPreviewSequence = () => (host.previewExists ? "yes" : "no");
	host.handlers.getMogrtParams = (p) => JSON.stringify({ params: host.params[p] || [], mogrtPath: p });
	host.handlers.applyPreviewParams = () => "SUCCESS";
	host.handlers.capturePreviewFrame = () => "ERROR: 하네스";
	host.handlers.getPreviewClipParams = () => "ERROR: 없음";
	host.handlers.applyToTimeline = () => "SUCCESS: 0개 배치 (하네스)";
	// 작업 저장 대화상자: 내용을 host.savedFiles에 남기고 저장한 것으로 답한다
	host.savedFiles = [];
	host.handlers.saveTextFileWithDialog = (json) => {
		const o = JSON.parse(json);
		host.savedFiles.push(o);
		return "SUCCESS: C:/fake/" + (o.defaultName || "work.json");
	};
	host.handlers.$ = () => "C:/Temp";
	// 네이티브 클립 지우기 (S1-11 ExtendScript 식, 인자 JSON {t, s}): 기본은 지운 것이 없다
	host.handlers.removeNativeClipsAt = () => "SUCCESS: 0";
	// v27 트랙 클립 목록 (S1-11 연쇄 계획이 ap 없는 줄의 클립 자리를 찾을 때 읽는다): 기본은 빈 트랙
	host.handlers.getTimelineClips = () => "[]";
	return host;
}
function parseCall(script) {
	// 호스트 함수가 아닌 ExtendScript 식은 맨 앞 주석 /*host:이름 인자*/로 이름과 인자(글자 하나)를 알린다 (S1-11 removeNativeClipsAt)
	const tagged = /^\s*\/\*host:([$A-Za-z_][\w$]*)(?:\s+([^*]*))?\*\//.exec(script);
	if (tagged) return { fn: tagged[1], args: tagged[2] !== undefined ? [tagged[2]] : [] };
	const m = /^\s*([$A-Za-z_][\w$]*)/.exec(script);
	const fn = m ? m[1] : "";
	const args = [];
	const re = /decodeURIComponent\("([^"]*)"\)|(?:[(,])\s*(-?\d+(?:\.\d+)?)\s*(?=[,)])/g;
	let a;
	while ((a = re.exec(script))) args.push(a[1] !== undefined ? decodeURIComponent(a[1]) : Number(a[2]));
	return { fn, args };
}

// ── 가짜 시계 ──

function makeClock() {
	let now = 0;
	let seq = 0;
	const timers = new Map();
	const clock = {
		get now() { return now; },
		setTimeout(fn, ms, ...a) { const id = ++seq; timers.set(id, { fn, at: now + Math.max(0, ms || 0), a, every: 0 }); return id; },
		setInterval(fn, ms, ...a) { const id = ++seq; timers.set(id, { fn, at: now + Math.max(1, ms || 0), a, every: Math.max(1, ms || 0) }); return id; },
		clearTimeout(id) { timers.delete(id); },
		clearInterval(id) { timers.delete(id); },
		pending() { return timers.size; },
		async advance(ms, flush) {
			const end = now + ms;
			for (;;) {
				let nextId = null;
				let next = null;
				for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && id < nextId))) { next = t; nextId = id; }
				if (!next) break;
				now = next.at;
				if (next.every) next.at = now + next.every;
				else timers.delete(nextId);
				try { next.fn(...next.a); } catch (e) { clock.errors.push(e); }
				await flush();
			}
			now = end;
			await flush();
		},
		errors: []
	};
	return clock;
}

// ── 키 (app.js simpleHash·_keysFromInfo와 같은 규칙) ──

function projKeyOf(projPath) {
	let hash = 0;
	for (let i = 0; i < projPath.length; i++) { hash = (hash << 5) - hash + projPath.charCodeAt(i); hash = hash & hash; }
	return "proj_" + Math.abs(hash).toString(36);
}
function seqKeyOf(projPath, seqId) { return projKeyOf(projPath) + "_seq_" + String(seqId).replace(/[^a-zA-Z0-9-]/g, "_"); }
const cachePaths = {
	root: CACHE_ROOT,
	presets: (projPath) => CACHE_ROOT + "/" + projKeyOf(projPath) + "/presets.json",
	session: (projPath, seqId) => CACHE_ROOT + "/" + projKeyOf(projPath) + "/" + seqKeyOf(projPath, seqId) + "/session.json",
	settings: (projPath, seqId) => CACHE_ROOT + "/" + projKeyOf(projPath) + "/" + seqKeyOf(projPath, seqId) + "/settings.json",
	historyAuto: (projPath, seqId) => CACHE_ROOT + "/" + projKeyOf(projPath) + "/" + seqKeyOf(projPath, seqId) + "/history_auto.json",
	historyManual: (projPath, seqId) => CACHE_ROOT + "/" + projKeyOf(projPath) + "/" + seqKeyOf(projPath, seqId) + "/history_manual.json",
	historySafety: (projPath, seqId) => CACHE_ROOT + "/" + projKeyOf(projPath) + "/" + seqKeyOf(projPath, seqId) + "/history_safety.json",
	cast: (projPath, seqId) => CACHE_ROOT + "/" + projKeyOf(projPath) + "/" + seqKeyOf(projPath, seqId) + "/cast.json",
	defaultSession: CACHE_ROOT + "/default/default_seq/session.json"
};

// ── 부팅 ──

/**
 * @param {object} opts
 *   seq       getActiveSequenceInfo가 돌려줄 {seqId, seqName, projPath} (null = 시퀀스 없음)
 *   files     cep.fs 초기 파일 {경로: 문자열|객체}. 경로는 h.paths로 만든다
 *   localStorage 초기 값
 *   previewExists, previewSetupOk, params, mogrts  호스트 흉내 설정
 *   node      {files: {경로: 바이트|{data, mtimeMs}}} — Node fs(메모리)·zlib·JSZip을 넣는다 (h.nodeFs)
 *             {env: {APPDATA: …}} — require("process").env (5단계 AI 연결 다리 폴더)
 *             {fs: 진짜 fs 같은 객체} — 메모리 fs 대신 쓴다 (MCP 테스트가 진짜 폴더로 패널과 이야기할 때. h.nodeFs = 그 객체)
 *   appSrc    app.js 대신 돌릴 소스 (예: git tag v27의 app.js — 단일 화자 DOM이 v27과 같은지 비교할 때)
 *   extDir    설치 폴더 (기본 EXT_DIR). 캐시는 <extDir>/cache — cachePaths는 기본 폴더 기준이라 다른 폴더면 경로를 직접 만든다
 *             (MCP 끝에서 끝 테스트: 진짜 임시 폴더에 html/js/app.js 사본을 두고 서버가 그 core를 읽는다)
 */
async function bootPanel(opts = {}) {
	const doc = buildDocument();
	const extDir = opts.extDir || EXT_DIR;
	const cfs = makeFs(opts.files, extDir);
	const host = makeHost(opts);
	const clock = makeClock();
	const logs = [];
	const pageErrors = [];
	const ls = new Map(Object.entries(opts.localStorage || {}));
	const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

	const ctx = vm.createContext({
		console: {
			log: (...a) => logs.push(["log", a.join(" ")]),
			info: (...a) => logs.push(["info", a.join(" ")]),
			warn: (...a) => logs.push(["warn", a.join(" ")]),
			error: (...a) => logs.push(["error", a.map((x) => (x && x.stack) || String(x)).join(" ")]),
			debug: () => {}
		},
		TextDecoder, TextEncoder, URL, atob, btoa,
		setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
		setInterval: clock.setInterval, clearInterval: clock.clearInterval,
		requestAnimationFrame: (fn) => clock.setTimeout(fn, 16),
		document: doc,
		localStorage: {
			getItem: (k) => (ls.has(k) ? ls.get(k) : null),
			setItem: (k, v) => ls.set(k, String(v)),
			removeItem: (k) => ls.delete(k)
		},
		SystemPath: { EXTENSION: "extension", USER_DATA: "userData" },
		alert: (m) => { throw new Error("alert() 호출: " + m); },
		confirm: (m) => { throw new Error("confirm() 호출: " + m); },
		Event: function Event(type, init) { return makeEvent(type, init); },
		ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
		IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
		innerWidth: 800,
		innerHeight: 600
	});
	const win = vm.runInContext("this", ctx);
	win.window = win;
	win.cep = { fs: cfs, encoding: { UTF8: "UTF-8", Base64: "Base64" } };
	// 클립보드 (T-ID 배지 복사, S1-6): 쓴 글자를 h.clipboard에 남긴다. 지우면 execCommand 대체 경로를 탄다
	const clipboard = [];
	win.navigator = { language: "ko-KR", clipboard: { writeText: (t) => { clipboard.push(String(t)); return Promise.resolve(); } } };
	win.CSInterface = function CSInterface() {};
	win.CSInterface.prototype.getSystemPath = (t) => (t === "userData" ? USER_DATA_DIR : extDir);
	// 처리기는 글자를 돌려주거나, 약속(느린 호출 흉내: 워치독 시험)을 돌려준다
	win.CSInterface.prototype.evalScript = (script, cb) => {
		const { fn, args } = parseCall(script);
		host.calls.push({ fn, args, script });
		let res = "";
		try {
			const h = host.handlers[fn];
			res = h ? h(...args) : "";
		} catch (e) {
			res = "EvalScript error.";
		}
		Promise.resolve(res).then((v) => cb && cb(String(v)), () => cb && cb("EvalScript error."));
	};
	win.FileReader = class {
		readAsText(file) { Promise.resolve().then(() => { this.result = file._text; this.onload && this.onload({ target: this }); }); }
		readAsArrayBuffer(file) { Promise.resolve().then(() => { this.result = Uint8Array.from(file._bytes || Buffer.from(file._text || "", "utf8")).buffer; this.onload && this.onload({ target: this }); }); }
	};

	// opts.node: CEP의 Node(require)와 index.html이 먼저 로드하는 JSZip을 넣는다 (S1-11 굽기). 없으면 둘 다 없다(운영 밖 기본값)
	let nodeFs = null;
	if (opts.node) {
		nodeFs = opts.node.fs || makeNodeFs(opts.node.files);
		const mods = { fs: nodeFs, zlib: require("node:zlib"), path: require("node:path") };
		if (opts.node.env) mods.process = { env: Object.assign({}, opts.node.env), platform: "win32" };
		win.require = (name) => {
			const k = String(name).replace(/^node:/, "");
			if (!mods[k]) throw new Error("하네스에 없는 Node 모듈: " + name);
			return mods[k];
		};
		// JSZip은 setImmediate가 없으면 가짜 시계의 setTimeout으로 돈다 → 진짜 setImmediate를 준다 (h.flush로 풀린다)
		win.setImmediate = setImmediate;
		vm.runInContext(fs.readFileSync(JSZIP_JS, "utf8"), ctx, { filename: "jszip.min.js" });
	}

	const src = typeof opts.appSrc === "string" ? opts.appSrc : fs.readFileSync(APP_JS, "utf8");
	try {
		vm.runInContext(src, ctx, { filename: "app.js" });
	} catch (e) {
		pageErrors.push(e);
	}
	await flush();

	const paths = cachePaths;
	const h = {
		win, doc, fs: cfs, nodeFs, host, clock, logs, pageErrors, paths, clipboard,
		flush,
		advance: (ms) => clock.advance(ms, flush),
		snapshot: () => JSON.parse(JSON.stringify(win._mogrtDebug.snapshot())),
		$: (id) => doc.getElementById(id),
		status: () => ({ text: doc.getElementById("statusBar").textContent, cls: doc.getElementById("statusBar").className }),
		rows: () => doc.querySelectorAll("#listWrap .sub-row"),
		/** #srtInput에 파일을 넣고 change를 보낸다 (FileReader는 마이크로태스크). content: 문자열(UTF-8) 또는 바이트(Buffer·Uint8Array) */
		async dropSrt(name, content) {
			return h.dropSrts([{ name, content }]);
		},
		/** 여러 파일: [{name, content, path?, lastModified?}] */
		async dropSrts(list) {
			const input = doc.getElementById("srtInput");
			input.files = list.map((f) => {
				const bytes = typeof f.content === "string" ? null : Buffer.from(f.content);
				const o = bytes ? { name: f.name, _bytes: bytes, size: bytes.length } : { name: f.name, _text: f.content, size: Buffer.byteLength(f.content) };
				if (f.path !== undefined) o.path = f.path;
				if (f.lastModified !== undefined) o.lastModified = f.lastModified;
				return o;
			});
			dispatch(input, makeEvent("change", { bubbles: true }));
			await flush();
		},
		async dropWork(name, obj) {
			const input = doc.getElementById("workInput");
			const text = JSON.stringify(obj);
			input.files = [{ name, _text: text, size: text.length }];
			dispatch(input, makeEvent("change", { bubbles: true }));
			await flush();
		},
		change(el) { dispatch(el, makeEvent("change", { bubbles: true })); },
		click(el) { el.click(); },
		projKeyOf, seqKeyOf,
		errors() { return pageErrors.concat(clock.errors).concat(logs.filter((l) => l[0] === "error" && /TypeError|ReferenceError|SyntaxError/.test(l[1])).map((l) => new Error(l[1]))); }
	};
	return h;
}

module.exports = { bootPanel, CACHE_ROOT, EXT_DIR, USER_DATA_DIR, parseCall, buildDocument, projKeyOf, seqKeyOf, cachePaths };
