#!/usr/bin/env node
/**
 * MOGRT Subtitle Importer 전용 MCP 서버 — stdio, 상태 없음. Codex 우선, Claude(Code·Desktop)도 같은 서버 (5단계).
 *
 * - 패널과는 파일 다리(%APPDATA%/MogrtImporter/bridge, mcp/lib/bridge.js)로만 이야기한다. 세션 파일·Premiere에는 직접 닿지 않는다.
 *   패널의 'AI 연결 허용'이 켜져 있어야 한다 (패널이 heartbeat.json을 2초마다 쓴다).
 * - 제안 확인은 **설치된** 패널의 core(heartbeat.extPath의 html/js/app.js, mcp/lib/core.js)로 한다. 패널이 알린 coreHash와
 *   다르면 쓰기 도구는 panel-version-mismatch로 거절한다.
 * - 도구 정의와 처리는 mcp/lib/tools.js, 안내문은 mcp/lib/guide.js. 여기서는 SDK(@modelcontextprotocol/sdk, 고정 버전)에 잇기만 한다.
 * - stdout은 MCP 프로토콜 전용이다. 로그는 stderr로만.
 *
 * 환경 변수
 *   MI_BRIDGE_DIR       다리 폴더 (기본 %APPDATA%/MogrtImporter/bridge. DEV 패널은 …/bridge_dev)
 *   MI_TOOL_BUDGET_MS   도구 호출 하나의 시간 한도 (기본 19000 — Codex·Claude Desktop은 약 60초에서 끊는다)
 *   MI_HB_WAIT_MS       패널 신호가 없을 때 기다리는 시간 (기본 5000)
 */
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const require = createRequire(import.meta.url);
const B = require("./lib/bridge.js");
const { createToolbox } = require("./lib/tools.js");
const { INSTRUCTIONS } = require("./lib/guide.js");
const PKG = require("./package.json");

const posInt = (v, d) => (/^\d+$/.test(String(v || "")) && Number(v) > 0 ? Number(v) : d);
const INFO = { name: "mogrt_importer", title: "MOGRT Subtitle Importer", version: PKG.version };

const server = new Server(INFO, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
const box = createToolbox({
	dir: B.bridgeDir(process.env),
	budgetMs: posInt(process.env.MI_TOOL_BUDGET_MS, 19000),
	hbWaitMs: process.env.MI_HB_WAIT_MS === "0" ? 0 : posInt(process.env.MI_HB_WAIT_MS, B.HB_WAIT_MS),
	clientName: () => ((server.getClientVersion && server.getClientVersion()) || {}).name || "",
	server: { name: INFO.name, version: INFO.version }
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: box.tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => box.call(req.params.name, req.params.arguments));

const transport = new StdioServerTransport();
transport.onerror = (e) => process.stderr.write("[mogrt_importer] 전송 오류: " + String((e && e.message) || e) + "\n");
await server.connect(transport);
process.stderr.write("[mogrt_importer] " + INFO.version + " 준비 — 다리 " + B.bridgeDir(process.env) + "\n");
