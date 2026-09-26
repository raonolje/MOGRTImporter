"use strict";
/**
 * MCP 도구 정의와 처리 (SDK에 기대지 않는다 — server.mjs가 SDK에 잇는다, 단위 테스트는 정의만 본다).
 *
 *   const box = createToolbox({ dir, budgetMs, hbWaitMs, clientName: () => "codex-mcp-client" });
 *   box.tools          [{name, title, description, inputSchema, annotations}]  (tools/list)
 *   await box.call(name, args)  → {content: [{type: "text", text: JSON}], isError?}  (tools/call)
 *
 * 모든 도구 공통 (Codex·Claude 호환, M5.0 조사):
 * - 결과는 content[0].text의 JSON 하나. structuredContent는 싣지 않는다 (Codex는 structuredContent가 있으면 글자를 버린다).
 * - 입력 스키마는 평평하게: 루트 type object + 이름을 적은 properties (additionalProperties false). anyOf·record 없음,
 *   이름은 [A-Za-z0-9_]. Codex가 지우는 minimum·maximum·pattern·default는 쓰지 않고 설명과 여기 확인에 둔다.
 * - 호출마다 budgetMs(기본 19초) 안에 끝난다: 패널 신호 확인(최대 5초) + 패널 명령(최대 15초, 남은 시간 안에서).
 * - 오류: isError true, {ok: false, code, message, hint}.
 * - 읽기 도구는 readOnlyHint true. 패널 명령은 source agent로 간다 (바꾸는 명령은 패널이 승인 대기열에 넣는다).
 */
const B = require("./bridge");
const C = require("./core");
const { GUIDE } = require("./guide");

const CALL_MAX_MS = 15000;
const ROWS_DEFAULT = 50;
const ROWS_MAX = 200;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// 패널 오류 코드 → 사용자에게 보일 말과 다음 할 일
const PANEL_ERRORS = {
	busy: ["패널이 타임라인에 적용하는 중입니다.", "적용이 끝난 뒤 다시 부르세요."],
	"seq-mismatch": ["패널의 시퀀스가 바뀌었습니다.", "get_status로 지금 시퀀스를 확인한 뒤 다시 하세요."],
	"build-mismatch": ["패널과 Premiere에 로드된 호스트 스크립트의 버전이 다릅니다.", "사용자에게 Premiere를 다시 시작해 달라고 하세요 (호스트 스크립트는 재시작할 때까지 캐시된다)."],
	"no-host": ["Premiere 호스트 스크립트가 답하지 않습니다.", "패널을 새로 고치거나 Premiere를 다시 시작해 달라고 하세요."],
	"preview-active": ["프리뷰 시퀀스가 활성입니다.", "사용자에게 작업 시퀀스를 열어 달라고 하세요."],
	"bad-args": ["요청 인자가 틀렸습니다.", "message의 까닭을 보고 인자를 고치세요."],
	"not-found": ["찾지 못했습니다.", "get_rows·find_row로 지금 목록의 uid를 다시 받으세요."],
	"fields-changed": ["줄의 필드 구조가 바뀌었습니다 (field_sig가 다릅니다).", "get_rows나 find_row로 그 줄의 sig를 다시 받아 보내세요."],
	"no-sequence": ["패널에 시퀀스가 열려 있지 않습니다.", "Premiere에서 시퀀스를 연 뒤 다시 하세요."],
	"no-rows": ["검수할 화자 줄이 없습니다.", "화자(C1, C2 …) SRT를 가져온 목록에서만 검수합니다."],
	"needs-approval": ["패널에서 사용자가 승인해야 합니다.", "사용자에게 패널에서 승인해 달라고 알리세요."],
	expired: ["명령이 너무 오래되어 패널이 돌리지 않았습니다.", "다시 부르세요."],
	duplicate: ["이미 처리한 명령입니다.", "새로 부르세요."],
	exception: ["패널에서 예외가 났습니다.", "잠시 뒤 다시 하거나 패널을 새로 고쳐 달라고 하세요."]
};

class ToolFail extends Error {
	constructor(code, message, hint, extra) {
		super(message);
		this.result = fail(code, message, hint, extra);
	}
}

function ok(data) {
	return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function fail(code, message, hint, extra) {
	return { isError: true, content: [{ type: "text", text: JSON.stringify(Object.assign({ ok: false, code, message, hint: hint || "" }, extra || {})) }] };
}

function obj(properties, required) {
	const s = { type: "object", properties, additionalProperties: false };
	if (required && required.length) s.required = required;
	return s;
}
const str = (description, extra) => Object.assign({ type: "string", description }, extra || {});
const int = (description) => ({ type: "integer", description });

/**
 * 스키마(위 모양)대로 인자를 확인한다 → 틀린 까닭 ("" = 맞음). 모르는 이름도 거절한다 (field·fid 같은 오타를 조용히 버리지 않게)
 */
function checkArgs(schema, v, where) {
	const at = where || "arguments";
	if (schema.type === "object") {
		if (v === undefined || v === null) v = {};
		if (typeof v !== "object" || Array.isArray(v)) return at + "는 객체여야 합니다";
		const props = schema.properties || {};
		for (const k of Object.keys(v)) {
			if (!Object.prototype.hasOwnProperty.call(props, k)) return at + "에 모르는 이름: " + k + " (쓸 수 있는 이름: " + (Object.keys(props).join(", ") || "없음") + ")";
			if (v[k] === undefined) continue;
			const e = checkArgs(props[k], v[k], at === "arguments" ? k : at + "." + k);
			if (e) return e;
		}
		for (const k of schema.required || []) if (v[k] === undefined || v[k] === null) return at + "에 " + k + "가 필요합니다";
		return "";
	}
	if (schema.type === "array") {
		if (!Array.isArray(v)) return at + "는 배열이어야 합니다";
		for (let i = 0; i < v.length; i++) {
			const e = checkArgs(schema.items, v[i], at + "[" + i + "]");
			if (e) return e;
		}
		return "";
	}
	if (schema.type === "string") {
		if (typeof v !== "string") return at + "는 문자열이어야 합니다";
		if (schema.enum && schema.enum.indexOf(v) === -1) return at + "는 " + schema.enum.join(" | ") + " 중 하나";
		return "";
	}
	if (schema.type === "integer") return Number.isInteger(v) ? "" : at + "는 정수여야 합니다";
	if (schema.type === "number") return typeof v === "number" && isFinite(v) ? "" : at + "는 숫자여야 합니다";
	if (schema.type === "boolean") return typeof v === "boolean" ? "" : at + "는 true/false";
	return "";
}

/** MCP 클라이언트 이름 → 제안의 by (패널 표시 'AI 제안 (Codex)') */
function byOf(name) {
	const n = String(name || "");
	if (/codex/i.test(n)) return "codex";
	if (/claude/i.test(n)) return "claude";
	return n ? n.slice(0, 40) : "ai";
}

/**
 * @param {object} o
 *   dir        다리 폴더 (bridge.bridgeDir())
 *   budgetMs   도구 호출 하나의 시간 한도 (기본 19초)
 *   hbWaitMs   신호가 없을 때 기다리는 시간 (기본 5초)
 *   clientName () => MCP 클라이언트 이름 (initialize clientInfo.name)
 *   server     {name, version} (get_status에 싣는다)
 */
function createToolbox(o) {
	const dir = o.dir;
	const budgetMs = o.budgetMs || 19000;
	const hbWaitMs = o.hbWaitMs === undefined ? B.HB_WAIT_MS : o.hbWaitMs;
	const clientName = o.clientName || (() => "");
	const serverInfo = o.server || { name: "mogrt_importer", version: "" };

	// 패널이 살아 있는가 → heartbeat (아니면 ToolFail)
	async function panelUp(ctx) {
		const pc = await B.checkPanel(dir, { waitMs: Math.max(0, Math.min(hbWaitMs, ctx.deadline - Date.now() - 1000)) });
		if (!pc.ok) throw new ToolFail(pc.code, pc.message, pc.hint);
		ctx.hb = pc.hb;
		ctx.hbAge = pc.age;
		return pc.hb;
	}
	// 패널 명령 → data (opts.raw면 응답 전체). 패널 오류는 ToolFail (opts.pass에 든 코드는 그대로 돌려준다)
	async function panel(ctx, op, args, opts = {}) {
		const left = ctx.deadline - Date.now() - 300;
		if (left < 500) throw new ToolFail("timeout", "도구 시간 한도(" + Math.round(budgetMs / 1000) + "초)를 넘었습니다.", "잠시 뒤 다시 부르세요.");
		const timeoutMs = opts.long ? left : Math.min(CALL_MAX_MS, left);
		let resp;
		try {
			resp = await B.call(dir, op, args, { by: ctx.by, seqId: opts.seqId, timeoutMs });
		} catch (e) {
			if (e && e.code === "timeout") throw new ToolFail("timeout", e.message, e.withdrawn ? "패널이 멈췄거나 앞 명령이 오래 걸립니다. Premiere 화면을 확인한 뒤 다시 부르세요." : "패널이 아직 처리 중일 수 있습니다 (검수·계획은 오래 걸린다). 잠시 뒤 결과를 다시 확인하세요.", { withdrawn: !!e.withdrawn });
			throw new ToolFail("bridge-error", "다리 폴더에 쓰지 못했습니다: " + String((e && e.message) || e), "다리 폴더(" + dir + ") 권한을 확인하세요.");
		}
		if (resp.ok === true) return opts.raw ? resp : resp.data;
		if (opts.pass && opts.pass.indexOf(resp.error) !== -1) return resp;
		const known = PANEL_ERRORS[resp.error] || ["패널이 거절했습니다 (" + resp.error + ").", "message를 확인하세요."];
		const extra = { detail: resp.detail || "" };
		if (resp.results) extra.results = resp.results;
		if (resp.rid) extra.rid = resp.rid;
		throw new ToolFail(resp.error || "panel-error", known[0] + (resp.detail ? " " + resp.detail : ""), known[1], extra);
	}
	// 설치본 core와 패널 core가 같은가 (get_status 보고용, 막지 않는다)
	function coreReport(hb) {
		const r = C.loadCore(hb);
		return r.ok ? { match: true, hash: r.hash } : { match: false, code: r.code, message: r.message, server: r.server || null, panel: r.panel || null };
	}

	const tools = [];
	const def = (name, title, description, inputSchema, annotations, run) => tools.push({ name, title, description, inputSchema, annotations: Object.assign({ title }, annotations), run });

	def("get_status", "패널 상태",
		"패널·시퀀스·화자·줄 수·제안 수·승인 대기 수와 core 버전 확인(core.match). 모든 작업의 처음에 부른다. 패널이 닫혀 있거나 'AI 연결 허용'이 꺼져 있으면 오류 code로 알려 준다.",
		obj({}), READ,
		async (a, ctx) => {
			const hb = await panelUp(ctx);
			const st = await panel(ctx, "status", {});
			return ok({ panel: st, core: coreReport(hb), bridge: { dir, heartbeatAgeMs: ctx.hbAge, pendingApproval: hb.pendingApproval || 0 }, server: serverInfo, client: ctx.by });
		});
	def("list_presets", "프리셋 목록",
		"프리셋마다 텍스트 필드(T-ID fid·label·caption), captionFid(캡션 필드 — 쓰지 않는다), 필드 서명 sig, notes(포인트 텍스트 '최대 N개' 같은 규칙), native·orderVerified.",
		obj({}), READ,
		async (a, ctx) => {
			await panelUp(ctx);
			return ok({ presets: await panel(ctx, "presets", {}) });
		});
	def("get_cast", "화자 표",
		"화자 표: castOrder와 화자마다(C1, C2 …) 이름·트랙·기본 프리셋·위치.",
		obj({}), READ,
		async (a, ctx) => {
			await panelUp(ctx);
			return ok(await panel(ctx, "cast.get", {}));
		});
	def("get_rows", "자막 줄 목록",
		"자막 줄 목록 (쪽 단위). 줄마다 uid(쓰기 주소)·label('C2·12')·text(캡션)·fields(T-ID별 값)·sig(field_sig)·warn(포인트 경고)·sugg(대기 중인 제안). total로 전체 수를 보고 from으로 쪽을 넘긴다.",
		obj({
			speaker: str("화자 키 (C1, C2 …). 빼면 모든 화자"),
			from: int("몇 번째 줄부터 (0부터, 기본 0)"),
			count: int("최대 줄 수 (1~" + ROWS_MAX + ", 기본 " + ROWS_DEFAULT + ")"),
			filter: str("all(기본) | changed(병합으로 바뀐 줄) | warn(포인트 경고가 있는 줄) | sugg(AI 제안이 있는 줄)", { enum: ["all", "changed", "warn", "sugg"] })
		}), READ,
		async (a, ctx) => {
			const count = a.count === undefined ? ROWS_DEFAULT : a.count;
			if (count < 1 || count > ROWS_MAX) throw new ToolFail("bad-args", "count는 1~" + ROWS_MAX, "count를 줄이고 from으로 쪽을 넘기세요.");
			if (a.from !== undefined && a.from < 0) throw new ToolFail("bad-args", "from은 0 이상", "");
			await panelUp(ctx);
			const args = { count };
			if (a.speaker !== undefined) args.spk = a.speaker;
			if (a.from !== undefined) args.from = a.from;
			if (a.filter !== undefined) args.filter = a.filter;
			return ok(await panel(ctx, "rows", args));
		});
	def("find_row", "줄 찾기",
		"사람이 말한 줄 주소('#12', '12', 'C2·12', '#12 T2')를 지금 목록의 줄로 바꾼다 → uid, label, text(캡션 문장), fields, sig(field_sig), 필드를 적었으면 field {fid, displayName, value, caption}. 쓰기 전에 사용자에게 문장을 확인한다.",
		obj({ label: str("줄 주소. 예: '#12', 'C2·12', '#12 T2' (다화자에서 번호가 겹치면 화자를 붙인다)") }, ["label"]), READ,
		async (a, ctx) => {
			await panelUp(ctx);
			return ok(await panel(ctx, "resolve", { label: a.label }));
		});
	def("get_suggestions", "제안 대기열",
		"패널의 AI 제안 대기열: 줄·필드·값·by·ok(지금 검증 통과)·stale(캡션·구조가 바뀌어 다시 확인 필요)·check(확인 문구). 사용자가 패널에서 [적용]하기 전에는 아무것도 바뀌지 않는다.",
		obj({ uid: str("이 줄의 제안만 (빼면 모두)") }), READ,
		async (a, ctx) => {
			await panelUp(ctx);
			return ok({ suggestions: await panel(ctx, "sugg.list", a.uid !== undefined ? { uid: a.uid } : {}) });
		});
	def("plan_apply", "배치 계획 (읽기만)",
		"화자별 배치 계획을 세운다: 작업 수, 새로 만들 트랙, 충돌, Premiere에서 고친 클립. 타임라인을 읽기만 하고 바꾸지 않는다 (적용은 사용자가 패널에서 한다). uids와 speaker 중 하나만, 둘 다 빼면 화자 줄 전부.",
		obj({
			uids: { type: "array", items: { type: "string" }, description: "계획할 줄 uid 목록" },
			speaker: str("이 화자(C1, C2 …)의 줄만")
		}), READ,
		async (a, ctx) => {
			if (a.uids !== undefined && a.speaker !== undefined) throw new ToolFail("bad-args", "uids와 speaker 중 하나만 주세요.", "");
			if (a.uids !== undefined && !a.uids.length) throw new ToolFail("bad-args", "uids가 비었습니다.", "");
			await panelUp(ctx);
			const args = {};
			if (a.uids !== undefined) args.uids = a.uids;
			if (a.speaker !== undefined) args.spk = a.speaker;
			const r = await panel(ctx, "plan", args, { long: true });
			return ok(Object.assign({}, r, { note: "타임라인은 바뀌지 않았습니다. 적용은 사용자가 패널에서 합니다." }));
		});
	def("verify_timeline", "타임라인 검수 (읽기만)",
		"타임라인을 읽기만 해서 목록과 맞는지 검수한다: 정상·타임라인에 없음·옮겨짐·같은 태그 중복·옛 세대·Premiere에서 고침·옛 버전 템플릿·효과·미적용·목록에 없는 클립. 화자 줄이 있는 목록에서만.",
		obj({}), READ,
		async (a, ctx) => {
			await panelUp(ctx);
			return ok(await panel(ctx, "verify", {}, { long: true }));
		});
	def("get_guide", "운영 규칙",
		"이 도구들의 자세한 운영 규칙 (주소·포인트 텍스트·승인·오류 코드). 패널에 닿지 않는다.",
		obj({}), READ,
		async () => ok({ guide: GUIDE }));

	async function call(name, args) {
		const t = tools.find((x) => x.name === name);
		if (!t) return fail("unknown-tool", "모르는 도구: " + String(name), "tools/list의 이름을 쓰세요.");
		const bad = checkArgs(t.inputSchema, args, "arguments");
		if (bad) return fail("bad-args", bad, "도구 설명의 인자 이름·형식을 확인하세요.");
		const ctx = { deadline: Date.now() + budgetMs, by: byOf(clientName()) };
		try {
			return await t.run(args || {}, ctx);
		} catch (e) {
			if (e instanceof ToolFail) return e.result;
			return fail("exception", "서버 예외: " + String((e && e.message) || e), "같은 호출을 다시 하거나 서버 로그를 확인하세요.");
		}
	}

	return {
		tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
		call
	};
}

module.exports = { createToolbox, checkArgs, byOf, ok, fail, ToolFail, PANEL_ERRORS, ROWS_DEFAULT, ROWS_MAX, CALL_MAX_MS };
