"use strict";
/**
 * 하드 테스트 가드: MI_test.prproj의 T_ 시퀀스에서만 돌아간다.
 * 사용자의 실제 프로젝트·시퀀스를 테스트가 건드리지 못하게 막는 마지막 장치다.
 * 호스트 정보는 v27 getActiveSequenceInfo()로 읽는다 (운영·DEV 모두 같은 함수).
 */
const TEST_PROJECT = "MI_test.prproj";
const SEQ_PREFIX = "T_";

class GuardError extends Error {
	constructor(msg) {
		super(msg);
		this.name = "GuardError";
	}
}

/**
 * @param {{projPath?: string, seqName?: string}} info getActiveSequenceInfo()의 결과
 * @returns {{ok: boolean, reason?: string}}
 */
function checkGuard(info) {
	const projPath = String((info && info.projPath) || "").replace(/\\/g, "/");
	const seqName = String((info && info.seqName) || "");
	const base = projPath.split("/").pop();
	if (!projPath) return { ok: false, reason: "열린 프로젝트 경로를 읽지 못했다" };
	if (base.toLowerCase() !== TEST_PROJECT.toLowerCase()) {
		return { ok: false, reason: "테스트 프로젝트가 아니다: " + base + " (" + TEST_PROJECT + "에서만 실행)" };
	}
	if (!seqName) return { ok: false, reason: "활성 시퀀스가 없다 (" + SEQ_PREFIX + "로 시작하는 시퀀스를 연다)" };
	if (seqName.indexOf(SEQ_PREFIX) !== 0) {
		return { ok: false, reason: "테스트 시퀀스가 아니다: " + seqName + " (" + SEQ_PREFIX + "로 시작해야 한다)" };
	}
	return { ok: true };
}

/**
 * 호스트에 물어보고 가드를 통과하지 못하면 GuardError를 던진다.
 * @param {(jsx: string) => Promise<string>} host
 */
async function guard(host) {
	const raw = await host("getActiveSequenceInfo()");
	let info;
	try {
		info = JSON.parse(raw);
	} catch (_) {
		throw new GuardError("getActiveSequenceInfo 결과를 읽지 못했다: " + String(raw).slice(0, 200));
	}
	const r = checkGuard(info);
	if (!r.ok) throw new GuardError("가드: " + r.reason);
	return info;
}

module.exports = { guard, checkGuard, GuardError, TEST_PROJECT, SEQ_PREFIX };
