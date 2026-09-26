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
const SUGG_MAX = 200;
const CAST_ITEMS_MAX = 99;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
// 쓰기 도구: 패널 대기열·승인 카드에만 넣는다 (속성·타임라인은 사용자가 패널에서 바꾼다) → destructive 아님
const QUEUE_ONLY = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

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
// suggest_fields가 확인에서 거절한 까닭 → 할 일
const SUGG_REJECT_HINT = "results의 error를 보고 고친 뒤 모두 다시 보내세요 — missing-segment: '$$' 조각이 캡션에 글자 그대로 없다, too-many: 조각이 notes의 최대 개수를 넘는다, " +
	"caption-field: 캡션 필드는 쓰지 않는다, unknown-field: 그 줄에 없는 T-ID, empty·too-long: 빈 값·500자 초과, native-unverified·no-preset·no-fields: 이 줄에는 제안할 수 없다, bad-args: 같은 필드가 두 번.";

/** 트랙 칸 'V3' | '3' | 'auto' → 패널 track (V2 = 1 … V99 = 98, 자동 = null). 틀리면 undefined */
function parseTrack(v) {
	const t = String(v).trim();
	if (/^(auto|자동)$/i.test(t)) return null;
	const m = /^[Vv]?\s*(\d{1,2})$/.exec(t);
	if (!m) return undefined;
	const n = parseInt(m[1], 10);
	return n >= 2 && n <= 99 ? n - 1 : undefined;
}

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
		// 서버가 보낸 명령을 패널이 모른다 = 설치된 패널이 서버보다 옛 버전 (core 해시는 core region만 보므로 여기서 잡는다, 예: M5.2 패널의 rows.raw)
		if (resp.error === "bad-args" && String(resp.detail || "").indexOf("모르는 명령: ") === 0) {
			throw new ToolFail("panel-version-mismatch", "패널이 이 서버의 명령(" + op + ")을 모릅니다 — 설치된 패널이 MCP 서버보다 옛 버전입니다.",
				"패널을 새 버전으로 설치하고 패널을 새로 고치거나 Premiere를 다시 시작한 뒤 다시 시도하세요. 그 전까지 쓰기 도구는 쓰지 않습니다.", { detail: resp.detail, op });
		}
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
			return ok({ seq_id: (st.seq && st.seq.id) || hb.seqId || "", panel: st, core: coreReport(hb), bridge: { dir, heartbeatAgeMs: ctx.hbAge, pendingApproval: hb.pendingApproval || 0 }, server: serverInfo, client: ctx.by });
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
		"자막 줄 목록 (쪽 단위)과 seq_id(쓰기 도구에 그대로 보낸다). 줄마다 uid(쓰기 주소)·label('C2·12')·text(캡션)·fields(T-ID별 값)·sig(field_sig)·warn(포인트 경고)·sugg(대기 중인 제안). total로 전체 수를 보고 from으로 쪽을 넘긴다.",
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
			// seq_id는 heartbeat의 시퀀스: 패널이 지금도 그 시퀀스일 때만 읽는다 (그 사이 바뀌었으면 seq-mismatch —
			// 다른 시퀀스의 줄에 옛 seq_id가 붙으면 화자 없는 목록의 uid(줄 번호)가 돌아온 시퀀스의 줄에 맞아 버린다)
			const seq_id = String(ctx.hb.seqId || "");
			return ok(Object.assign({ seq_id }, await panel(ctx, "rows", args, { seqId: seq_id })));
		});
	def("find_row", "줄 찾기",
		"사람이 말한 줄 주소('#12', '12', 'C2·12', '#12 T2')를 지금 목록의 줄로 바꾼다 → seq_id, uid, label, text(캡션 문장), fields, sig(field_sig), 필드를 적었으면 field {fid, displayName, value, caption}. 쓰기 전에 사용자에게 문장을 확인한다.",
		obj({ label: str("줄 주소. 예: '#12', 'C2·12', '#12 T2' (다화자에서 번호가 겹치면 화자를 붙인다)") }, ["label"]), READ,
		async (a, ctx) => {
			await panelUp(ctx);
			const seq_id = String(ctx.hb.seqId || ""); // get_rows와 같다
			return ok(Object.assign({ seq_id }, await panel(ctx, "resolve", { label: a.label }, { seqId: seq_id })));
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
	// ── 쓰기 도구 (M5.3): 패널 신호 + 설치본 core 해시가 패널과 같을 때만. seq_id는 읽기 도구가 준 값 (그 사이 시퀀스가 바뀌면 패널이 거절) ──
	const SEQ_ID = str("get_status·get_rows·find_row가 준 seq_id (그 사이 패널의 시퀀스가 바뀌었으면 거절한다)");
	async function writeReady(ctx, withCore) {
		const hb = await panelUp(ctx);
		const r = C.loadCore(hb, { withCore });
		if (!r.ok) throw new ToolFail(r.code, r.message, r.hint, { server: r.server || null, panel: r.panel || null });
		return r.core;
	}
	def("suggest_fields", "텍스트 필드 제안",
		"캡션이 아닌 텍스트 필드(T-ID)에 값을 제안한다. 패널의 제안 대기열에만 들어가고 사용자가 패널에서 [적용]해야 바뀐다 (속성·타임라인은 그대로). " +
		"서버가 설치된 패널과 같은 core(validateSuggestion)로 먼저 확인하고 하나라도 틀리면 아무것도 넣지 않는다 (results에 까닭). " +
		"포인트 텍스트는 캡션에 글자 그대로 있는 조각을 '$$'로 잇는다 (조각 수는 list_presets notes의 최대 N개). field_sig는 get_rows·find_row의 sig를 그대로 보낸다 (결과에 되돌려 준다). 한 번에 " + SUGG_MAX + "개까지.",
		obj({
			seq_id: SEQ_ID,
			items: { type: "array", description: "제안 목록 (1~" + SUGG_MAX + "개)", items: obj({
				uid: str("줄 uid (get_rows·find_row)"),
				field_id: str("T-ID (T2 …). 캡션 필드(captionFid)는 안 된다"),
				field_sig: str("그 줄의 sig (get_rows·find_row) 그대로"),
				value: str("제안 값 (500자까지). 포인트 텍스트는 '날씨$$하늘'처럼"),
				note: str("사용자에게 보일 짧은 메모 (선택, 200자까지)")
			}, ["uid", "field_id", "field_sig", "value"]) }
		}, ["seq_id", "items"]),
		Object.assign({ idempotentHint: true }, QUEUE_ONLY),
		async (a, ctx) => {
			if (!a.items.length || a.items.length > SUGG_MAX) throw new ToolFail("bad-args", "items는 1~" + SUGG_MAX + "개", "나눠서 보내세요.");
			const core = await writeReady(ctx, true);
			const uids = [...new Set(a.items.map((x) => x.uid))];
			const raw = await panel(ctx, "rows.raw", { uids }, { seqId: a.seq_id });
			const byUid = {};
			raw.rows.forEach((r) => { byUid[r.uid] = r; });
			const seen = {};
			const results = a.items.map((it) => {
				const res = { uid: it.uid, field_id: it.field_id, field_sig: it.field_sig, ok: false, error: "", detail: "", warn: [], kind: "", field: "", check: "" };
				const row = byUid[it.uid];
				if (!row) return Object.assign(res, { error: "not-found", detail: "그런 줄이 없다 (다른 시퀀스의 uid이거나 지워진 줄)" });
				const k = it.uid + "|" + it.field_id;
				if (seen[k]) return Object.assign(res, { error: "bad-args", detail: "같은 필드가 두 번" });
				seen[k] = true;
				const preset = row.rs.presetId ? raw.presets[row.rs.presetId] || null : null;
				const v = core.validateSuggestion({ sub: row.sub, rs: row.rs, preset, fid: it.field_id, value: it.value, sig: it.field_sig });
				return Object.assign(res, { ok: !!v.ok, error: v.error, detail: v.detail, warn: Array.from(v.warn || []), kind: v.kind, field: v.field, check: core.suggCheckText(v) });
			});
			const bad = results.filter((r) => !r.ok);
			if (bad.length) {
				const code = bad.some((r) => r.error === "fields-changed") ? "fields-changed" : bad.every((r) => r.error === "not-found") ? "not-found" : "rejected";
				throw new ToolFail(code, "제안 " + a.items.length + "개 중 " + bad.length + "개가 확인을 통과하지 못해 아무것도 넣지 않았습니다.", code === "rejected" ? SUGG_REJECT_HINT : PANEL_ERRORS[code][1], { results });
			}
			const put = await panel(ctx, "suggest", { items: a.items.map((it) => ({ uid: it.uid, fid: it.field_id, value: it.value, sig: it.field_sig, by: ctx.by, note: it.note })) }, { seqId: a.seq_id });
			return ok({
				queued: put.queued,
				results: results.map((r) => ({ uid: r.uid, field_id: r.field_id, field_sig: r.field_sig, ok: true, kind: r.kind, field: r.field, warn: r.warn, check: r.check })),
				message: "제안 " + put.queued + "개를 패널의 제안 대기열에 넣었습니다. 사용자가 패널에서 [적용]해야 바뀝니다."
			});
		});
	def("set_cast_proposal", "화자 표 제안",
		"화자 표(이름·비디오 트랙·기본 프리셋·화면 위치) 변경을 제안한다. 패널 위쪽 승인 카드에 올라가고 사용자가 [승인]해야 바뀐다 (타임라인은 그대로). " +
		"결과가 pending true(rid)면 사용자에게 패널에서 승인해 달라고 알린다. key는 get_cast의 C1, C2 …, track은 'V2'~'V99' 또는 'auto', " +
		"preset_id는 list_presets의 캡션 필드가 있는 프리셋 id(빈 문자열이면 없음), 위치는 pos_x·pos_y 둘 다 (0~1, MOGRT 자체 배치 기준).",
		obj({
			seq_id: SEQ_ID,
			items: { type: "array", description: "화자마다 바꿀 칸 (1~" + CAST_ITEMS_MAX + "개)", items: obj({
				key: str("화자 키 (C1, C2 …)"),
				name: str("새 이름 (60자까지)"),
				track: str("'V3'처럼 비디오 트랙, 'auto'면 자동"),
				preset_id: str("기본 프리셋 id (빈 문자열이면 없음)"),
				pos_x: { type: "number", description: "화면 위치 x (0~1)" },
				pos_y: { type: "number", description: "화면 위치 y (0~1)" }
			}, ["key"]) },
			note: str("승인 카드에 보일 짧은 까닭 (선택)")
		}, ["seq_id", "items"]),
		Object.assign({ idempotentHint: false }, QUEUE_ONLY),
		async (a, ctx) => {
			if (!a.items.length || a.items.length > CAST_ITEMS_MAX) throw new ToolFail("bad-args", "items는 1~" + CAST_ITEMS_MAX + "개", "");
			await writeReady(ctx, false);
			const cast = await panel(ctx, "cast.get", {}, { seqId: a.seq_id });
			const presets = await panel(ctx, "presets", {}, { seqId: a.seq_id });
			const keys = (cast && cast.castOrder) || [];
			const items = [];
			const seen = {};
			const bad = (msg) => new ToolFail("bad-args", msg, "get_cast·list_presets로 화자 키·프리셋 id를 확인하세요.");
			for (const it of a.items) {
				if (!cast.cast || !cast.cast[it.key]) throw bad("화자 표에 없는 화자: " + it.key + " (있는 화자: " + (keys.join(", ") || "없음") + ")");
				if (seen[it.key]) throw bad(it.key + "가 두 번 있습니다.");
				seen[it.key] = true;
				const o = { key: it.key };
				if (it.name !== undefined) {
					const n = it.name.trim();
					if (!n || n.length > 60) throw bad(it.key + " name은 1~60자");
					o.name = n;
				}
				if (it.track !== undefined) {
					const t = parseTrack(it.track);
					if (t === undefined) throw bad(it.key + " track은 'V2'~'V99' 또는 'auto': " + it.track);
					o.track = t;
				}
				if (it.preset_id !== undefined) {
					if (it.preset_id && !presets.some((p) => p.id === it.preset_id && p.captionFid)) throw bad(it.key + ": 캡션 필드가 있는 프리셋이 아니다: " + it.preset_id);
					o.presetId = it.preset_id;
				}
				if (it.pos_x !== undefined || it.pos_y !== undefined) {
					const unit = (x) => typeof x === "number" && x >= 0 && x <= 1;
					if (!unit(it.pos_x) || !unit(it.pos_y)) throw bad(it.key + " 위치는 pos_x·pos_y 둘 다 0~1");
					o.pos = { x: it.pos_x, y: it.pos_y };
				}
				if (Object.keys(o).length === 1) throw bad(it.key + ": 바꿀 칸이 없습니다 (name·track·preset_id·pos_x/pos_y)");
				items.push(o);
			}
			const args = { items };
			if (typeof a.note === "string" && a.note.trim()) args.note = a.note.trim().slice(0, 200);
			const r = await panel(ctx, "cast.set", args, { seqId: a.seq_id, raw: true, pass: ["needs-approval"] });
			if (r.ok) return ok({ pending: false, changed: (r.data && r.data.changed) || [], message: "화자 표를 바꿨습니다." });
			return ok({ pending: true, rid: r.rid, items, message: "화자 표 변경을 패널 승인 카드에 올렸습니다. 사용자가 패널에서 [승인]해야 바뀝니다 (타임라인은 그대로)." });
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

module.exports = { createToolbox, checkArgs, byOf, parseTrack, ok, fail, ToolFail, PANEL_ERRORS, ROWS_DEFAULT, ROWS_MAX, SUGG_MAX, CALL_MAX_MS };
