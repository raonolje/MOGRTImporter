"use strict";
/**
 * 합성 네이티브(Premiere에서 만든) MOGRT 픽스처와 구운 사본 읽기 (S1-11). 텍스트는 모두 지어낸 것이다.
 *
 *   const N = require("../fixtures/mogrt/make_native_mogrt");
 *   const buf = N.buildNativeMogrt({ texts: ["합성 이름 칸", "합성 제목 칸"] });   // .mogrt 바이트 (Buffer)
 *   const r = N.readNativeMogrt(buf);   // {names, def, graphics: {이름: {entries: [{name, gz, xml, texts, hashes}], count}}}
 *
 * 모양은 설치된 Premiere 템플릿(Lower Thirds/Classic Lower Third Two Lines.mogrt, 2018 형식)을 따른다:
 *   definition.json  clientControls에 TextLayer(type 6)와 다른 컨트롤, capsuleNameLocalized, int64 ticksperframe
 *   project.prgraphic        zip → gzip .prproj XML. <Name>Source Text</Name> StartKeyframeValue 블롭
 *                            (8바이트 LE 길이 + UTF-16LE JSON {mTextParam: {mStyleSheet: {mText}}}) + Path(이진)·Appearance(JSON) 블롭
 *   project_ko_KR.prgraphic  같은 내용인데 속성 이름이 '소스 텍스트', 항목 이름이 한글(UTF-8 플래그)
 *   thumb.png, thumb.mp4, thumb_ko_KR.png
 * opts.format "binary": Source Text 블롭을 새 Premiere(apiVersion 2.x)처럼 이진 형식으로 (굽기 불가)
 * opts.selfRef: 두 번째 Source Text를 첫 번째와 같은 내용으로 두고 빈 요소(<… BinaryHash="h"/>)로 가리킨다 (Premiere 쓰기 방식)
 * opts.localized false: project_ko_KR.prgraphic을 넣지 않는다
 */
const zlib = require("node:zlib");
const { writeZip, readZip } = require("./make_old_mogrt");

const INT64_MAX = "9223372036854775807";

/** Source Text 블롭 (base64) */
function textBlob(text, font) {
	const json = "{\"mTextParam\":{\"mAlignment\":0,\"mDefaultRun\":[],\"mLeading\":0,\"mShadowAngle\":171.86990356445313,\"mShadowVisible\":true," +
		"\"mStyleSheet\":{\"mFillColor\":{\"mParamValues\":[[0,16777215]]},\"mFontName\":{\"mParamValues\":[[0," + JSON.stringify(font || "RobotoSlab-Bold") + "]]}," +
		"\"mFontSize\":{\"mParamValues\":[[0,53.250003814697266]]},\"mText\":" + JSON.stringify(text) + ",\"mTracking\":{\"mParamValues\":[[0,0]]}},\"mTabWidth\":400,\"mWidth\":0},\"mVersion\":1}";
	const body = Buffer.from(json, "utf16le");
	const head = Buffer.alloc(8);
	head.writeUInt32LE(body.length, 0);
	return Buffer.concat([head, body]).toString("base64");
}
/** 새 형식(이진) Source Text 블롭: 8바이트 길이 + 0x11223344 머리 + UTF-8 문구 (JSON이 아니다) */
function binaryTextBlob(text) {
	const t = Buffer.from(text, "utf8");
	const body = Buffer.concat([Buffer.from([0x44, 0x33, 0x22, 0x11, 0x0c, 0, 0, 0]), Buffer.alloc(4), t, Buffer.alloc(4 - (t.length % 4))]);
	const head = Buffer.alloc(8);
	head.writeUInt32LE(body.length, 0);
	return Buffer.concat([head, body]).toString("base64");
}
/** Path 블롭 (이진, 머리 8바이트가 길이가 아니다) */
function pathBlob() {
	return Buffer.from([2, 0, 0, 0, 4, 0, 0, 0].concat(Array.from({ length: 40 }, (_, i) => (i * 37) & 255))).toString("base64");
}
/** Appearance 블롭 (JSON이지만 mTextParam이 없다) */
function appearanceBlob() {
	const body = Buffer.from("{\"mStyle\":{\"mFillColor\":19161,\"mFillVisible\":true,\"mShadowAngle\":135},\"mVersion\":1}", "utf16le");
	const head = Buffer.alloc(8);
	head.writeUInt32LE(body.length, 0);
	return Buffer.concat([head, body]).toString("base64");
}
/** BinaryHash 모양 (8-4-4-4-12, 끝 8자리 = 바이트 길이 + 12) */
function binHash(seed, b64) {
	const len = Buffer.from(b64, "base64").length + 12;
	const h = require("node:crypto").createHash("md5").update(seed + b64).digest("hex");
	return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 24) + ("0000000" + len.toString(16)).slice(-8);
}
function param(objectId, name, b64, hash, selfClosing) {
	const value = selfClosing
		? "<StartKeyframeValue Encoding=\"base64\" BinaryHash=\"" + hash + "\"/>"
		: "<StartKeyframeValue Encoding=\"base64\" BinaryHash=\"" + hash + "\">" + b64 + "</StartKeyframeValue>";
	return "\t<ArbVideoComponentParam ObjectID=\"" + objectId + "\" ClassID=\"313e54d4-6903-49ad-b0bf-8262cdd10f4e\" Version=\"2\">\n" +
		"\t\t<Name>" + name + "</Name>\n\t\t<IsTimeVarying>false</IsTimeVarying>\n\t\t<ParameterControlType>9</ParameterControlType>\n" +
		"\t\t<StartKeyframePosition>-91445760000000000</StartKeyframePosition>\n\t\t" + value + "\n\t</ArbVideoComponentParam>\n";
}
/** .prproj XML (글자) */
function prprojXml(texts, opts) {
	const o = opts || {};
	const stName = o.sourceTextName || "Source Text";
	const pathB = pathBlob();
	const pathH = binHash("path", pathB);
	const parts = ["<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<PremiereData Version=\"3\">\n",
		"\t<VideoComponentParam ObjectID=\"80\"><Name>Opacity</Name><StartKeyframe>-91445760000000000,100.,0,0,0,0,0,0</StartKeyframe></VideoComponentParam>\n"];
	let firstText = null;
	texts.forEach((t, k) => {
		const b = o.format === "binary" ? binaryTextBlob(t) : textBlob(t, o.font);
		if (o.selfRef && k === 1 && firstText) parts.push(param(90 + k, stName, null, firstText.h, true));
		else {
			const h = binHash("text" + k + (o.seed || ""), b);
			if (!firstText) firstText = { b, h };
			parts.push(param(90 + k, stName, b, h, false));
		}
		parts.push(param(95 + k, o.pathName || "Path", pathB, pathH, k > 0)); // 두 번째부터는 같은 Path 블롭을 가리킨다
	});
	const ap = appearanceBlob();
	parts.push(param(99, o.appearanceName || "Appearance", ap, binHash("ap", ap), false));
	parts.push("</PremiereData>\n");
	return parts.join("");
}
function prgraphic(entryName, xml, extra) {
	return writeZip([{ name: entryName, data: zlib.gzipSync(Buffer.from(xml, "utf8")) }].concat(extra || []));
}
/** 합성 definition.json 글자 (Python json.dumps 기본 구분자 모양) */
function definitionJson(texts, opts) {
	const o = opts || {};
	const layer = (id, t) => ({ canAnimate: false, id: String(id), type: 6, uiName: { strDB: [{ localeString: "en_US", str: "TextLayer" }] },
		value: { strDB: [{ localeString: "en_US", str: t }, { localeString: "ko_KR", str: t + " (한국어)" }] } });
	const controls = [];
	texts.forEach((t, k) => {
		controls.push(layer(3 + 2 * k, t));
		if (k === 0) controls.push({ canAnimate: false, id: "4", type: 2, uiName: { strDB: [{ localeString: "en_US", str: "Color" }] }, value: 1.0 });
	});
	controls.push({ canAnimate: false, hidden: true, id: "9", type: 8, uiName: { strDB: [{ localeString: "en_US", str: "LayerName" }] }, value: { strDB: [{ localeString: "en_US", str: "Shape" }] } });
	const def = {
		apiVersion: o.format === "binary" ? "2.2" : "1.4",
		authorApp: "ppro",
		capsuleID: o.capsuleID || "3b7f65d3-e666-4115-8568-000000000001",
		capsuleName: o.capsuleName || "합성 네이티브",
		capsuleNameLocalized: { strDB: [{ localeString: "en_US", str: o.capsuleName || "합성 네이티브" }, { localeString: "ko_KR", str: "합성 네이티브 (한국어)" }] },
		clientControls: controls,
		sourceInfoLocalized: { en_US: { audiosamplerate: { ticksperframe: "__INT64__" }, framerate: { ticksperframe: 10594584000 }, scale: "__ONE__" } }
	};
	// 템플릿 길이 (opts.durationSec, 설치된 템플릿처럼 {scale, value})
	if (o.durationSec) def.sourceInfoLocalized.en_US.duration = { scale: 1000, value: Math.round(o.durationSec * 1000) };
	return JSON.stringify(def, null, 0).replace(/,/g, ", ").replace(/":/g, "\": ")
		.replace("\"__INT64__\"", INT64_MAX).replace("\"__ONE__\"", "1.0");
}
/** 합성 네이티브 .mogrt 바이트 */
function buildNativeMogrt(opts) {
	const o = opts || {};
	const texts = o.texts || ["합성 이름 칸", "합성 제목 칸"];
	const entries = [
		{ name: "definition.json", data: Buffer.from((o.bom ? "\uFEFF" : "") + definitionJson(texts, o), "utf8") },
		{ name: "project.prgraphic", data: prgraphic("Synth_Delivery.prproj", prprojXml(texts, o)) }
	];
	if (o.localized !== false) {
		entries.push({ name: "project_ko_KR.prgraphic", data: prgraphic("무제.prproj", prprojXml(texts.map((t) => t + " (한국어)"), Object.assign({}, o, { sourceTextName: "소스 텍스트", pathName: "경로", appearanceName: "모양", seed: "ko", font: "SourceHanSansKR-Light" }))) });
	}
	entries.push({ name: "thumb.mp4", data: Buffer.alloc(3000, 7) });
	entries.push({ name: "thumb.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), method: 0 });
	entries.push({ name: "thumb_ko_KR.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]), method: 0 });
	return writeZip(entries);
}

// ── 읽기 (검증용, 패널 코드와 따로 쓴 구현) ──

/** base64 Source Text 블롭 → mText (텍스트 블롭이 아니면 null) */
function blobText(b64) {
	const b = Buffer.from(b64, "base64");
	if (b.length < 10) return null;
	const n = Number(b.readBigUInt64LE(0));
	if (n > b.length - 8 || b[8] !== 0x7b) return null;
	try {
		const j = JSON.parse(b.subarray(8, 8 + n).toString("utf16le"));
		return j && j.mTextParam && j.mTextParam.mStyleSheet && typeof j.mTextParam.mStyleSheet.mText === "string" ? j.mTextParam.mStyleSheet.mText : null;
	} catch (_) {
		return null;
	}
}
/** prproj XML → {texts: 문서 순서의 Source Text mText (빈 요소는 가리키는 블롭으로), hashes, refs: 빈 요소 해시, full: {해시: base64}} */
function xmlTexts(xml) {
	const full = {};
	const re = /<StartKeyframeValue\b([^>]*?)(?:\/>|>([^<]*)<\/StartKeyframeValue>)/g;
	let m;
	while ((m = re.exec(xml))) {
		const h = (/BinaryHash="([^"]*)"/.exec(m[1]) || [])[1];
		if (m[2] !== undefined && h && !(h in full)) full[h] = m[2];
	}
	const texts = [];
	const hashes = [];
	const refs = [];
	re.lastIndex = 0;
	while ((m = re.exec(xml))) {
		const h = (/BinaryHash="([^"]*)"/.exec(m[1]) || [])[1];
		const data = m[2] !== undefined ? m[2] : full[h];
		if (m[2] === undefined) refs.push(h);
		const t = data ? blobText(data) : null;
		if (t !== null) {
			texts.push(t);
			hashes.push({ h, len: Buffer.from(data, "base64").length, ref: m[2] === undefined });
		}
	}
	return { texts, hashes, refs, full };
}
/** .mogrt 바이트 → {names, def (JSON.parse), defText, graphics: {이름: {entries: [{name, gz, xml, texts, hashes, refs, full}], count}}} */
function readNativeMogrt(buf) {
	const entries = readZip(Buffer.from(buf));
	const out = { names: entries.map((e) => e.name), def: null, defText: "", graphics: {} };
	entries.forEach((e) => {
		if (e.name === "definition.json") {
			out.defText = e.data.toString("utf8").replace(/^\uFEFF/, "");
			out.def = JSON.parse(out.defText);
		}
		if (/\.prgraphic$/.test(e.name)) {
			const inner = readZip(e.data).map((ie) => {
				const gz = ie.data[0] === 0x1f && ie.data[1] === 0x8b;
				const xml = (gz ? zlib.gunzipSync(ie.data) : ie.data).toString("utf8");
				return Object.assign({ name: ie.name, gz, xml }, xmlTexts(xml));
			});
			out.graphics[e.name] = { entries: inner, count: inner.reduce((n, x) => n + x.texts.length, 0) };
		}
	});
	return out;
}

module.exports = { buildNativeMogrt, readNativeMogrt, prprojXml, definitionJson, textBlob, binaryTextBlob, pathBlob, appearanceBlob, blobText, xmlTexts, INT64_MAX };
