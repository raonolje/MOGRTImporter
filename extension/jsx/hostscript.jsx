/*
 * hostscript.jsx  v28
 * Premiere Pro ExtendScript
 * - v28 변경사항:
 *   1. 파일 끝에 다화자 호스트 구역(MI:BEGIN v28 ~ MI:END)을 더했다. 진입점은 MI_, 헬퍼는 MI__ 접두사,
 *      ES3만 쓴다 (npm run lint:jsx). 위의 v27 함수는 한 바이트도 바꾸지 않았다 (tests/unit/host_pure.test.js).
 * - v27 변경사항:
 *   1. Premiere 네이티브 템플릿 지원. getMGTComponent가 null인 클립은
 *      AE.ADBE Text 컴포넌트의 "Source Text"를 읽고 쓴다.
 *      collectNativeTextProps() 추가, getMogrtParams/applyParamsToItem에 분기.
 * - v26 변경사항:
 *   1. 공통 헬퍼로 중복 정리: findPreviewSequence / findWorkSequence /
 *      findSequenceByName / secToTicks / ticksToSec / ensureQE / parsePayload /
 *      parsePayloadMaybeEncoded. 같은 루프가 7곳, 파싱이 13곳, enableQE가
 *      9곳에 복사되어 있었다. setActive처럼 한 곳만 고치고 나머지를
 *      놓치는 사고를 막는다.
 *   2. addLegacyTextLayer(): Premiere 26.x에서 제거된 createNewTitle을 판별해
 *      원인을 담은 예외를 던지고, 호출부가 그 사유를 결과 메시지에 실는다.
 * - v25 변경사항:
 *   1. setActiveSequence(): Premiere 26.x에서 제거된 Sequence.setActive() 대체.
 *      기존 11곳의 seq.setActive() 호출은 try/catch에 감싸서 조용히 실패하고 있었다.
 *   2. getMogrtParams(): Premiere 네이티브 템플릿을 판별해 원인을 알려주는 메시지로 교체.
 * - v24 변경사항:
 *   1. detectParamType(): 컬러 감지를 숫자 체크보다 먼저 수행 (64비트 ARGB 범위 체크 추가)
 *   2. getMogrtParams(): 텍스트 파라미터에 fontExposed 플래그 추가
 * - v23 변경사항:
 *   1. setupPreviewSequence(): sqpreset 경로 macOS/Windows 크로스 플랫폼 (연도별 다중 후보 탐색)
 *   2. capturePreviewFrame(): 임시 파일 경로 구분자 크로스 플랫폼화
 *   3. getSystemFonts(): macOS 폰트 경로 추가 (/Library/Fonts, ~/Library/Fonts, Adobe CoreSync)
 * - v22 변경사항:
 *   1. scanMogrtFiles(): macOS 경로 추가 (HOME/Library/Application Support)
 *   2. getMogrtFolderTree(): macOS/Windows 크로스 플랫폼 지원 (HOME, Folder.userData 폴백)
 * - v21 변경사항:
 *   1. getMogrtParams(): textsetting/comment 타입 감지 개선
 *   2. getMogrtParams(): 그룹 구조 정확히 반영 (numItems 기반)
 *   3. seekToClip(payloadStr): 타임라인을 특정 클립 위치로 이동
 *   4. getClipInfo(payloadStr): 특정 시간의 클립 존재 여부 반환
 */

/* ── 시퀀스 활성화 ──
   Premiere 26.x에서 Sequence.setActive()가 제거되었다(26.5.1에서 typeof 확인: undefined).
   기존 코드는 seq.setActive()를 try/catch로 감싸 불렀기 때문에, 실패해도
   조용히 무시되어 활성 시퀀스가 __MOGRT_PREVIEW__에 머무르는 문제가 있었다.
   app.project.activeSequence 대입이 대체로 동작한다(26.5.1 확인).
   구버전 호환을 위해 setActive가 있으면 그쪽을 먼저 쓴다. */
/* ── 공통 상수 ── */
var PREVIEW_SEQ_NAME = "__MOGRT_PREVIEW__";   /* 파리별로 7번 선언되던 것을 하나로 모음 */
var TICKS_PER_SECOND = 254016000000;          /* 네 곳에 상수가 박혀 있던 것을 모음 */

function secToTicks(sec) { return String(Math.round(sec * TICKS_PER_SECOND)); }
function ticksToSec(ticks) { return parseInt(ticks, 10) / TICKS_PER_SECOND; }

/* 이름으로 시퀀스 찾기. 같은 탐색 루프가 7곳에 복사되어 있었다. */
function findSequenceByName(name) {
    var proj = app.project;
    if (!proj) return null;
    var n = 0;
    try { n = proj.sequences.numSequences; } catch(e) { return null; }
    for (var i = 0; i < n; i++) {
        var s;
        try { s = proj.sequences[i]; } catch(e) { continue; }
        if (s && String(s.name) === String(name)) return s;
    }
    return null;
}
function findPreviewSequence() { return findSequenceByName(PREVIEW_SEQ_NAME); }

/* 프리뷰가 아닌 첫 시퀀스. 프리뷰가 활성인 채로 남았을 때 작업 시퀀스를 되찾는 용도. */
function findWorkSequence() {
    var proj = app.project;
    if (!proj) return null;
    var n = 0;
    try { n = proj.sequences.numSequences; } catch(e) { return null; }
    for (var i = 0; i < n; i++) {
        var s;
        try { s = proj.sequences[i]; } catch(e) { continue; }
        if (s && String(s.name) !== PREVIEW_SEQ_NAME) return s;
    }
    return null;
}

/* QE DOM 준비. app.enableQE()가 9곳에 흘어져 있었다. */
function ensureQE() {
    try { app.enableQE(); } catch(e) { return false; }
    return (typeof qe !== "undefined" && !!qe);
}

/* 페이로드 파싱. 13곳이 같은 try/catch를 반복했다. 실패 시 null. */
function parsePayload(payloadStr) {
    try { return JSON.parse(payloadStr); } catch(e) { return null; }
}
/* 일부 진입점은 encodeURIComponent로 감싼 문자열과 날것을 모두 받는다. */
function parsePayloadMaybeEncoded(payloadStr) {
    var p = null;
    try { p = JSON.parse(decodeURIComponent(payloadStr)); } catch(e) {}
    if (!p) p = parsePayload(payloadStr);
    return p;
}

/* ── 네이티브(Premiere 필수 그래픽) 템플릿의 텍스트 속성 수집 ──
   getMGTComponent()는 After Effects에서 만든 MOGRT(AE.ADBE Capsule 보유)에서만
   값을 돌려준다. Premiere 필수 그래픽 패널로 만든 템플릿은 삽입 결과가
   이름 "Graphic"인 일반 그래픽 클립이지만, AE.ADBE Text 컴포넌트의
   "Source Text" 속성은 읽고 쓸 수 있다(26.5.1 확인: setValue/getValue 둘 다 동작).
   수집 순서(컴포넌트 순 → 속성 순)를 그대로 파라미터 index로 쓴다.
   MGT 경로가 props[index]를 쓰는 것과 같은 가정이다. */
function collectNativeTextProps(trackItem) {
    var out = [];
    if (!trackItem) return out;
    var nc = 0;
    try { nc = trackItem.components.numItems; } catch(e) { return out; }
    for (var c = 0; c < nc; c++) {
        var cp;
        try { cp = trackItem.components[c]; } catch(e) { continue; }
        if (!cp) continue;
        var mn = "";
        try { mn = String(cp.matchName); } catch(e) { continue; }
        if (mn.indexOf("Text") === -1) continue;
        var ps;
        try { ps = cp.properties; } catch(e) { continue; }
        var np = 0;
        try { np = ps.numItems; } catch(e) { continue; }
        for (var i = 0; i < np; i++) {
            var pr;
            try { pr = ps[i]; } catch(e) { continue; }
            var dn = "";
            try { dn = String(pr.displayName); } catch(e) {}
            if (dn === "Source Text") out.push(pr);
        }
    }
    return out;
}

function setActiveSequence(seq) {
    if (!seq) return false;
    try { if (typeof seq.setActive === "function") { seq.setActive(); return true; } } catch(e) {}
    try { app.project.activeSequence = seq; return true; } catch(e) {}
    return false;
}

/* ── JSON Polyfill ── */
if (typeof JSON === "undefined") { JSON = {}; }
if (typeof JSON.stringify !== "function") {
    JSON.stringify = function (v) {
        var t = typeof v;
        if (v === null) return "null";
        if (t === "boolean" || t === "number") return String(v);
        if (t === "string") return '"' + v.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/\t/g,"\\t") + '"';
        if (Object.prototype.toString.call(v) === "[object Array]") {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(JSON.stringify(v[i]));
            return "[" + a.join(",") + "]";
        }
        if (t === "object") {
            var p = [];
            for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) p.push('"' + k + '":' + JSON.stringify(v[k])); }
            return "{" + p.join(",") + "}";
        }
        return "null";
    };
}
if (typeof JSON.parse !== "function") {
    JSON.parse = function (s) { return eval("(" + s + ")"); };
}

/* ══════════════════════════════════════════════
   1. MOGRT 스캔
══════════════════════════════════════════════ */
function scanMogrtFiles() {
    try {
        var list = [];
        var visitedPaths = {}; // 중복 탐색 방지
        var rawDirs = [];

        // ── Windows: APPDATA 우선 (myDocuments는 APPDATA와 동일한 경우 많음) ──
        var appDataEnv = $.getenv("APPDATA");
        if (appDataEnv) {
            rawDirs.push(appDataEnv + "/Adobe/Common/Motion Graphics Templates");
            rawDirs.push(appDataEnv + "/Adobe/Motion Graphics Templates");
        }
        // myDocuments가 APPDATA와 다를 때만 추가
        if (Folder.myDocuments && Folder.myDocuments.exists) {
            var myDocPath = Folder.myDocuments.fsName;
            if (!appDataEnv || myDocPath.toLowerCase() !== appDataEnv.toLowerCase()) {
                rawDirs.push(myDocPath + "/Adobe/Motion Graphics Templates");
                rawDirs.push(myDocPath + "/Adobe/Common/Motion Graphics Templates");
            }
        }
        rawDirs.push("C:/Users/Public/Documents/Adobe/Motion Graphics Templates");
        // 설치된 프리미어 버전만 확인 (2023~2026)
        var ppYears = ["2023", "2024", "2025", "2026"];
        for (var y = 0; y < ppYears.length; y++) {
            rawDirs.push("C:/Program Files/Adobe/Adobe Premiere Pro " + ppYears[y] + "/Motion Graphics Templates");
        }
        // macOS
        var homeEnv = $.getenv("HOME");
        if (homeEnv) {
            rawDirs.push(homeEnv + "/Library/Application Support/Adobe/Common/Motion Graphics Templates");
            rawDirs.push(homeEnv + "/Movies/Motion Graphics Templates");
        }
        rawDirs.push("/Library/Application Support/Adobe/Common/Motion Graphics Templates");

        // 중복 제거 후 존재하는 폴더만 탐색
        for (var i = 0; i < rawDirs.length; i++) {
            try {
                var f = new Folder(rawDirs[i]);
                if (!f.exists) continue;
                var key = f.fsName.toLowerCase();
                if (visitedPaths[key]) continue;
                visitedPaths[key] = true;
                collectMogrts(f, list, 0, visitedPaths);
            } catch(e2) {}
        }
        return JSON.stringify(list);
    } catch(e) {
        return "ERROR: scanMogrtFiles - " + e.message;
    }
}

function collectMogrts(folder, list, depth, visitedPaths) {
    if (depth > 3) return; // 깊이 제한 4단계로 축소
    if (!visitedPaths) visitedPaths = {};
    var items;
    try { items = folder.getFiles(); } catch(e) { return; }
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        try {
            var item = items[i];
            if (!item) continue;
            var itemNameStr = "";
            try { itemNameStr = item.name; } catch(en) { continue; }
            // item.name이 URL 인코딩된 경우(예: %20, %EB 등) decodeURI로 디코딩 후 체크
            var itemNameDecoded = "";
            try { itemNameDecoded = decodeURI(itemNameStr); } catch(ed) { itemNameDecoded = itemNameStr; }
            // .mogrt는 File이든 Folder(패키지)든 무조건 MOGRT로 처리 — 내부 재귀 탐색 금지
            if (/\.mogrt$/i.test(itemNameDecoded)) {
                var itemName = "";
                var itemPath = "";
                try { itemName = decodeURI(itemNameStr).replace(/\.mogrt$/i, ""); } catch(eu) { itemName = itemNameStr.replace(/\.mogrt$/i, ""); }
                try { itemPath = item.fsName; } catch(ep) { continue; }
                list.push({ name: itemName, path: itemPath });
            } else if (item instanceof Folder) {
                try {
                    var subKey = item.fsName.toLowerCase();
                    if (!visitedPaths[subKey]) {
                        visitedPaths[subKey] = true;
                        collectMogrts(item, list, depth + 1, visitedPaths);
                    }
                } catch(ef) {}
            }
        } catch(ei) {}
    }
}

/* ══════════════════════════════════════════════
   1a-2. 단일 폴더 스캔 (청크 방식용)
   folderPath: 탐색할 폴더 경로 문자열
   반환: JSON 배열 또는 "ERROR:..."
══════════════════════════════════════════════ */
function scanMogrtFolder(folderPath) {
    try {
        var f = new Folder(folderPath);
        if (!f.exists) return "[]";
        var list = [];
        var visitedPaths = {};
        visitedPaths[f.fsName.toLowerCase()] = true;
        collectMogrts(f, list, 0, visitedPaths);
        return JSON.stringify(list);
    } catch(e) {
        return "ERROR: scanMogrtFolder - " + e.message;
    }
}

/* ══════════════════════════════════════════════
   1a-3. MOGRT 스캔 대상 폴더 목록 반환
   반환: 존재하는 폴더 경로 배열 JSON
══════════════════════════════════════════════ */
function getMogrtScanDirs() {
    try {
        var rawDirs = [];
        var appDataEnv = $.getenv("APPDATA");
        if (appDataEnv) {
            rawDirs.push(appDataEnv + "/Adobe/Common/Motion Graphics Templates");
            rawDirs.push(appDataEnv + "/Adobe/Motion Graphics Templates");
        }
        if (Folder.myDocuments && Folder.myDocuments.exists) {
            var myDocPath = Folder.myDocuments.fsName;
            if (!appDataEnv || myDocPath.toLowerCase() !== appDataEnv.toLowerCase()) {
                rawDirs.push(myDocPath + "/Adobe/Motion Graphics Templates");
                rawDirs.push(myDocPath + "/Adobe/Common/Motion Graphics Templates");
            }
        }
        rawDirs.push("C:/Users/Public/Documents/Adobe/Motion Graphics Templates");
        var ppYears = ["2023", "2024", "2025", "2026"];
        for (var y = 0; y < ppYears.length; y++) {
            rawDirs.push("C:/Program Files/Adobe/Adobe Premiere Pro " + ppYears[y] + "/Motion Graphics Templates");
        }
        var homeEnv = $.getenv("HOME");
        if (homeEnv) {
            rawDirs.push(homeEnv + "/Library/Application Support/Adobe/Common/Motion Graphics Templates");
            rawDirs.push(homeEnv + "/Movies/Motion Graphics Templates");
        }
        rawDirs.push("/Library/Application Support/Adobe/Common/Motion Graphics Templates");

        // 존재하는 폴더만 중복 없이 반환
        var result = [];
        var seen = {};
        for (var i = 0; i < rawDirs.length; i++) {
            try {
                var f = new Folder(rawDirs[i]);
                if (!f.exists) continue;
                var key = f.fsName.toLowerCase();
                if (seen[key]) continue;
                seen[key] = true;
                result.push(f.fsName);
            } catch(e2) {}
        }
        return JSON.stringify(result);
    } catch(e) {
        return "ERROR: getMogrtScanDirs - " + e.message;
    }
}

/* ══════════════════════════════════════════════
   1b. MOGRT 폴더 트리 반환
══════════════════════════════════════════════ */
function getMogrtFolderTree() {
    try {
        var rootFolder = null;

        // ── Windows: APPDATA 우선 ──
        var appDataEnv = $.getenv("APPDATA");
        if (appDataEnv) {
            var winFolder = new Folder(appDataEnv + "/Adobe/Common/Motion Graphics Templates");
            if (winFolder.exists) rootFolder = winFolder;
        }

        // ── macOS: HOME 기반 경로 ──
        if (!rootFolder) {
            var homeEnv = $.getenv("HOME");
            if (homeEnv) {
                var macFolder = new Folder(homeEnv + "/Library/Application Support/Adobe/Common/Motion Graphics Templates");
                if (macFolder.exists) rootFolder = macFolder;
            }
        }

        // ── 공통 폴백: Folder.userData ──
        if (!rootFolder && Folder.userData && Folder.userData.exists) {
            var udFolder = new Folder(Folder.userData.fsName + "/Adobe/Common/Motion Graphics Templates");
            if (udFolder.exists) rootFolder = udFolder;
        }

        // ── 공통 폴백: Folder.myDocuments ──
        if (!rootFolder && Folder.myDocuments && Folder.myDocuments.exists) {
            var docFolder = new Folder(Folder.myDocuments.fsName + "/Adobe/Common/Motion Graphics Templates");
            if (docFolder.exists) rootFolder = docFolder;
        }

        if (!rootFolder) {
            return JSON.stringify({ name: "Motion Graphics Templates", path: "", children: [], mogrts: [] });
        }
        return JSON.stringify(buildFolderNode(rootFolder, 0));
    } catch(e) {
        return "ERROR: getMogrtFolderTree - " + e.message;
    }
}

function buildFolderNode(folder, depth) {
    if (depth > 3) return null; // 깊이 제한 4단계로 축소
    var node = { name: "", path: "", children: [], mogrts: [] };
    try { node.name = decodeURI(folder.name); } catch(e) { node.name = folder.name || ""; }
    try { node.path = folder.fsName; } catch(e) { node.path = ""; }

    // MOGRT 파일만 필터링하여 가져오기 (instanceof 루프 제거)
    var mogrtFiles;
    try { mogrtFiles = folder.getFiles(/\.mogrt$/i); } catch(e) { mogrtFiles = []; }
    if (mogrtFiles) {
        for (var i = 0; i < mogrtFiles.length; i++) {
            try {
                var f = mogrtFiles[i];
                if (!f) continue;
                var mName = "";
                var mPath = "";
                try { mName = decodeURI(f.name).replace(/\.mogrt$/i, ""); } catch(eu) { mName = f.name.replace(/\.mogrt$/i, ""); }
                try { mPath = f.fsName; } catch(ep) { continue; }
                node.mogrts.push({ name: mName, path: mPath });
            } catch(ei) {}
        }
    }

    // 서브폴더만 필터링하여 가져오기
    var subFolders;
    try { subFolders = folder.getFiles(function(f) { return f instanceof Folder; }); } catch(e) { subFolders = []; }
    if (subFolders) {
        for (var j = 0; j < subFolders.length; j++) {
            try {
                var child = buildFolderNode(subFolders[j], depth + 1);
                if (child) node.children.push(child);
            } catch(ej) {}
        }
    }
    return node;
}

/* ══════════════════════════════════════════════
   2. 활성 시퀀스 정보 반환 (영속화 키용)
══════════════════════════════════════════════ */
function getSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR: 활성 시퀀스 없음";
        var seqId   = "";
        var seqName = "";
        try { seqId   = String(seq.sequenceID || ""); } catch(e) {}
        try { seqName = String(seq.name || "");       } catch(e) {}
        // 프로젝트 경로도 함께 반환
        var projPath = "";
        try { projPath = String(app.project.path || ""); } catch(e) {}
        return JSON.stringify({ seqId: seqId, seqName: seqName, projPath: projPath });
    } catch(e) {
        return "ERROR: " + e.message;
    }
}

/* ══════════════════════════════════════════════
   3. 현재 프로젝트 경로 반환 (설정 저장 경로용)
══════════════════════════════════════════════ */
function getProjectPath() {
    try {
        if (app.project && app.project.path) {
            return String(app.project.path);
        }
    } catch(e) {}
    return "";
}

/* ══════════════════════════════════════════════
   4. 파라미터 타입 판별 (ES3 호환)
══════════════════════════════════════════════ */
function detectParamType(val, displayName, hasSubItems, paramObj) {
    // 그룹 컨테이너 (원래 로직 유지 - 텍스트 파라미터의 group 분류는 getMogrtParams에서 별도 처리)
    if (hasSubItems) return "group";

    if (val === null || val === undefined) return "comment";
    var s = String(val);

    // 텍스트 레이어 JSON (textEditValue 또는 capPropFontEdit 플래그 포함)
    if (s.indexOf('"textEditValue"') !== -1) return "text";
    if (s.indexOf('"capPropFontEdit"') !== -1) return "text";

    // 텍스트 스타일 세팅 (UUID 세미콜론 패턴 또는 세팅 키워드)
    if (s.indexOf('"fontFamily"') !== -1 || s.indexOf('"fontSize"') !== -1 ||
        s.indexOf('"fontStyle"') !== -1 || s.indexOf('"textStyle"') !== -1) {
        return "textsetting";
    }
    if (/^[0-9a-f\-]{36};/.test(s)) {
        return "textsetting";
    }
    if (displayName.indexOf('\uc138\ud305') !== -1 || displayName.toLowerCase().indexOf('setting') !== -1) {
        return "textsetting";
    }

    // 색상 (displayName 기반 + 컬러 값 범위 기반)
    // ★ 숫자 체크보다 먼저 수행해야 함: 컬러값은 큰 정수로 반환되어 숫자로 오분류됨
    var isColorByName = (displayName.indexOf('\uc0c9\uc0c1') !== -1 ||
                         displayName.toLowerCase().indexOf('color') !== -1 ||
                         displayName.toLowerCase().indexOf('colour') !== -1 ||
                         displayName.indexOf('\ucef4\ub7ec') !== -1);
    if (isColorByName) return "color";

    // 컬러 값 범위 기반 감지: 64비트 ARGB 정수 (72057594037927936 ~ 72339069014638591)
    // 이 범위의 숫자는 컬러 파라미터로 판단
    var sTrimmedColor = s.replace(/^\s+|\s+$/g, '');
    if (/^\d+$/.test(sTrimmedColor)) {
        var numForColor = parseFloat(sTrimmedColor);
        // 64비트 ARGB 범위: 0x0100000000000000 ~ 0x01FFFFFFFFFFFFFF
        if (numForColor >= 72057594037927936 && numForColor <= 72339069014638591) {
            return "color";
        }
        // 32비트 ARGB 범위이고 min/max가 없는 경우 (컬러 파라미터는 min/max가 없음)
        if (numForColor >= 16777216 && numForColor <= 4294967295) {
            try {
                var minTest = paramObj ? paramObj.getMinValue() : null;
                var maxTest = paramObj ? paramObj.getMaxValue() : null;
                if ((minTest === null || minTest === undefined || isNaN(minTest)) &&
                    (maxTest === null || maxTest === undefined || isNaN(maxTest))) {
                    return "color";
                }
            } catch(eColor) {
                return "color"; // getMinValue 자체가 없으면 컬러로 판단
            }
        }
    }

    // boolean: "true" 또는 "false" 문자열
    var sLower = s.toLowerCase().replace(/^\s+|\s+$/g, '');
    if (sLower === "true" || sLower === "false") return "boolean";

    var sTrimmed = s.replace(/^\s+|\s+$/g, '');

    // x,y 좌표 패턴 (Point Control) - 숫자 체크보다 먼저
    if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(sTrimmed)) return "point";

    // Angle Control: displayName 기반 감지 - 숫자 체크보다 먼저
    if (displayName.toLowerCase().indexOf('angle') !== -1 ||
        displayName.indexOf('\uac01\ub3c4') !== -1 ||
        displayName.indexOf('\ud68c\uc804') !== -1) {
        return "angle";
    }

    // 숫자 (ES3 호환: .trim() 대신 정규식)
    if (/^-?\d+(\.\d+)?$/.test(sTrimmed)) {
        var numVal = parseFloat(sTrimmed);
        // dropdown 감지: 정수값이고 비음수인 경우
        if (paramObj && Math.floor(numVal) === numVal && numVal >= 0) {
            try {
                // 1순위: getOptionName(0) 이 동작하면 dropdown (비공식 API)
                var testOpt = paramObj.getOptionName ? paramObj.getOptionName(0) : null;
                if (testOpt !== null && testOpt !== undefined && String(testOpt).length > 0) {
                    return "dropdown";
                }
            } catch(e1) {}
            // 2순위: areKeyframesSupported() === false 이면 dropdown 가능성 높음
            var noKeyframes = false;
            try {
                if (paramObj.areKeyframesSupported !== undefined) {
                    noKeyframes = (paramObj.areKeyframesSupported() === false);
                }
            } catch(e2) {}
            // 3순위: min/max 범위로 판단
            try {
                var minV = paramObj.getMinValue();
                var maxV = paramObj.getMaxValue();
                if (minV !== null && maxV !== null && !isNaN(minV) && !isNaN(maxV)) {
                    var range = maxV - minV;
                    if (minV >= 0 && Math.floor(minV) === minV && Math.floor(maxV) === maxV) {
                        // 키프레임 미지원: 범위 제한 없이 dropdown
                        if (noKeyframes) return "dropdown";
                        // 키프레임 지원 여부 문관 + 범위 20 이하: dropdown
                        if (range >= 1 && range <= 20) return "dropdown";
                    }
                }
            } catch(e3) {}
        }
        return "number";
    }

    // 빈 문자열이거나 순수 텍스트 → comment
    return "comment";
}

/* ══════════════════════════════════════════════
   5. MOGRT 파라미터 추출 (그룹/코멘트 포함)
══════════════════════════════════════════════ */
function getMogrtParams(mogrtPath) {
    ensureQE();

    var proj = app.project;
    if (!proj) return "ERROR: 프로젝트 없음";

    // 원래 활성 시퀀스 저장
    var originalActiveSeq = null;
    try { originalActiveSeq = proj.activeSequence; } catch(e) {}
    if (!originalActiveSeq) return "ERROR: 활성 시퀀스 없음";

    // __MOGRT_PREVIEW__ 시퀀스 찾기
    var previewSeq = findPreviewSequence();

    // ★ 핵심: originalActiveSeq가 __MOGRT_PREVIEW__이면 실제 작업 시퀀스로 교정
    // (setupPreviewSequence 후 활성 시퀀스가 복원되지 않은 경우 대비)
    if (String(originalActiveSeq.name) === PREVIEW_SEQ_NAME) {
        var workSeq = findWorkSequence();
        if (workSeq) originalActiveSeq = workSeq;
    }

    // 프리뷰 시퀀스가 있으면 setActive 없이 직접 사용 (탭 전환 없이 importMGT 호출 가능)
    // setActive는 렌더링 준비로 인해 매우 느려지므로 호출하지 않음
    var seq = previewSeq ? previewSeq : originalActiveSeq;

    var item;
    try { item = seq.importMGT(mogrtPath, "0", 0, 0); } catch (e) {
        // 실패해도 원래 시퀀스 복원
        setActiveSequence(originalActiveSeq);
        return "ERROR: importMGT 실패 - " + e.message;
    }
    if (!item) {
        setActiveSequence(originalActiveSeq);
        return "ERROR: importMGT null 반환";
    }

    var result = [];
    try {
        var comp = item.getMGTComponent();
        if (!comp) {
            /* getMGTComponent는 AE에서 만든 MOGRT(내부에 AE.ADBE Capsule 컴포넌트를 가진다)에서만
               값을 돌려준다. Premiere 필수 그래픽 패널로 만든 네이티브 템플릿은
               삽입 결과가 이름 "Graphic"인 일반 그래픽 클립이고 Capsule이 없어 null이 된다.
               둘을 구별해 원인을 알려준다. */
            var hasCapsule = false;
            try {
                for (var ci = 0; ci < item.components.numItems; ci++) {
                    if (String(item.components[ci].matchName) === "AE.ADBE Capsule") { hasCapsule = true; break; }
                }
            } catch(e) {}
            var looksNative = (!hasCapsule && String(item.name) === "Graphic");

            /* 네이티브 템플릿은 Source Text만 읽고 쓸 수 있다.
               그것만 텍스트 파라미터로 내어주면 패널은 기존 MOGRT와 똑같이 다룬다. */
            var ntp = collectNativeTextProps(item);
            if (ntp.length > 0) {
                var nres = [];
                for (var nk = 0; nk < ntp.length; nk++) {
                    var ncur = "";
                    try { ncur = String(ntp[nk].getValue()); } catch(e) {}
                    /* 초기값은 플레이스홀더 한 글자가 들어 있다. 빈 값으로 본다. */
                    if (ncur.length <= 1) ncur = "";
                    nres.push({
                        index: nk,
                        displayName: "텍스트 " + (nk + 1),
                        type: "text",
                        value: ncur,
                        rawValue: "",
                        exposedFontFields: [],
                        fontExposed: false,
                        nativeText: true
                    });
                }
                try { item.remove(false, false); } catch(e) {}
                setActiveSequence(originalActiveSeq);
                return JSON.stringify({ params: nres, mogrtPath: mogrtPath, nativeText: true });
            }

            try { item.remove(false, false); } catch(e) {}
            if (looksNative) return "ERROR: Premiere 네이티브 템플릿인데 쓸 수 있는 텍스트 속성이 없습니다.";
            return "ERROR: getMGTComponent null";
        }
        if (!comp.properties) { try { item.remove(false, false); } catch(e) {} return "ERROR: comp.properties null"; }

        var props = comp.properties;
        var n = 0;
        try { n = props.numItems; } catch(e) { n = 0; }

        // 그룹 추적용 변수 (스택 방식: numItems 기반 정확한 그룹 범위 추적)
        var groupStack = []; // { name, remaining } 스택

        for (var i = 0; i < n; i++) {
            var p;
            try { p = props[i]; } catch(e) { continue; }
            if (!p) continue;

            var dname = "";
            try { dname = p.displayName || ""; } catch(e) {}

            var val = "";
            try { val = p.getValue(); } catch(e) { val = ""; }
            if (val === null || val === undefined) val = "";

            // numItems > 0 이면 그룹 헤더 (하위 파라미터를 가진 컨테이너)
            var numSubItems = 0;
            try { numSubItems = p.numItems || 0; } catch(e) {}

            var detectedType = detectParamType(val, dname, numSubItems > 0, p);
            var displayVal = String(val);

            // 스택 상단 그룹의 remaining 차감 (그룹 헤더 자신은 차감 안 함)
            if (detectedType !== "group" && groupStack.length > 0) {
                groupStack[groupStack.length - 1].remaining--;
                // remaining 0 이하면 그룹 종료
                while (groupStack.length > 0 && groupStack[groupStack.length - 1].remaining <= 0) {
                    groupStack.pop();
                }
            }

            // 현재 그룹명: 스택 최상단
            var currentGroup = groupStack.length > 0 ? groupStack[groupStack.length - 1].name : "";

            // 그룹 헤더: 스택에 push
            // ★ 단, group으로 분류되었어도 val에 textEditValue가 있으면 텍스트 파라미터로 재분류
            // (폰트/사이즈가 노출된 텍스트 파라미터는 numItems > 1 → group으로 분류되지만 실제로는 text)
            if (detectedType === "group") {
                var sGroupVal = String(val);
                if (sGroupVal.indexOf('"textEditValue"') !== -1) {
                    // 텍스트 파라미터로 재분류: 그룹 스택에 push하되 result에도 text로 추가
                    detectedType = "text";
                    // 그룹 스택에는 push (서브 속성들이 스킵되도록)
                    groupStack.push({ name: dname, remaining: numSubItems });
                } else {
                    groupStack.push({ name: dname, remaining: numSubItems });
                    displayVal = "";
                }
            }

            // 텍스트 타입이면 textEditValue 추출 + 폰트 편집 가능 여부 감지
            if (detectedType === "text") {
                try {
                    var parsedText = JSON.parse(String(val));
                    if (parsedText && typeof parsedText.textEditValue !== "undefined") {
                        displayVal = parsedText.textEditValue;
                    }
                    // capPropFontEdit: true → 폰트/스타일/사이즈 편집 가능
                    // false 또는 없음 → 텍스트 내용만 편집 가능
                    // 이 정보를 entry에 저장하여 app.js에서 UI 결정에 사용
                    if (typeof parsedText.capPropFontEdit !== "undefined") {
                        // capPropFontEdit이 명시적으로 있는 경우
                        // true면 폰트 편집 가능, false면 텍스트만
                    } else if (typeof parsedText.fontEditValue !== "undefined" ||
                               typeof parsedText.fontSizeEditValue !== "undefined" ||
                               typeof parsedText.fontFSBoldValue !== "undefined") {
                        // fontEditValue 등이 있으면 폰트 편집 가능
                    }
                } catch(e) {}
            }

            // boolean 타입: true/false 정규화
            if (detectedType === "boolean") {
                var sLow = String(val).toLowerCase().replace(/^\s+|\s+$/g, '');
                displayVal = (sLow === "true") ? "true" : "false";
            }

            // min/max 범위 추출 (숫자/dropdown/angle/point 타입)
            var minVal = null;
            var maxVal = null;
            if (detectedType === "number" || detectedType === "dropdown" ||
                detectedType === "angle" || detectedType === "point") {
                try { minVal = p.getMinValue(); } catch(e) { minVal = null; }
                try { maxVal = p.getMaxValue(); } catch(e) { maxVal = null; }
                if (minVal === null || minVal === undefined || isNaN(minVal)) minVal = null;
                if (maxVal === null || maxVal === undefined || isNaN(maxVal)) maxVal = null;
            }

            var entry = {
                index: i,
                displayName: dname,
                type: detectedType,
                rawValue: String(val),
                value: displayVal,
                group: currentGroup
            };

            // 색상 타입이면 colorHex 저장
            if (detectedType === "color") {
                var rawColorNum = parseFloat(String(val)) || 0;
                function h2c(v) { var s = Math.floor(v).toString(16); return s.length < 2 ? '0' + s : s; }
                if (rawColorNum < 4294967296) {
                    // 32비트 ARGB: 0xAARRGGBB
                    var cr2 = Math.floor(rawColorNum / 65536) % 256;
                    var cg2 = Math.floor(rawColorNum / 256) % 256;
                    var cb2 = rawColorNum % 256;
                    entry.colorHex = '#' + h2c(cr2) + h2c(cg2) + h2c(cb2);
                    entry.colorFormat = "argb32";
                } else {
                    // 64비트
                    var colorBase = 72057594037927936;
                    var colorRem = rawColorNum - colorBase;
                    if (colorRem >= 0) {
                        var cr2 = Math.floor(colorRem / 1099511627776) % 256;
                        colorRem = colorRem - cr2 * 1099511627776;
                        var cg2 = Math.floor(colorRem / 16777216) % 256;
                        colorRem = colorRem - cg2 * 16777216;
                        var cb2 = Math.floor(colorRem / 256) % 256;
                        entry.colorHex = '#' + h2c(cr2) + h2c(cg2) + h2c(cb2);
                    } else {
                        entry.colorHex = '#000000';
                    }
                    entry.colorFormat = "rgba64";
                }
            }
            if (minVal !== null) entry.minValue = minVal;
            if (maxVal !== null) entry.maxValue = maxVal;

            // dropdown 옵션명 추출 시도
            if (detectedType === "dropdown") {
                var dropOpts = [];
                try {
                    var dMin = Math.round(minVal !== null ? minVal : 0);
                    var dMax = Math.round(maxVal !== null ? maxVal : 10);
                    // getOptionName(index) API 시도
                    for (var di = dMin; di <= dMax; di++) {
                        try {
                            var optName = p.getOptionName ? p.getOptionName(di) : null;
                            dropOpts.push(optName ? String(optName) : String(di));
                        } catch(de) { dropOpts.push(String(di)); }
                    }
                } catch(de2) {}
                if (dropOpts.length > 0) entry.dropdownOptions = dropOpts;
            }

            // 텍스트 파라미터: capProp 플래그로 노출 속성 정확히 판단
            // ★ 핵심: rawValue JSON 안의 capPropFontEdit / capPropFontSizeEdit / capPropFontFauxStyleEdit
            //   - capPropFontEdit: true → 폰트 드롭다운 노출
            //   - capPropFontSizeEdit: true → 폰트 사이즈 노출
            //   - capPropFontFauxStyleEdit: true → B/I/TT/Tt(Faux Style) 노출
            if (detectedType === "text") {
                var capFont = false;
                var capSize = false;
                var capFaux = false;
                try {
                    var parsedCap = JSON.parse(String(val));
                    if (parsedCap) {
                        capFont = (parsedCap.capPropFontEdit === true);
                        capSize = (parsedCap.capPropFontSizeEdit === true);
                        capFaux = (parsedCap.capPropFontFauxStyleEdit === true);
                    }
                } catch(eCap) {}

                var exposedFontArr = [];
                if (capFont)  exposedFontArr.push("font");
                if (capSize)  exposedFontArr.push("size");
                if (capFaux) {
                    exposedFontArr.push("bold");
                    exposedFontArr.push("italic");
                    exposedFontArr.push("allcaps");
                    exposedFontArr.push("smallcaps");
                }

                if (capFont || capSize || capFaux) {
                    entry.fontExposed = true;
                    entry.exposedFontFields = exposedFontArr;
                } else {
                    entry.fontExposed = false;
                    entry.exposedFontFields = [];
                }
            }

            result.push(entry);
        }
    } catch (e) {
        try { item.remove(false, false); } catch(e2) {}
        // 오류 시에도 원래 시퀀스 복원
        setActiveSequence(originalActiveSeq);
        return "ERROR: " + e.message;
    }

    try { item.remove(false, false); } catch (e) {}

    // importMGT 완료 후 원래 활성 시퀀스로 복원
    setActiveSequence(originalActiveSeq);

    // app.js에서 JSZip으로 definition.json을 파싱할 수 있도록 mogrtPath를 메타로 포함
    return JSON.stringify({ params: result, mogrtPath: mogrtPath });
}

/* ══════════════════════════════════════════════
   6. 디버그: MOGRT 구조 덤프
══════════════════════════════════════════════ */
function debugMogrtStructure(mogrtPath) {
    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시쿼스 없음";
    ensureQE();
    var item;
    try { item = seq.importMGT(mogrtPath, "0", 0, 0); } catch (e) { return "ERROR: " + e.message; }
    if (!item) return "ERROR: importMGT 실패";

    var dump = [];
    try {
        var comp = item.getMGTComponent();
        if (comp && comp.properties) {
            var props = comp.properties;
            dump.push("numItems=" + props.numItems);
            for (var i = 0; i < props.numItems; i++) {
                var p = props[i];
                var info = "[" + i + "] displayName=" + p.displayName;
                try { info += " numItems=" + p.numItems; } catch(e) { info += " numItems=undefined"; }
                try { var v = p.getValue(); info += " value=" + String(v).substring(0, 80); } catch(e) { info += " value=ERR"; }
                try { info += " min=" + p.getMinValue() + " max=" + p.getMaxValue(); } catch(e) {}
                try {
                    var opt0 = p.getOptionName ? p.getOptionName(0) : "[no getOptionName]";
                    info += " opt0=" + String(opt0);
                } catch(eOpt) { info += " opt0=ERR(" + eOpt.message + ")"; }
                try {
                    var ct = p.controlType !== undefined ? p.controlType : "[no controlType]";
                    info += " controlType=" + String(ct);
                } catch(eCt) { info += " controlType=ERR"; }
                dump.push(info);
                // ★ 서브 속성 덤프 (텍스트 파라미터의 하위 속성 확인)
                var subCnt = 0;
                try { subCnt = p.numItems || 0; } catch(e) {}
                if (subCnt > 0) {
                    for (var si = 0; si < subCnt; si++) {
                        try {
                            var sp = p[si];
                            if (!sp) continue;
                            var sinfo = "  [" + i + "][" + si + "] displayName=" + String(sp.displayName || "");
                            try { var sv = sp.getValue(); sinfo += " value=" + String(sv).substring(0, 60); } catch(e) { sinfo += " value=ERR"; }
                            try { sinfo += " numItems=" + sp.numItems; } catch(e) {}
                            try {
                                var sct = sp.controlType !== undefined ? sp.controlType : "[no controlType]";
                                sinfo += " controlType=" + String(sct);
                            } catch(e) {}
                            dump.push(sinfo);
                        } catch(eSub) { dump.push("  [" + i + "][" + si + "] ERR: " + eSub.message); }
                    }
                }
            }
        }
    } catch (e) { dump.push("ERROR: " + e.message); }

    try { item.remove(false, false); } catch (e) {}
    return dump.join("\n");
}

/* ══════════════════════════════════════════════
   7. 파라미터 적용 (공통 함수)
══════════════════════════════════════════════ */
function applyParamsToItem(trackItem, paramsList) {
    if (!paramsList || paramsList.length === 0) return;
    var comp = trackItem.getMGTComponent();
    if (!comp || !comp.properties) {
        /* 네이티브 템플릿: MGT 컴포넌트가 없다. Source Text에 직접 넣는다.
           수집 순서가 getMogrtParams와 같아 index로 그대로 대응된다. */
        var ntp2 = collectNativeTextProps(trackItem);
        if (ntp2.length === 0) return;
        for (var ni = 0; ni < paramsList.length; ni++) {
            var npar = paramsList[ni];
            if (!npar) continue;
            if (String(npar.type || "").toLowerCase() !== "text") continue;
            var nidx = (typeof npar.index === "number") ? npar.index : 0;
            if (nidx < 0 || nidx >= ntp2.length) continue;
            try { ntp2[nidx].setValue(String(npar.value || ""), true); } catch(e) {}
        }
        return;
    }

    var props = comp.properties;
    var n = 0;
    try { n = props.numItems; } catch(e) {}

    for (var i = 0; i < paramsList.length; i++) {
        var p = paramsList[i];
        try {
            var paramObj = null;
            if (typeof p.index === "number" && p.index >= 0 && p.index < n) {
                try { paramObj = props[p.index]; } catch(e) {}
            }
            if (!paramObj) {
                for (var j = 0; j < n; j++) {
                    try {
                        var candidate = props[j];
                        if (candidate && candidate.displayName === p.displayName) {
                            paramObj = candidate; break;
                        }
                    } catch(e) {}
                }
            }
            if (!paramObj) continue;

            var t = String(p.type || "").toLowerCase();

            if (t === "text") {
                var rawStr = String(p.rawValue || "");
                var newText = String(p.value || "");
                var applied = false;

                // 폰트 정보 추출 (rawValue 배열 형식 → 단일 값)
                var fontName = "";
                var fontSize2 = 0;
                var isBold2 = false;
                var isItalic2 = false;
                var isAllCaps2 = false;
                var isSmallCaps2 = false;
                if (rawStr.indexOf('"fontEditValue"') !== -1) {
                    try {
                        var tmpParsed = JSON.parse(rawStr);
                        fontName = (Object.prototype.toString.call(tmpParsed.fontEditValue) === "[object Array]")
                            ? String(tmpParsed.fontEditValue[0] || "")
                            : String(tmpParsed.fontEditValue || "");
                        fontSize2 = (Object.prototype.toString.call(tmpParsed.fontSizeEditValue) === "[object Array]")
                            ? (parseFloat(tmpParsed.fontSizeEditValue[0]) || 0)
                            : (parseFloat(tmpParsed.fontSizeEditValue) || 0);
                        isBold2 = (Object.prototype.toString.call(tmpParsed.fontFSBoldValue) === "[object Array]")
                            ? (tmpParsed.fontFSBoldValue[0] === true)
                            : (tmpParsed.fontFSBoldValue === true);
                        isItalic2 = (Object.prototype.toString.call(tmpParsed.fontFSItalicValue) === "[object Array]")
                            ? (tmpParsed.fontFSItalicValue[0] === true)
                            : (tmpParsed.fontFSItalicValue === true);
                        isAllCaps2 = (Object.prototype.toString.call(tmpParsed.fontFSAllCapsValue) === "[object Array]")
                            ? (tmpParsed.fontFSAllCapsValue[0] === true)
                            : (tmpParsed.fontFSAllCapsValue === true);
                        isSmallCaps2 = (Object.prototype.toString.call(tmpParsed.fontFSSmallCapsValue) === "[object Array]")
                            ? (tmpParsed.fontFSSmallCapsValue[0] === true)
                            : (tmpParsed.fontFSSmallCapsValue === true);
                    } catch(e) {}
                }

                // PP 포럼에서 확인된 올바른 방식:
                // 1. paramObj.getValue()로 PP 내부의 현재 전체 JSON 구조를 읽어옴
                // 2. 그 구조 안에서 textEditValue, fontTextRunLength 및 폰트/스타일 관련 필드만 교체
                // 3. 다시 paramObj.setValue()로 덮어씌움
                try {
                    var curValStr = paramObj.getValue();
                    if (curValStr) {
                        var parsedVal = JSON.parse(curValStr);
                        
                        // 텍스트 내용 교체
                        parsedVal.textEditValue = newText;
                        
                        // fontTextRunLength 업데이트 (배열 형태)
                        if (parsedVal.fontTextRunLength && Object.prototype.toString.call(parsedVal.fontTextRunLength) === "[object Array]") {
                            parsedVal.fontTextRunLength = [newText.length];
                        } else {
                            parsedVal.fontTextRunLength = [newText.length];
                        }

                        // 폰트 및 스타일 교체 (프론트엔드에서 넘어온 배열 형식 유지)
                        if (fontName) {
                            parsedVal.fontEditValue = [fontName];
                        }
                        if (fontSize2 > 0) {
                            parsedVal.fontSizeEditValue = [fontSize2];
                        }
                        parsedVal.fontFSBoldValue = [isBold2];
                        parsedVal.fontFSItalicValue = [isItalic2];
                        parsedVal.fontFSAllCapsValue = [isAllCaps2];
                        parsedVal.fontFSSmallCapsValue = [isSmallCaps2];

                        paramObj.setValue(JSON.stringify(parsedVal), true);
                        applied = true;
                    }
                } catch(e) {
                    // getValue 파싱 실패 시 예외 처리
                }

                if (!applied) {
                    try { paramObj.setValue(newText, true); } catch(e) {}
                }
            } else if (t === "color") {
                // 공식 시그니처: setColorValue(alpha, red, green, blue, updateUI)
                // https://ppro-scripting.docsforadobe.dev/sequence/componentparam/
                var colorHex = p.colorHex || "";
                if (!colorHex && p.value && String(p.value).charAt(0) === '#') {
                    colorHex = String(p.value);
                }
                if (colorHex && colorHex.charAt(0) === '#' && colorHex.length >= 7) {
                    var cr = parseInt(colorHex.substr(1,2), 16) || 0;
                    var cg = parseInt(colorHex.substr(3,2), 16) || 0;
                    var cb = parseInt(colorHex.substr(5,2), 16) || 0;
                    var colorApplied = false;
                    try {
                        paramObj.setColorValue(255, cr, cg, cb, 1);
                        colorApplied = true;
                    } catch(e1) {
                        try {
                            paramObj.setColorValue(255, cr, cg, cb);
                            colorApplied = true;
                        } catch(e2) {}
                    }
                    if (!colorApplied) {
                        var colorVal32 = 255 * 16777216 + cr * 65536 + cg * 256 + cb;
                        try { paramObj.setValue(colorVal32, true); } catch(e) {}
                    }
                } else {
                    var colorRawStr2 = String(p.rawValue || "");
                    if (colorRawStr2 !== "") {
                        var colorRawNum2 = parseFloat(colorRawStr2);
                        if (!isNaN(colorRawNum2)) {
                            try { paramObj.setValue(colorRawNum2, true); } catch(e) {}
                        }
                    }
                }
            } else if (t === "number" || t === "angle") {
                var numVal = parseFloat(String(p.value));
                if (!isNaN(numVal)) {
                    try { paramObj.setValue(numVal, true); } catch(e) {}
                }
            } else if (t === "point") {
                // point: "x,y" 형식
                var ptStr = String(p.value || "");
                var ptParts = ptStr.split(",");
                if (ptParts.length >= 2) {
                    var px = parseFloat(ptParts[0]);
                    var py = parseFloat(ptParts[1]);
                    if (!isNaN(px) && !isNaN(py)) {
                        try { paramObj.setValue([px, py], true); } catch(e) {
                            try { paramObj.setValue(px + "," + py, true); } catch(e2) {}
                        }
                    }
                }
            } else if (t === "dropdown") {
                var dropVal = Math.round(parseFloat(String(p.value)));
                if (!isNaN(dropVal)) {
                    try { paramObj.setValue(dropVal, true); } catch(e) {}
                }
            } else if (t === "boolean") {
                var boolVal = (p.value === "true" || p.value === "1" || p.value === true || p.value === 1);
                try { paramObj.setValue(boolVal ? 1 : 0, true); } catch(e) {}
            } else if (t === "textsetting" || t === "group") {
                // 스타일 세팅 / 그룹 헤더: 변경하지 않음
            } else if (t === "comment") {
                if (p.value !== undefined && String(p.value) !== String(p.rawValue)) {
                    try { paramObj.setValue(String(p.value), true); } catch(e) {}
                }
            }
        } catch (e) {}
    }
}

/* ════════════════════════════════════════════
   8-0. 헬퍼: importMGT 최소화 (projectItem 재사용)
   - 첫 번째 mogrtPath는 importMGT로 배치 후 projectItem 캐시
   - 동일 mogrtPath 이후는 overwriteClip으로 즉시 배치 (MOGRT 파싱 없음)
   ※ insertClip 방식 제거: 클립을 밀어내서 시작 시간이 바뀌고
      파라미터 적용 대상 클립을 찾지 못하는 버그 발생
════════════════════════════════════════════ */
function _importOrInsertMGT(seq, mogrtPath, startTicks, trackIdx, projectItemCache) {
    var startTimeSec = ticksToSec(startTicks);

    // 캐시에 projectItem이 있으면 overwriteClip으로 즉시 배치
    if (projectItemCache && projectItemCache[mogrtPath]) {
        var cachedItem = projectItemCache[mogrtPath];
        try {
            var startTime = new Time();
            startTime.seconds = startTimeSec;
            // overwriteClip: 지정 위치에 덮어쓰기 배치 (다른 클립 밀지 않음)
            seq.overwriteClip(cachedItem, startTime, trackIdx);
            // 배치된 클립 찾기 (시작 시간 기준, 허용 오차 0.05초)
            var track = null;
            try { track = seq.videoTracks[trackIdx]; } catch(e) {}
            if (track) {
                var numC = 0;
                try { numC = track.clips.numItems; } catch(e) {}
                for (var ci = 0; ci < numC; ci++) {
                    try {
                        var c = track.clips[ci];
                        if (c && Math.abs(c.start.seconds - startTimeSec) < 0.05) {
                            return c;
                        }
                    } catch(e) {}
                }
            }
        } catch(e) {}
        // overwriteClip 실패 시 fallback: importMGT
    }

    // 첫 번째 또는 fallback: importMGT 호출
    var newClip = null;
    try { newClip = seq.importMGT(mogrtPath, startTicks, trackIdx, 0); } catch(e) { return null; }
    if (!newClip) return null;
    // projectItem 캐시 등록 (첫 번째 배치 시)
    if (projectItemCache && !projectItemCache[mogrtPath]) {
        try { if (newClip.projectItem) projectItemCache[mogrtPath] = newClip.projectItem; } catch(e) {}
    }
    return newClip;
}

/* ════════════════════════════════════════════
   8. 타임라인에 전체 적용
   최적화: 동일 mogrtPath는 첫 번째만 importMGT, 나머지는 overwriteClip 재사용
   (importMGT 반복 호출로 인한 JSX 엔진 블로킹 방지)
════════════════════════════════════════════ */
function applyToTimeline(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";

    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시퀀스 없음";
    // enableQE는 루프 밖에서 한 번만 호출
    ensureQE();

    var trackIdx  = payload.videoTrackIndex || 2;
    var subs      = payload.subtitles;
    var okCount   = 0;
    var textCount = 0;
    var failReason = "";
    var failCount = 0;

    // 기존 클립 목록 수집 (시작 시간 기준)
    var track = null;
    try { track = seq.videoTracks[trackIdx]; } catch(e) {}
    var existingClips = {};
    if (track) {
        var numExisting = 0;
        try { numExisting = track.clips.numItems; } catch(e) {}
        for (var ci = 0; ci < numExisting; ci++) {
            try {
                var ec = track.clips[ci];
                if (ec) {
                    var ecStart = 0;
                    try { ecStart = ec.start.seconds; } catch(e) {}
                    existingClips[String(Math.round(ecStart * 100))] = ec;
                }
            } catch(e) {}
        }
    }

    // ★ 최적화: mogrtPath별 첫 번째 배치된 클립의 projectItem 캐시
    // 동일 mogrtPath는 importMGT를 한 번만 호출하고,
    // 이후 클립은 projectItem을 insertClip으로 재사용 (importMGT 반복 블로킹 방지)
    var mogrtProjectItem = {}; // { mogrtPath: projectItem }

    for (var i = 0; i < subs.length; i++) {
        var sub = subs[i];
        var startTicks = secToTicks(sub.startSec);
        var startKey = String(Math.round(sub.startSec * 100));

        if (sub.mogrtPath) {
            // 기존 클립이 같은 시작 시간에 있으면 확인 후 처리
            var existingClip = existingClips[startKey] || null;
            if (existingClip) {
                // 기존 클립의 MOGRT 경로 확인
                var existingMogrtPath = "";
                try {
                    var existingComp = existingClip.getMGTComponent();
                    if (existingComp) {
                        try { existingMogrtPath = String(existingComp.mogrtPath || ""); } catch(e) {}
                        if (!existingMogrtPath) {
                            try { existingMogrtPath = String(existingClip.projectItem ? existingClip.projectItem.treePath || "" : ""); } catch(e) {}
                        }
                    }
                } catch(e) {}

                var isSameMogrt = !existingMogrtPath ||
                    existingMogrtPath === sub.mogrtPath ||
                    existingMogrtPath.indexOf(sub.mogrtPath.replace(/\\/g, '/').split('/').pop()) !== -1 ||
                    sub.mogrtPath.indexOf(existingMogrtPath.replace(/\\/g, '/').split('/').pop()) !== -1;

                if (isSameMogrt) {
                    // 같은 MOGRT: 파라미터만 업데이트 + 길이 조정
                    try { applyParamsToItem(existingClip, sub.params); } catch(e) {}
                    try { var etEx = new Time(); etEx.seconds = sub.endSec; existingClip.end = etEx; } catch(e) {}
                    // projectItem 캐시 등록
                    if (!mogrtProjectItem[sub.mogrtPath]) {
                        try { if (existingClip.projectItem) mogrtProjectItem[sub.mogrtPath] = existingClip.projectItem; } catch(e) {}
                    }
                    okCount++;
                } else {
                    // 다른 MOGRT: 기존 클립 삭제 후 새 클립 배치
                    try { existingClip.remove(false, false); } catch(e) {}
                    var newItemAlt = _importOrInsertMGT(seq, sub.mogrtPath, startTicks, trackIdx, mogrtProjectItem);
                    if (!newItemAlt) { failCount++; continue; }
                    try { applyParamsToItem(newItemAlt, sub.params); } catch (e) {}
                    try { var etAlt = new Time(); etAlt.seconds = sub.endSec; newItemAlt.end = etAlt; } catch (e) {}
                    okCount++;
                }
            } else {
                // 기존 클립 없음 → 새로 배치 (캐시 활용)
                var newItem = _importOrInsertMGT(seq, sub.mogrtPath, startTicks, trackIdx, mogrtProjectItem);
                if (!newItem) { failCount++; continue; }
                try { applyParamsToItem(newItem, sub.params); } catch (e) {}
                try { var et = new Time(); et.seconds = sub.endSec; newItem.end = et; } catch (e) {}
                okCount++;
            }
        } else {
            try {
                addTextLayer(seq, sub.text, sub.startSec, sub.endSec, trackIdx);
                textCount++;
            } catch (e) {
                failCount++;
                if (!failReason) failReason = (e && e.message) ? String(e.message) : String(e);
            }
        }
    }

    return "SUCCESS: MOGRT " + okCount + "개 + 텍스트 레이어 " + textCount + "개 배치 완료" +
           (failCount > 0 ? " (실패 " + failCount + "개" + (failReason ? ": " + failReason : "") + ")" : "");
}

/* ══════════════════════════════════════════════
   9. 특정 클립만 파라미터 업데이트
   payloadStr: { videoTrackIndex, startSec, endSec, mogrtPath, params[] }
══════════════════════════════════════════════ */
function updateClipAtTime(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";

    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시퀀스 없음";
    ensureQE();

    var trackIdx = payload.videoTrackIndex || 2;
    var startSec = payload.startSec;
    var endSec   = payload.endSec;
    var params   = payload.params || [];

    var track = null;
    try { track = seq.videoTracks[trackIdx]; } catch(e) { return "ERROR: 트랙 접근 실패"; }
    if (!track) return "ERROR: 트랙 없음";

    var targetClip = null;
    var numClips = 0;
    try { numClips = track.clips.numItems; } catch(e) {}

    for (var i = 0; i < numClips; i++) {
        var clip;
        try { clip = track.clips[i]; } catch(e) { continue; }
        if (!clip) continue;
        var clipStart = 0;
        try { clipStart = clip.start.seconds; } catch(e) {}
        if (Math.abs(clipStart - startSec) < 0.5) {
            targetClip = clip; break;
        }
    }

    if (!targetClip) {
        if (!payload.mogrtPath) return "ERROR: 클립 없음 + mogrtPath 미지정";
        var startTicks = secToTicks(startSec);
        // 트랙 내 동일 MOGRT 클립의 projectItem 재사용 시도 (importMGT 회피)
        var cachedProjItem = null;
        var mogrtFileName = payload.mogrtPath.replace(/\\/g, '/').split('/').pop();
        var numAll = 0;
        try { numAll = track.clips.numItems; } catch(e) {}
        for (var si = 0; si < numAll; si++) {
            try {
                var sc = track.clips[si];
                if (!sc) continue;
                var scProjItem = null;
                try { scProjItem = sc.projectItem; } catch(e) {}
                if (!scProjItem) continue;
                var scPath = "";
                try { scPath = String(scProjItem.treePath || scProjItem.name || ""); } catch(e) {}
                if (scPath.indexOf(mogrtFileName) !== -1) {
                    cachedProjItem = scProjItem; break;
                }
            } catch(e) {}
        }
        var newItem = null;
        if (cachedProjItem) {
            // insertClip으로 즉시 배치
            try {
                var stTime = new Time(); stTime.seconds = startSec;
                track.insertClip(cachedProjItem, stTime);
                // 삽입된 클립 찾기
                var numA2 = 0;
                try { numA2 = track.clips.numItems; } catch(e) {}
                for (var fi = 0; fi < numA2; fi++) {
                    try {
                        var fc = track.clips[fi];
                        if (fc && Math.abs(fc.start.seconds - startSec) < 0.1) { newItem = fc; break; }
                    } catch(e) {}
                }
            } catch(e) {}
        }
        if (!newItem) {
            // fallback: importMGT
            try { newItem = seq.importMGT(payload.mogrtPath, startTicks, trackIdx, 0); } catch (e) { return "ERROR: importMGT 실패"; }
            if (!newItem) return "ERROR: importMGT null";
        }
        try { applyParamsToItem(newItem, params); } catch(e) {}
        try { var et2 = new Time(); et2.seconds = endSec; newItem.end = et2; } catch(e) {}
        return "SUCCESS: 새 클립 배치 완료";
    }

    try { applyParamsToItem(targetClip, params); } catch(e) { return "ERROR: 파라미터 적용 실패 - " + e.message; }
    return "SUCCESS: 클립 업데이트 완료";
}

/* ══════════════════════════════════════════════
   10. 기본 텍스트 레이어 추가
══════════════════════════════════════════════ */
function addTextLayer(seq, text, startSec, endSec, trackIdx) {
    var qeSeq;
    try { qeSeq = qe.project.getActiveSequence(); } catch(e) {}

    if (qeSeq) {
        var startTicks = secToTicks(startSec);
        try {
            var clip = qeSeq.addTextClip(text, startTicks, trackIdx);
            if (clip) {
                try {
                    var track = seq.videoTracks[trackIdx];
                    if (track) {
                        for (var i = 0; i < track.clips.numItems; i++) {
                            var c = track.clips[i];
                            if (Math.abs(c.start.seconds - startSec) < 0.1) {
                                var et = new Time(); et.seconds = endSec;
                                c.end = et; break;
                            }
                        }
                    }
                } catch(e) {}
                return;
            }
        } catch(e) {}
    }
    addLegacyTextLayer(seq, text, startSec, endSec, trackIdx);
}

function addLegacyTextLayer(seq, text, startSec, endSec, trackIdx) {
    /* 구 Titler API. Premiere 26.5.1에서 app.project.createNewTitle이 제거되었다
       (typeof 확인: undefined). 프리셋 없이 자막만 얹는 폴백 경로였는데
       더는 동작하지 않는다. 호출부가 예외를 잡아 failCount로만 세고 있어
       사용자에게 원인이 드러나지 않았다. 이유를 담아 던진다. */
    if (typeof app.project.createNewTitle !== "function") {
        throw new Error("이 Premiere 버전은 구 Titler API(createNewTitle)를 지원하지 않아 프리셋 없는 자막 배치가 불가합니다. 자막에 프리셋을 지정하세요.");
    }
    var title = app.project.createNewTitle(app.project.rootItem, "SubTitle_" + Math.round(startSec));
    if (!title) return;
    var titleObj = title.getTitle();
    if (titleObj) {
        titleObj.setDefaultTextProperties();
        var textParam = titleObj.createTextParam();
        if (textParam) {
            textParam.setString(text);
            textParam.setPosition(960, 900);
            textParam.setFontSize(48);
        }
        titleObj.save();
    }
    var startTime = new Time(); startTime.seconds = startSec;
    seq.videoTracks[trackIdx].insertClip(title, startTime);
}

/* ══════════════════════════════════════════════
   11. 타임라인 이동: 특정 시간으로 CTI 이동
══════════════════════════════════════════════ */
function seekToClip(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";

    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시퀀스 없음";

    var startSec = payload.startSec || 0;
    try {
        var t = new Time();
        t.seconds = startSec;
        seq.setPlayerPosition(t.ticks);
        return "SUCCESS: " + startSec + "초로 이동";
    } catch(e) {
        return "ERROR: " + e.message;
    }
}

/* ══════════════════════════════════════════════
   12. 프리뷰: 타임라인 첫 번째 클립에 파라미터 적용
══════════════════════════════════════════════ */
function previewParamsOnFirstClip(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";

    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시퀀스 없음";
    ensureQE();

    var trackIdx = payload.videoTrackIndex || 2;
    var params   = payload.params || [];

    var track = null;
    try { track = seq.videoTracks[trackIdx]; } catch(e) { return "ERROR: 트랙 접근 실패"; }
    if (!track) return "ERROR: 트랙 없음";

    var numClips = 0;
    try { numClips = track.clips.numItems; } catch(e) {}
    if (numClips === 0) return "ERROR: 트랙에 클립이 없습니다";

    var firstClip = null;
    try { firstClip = track.clips[0]; } catch(e) {}
    if (!firstClip) return "ERROR: 첫 번째 클립 접근 실패";

    try { applyParamsToItem(firstClip, params); } catch(e) { return "ERROR: 파라미터 적용 실패 - " + e.message; }
    return "SUCCESS: 프리뷰 적용 완료";
}

/* ══════════════════════════════════════════════
   13. 활성 시퀀스의 특정 트랙 클립 목록 반환 (동기화용)
   payloadStr: { videoTrackIndex }
   반환: [{ startSec, endSec, mogrtName }] JSON
══════════════════════════════════════════════ */
function getTimelineClips(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";

    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시퀀스 없음";

    var trackIdx = payload.videoTrackIndex || 2;
    var track = null;
    try { track = seq.videoTracks[trackIdx]; } catch(e) { return "ERROR: 트랙 접근 실패"; }
    if (!track) return "ERROR: 트랙 없음";

    var numClips = 0;
    try { numClips = track.clips.numItems; } catch(e) {}

    var clips = [];
    for (var i = 0; i < numClips; i++) {
        var clip;
        try { clip = track.clips[i]; } catch(e) { continue; }
        if (!clip) continue;
        var startSec = 0, endSec = 0, clipName = "";
        try { startSec = clip.start.seconds; } catch(e) {}
        try { endSec = clip.end.seconds; } catch(e) {}
        try { clipName = clip.name || ""; } catch(e) {}
        clips.push({ startSec: startSec, endSec: endSec, name: clipName });
    }
    return JSON.stringify(clips);
}

/* ══════════════════════════════════════════════
   15. 타임라인 클립에서 파라미터 읽기 (동기화용)
   payloadStr: { videoTrackIndex, startSec }
   반환: [ParamDef] JSON (getMogrtParams와 동일 구조)
══════════════════════════════════════════════ */
function syncFromTimeline(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";

    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시퀀스 없음";

    var trackIdx = (payload.videoTrackIndex !== undefined) ? payload.videoTrackIndex : 2;
    var startSec = (payload.startSec !== undefined) ? payload.startSec : -1;

    var track = null;
    try { track = seq.videoTracks[trackIdx]; } catch(e) { return "ERROR: 트랙 접근 실패"; }
    if (!track) return "ERROR: 트랙 없음";

    var numClips = 0;
    try { numClips = track.clips.numItems; } catch(e) {}

    var targetClip = null;
    for (var i = 0; i < numClips; i++) {
        var clip;
        try { clip = track.clips[i]; } catch(e) { continue; }
        if (!clip) continue;
        var clipStart = 0;
        try { clipStart = clip.start.seconds; } catch(e) {}
        if (Math.abs(clipStart - startSec) < 0.5) {
            targetClip = clip; break;
        }
    }
    if (!targetClip) return "ERROR: 클립 없음 (startSec=" + startSec + ")";

    var result = [];
    try {
        var comp = targetClip.getMGTComponent();
        if (!comp || !comp.properties) return "ERROR: MOGRT 컴포넌트 없음";

        var props = comp.properties;
        var n = 0;
        try { n = props.numItems; } catch(e) {}

        var groupStack2 = []; // { name, remaining } 스택
        for (var j = 0; j < n; j++) {
            var p;
            try { p = props[j]; } catch(e) { continue; }
            if (!p) continue;

            var dname = "";
            try { dname = p.displayName || ""; } catch(e) {}

            var val = "";
            try { val = p.getValue(); } catch(e) { val = ""; }
            if (val === null || val === undefined) val = "";

            var numSubItems = 0;
            try { numSubItems = p.numItems || 0; } catch(e) {}

            var detectedType = detectParamType(val, dname, numSubItems > 0, p);
            var displayVal = String(val);

            // 스택 상단 그룹의 remaining 차감
            if (detectedType !== "group" && groupStack2.length > 0) {
                groupStack2[groupStack2.length - 1].remaining--;
                while (groupStack2.length > 0 && groupStack2[groupStack2.length - 1].remaining <= 0) {
                    groupStack2.pop();
                }
            }
            var currentGroup = groupStack2.length > 0 ? groupStack2[groupStack2.length - 1].name : "";

            if (detectedType === "group") {
                groupStack2.push({ name: dname, remaining: numSubItems });
                displayVal = "";
            }
            if (detectedType === "text") {
                try {
                    var parsedT = JSON.parse(String(val));
                    if (parsedT && typeof parsedT.textEditValue !== "undefined") {
                        displayVal = parsedT.textEditValue;
                    }
                } catch(e) {}
            }
            if (detectedType === "boolean") {
                var sLow2 = String(val).toLowerCase().replace(/^\s+|\s+$/g, '');
                displayVal = (sLow2 === "true") ? "true" : "false";
            }

            var minVal = null, maxVal = null;
            if (detectedType === "number" || detectedType === "dropdown" ||
                detectedType === "angle" || detectedType === "point") {
                try { minVal = p.getMinValue(); } catch(e) { minVal = null; }
                try { maxVal = p.getMaxValue(); } catch(e) { maxVal = null; }
                if (minVal === null || isNaN(minVal)) minVal = null;
                if (maxVal === null || isNaN(maxVal)) maxVal = null;
            }

            var entry = {
                index: j,
                displayName: dname,
                type: detectedType,
                rawValue: String(val),
                value: displayVal,
                group: currentGroup
            };

            if (detectedType === "color") {
                var rawColorNum2 = parseFloat(String(val)) || 0;
                function h2c2(v) { var s = Math.floor(v).toString(16); return s.length < 2 ? '0' + s : s; }
                if (rawColorNum2 < 4294967296) {
                    var cr3 = Math.floor(rawColorNum2 / 65536) % 256;
                    var cg3 = Math.floor(rawColorNum2 / 256) % 256;
                    var cb3 = rawColorNum2 % 256;
                    entry.colorHex = '#' + h2c2(cr3) + h2c2(cg3) + h2c2(cb3);
                } else {
                    var colorBase2 = 72057594037927936;
                    var colorRem2 = rawColorNum2 - colorBase2;
                    if (colorRem2 >= 0) {
                        var cr3b = Math.floor(colorRem2 / 1099511627776) % 256;
                        colorRem2 = colorRem2 - cr3b * 1099511627776;
                        var cg3b = Math.floor(colorRem2 / 16777216) % 256;
                        colorRem2 = colorRem2 - cg3b * 16777216;
                        var cb3b = Math.floor(colorRem2 / 256) % 256;
                        entry.colorHex = '#' + h2c2(cr3b) + h2c2(cg3b) + h2c2(cb3b);
                    } else {
                        entry.colorHex = '#000000';
                    }
                }
            }
            if (minVal !== null) entry.minValue = minVal;
            if (maxVal !== null) entry.maxValue = maxVal;

            result.push(entry);
        }
    } catch (e) {
        return "ERROR: " + e.message;
    }

    return JSON.stringify(result);
}

/* ══════════════════════════════════════════════
   PREVIEW-A. 프리뷰 전용 시퀀스 초기화
   payloadStr: { mogrtPath, durationSec }
   - __MOGRT_PREVIEW__ 시퀀스가 없으면 생성
   - 기존 클립 전부 삭제 후 mogrt 클립 1개 배치
   - 해당 시퀀스를 활성화
   반환: "SUCCESS" or "ERROR:..."
══════════════════════════════════════════════ */
function setupPreviewSequence(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";
    var mogrtPath = payload.mogrtPath || "";
    var durationSec = payload.durationSec || 5;
    if (!mogrtPath) return "ERROR: mogrtPath 없음";

    ensureQE();

    var proj = app.project;
    if (!proj) return "ERROR: 프로젝트 없음";

    // ★ 핵심: 함수 진입 즉시 원래 활성 시퀀스 저장
    // (qe.project.newSequence가 자동으로 활성 시퀀스를 전환하므로
    //  newSequence 호출 전에 반드시 저장해야 함)
    var originalActiveSeq = null;
    try { originalActiveSeq = proj.activeSequence; } catch(e) {}

    // 기존 프리뷰 시퀀스 찾기
    var previewSeq = findPreviewSequence();

    // 없으면 qe.project.newSequence로 다이얼로그 없이 생성
    if (!previewSeq) {
        var activeSeq = proj.activeSequence;
        if (!activeSeq) return "ERROR: 활성 시퀀스 없음 (프리뷰 시퀀스 생성 불가)";

        // 현재 시퀀스의 해상도/fps 읽기
        var seqW = 1920, seqH = 1080, seqFps = 29.97;
        try {
            var st = activeSeq.getSettings();
            seqW = st.videoFrameWidth || 1920;
            seqH = st.videoFrameHeight || 1080;
            var ftd = st.videoFrameRate;
            if (ftd && ftd.seconds > 0) seqFps = 1.0 / ftd.seconds;
        } catch(e) {}

        // ── OS 감지: macOS vs Windows ──
        var isWin = ($.os && $.os.toLowerCase().indexOf("windows") !== -1);
        var isMac = !isWin;

        // fps 반올림 → 가장 가까운 프리셋 선택
        var fpsRound = Math.round(seqFps * 100) / 100;
        var fpsKey = "29.97";
        if (fpsRound >= 59) fpsKey = "59.94";
        else if (fpsRound >= 50) fpsKey = "50";
        else if (fpsRound >= 29) fpsKey = "29.97";
        else if (fpsRound >= 25) fpsKey = "25";
        else if (fpsRound >= 24) fpsKey = "23.976";

        // ── sqpreset 경로 후보 목록 (OS별 + 연도별 다중 시도) ──
        var sqPresetPath = "";
        var sqPresetCandidates = [];

        if (isMac) {
            // macOS: /Applications/Adobe Premiere Pro YYYY/Adobe Premiere Pro YYYY.app/Contents/Settings/SequencePresets/
            var macYears = ["2026", "2025", "2024", "2023"];
            for (var myi = 0; myi < macYears.length; myi++) {
                var macBase = "/Applications/Adobe Premiere Pro " + macYears[myi] +
                              "/Adobe Premiere Pro " + macYears[myi] + ".app/Contents/Settings/SequencePresets/";
                if (seqH >= 2160) {
                    sqPresetCandidates.push(macBase + "UHD (4K)/UHD (4K) 2160p " + fpsKey + " fps.sqpreset");
                    sqPresetCandidates.push(macBase + "UHD (4K)/UHD (4K) 2160p 29.97 fps.sqpreset");
                } else if (seqH >= 1080) {
                    sqPresetCandidates.push(macBase + "HD 1080p/HD 1080p " + fpsKey + " fps.sqpreset");
                    sqPresetCandidates.push(macBase + "HD 1080p/HD 1080p 29.97 fps.sqpreset");
                } else if (seqH >= 720) {
                    sqPresetCandidates.push(macBase + "HD 720p/HD 720p " + fpsKey + " fps.sqpreset");
                    sqPresetCandidates.push(macBase + "HD 720p/HD 720p 29.97 fps.sqpreset");
                } else {
                    sqPresetCandidates.push(macBase + "HD 1080p/HD 1080p 29.97 fps.sqpreset");
                }
            }
        } else {
            // Windows: C:\Program Files\Adobe\Adobe Premiere Pro YYYY\Settings\SequencePresets\
            var winYears = ["2026", "2025", "2024", "2023"];
            for (var wyi = 0; wyi < winYears.length; wyi++) {
                var winBase = "C:\\Program Files\\Adobe\\Adobe Premiere Pro " + winYears[wyi] +
                              "\\Settings\\SequencePresets\\";
                if (seqH >= 2160) {
                    sqPresetCandidates.push(winBase + "UHD (4K)\\UHD (4K) 2160p " + fpsKey + " fps.sqpreset");
                    sqPresetCandidates.push(winBase + "UHD (4K)\\UHD (4K) 2160p 29.97 fps.sqpreset");
                } else if (seqH >= 1080) {
                    sqPresetCandidates.push(winBase + "HD 1080p\\HD 1080p " + fpsKey + " fps.sqpreset");
                    sqPresetCandidates.push(winBase + "HD 1080p\\HD 1080p 29.97 fps.sqpreset");
                } else if (seqH >= 720) {
                    sqPresetCandidates.push(winBase + "HD 720p\\HD 720p " + fpsKey + " fps.sqpreset");
                    sqPresetCandidates.push(winBase + "HD 720p\\HD 720p 29.97 fps.sqpreset");
                } else {
                    sqPresetCandidates.push(winBase + "HD 1080p\\HD 1080p 29.97 fps.sqpreset");
                }
            }
        }

        // 후보 중 실제 존재하는 첫 번째 파일 사용
        for (var sci = 0; sci < sqPresetCandidates.length; sci++) {
            try {
                var sqFile = new File(sqPresetCandidates[sci]);
                if (sqFile.exists) { sqPresetPath = sqPresetCandidates[sci]; break; }
            } catch(e) {}
        }
        // 모두 없으면 첫 번째 후보로 fallback (qe.project.newSequence가 자체 처리)
        if (!sqPresetPath && sqPresetCandidates.length > 0) {
            sqPresetPath = sqPresetCandidates[0];
        }

        // qe.project.newSequence → 다이얼로그 없이 생성
        try {
            ensureQE();
            qe.project.newSequence(PREVIEW_SEQ_NAME, sqPresetPath);
        } catch(e) {
            return "ERROR: qe.project.newSequence 실패 - " + e.message;
        }

        // 생성된 시퀀스 찾기 (이름으로)
        var newSeqCount = 0;
        try { newSeqCount = proj.sequences.numSequences; } catch(e) {}
        for (var ni = 0; ni < newSeqCount; ni++) {
            var ns;
            try { ns = proj.sequences[ni]; } catch(e) { continue; }
            if (ns && String(ns.name) === PREVIEW_SEQ_NAME) {
                previewSeq = ns; break;
            }
        }
        if (!previewSeq) return "ERROR: 프리뷰 시퀀스 생성 후 찾기 실패";
    }

    // 프리뷰 시퀀스의 V2(트랙 1) 기존 클립 모두 삭제
    // V1(트랙 0)은 사용자가 배경 등을 배치할 수 있도록 보존
    var previewTrack = null;
    try { previewTrack = previewSeq.videoTracks[1]; } catch(e) {}
    if (previewTrack) {
        var nClips = 0;
        try { nClips = previewTrack.clips.numItems; } catch(e) {}
        // 뒤에서부터 삭제
        for (var ci = nClips - 1; ci >= 0; ci--) {
            try {
                var oldClip = previewTrack.clips[ci];
                if (oldClip) oldClip.remove(false, false);
            } catch(e) {}
        }
    }

    // originalActiveSeq는 함수 시작 시 이미 저장됨 (위 참조)
    // importMGT 직전 재확인: 혹시 __MOGRT_PREVIEW__가 저장되었다면 교정
    try {
        if (!originalActiveSeq || String(originalActiveSeq.name) === PREVIEW_SEQ_NAME) {
            // 모든 시퀀스 중 __MOGRT_PREVIEW__가 아닌 첫 번째 시퀀스로 대체
            var sc2 = 0;
            try { sc2 = proj.sequences.numSequences; } catch(e) {}
            for (var si2 = 0; si2 < sc2; si2++) {
                var s2;
                try { s2 = proj.sequences[si2]; } catch(e) { continue; }
                if (s2 && String(s2.name) !== PREVIEW_SEQ_NAME) {
                    originalActiveSeq = s2; break;
                }
            }
        }
    } catch(e) {}

    // mogrt 클립 배치 (V2=트랙 1, 0초 위치)
    var startTicks = "0";
    var newClip = null;
    try {
        newClip = previewSeq.importMGT(mogrtPath, startTicks, 1, 0);
    } catch(e) {
        // importMGT 실패해도 원래 시퀀스 복원
        setActiveSequence(originalActiveSeq);
        return "ERROR: importMGT 실패 - " + e.message;
    }

    // importMGT 직후 즉시 원래 시퀀스로 복원
    setActiveSequence(originalActiveSeq);

    if (!newClip) return "ERROR: importMGT null";

    // importMGT가 트랙 인자를 무시하는 경우 실제 배치된 트랙 확인 후 V2로 이동
    var actualTrackIdx = -1;
    var numVideoTracks = 0;
    try { numVideoTracks = previewSeq.videoTracks.numTracks; } catch(e) {}
    for (var vti = 0; vti < numVideoTracks; vti++) {
        try {
            var vt = previewSeq.videoTracks[vti];
            if (!vt) continue;
            var vtClips = 0;
            try { vtClips = vt.clips.numItems; } catch(e) {}
            for (var vtci = 0; vtci < vtClips; vtci++) {
                try {
                    var vtClip = vt.clips[vtci];
                    if (vtClip && vtClip === newClip) { actualTrackIdx = vti; break; }
                } catch(e) {}
            }
            if (actualTrackIdx >= 0) break;
        } catch(e) {}
    }
    // V2(트랙 1)이 아닌 다른 트랙에 배치된 경우: 해당 클립 삭제 후 V2에 재배치
    if (actualTrackIdx !== 1) {
        try { newClip.remove(false, false); } catch(e) {}
        newClip = null;
        // V2의 기존 클립 모두 삭제 후 재배치
        var v2Track = null;
        try { v2Track = previewSeq.videoTracks[1]; } catch(e) {}
        if (v2Track) {
            var v2Clips = 0;
            try { v2Clips = v2Track.clips.numItems; } catch(e) {}
            for (var v2ci = v2Clips - 1; v2ci >= 0; v2ci--) {
                try { var v2c = v2Track.clips[v2ci]; if (v2c) v2c.remove(false, false); } catch(e) {}
            }
        }
        // 재배치 시도 (트랙 1 강제) - originalActiveSeq는 함수 시작 시 저장된 값 유지
        try { newClip = previewSeq.importMGT(mogrtPath, startTicks, 1, 0); } catch(e) {}
        // 재배치 후에도 즉시 복원
        setActiveSequence(originalActiveSeq);
        if (!newClip) return "ERROR: V2 재배치 실패";
    }

    // 클립 길이 설정
    try {
        var endTime = new Time();
        endTime.seconds = durationSec;
        newClip.end = endTime;
    } catch(e) {}

    // 프리뷰 시퀀스 활성화 안 함 (작업 시퀀스가 전환되면 영상이 잘림)
    // CTI를 중간 프레임으로 이동 (썸네일용)
    try {
        var midTime = new Time();
        midTime.seconds = durationSec / 2;
        previewSeq.setPlayerPosition(midTime.ticks);
    } catch(e) {}

    return "SUCCESS";
}

/* ══════════════════════════════════════════════
   PREVIEW-B. 프리뷰 시퀀스 클립에 파라미터 적용
   payloadStr: { params: [ParamDef] }
   반환: "SUCCESS" or "ERROR:..."
══════════════════════════════════════════════ */
function applyPreviewParams(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";
    var params = payload.params || [];

    var proj = app.project;
    if (!proj) return "ERROR: 프로젝트 없음";

    var previewSeq = findPreviewSequence();
    if (!previewSeq) return "ERROR: 프리뷰 시퀀스 없음";

    // V2(트랙 1)에서 클립 찾기 (V1은 배경용으로 보존)
    var previewTrack = null;
    try { previewTrack = previewSeq.videoTracks[1]; } catch(e) {}
    // V2에 클립이 없으면 V1도 확인 (폴백)
    if (!previewTrack || (function(){ try { return previewTrack.clips.numItems === 0; } catch(e) { return true; } })()) {
        try { previewTrack = previewSeq.videoTracks[0]; } catch(e) {}
    }
    if (!previewTrack) return "ERROR: 프리뷰 트랙 없음";

    var nClips = 0;
    try { nClips = previewTrack.clips.numItems; } catch(e) {}
    if (nClips === 0) return "ERROR: 프리뷰 클립 없음";

    var previewClip = null;
    try { previewClip = previewTrack.clips[0]; } catch(e) {}
    if (!previewClip) return "ERROR: 프리뷰 클립 접근 실패";

    try { applyParamsToItem(previewClip, params); } catch(e) {
        return "ERROR: 파라미터 적용 실패 - " + e.message;
    }
    return "SUCCESS";
}

/* ══════════════════════════════════════════════
   PREVIEW-B2. 프리뷰 클립의 현재 파라미터 값 읽기 (역방향 동기화)
   반환: JSON 배열 [{index, displayName, type, rawValue, value}] or "ERROR:..."
══════════════════════════════════════════════ */
function getPreviewClipParams() {
    var proj = app.project;
    if (!proj) return "ERROR: 프로젝트 없음";

    var previewSeq = findPreviewSequence();
    if (!previewSeq) return "ERROR: 프리뷰 시쿀스 없음";

    var previewTrack = null;
    try { previewTrack = previewSeq.videoTracks[1]; } catch(e) {}
    if (!previewTrack || (function(){ try { return previewTrack.clips.numItems === 0; } catch(e) { return true; } })()) {
        try { previewTrack = previewSeq.videoTracks[0]; } catch(e) {}
    }
    if (!previewTrack) return "ERROR: 프리뷰 트랙 없음";

    var nClips = 0;
    try { nClips = previewTrack.clips.numItems; } catch(e) {}
    if (nClips === 0) return "ERROR: 프리뷰 클립 없음";

    var previewClip = null;
    try { previewClip = previewTrack.clips[0]; } catch(e) {}
    if (!previewClip) return "ERROR: 프리뷰 클립 접근 실패";

    var comp = null;
    try { comp = previewClip.getMGTComponent(); } catch(e) {}
    if (!comp || !comp.properties) return "ERROR: MGT 컴포넌트 없음";

    var props = comp.properties;
    var n = 0;
    try { n = props.numItems; } catch(e) {}

    var result = [];
    for (var i = 0; i < n; i++) {
        var p;
        try { p = props[i]; } catch(e) { continue; }
        if (!p) continue;
        var dname = "";
        try { dname = p.displayName || ""; } catch(e) {}
        var val = "";
        try { val = p.getValue(); } catch(e) { val = ""; }
        if (val === null || val === undefined) val = "";
        var numSubItems = 0;
        try { numSubItems = p.numItems || 0; } catch(e) {}
        var detectedType = detectParamType(val, dname, numSubItems > 0, p);
        var displayVal = String(val);
        if (detectedType === "text") {
            try {
                var parsed = JSON.parse(String(val));
                if (parsed && typeof parsed.textEditValue !== "undefined") displayVal = parsed.textEditValue;
            } catch(e) {}
        }
        if (detectedType === "boolean") {
            var sLow = String(val).toLowerCase().replace(/^\s+|\s+$/g, '');
            displayVal = (sLow === "true") ? "true" : "false";
        }
        var entry = {
            index: i,
            displayName: dname,
            type: detectedType,
            rawValue: String(val),
            value: displayVal
        };
        if (detectedType === "text") {
            var fontExp = false;
            try {
                var pj = JSON.parse(String(val));
                if (pj && typeof pj.fontEditValue === "string" && pj.fontEditValue !== "") {
                    fontExp = true;
                }
            } catch(e) {}
            entry.fontExposed = fontExp;
        }
        result.push(entry);
    }
    return JSON.stringify(result);
}

/* ══════════════════════════════════════════════
   PREVIEW-C. 프리뷰 시쿀스 현재 프레임 캐처
   payloadStr: { outputPath }
   - 프리뷰 시퀀스의 현재 CTI 위치를 JPEG로 저장
   반환: "SUCCESS:경로" or "ERROR:..."
══════════════════════════════════════════════ */
function capturePreviewFrame(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";
    var outputPath = payload.outputPath || "";
    if (!outputPath) return "ERROR: outputPath 없음";

    var proj = app.project;
    if (!proj) return "ERROR: 프로젝트 없음";

    // 원래 활성 시퀀스 저장 (코드 완료 후 복교용)
    var originalSeq = null;
    try {
        var curSeq = proj.activeSequence;
        if (curSeq && String(curSeq.name) !== PREVIEW_SEQ_NAME) {
            originalSeq = curSeq;
        }
    } catch(e) {}

    // QE DOM 활성화
    ensureQE();

    var previewSeq = findPreviewSequence();
    if (!previewSeq) return "ERROR: 프리뷰 시퀀스 없음";

    // ExtendScript Folder.temp 기반 임시 경로 사용
    // exportFrameJPEG가 자동으로 .jpg를 붙이므로 파일명에 .jpg 미포함
    var tmpFolder = Folder.temp;
    var baseName = "mogrt_preview_" + (new Date().getTime());
    // 크로스 플랫폼: "/" 구분자 사용 (ExtendScript는 macOS/Windows 모두 "/" 허용)
    var jpgFile = new File(tmpFolder.fsName + "/" + baseName);
    var jpgPath = jpgFile.fsName;
    // 실제 생성되는 파일: jpgPath + ".jpg"
    var actualJpgPath = jpgPath + ".jpg";

    // QE DOM의 exportFrameJPEG 사용 (PP 자체 렌더링, AME 불필요)
    // ★ 핵심 변경: $.sleep busy-wait 제거 → exportFrameJPEG 후 즉시 PENDING 반환
    // ($.sleep은 ExtendScript 엔진을 최대 30초 블로킹하여 Premiere 전체를 먹통으로 만듦)
    // 파일 생성 대기는 JS 쪽에서 폴링으로 처리 (app.js runPreviewCapture 이미 구현됨)
    var ctiTimecode = "00:00:00:00";
    try {
        ensureQE();
        // 프리뷰 시퀀스를 일시 활성화 (캐쳐에 필요)
        setActiveSequence(previewSeq);
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) {
            setActiveSequence(originalSeq);
            return "ERROR: QE 활성 시퀀스 없음";
        }
        try { ctiTimecode = qeSeq.CTI.timecode; } catch(e2) {}
        // CTI 넘지리기 (렌더 캐시 무효화)
        try {
            var ctiSec = 0;
            try { ctiSec = previewSeq.getPlayerPosition().seconds; } catch(e) {}
            var nudgeTime = new Time();
            nudgeTime.seconds = ctiSec + 0.1;
            previewSeq.setPlayerPosition(nudgeTime.ticks);
            var origTime = new Time();
            origTime.seconds = ctiSec;
            previewSeq.setPlayerPosition(origTime.ticks);
        } catch(e) {}
        qeSeq.exportFrameJPEG(ctiTimecode, jpgPath);
        // 원래 시퀀스 즉시 복원 ($.sleep 없이)
        setActiveSequence(originalSeq);
        // 파일 생성 대기 없이 즉시 PENDING 반환 → JS 쪽에서 폴링
        return "PENDING:" + actualJpgPath.replace(/\\/g, "/");
    } catch(e) {
        var seqName2 = "";
        try { seqName2 = (typeof qeSeq !== 'undefined' && qeSeq) ? qeSeq.name : ""; } catch(e3) {}
        setActiveSequence(originalSeq);
        return "ERROR: QE exportFrameJPEG err=[" + (e.message || String(e)) + "] | seqName=[" + seqName2 + "] | cti=[" + ctiTimecode + "] | path=[" + jpgPath + "]";
    }
}

/* ══════════════════════════════════════════════
   16. 현재 활성 시퀀스 ID 반환 (시퀀스 변경 감지용)
   반환: { seqId, seqName, projPath } JSON
══════════════════════════════════════════════ */
function getActiveSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ seqId: "", seqName: "", projPath: "" });
        var seqId = "";
        var seqName = "";
        var projPath = "";
        try { seqId = String(seq.sequenceID || ""); } catch(e) {}
        try { seqName = String(seq.name || ""); } catch(e) {}
        try { projPath = app.project.path || ""; } catch(e) {}
        return JSON.stringify({ seqId: seqId, seqName: seqName, projPath: projPath });
    } catch(e) {
        return JSON.stringify({ seqId: "", seqName: "", projPath: "" });
    }
}

/* ══════════════════════════════════════════════
   17. 전체 트랙의 모든 MOGRT 클립 파라미터 읽기 (전체 동기화용)
   trackIndex: 비디오 트랙 인덱스 (정수)
   반환: [{ startSec, endSec, mogrtPath, params: [ParamDef] }] JSON
══════════════════════════════════════════════ */
function syncAllClipsFromTimeline(trackIndex) {
    var seq = app.project.activeSequence;
    if (!seq) return "ERROR: 활성 시퀀스 없음";

    var trackIdx = parseInt(trackIndex, 10) || 0;
    var track = null;
    try { track = seq.videoTracks[trackIdx]; } catch(e) { return "ERROR: 트랙 접근 실패"; }
    if (!track) return "ERROR: 트랙 없음";

    var numClips = 0;
    try { numClips = track.clips.numItems; } catch(e) {}

    var allResults = [];

    for (var ci = 0; ci < numClips; ci++) {
        var clip;
        try { clip = track.clips[ci]; } catch(e) { continue; }
        if (!clip) continue;

        var clipStart = 0, clipEnd = 0;
        try { clipStart = clip.start.seconds; } catch(e) {}
        try { clipEnd = clip.end.seconds; } catch(e) {}

        var clipResult = { startSec: clipStart, endSec: clipEnd, mogrtPath: "", params: [] };

        try {
            var comp = clip.getMGTComponent();
            if (!comp || !comp.properties) { allResults.push(clipResult); continue; }

            var props = comp.properties;
            var n = 0;
            try { n = props.numItems; } catch(e) {}

            var currentGroup = "";
            var paramList = [];

            for (var j = 0; j < n; j++) {
                var p;
                try { p = props[j]; } catch(e) { continue; }
                if (!p) continue;

                var dname = "";
                try { dname = p.displayName || ""; } catch(e) {}

                var val = "";
                try { val = p.getValue(); } catch(e) { val = ""; }
                if (val === null || val === undefined) val = "";

                var numSubItems = 0;
                try { numSubItems = p.numItems || 0; } catch(e) {}

                var detectedType = detectParamType(val, dname, numSubItems > 0, p);
                var displayVal = String(val);

                if (detectedType === "group") {
                    currentGroup = dname;
                    displayVal = "";
                }
                if (detectedType === "text") {
                    try {
                        var parsedT = JSON.parse(String(val));
                        if (parsedT && typeof parsedT.textEditValue !== "undefined") {
                            displayVal = parsedT.textEditValue;
                        }
                    } catch(e) {}
                }
                if (detectedType === "boolean") {
                    var sLow3 = String(val).toLowerCase().replace(/^\s+|\s+$/g, '');
                    displayVal = (sLow3 === "true") ? "true" : "false";
                }

                var minVal = null, maxVal = null;
                if (detectedType === "number" || detectedType === "dropdown" ||
                    detectedType === "angle" || detectedType === "point") {
                    try { minVal = p.getMinValue(); } catch(e) { minVal = null; }
                    try { maxVal = p.getMaxValue(); } catch(e) { maxVal = null; }
                    if (minVal === null || isNaN(minVal)) minVal = null;
                    if (maxVal === null || isNaN(maxVal)) maxVal = null;
                }

                var entry = {
                    index: j,
                    displayName: dname,
                    type: detectedType,
                    rawValue: String(val),
                    value: displayVal,
                    group: currentGroup !== dname ? currentGroup : ""
                };

                if (detectedType === "color") {
                    var rawColorNum3 = parseFloat(String(val)) || 0;
                    function h2c3(v) { var s = Math.floor(v).toString(16); return s.length < 2 ? '0' + s : s; }
                    if (rawColorNum3 < 4294967296) {
                        var cr4 = Math.floor(rawColorNum3 / 65536) % 256;
                        var cg4 = Math.floor(rawColorNum3 / 256) % 256;
                        var cb4 = rawColorNum3 % 256;
                        entry.colorHex = '#' + h2c3(cr4) + h2c3(cg4) + h2c3(cb4);
                    } else {
                        var colorBase3 = 72057594037927936;
                        var colorRem3 = rawColorNum3 - colorBase3;
                        if (colorRem3 >= 0) {
                            var cr4b = Math.floor(colorRem3 / 1099511627776) % 256;
                            colorRem3 = colorRem3 - cr4b * 1099511627776;
                            var cg4b = Math.floor(colorRem3 / 16777216) % 256;
                            colorRem3 = colorRem3 - cg4b * 16777216;
                            var cb4b = Math.floor(colorRem3 / 256) % 256;
                            entry.colorHex = '#' + h2c3(cr4b) + h2c3(cg4b) + h2c3(cb4b);
                        } else {
                            entry.colorHex = '#000000';
                        }
                    }
                }
                if (minVal !== null) entry.minValue = minVal;
                if (maxVal !== null) entry.maxValue = maxVal;

                paramList.push(entry);
            }

            clipResult.params = paramList;
        } catch(e) {
            // 클립 파라미터 읽기 실패 시 빈 params로 추가
        }

        allResults.push(clipResult);
    }

    return JSON.stringify(allResults);
}

/* ══════════════════════════════════════════════
   18. 텍스트 파일 저장 (프리셋 내보내기용)
   payloadStr: { path, content }
   반환: "SUCCESS" 또는 "ERROR: ..."
══════════════════════════════════════════════ */
function saveTextFile(payloadStr) {
    var payload;
    payload = parsePayloadMaybeEncoded(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";
    var filePath = payload.path;
    var content = payload.content;
    if (!filePath) return "ERROR: 경로 없음";
    try {
        var f = new File(filePath);
        f.encoding = "UTF-8";
        f.open("w");
        f.write(content);
        f.close();
        return "SUCCESS";
    } catch(e) {
        return "ERROR: " + e.message;
    }
}

/* ══════════════════════════════════════════════
   19. 파일 저장 다이얼로그 + 저장 (프리셋 내보내기용)
   payloadStr: { defaultName, content }
   반환: "SUCCESS:저장된경로" 또는 "CANCEL" 또는 "ERROR: ..."
══════════════════════════════════════════════ */
function saveTextFileWithDialog(payloadStr) {
    var payload;
    payload = parsePayloadMaybeEncoded(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";
    var defaultName = payload.defaultName || "export.json";
    var content = payload.content || "";
    try {
        var f = null;
        // 1차 시도: File.saveDialog 정적 메서드 (defaultName 포함)
        try {
            // 기본 저장 위치를 데스크톱으로 설정
            var desktopPath = Folder.desktop.fsName;
            var defaultFile = new File(desktopPath + "/" + defaultName);
            f = defaultFile.saveDlg("\ud504\ub9ac\uc14b \ub0b4\ubcf4\ub0b4\uae30 - \uc800\uc7a5 \uc704\uce58 \uc120\ud0dd", "JSON \ud30c\uc77c:*.json,\ubaa8\ub4e0 \ud30c\uc77c:*.*");
        } catch(e1) {
            // 2차 시도: File.saveDialog 정적 메서드
            try {
                f = File.saveDialog("\ud504\ub9ac\uc14b \ub0b4\ubcf4\ub0b4\uae30 - \uc800\uc7a5 \uc704\uce58 \uc120\ud0dd", "JSON \ud30c\uc77c:*.json,\ubaa8\ub4e0 \ud30c\uc77c:*.*");
            } catch(e2) {
                // 3차 시도: Folder.selectDialog 대안
                try {
                    var folder = Folder.selectDialog("\ud504\ub9ac\uc14b \uc800\uc7a5 \ud3f4\ub354\ub97c \uc120\ud0dd\ud558\uc138\uc694");
                    if (!folder) return "CANCEL";
                    f = new File(folder.fsName + "/" + defaultName);
                } catch(e3) {
                    return "ERROR: \ub2e4\uc774\uc5bc\ub85c\uadf8 \uc2e4\ud328 - " + e3.message;
                }
            }
        }
        if (!f) return "CANCEL";
        // 확장자 없으면 .json 추가
        var fname = f.name || "";
        if (fname.indexOf(".") === -1) {
            f = new File(f.fsName + ".json");
        }
        f.encoding = "UTF-8";
        if (!f.open("w")) {
            return "ERROR: \ud30c\uc77c \uc4f0\uae30 \uad8c\ud55c \uc5c6\uc74c - " + f.fsName;
        }
        f.write(content);
        f.close();
        return "SUCCESS:" + f.fsName;
    } catch(e) {
        return "ERROR: " + e.message;
    }
}

/* ══════════════════════════════════════════════
   FONT. 시스템 폰트 목록 반환
   - TTF/OTF 바이너리에서 name 테이블 파싱하여 패밀리명 추출
   - PP Properties 패널과 동일한 폰트명 반환
   반환: JSON 배열 ["폰트명", ...]
══════════════════════════════════════════════ */

/* fms_metadata.xml 에서 Font Family 속성값 추출
   리턴: 패밀리명 배열 ["폰트명", ...] 또는 null */
function parseFmsMetadata(xmlFile) {
    try {
        if (!xmlFile.exists) return null;
        xmlFile.encoding = "UTF-8";
        if (!xmlFile.open("r")) return null;
        var content = xmlFile.read();
        xmlFile.close();

        var families = [];
        var seen = {};
        // Family="..." 패턴 매칭
        var re = /Family="([^"]+)"/g;
        var m;
        while ((m = re.exec(content)) !== null) {
            var name = m[1];
            if (name && !seen[name]) {
                seen[name] = true;
                families.push(name);
            }
        }
        return families.length > 0 ? families : null;
    } catch(e) {
        try { xmlFile.close(); } catch(e2) {}
        return null;
    }
}

/* TTF/OTF name 테이블에서 패밀리명(display)과 PostScript 이름(postscript) 추출
   반환: { display: "영월 TTF", postscript: "YeongwolTTF-Regular" } 또는 null
   PP는 fontEditValue에 PostScript 이름을 사용함 */
function readFontFamilyName(fontFile) {
    try {
        fontFile.encoding = "BINARY";
        if (!fontFile.open("r")) return null;

        // 파일 시그니처 확인 (TTF/OTF/TTC)
        var sig = "";
        for (var si = 0; si < 4; si++) sig += fontFile.readch();

        // TTC 헤더 처리: 첫 번째 폰트 오프셋으로 이동
        var ttcTag = (sig.charCodeAt(0)===116 && sig.charCodeAt(1)===116 && sig.charCodeAt(2)===99 && sig.charCodeAt(3)===102);
        if (ttcTag) {
            fontFile.seek(8, 0);
            var ob0=fontFile.readch().charCodeAt(0), ob1=fontFile.readch().charCodeAt(0);
            var ob2=fontFile.readch().charCodeAt(0), ob3=fontFile.readch().charCodeAt(0);
            fontFile.seek(ob0*16777216+ob1*65536+ob2*256+ob3, 0);
            for (var sk=0; sk<4; sk++) fontFile.readch();
        }

        // Offset Table
        var numTables = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
        for (var sk2=0; sk2<6; sk2++) fontFile.readch(); // skip searchRange/entrySelector/rangeShift

        // Table Directory 탐색
        var nameTableOffset = 0;
        for (var ti=0; ti<numTables; ti++) {
            var tag="";
            for (var tc=0; tc<4; tc++) tag += fontFile.readch();
            fontFile.readch(); fontFile.readch(); fontFile.readch(); fontFile.readch(); // checkSum
            var to0=fontFile.readch().charCodeAt(0), to1=fontFile.readch().charCodeAt(0);
            var to2=fontFile.readch().charCodeAt(0), to3=fontFile.readch().charCodeAt(0);
            fontFile.readch(); fontFile.readch(); fontFile.readch(); fontFile.readch(); // length
            if (tag==="name") { nameTableOffset=to0*16777216+to1*65536+to2*256+to3; break; }
        }
        if (!nameTableOffset) { fontFile.close(); return null; }

        // name 테이블 파싱
        fontFile.seek(nameTableOffset, 0);
        fontFile.readch(); fontFile.readch(); // format
        var count = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
        var strOff = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
        var stringOffset = nameTableOffset + strOff;

        // 수집할 이름 종류 (nameID 1=Family, 16=PreferredFamily)
        // 언어 우선순위: 한국어(0x0412) > 영어(0x0409) > 기타
        var names = {}; // key: nameID+"_"+langPriority, value: string
        // langPriority: 0=한국어, 1=영어, 2=기타

        var records = [];
        for (var ni=0; ni<count; ni++) {
            var platformID = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
            var encodingID = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
            var languageID = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
            var nameID     = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
            var length     = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
            var offset     = fontFile.readch().charCodeAt(0)*256 + fontFile.readch().charCodeAt(0);
            // nameID 1(Family), 6(PostScript Name), 16(PreferredFamily) 수집
            if (nameID !== 1 && nameID !== 2 && nameID !== 6 && nameID !== 16 && nameID !== 17) continue;
            // 플랫폼 3(Windows UTF-16BE) 또는 플랫폼 1(Mac Roman, nameID=6 전용)
            if (nameID === 6) {
                // PostScript 이름: 플랫폼 1(Mac ASCII) 또는 플랫폼 3(Win UTF-16BE) 모두 허용
                if (platformID !== 1 && platformID !== 3) continue;
            } else if (nameID === 2 || nameID === 17) {
                // 서브패밀리: 플랫폼 3(Win UTF-16BE), 언어ID 0x0409(영어)만 사용 (한자 혼입 방지)
                if (platformID !== 3 || encodingID !== 1) continue;
                if (languageID !== 0x0409 && languageID !== 0x0000) continue;
            } else {
                if (platformID !== 3 || encodingID !== 1) continue;
            }
            records.push({nameID:nameID, platformID:platformID, encodingID:encodingID, languageID:languageID, length:length, offset:offset});
        }

        // 문자열 데이터 읽기
        var preferredKo=null, preferredEn=null, preferredOther=null;
        var familyKo=null, familyEn=null, familyOther=null;
        var postscriptName=null; // nameID=6
        var subfamilyPreferred=null, subfamilyBasic=null; // nameID=17, 2

        for (var ri=0; ri<records.length; ri++) {
            var rec = records[ri];
            fontFile.seek(stringOffset + rec.offset, 0);
            var nameStr = "";
            if (rec.nameID === 6 && rec.platformID === 1) {
                // Mac Roman: 1바이트 ASCII
                for (var ci=0; ci<rec.length; ci++) {
                    var ch = fontFile.readch();
                    nameStr += ch;
                }
            } else {
                // UTF-16BE
                for (var ci=0; ci<rec.length; ci+=2) {
                    var hi=fontFile.readch().charCodeAt(0), lo=fontFile.readch().charCodeAt(0);
                    var code=hi*256+lo;
                    if (code>0 && code<65536) nameStr += String.fromCharCode(code);
                }
            }
            nameStr = nameStr.replace(/^\s+|\s+$/g, "");
            if (!nameStr) continue;

            if (rec.nameID === 6) {
                if (!postscriptName) postscriptName = nameStr;
                continue;
            }
            if (rec.nameID === 17) {
                if (!subfamilyPreferred) subfamilyPreferred = nameStr;
                continue;
            }
            if (rec.nameID === 2) {
                if (!subfamilyBasic) subfamilyBasic = nameStr;
                continue;
            }

            var isKo = (rec.languageID === 0x0412);
            var isEn = (rec.languageID === 0x0409 || rec.languageID === 0x0000);

            if (rec.nameID === 16) {
                if (isKo && !preferredKo) preferredKo = nameStr;
                else if (isEn && !preferredEn) preferredEn = nameStr;
                else if (!isKo && !isEn && !preferredOther) preferredOther = nameStr;
            } else { // nameID === 1
                if (isKo && !familyKo) familyKo = nameStr;
                else if (isEn && !familyEn) familyEn = nameStr;
                else if (!isKo && !isEn && !familyOther) familyOther = nameStr;
            }
        }

        fontFile.close();
        var displayName = preferredKo || familyKo || preferredEn || familyEn || preferredOther || familyOther || null;
        if (!displayName) return null;
        // 서브패밀리: nameID=17 우선, 없으면 nameID=2 사용
        var rawSub = subfamilyPreferred || subfamilyBasic || null;
        // Regular/Normal/Roman은 단일 폰트와 동일하므로 null로 처리
        if (rawSub && /^(regular|normal|roman|표준)$/i.test(rawSub.replace(/^\s+|\s+$/g,""))) rawSub = null;
        // 한자 등 비ASCII 문자가 포함된 서브패밀리는 잘못 읽힌 것으로 판단하여 null 처리
        if (rawSub && /[\u2E80-\u9FFF\uF900-\uFAFF]/.test(rawSub)) rawSub = null;
        // PostScript 이름이 없으면 displayName을 그대로 사용 (폴백)
        // PP는 fontEditValue에 공백 없는 PostScript 이름을 사용함 (공백 → 하이픈 변환)
        var psName = postscriptName || displayName;
        psName = psName.replace(/ /g, "-");
        return { display: displayName, postscript: psName, subfamily: rawSub || null };
    } catch(e) {
        try { fontFile.close(); } catch(e2) {}
        return null;
    }
}

function getSystemFonts() {
    var fonts = [];
    var seen = {};

    // ── OS 감지 ──
    var isFontWin = ($.os && $.os.toLowerCase().indexOf("windows") !== -1);
    var homeEnvF = $.getenv("HOME") || "";
    var appDataEnvF = $.getenv("APPDATA") || "";
    var localAppDataEnvF = $.getenv("LOCALAPPDATA") || "";

    // ── 폰트 디렉토리 목록 구성 (OS별) ──
    var fontScanDirs = [];

    if (isFontWin) {
        // Windows 폰트 경로
        fontScanDirs.push(new Folder("C:/Windows/Fonts"));
        if (localAppDataEnvF) fontScanDirs.push(new Folder(localAppDataEnvF + "/Microsoft/Windows/Fonts"));
    } else {
        // macOS 폰트 경로
        fontScanDirs.push(new Folder("/Library/Fonts"));
        fontScanDirs.push(new Folder("/System/Library/Fonts"));
        fontScanDirs.push(new Folder("/Network/Library/Fonts"));
        if (homeEnvF) {
            fontScanDirs.push(new Folder(homeEnvF + "/Library/Fonts"));
        }
    }

    // ── 1순위: 시스템/사용자 폰트 폴더 TTF/OTF 바이너리 직접 파싱 ──
    for (var wfi2 = 0; wfi2 < fontScanDirs.length; wfi2++) {
        try {
            var sysDir = fontScanDirs[wfi2];
            if (!sysDir || !sysDir.exists) continue;
            var sysFiles = sysDir.getFiles(/\.(ttf|otf|ttc)$/i);
            if (!sysFiles) continue;
            for (var sfi = 0; sfi < sysFiles.length; sfi++) {
                try {
                    var wfam = readFontFamilyName(sysFiles[sfi]);
                    if (wfam && wfam.display) {
                        var wkey = wfam.display + (wfam.subfamily ? "__" + wfam.subfamily : "");
                        if (!seen[wkey]) {
                            seen[wkey] = true;
                            fonts.push({ display: wfam.display, postscript: wfam.postscript, subfamily: wfam.subfamily || null });
                        }
                    }
                } catch(wfe) {}
            }
        } catch(e) {}
    }

    // ── 2순위: Adobe Fonts(Typekit) livetype 폴더 — TTF/OTF 바이너리 파싱 ──
    var liveTypeDirs = [];
    if (isFontWin && appDataEnvF) {
        // Windows Adobe Fonts
        liveTypeDirs.push(appDataEnvF + "/Adobe/CoreSync/plugins/livetype/e");
        liveTypeDirs.push(appDataEnvF + "/Adobe/CoreSync/plugins/livetype/r");
        liveTypeDirs.push(appDataEnvF + "/Adobe/CoreSync/plugins/livetype/w");
        liveTypeDirs.push(appDataEnvF + "/Adobe/CoreSync/plugins/livetype/x");
    } else if (!isFontWin && homeEnvF) {
        // macOS Adobe Fonts
        liveTypeDirs.push(homeEnvF + "/Library/Application Support/Adobe/CoreSync/plugins/livetype/e");
        liveTypeDirs.push(homeEnvF + "/Library/Application Support/Adobe/CoreSync/plugins/livetype/r");
        liveTypeDirs.push(homeEnvF + "/Library/Application Support/Adobe/CoreSync/plugins/livetype/w");
        liveTypeDirs.push(homeEnvF + "/Library/Application Support/Adobe/CoreSync/plugins/livetype/x");
        // macOS Adobe Fonts 추가 경로
        liveTypeDirs.push(homeEnvF + "/Library/Fonts/Adobe Fonts");
        liveTypeDirs.push("/Library/Application Support/Adobe/Fonts");
    }
    for (var di = 0; di < liveTypeDirs.length; di++) {
        try {
            var ltDir = new Folder(liveTypeDirs[di]);
            if (!ltDir.exists) continue;
            // 숫자 폴더들 탐색
            var numFolders = ltDir.getFiles();
            if (!numFolders) continue;
            for (var nfi = 0; nfi < numFolders.length; nfi++) {
                try {
                    if (!(numFolders[nfi] instanceof Folder)) continue;
                    var innerFiles = numFolders[nfi].getFiles(/\.(ttf|otf|ttc)$/i);
                    if (!innerFiles) continue;
                    for (var ifi = 0; ifi < innerFiles.length; ifi++) {
                        try {
                            var ltFamily = readFontFamilyName(innerFiles[ifi]);
                            if (ltFamily && ltFamily.display) {
                                var ltkey = ltFamily.display + (ltFamily.subfamily ? "__" + ltFamily.subfamily : "");
                                if (!seen[ltkey]) {
                                    seen[ltkey] = true;
                                    fonts.push({ display: ltFamily.display, postscript: ltFamily.postscript, subfamily: ltFamily.subfamily || null });
                                }
                            }
                        } catch(fe) {}
                    }
                } catch(ne) {}
            }
        } catch(de) {}
    }

    // ── 3순위: 사용자 로컬 폰트 폴더 (TTF/OTF 바이너리 파싱)
    var userFontDirs = [];
    if (isFontWin && localAppDataEnvF) {
        userFontDirs.push(new Folder(localAppDataEnvF + "/Microsoft/Windows/Fonts"));
    }
    for (var di2 = 0; di2 < userFontDirs.length; di2++) {
        try {
            var dir2 = userFontDirs[di2];
            if (!dir2 || !dir2.exists) continue;
            var files2 = dir2.getFiles(/\.(ttf|otf|ttc)$/i);
            if (!files2) continue;
            for (var fi2 = 0; fi2 < files2.length; fi2++) {
                try {
                    var fam2 = readFontFamilyName(files2[fi2]);
                    if (fam2 && fam2.display) {
                        var fkey2 = fam2.display + (fam2.subfamily ? "__" + fam2.subfamily : "");
                        if (!seen[fkey2]) {
                            seen[fkey2] = true;
                            fonts.push({ display: fam2.display, postscript: fam2.postscript, subfamily: fam2.subfamily || null });
                        }
                    }
                } catch(fe2) {}
            }
        } catch(de2) {}
    }

    // 알파벳 정렬 (display 기준)
    fonts.sort(function(a, b) {
        var al = a.display.toLowerCase(), bl = b.display.toLowerCase();
        return al < bl ? -1 : al > bl ? 1 : 0;
    });

    return JSON.stringify(fonts);
}

/* ══════════════════════════════════════════════
   DEBUG. 프리뷰 클립 text 파라미터 getValue() 결과 반환
   payloadStr: { paramIndex }
   반환: "SUCCESS:JSON" 또는 "ERROR:..."
══════════════════════════════════════════════ */
function debugGetTextParamValue(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON \ud30c\uc2f1 \uc2e4\ud328";

    var proj = app.project;
    if (!proj) return "ERROR: \ud504\ub85c\uc81d\ud2b8 \uc5c6\uc74c";

    var previewSeq = findPreviewSequence();
    if (!previewSeq) return "ERROR: \ud504\ub9ac\ubdf0 \uc2dc\ud000\uc2a4 \uc5c6\uc74c";

    var previewTrack = null;
    try { previewTrack = previewSeq.videoTracks[0]; } catch(e) {}
    if (!previewTrack) return "ERROR: \ud2b8\ub799 \uc5c6\uc74c";

    var nClips = 0;
    try { nClips = previewTrack.clips.numItems; } catch(e) {}
    if (nClips === 0) return "ERROR: \ud074\ub9bd \uc5c6\uc74c";

    var clip = null;
    try { clip = previewTrack.clips[0]; } catch(e) {}
    if (!clip) return "ERROR: \ud074\ub9bd \uc811\uadfc \uc2e4\ud328";

    var comp = null;
    try { comp = clip.getMGTComponent(); } catch(e) {}
    if (!comp || !comp.properties) return "ERROR: MGT \ucef4\ud3ec\ub10c\ud2b8 \uc5c6\uc74c";

    var props = comp.properties;
    var pIdx = parseInt(payload.paramIndex, 10);
    if (isNaN(pIdx)) pIdx = -1;

    // paramIndex 지\uc815\uc2dc \ud574\ub2f9 \ud30c\ub77c\ubbf8\ud130 \ud558\ub098\ub9cc \ubc18\ud658
    if (pIdx >= 0) {
        var paramObj = null;
        try { paramObj = props[pIdx]; } catch(e) {}
        if (!paramObj) return "ERROR: \ud30c\ub77c\ubbf8\ud130 \uc5c6\uc74c (index=" + pIdx + ")";
        var curVal = "";
        try { curVal = String(paramObj.getValue() || ""); } catch(e) { return "ERROR: getValue \uc2e4\ud328: " + e.message; }
        return "SUCCESS:" + curVal;
    }

    // paramIndex \ubbf8\uc9c0\uc815 (-1) \uc2dc \uc804\uccb4 \ud30c\ub77c\ubbf8\ud130 \ub364\ud504
    var numProps = 0;
    try { numProps = props.numItems; } catch(e) {}
    var dumpLines = [];
    dumpLines.push("numItems=" + numProps);
    for (var di = 0; di < numProps; di++) {
        try {
            var dp = props[di];
            var dname = "";
            try { dname = dp.displayName || ""; } catch(e) {}
            var dval = "";
            try { dval = String(dp.getValue() || ""); } catch(e) { dval = "ERR"; }
            // \uac12\uc774 \uae38\uba74 50\uc790\ub85c \uc790\ub984
            var dvalShort = dval.length > 80 ? dval.substring(0, 80) + "..." : dval;
            dumpLines.push("[" + di + "] " + dname + " = " + dvalShort);
        } catch(e) {
            dumpLines.push("[" + di + "] ERR: " + e.message);
        }
    }
    return "SUCCESS:" + dumpLines.join("\n");
}

function debugApplyFont(payloadStr) {
    var payload = parsePayload(payloadStr);
    if (!payload) return "ERROR: JSON 파싱 실패";

    var proj = app.project;
    if (!proj) return "ERROR: 프로젝트 없음";

    var previewSeq = findPreviewSequence();
    if (!previewSeq) return "ERROR: 프리뷰 시퀀스 없음";

    var previewTrack = null;
    try { previewTrack = previewSeq.videoTracks[0]; } catch(e) {}
    if (!previewTrack) return "ERROR: 트랙 없음";

    var nClips = 0;
    try { nClips = previewTrack.clips.numItems; } catch(e) {}
    if (nClips === 0) return "ERROR: 클립 없음";

    var clip = null;
    try { clip = previewTrack.clips[0]; } catch(e) {}
    if (!clip) return "ERROR: 클립 접근 실패";

    var comp = null;
    try { comp = clip.getMGTComponent(); } catch(e) {}
    if (!comp || !comp.properties) return "ERROR: MGT 컴포넌트 없음";

    var props = comp.properties;
    var n = 0;
    try { n = props.numItems; } catch(e) {}

    var pIdx = parseInt(payload.paramIndex, 10) || 0;
    var paramObj = null;
    try { paramObj = props[pIdx]; } catch(e) {}
    if (!paramObj) return "ERROR: 파라미터 없음 (index=" + pIdx + ")";

    var fontName = payload.fontName || "";
    var fontSize2 = parseFloat(payload.fontSize) || 60;
    var isBold2 = payload.isBold === true;
    var isItalic2 = payload.isItalic === true;
    var text2 = payload.text || "";

    // 현재 rawValue 읽기
    var curVal = "";
    try { curVal = String(paramObj.getValue() || ""); } catch(e) {}

    var log = "curVal=" + curVal.substr(0, 100) + "...\n";

    // 방법 1: fonteditinfo 구조
    var result1 = "SKIP";
    try {
        var payload1 = {
            fonteditinfo: {
                capPropFontEdit: true,
                capPropFontFauxStyleEdit: true,
                fontEditValue: fontName,
                fontFSBoldValue: isBold2,
                fontFSItalicValue: isItalic2,
                fontFSAllCapsValue: false,
                fontFSSmallCapsValue: false,
                fontSizeEditValue: fontSize2
            },
            textEditValue: text2
        };
        paramObj.setValue(JSON.stringify(payload1), true);
        result1 = "OK";
    } catch(e) { result1 = "ERR:" + e.message; }

    // 방법 1 적용 후 값 확인
    var afterVal1 = "";
    try { afterVal1 = String(paramObj.getValue() || ""); } catch(e) {}
    log += "method1(fonteditinfo)=" + result1 + " afterVal=" + afterVal1.substr(0, 100) + "\n";

    return "SUCCESS:" + log;
}


/* ======================================================
   20. selectExportFolder - 프리셋 내보내기 폴더 선택
====================================================== */
function selectExportFolder() {
    try {
        var folder = Folder.selectDialog("저장 폴더 선택");
        if (!folder) return "CANCEL";
        return folder.fsName;
    } catch(e) {
        return "ERROR: " + e.message;
    }
}

/* MI:BEGIN v28 */
/* ══════════════════════════════════════════════
   v28 다화자 호스트 (docs/MULTISPEAKER_PLAN.md §7, spec placement 14)
   - 진입점은 MI_, 헬퍼·전역은 MI__ 접두사. ExtendScript 전역은 모든 CEP 확장이 같이 쓴다.
     DEV 설치는 접두사 뒤에 D를 붙여(stamp.js rewriteMiPrefix) 운영 호스트와 부딪히지 않는다 (tools/lib/stamp.js).
   - 위의 v27 함수는 바꾸지 않고 부르기만 한다: parsePayload, detectParamType, collectNativeTextProps,
     applyParamsToItem, ensureQE, PREVIEW_SEQ_NAME.
   - ES3만 쓴다 (npm run lint:jsx). JSON.*은 쓰지 않는다: 입력은 parsePayload(eval 폴리필), 출력은 MI__json.
   - 입력: JSON 문자열 하나 {seqId, build, …}. 패널(_callMi)이 U+2028/2029를 JSON 이스케이프로 바꿔 보낸다
     (eval 폴리필은 문자열 속 날 U+2028을 문법 오류로 본다, S0-3 h).
   - 출력: 늘 비어 있지 않은 JSON이고 "ERROR"로 시작하지 않는다. 실패는
     {"ok":false,"error":"bad-payload|no-sequence|preview-active|seq-mismatch|build-mismatch|no-track|add-failed|exception","detail":"…"}
   - 모든 진입점(MI_ping 빼고)은 MI__guard로 시작한다: 빌드가 같고, 활성 시퀀스가 있고, 프리뷰가 아니고,
     activeSequence.sequenceID가 payload.seqId와 같아야 한다. 시퀀스를 id로 찾아 다루지 않는다
     (QE addTracks는 활성 시퀀스만 바꾼다, spike #3).
   - 시간: 모든 스크립트 시간은 시퀀스 0 기준(zeroPoint와 무관, S0-3 o). 프레임 = Math.round(ticks / frameTicks).
     시작은 sf × frameTicks로 정확히 놓는다. 끝은 Premiere가 스냅하지 않으므로 늘 ef × frameTicks로 쓴다 (S0-3 p).
   - 클립 태그: TrackItem.name 끝의 "[MI:<salt>-<id>.<gen>]" (저장·재시작 뒤에도 남는다, spike #1).
     호스트는 태그를 읽기만 한다. 누가 우리 것인지(현재·옛 gen·중복)는 패널 core scanIndex가 가른다.
══════════════════════════════════════════════ */
var MI_VERSION = 28;
var MI_BUILD = "@@BUILD@@";

/* MI_PURE_BEGIN */
/* 순수 헬퍼 (Premiere 객체 app·qe·$·File·Folder를 쓰지 않는다). node 테스트가 이 블록만 잘라
   그대로 돌린다 (tests/lib/loadRegions.js loadHostPure, tests/unit/host_pure.test.js). */
var MI__TPS = 254016000000;
/* 클립 이름 끝의 태그 (패널 core CLIP_TAG_RE와 같은 규칙) */
var MI__TAG_RE = /\[MI:([a-z0-9]{4})-(\d+)\.(\d+)\]\s*$/;
/* MI_readClipTexts 한 번에 읽는 클립 수 상한 (클립당 54~61 ms, S0-3 결정 8) */
var MI__READ_MAX = 40;

/* 배열인가 (ES3에는 Array.isArray가 없다) */
function MI__isArr(v) {
    return Object.prototype.toString.call(v) === "[object Array]";
}
/* 정수인가 (숫자 타입만) */
function MI__isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
}
/* 배열 안 x의 위치, 없으면 -1 (ES3에는 배열 indexOf가 없다) */
function MI__idx(arr, x) {
    if (!arr) return -1;
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === x) return i;
    }
    return -1;
}
/* JSON 문자열 속 한 글자 이스케이프 */
function MI__esc(c) {
    var n = c.charCodeAt(0);
    if (c === "\"") return "\\\"";
    if (c === "\\") return "\\\\";
    if (n === 10) return "\\n";
    if (n === 13) return "\\r";
    if (n === 9) return "\\t";
    if (n === 8) return "\\b";
    if (n === 12) return "\\f";
    var h = n.toString(16);
    while (h.length < 4) h = "0" + h;
    return "\\u" + h;
}
/* 문자열 → JSON 문자열 리터럴. 따옴표·역슬래시·0x20 미만 제어 문자·U+2028/2029를 이스케이프한다 */
function MI__str(s) {
    return "\"" + String(s).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, MI__esc) + "\"";
}
/* 값 → JSON 텍스트 (v27 JSON 폴리필 대신 쓰는 직렬화기).
   NaN·Infinity → null, undefined·함수인 속성은 뺀다, 배열 속 undefined → null. 한글은 그대로 둔다 */
function MI__json(v) {
    var t = typeof v;
    if (v === null || v === undefined || t === "function") return "null";
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return MI__str(v);
    var i, parts = [];
    if (MI__isArr(v)) {
        for (i = 0; i < v.length; i++) {
            parts.push((v[i] === undefined || typeof v[i] === "function") ? "null" : MI__json(v[i]));
        }
        return "[" + parts.join(",") + "]";
    }
    if (t === "object") {
        for (var k in v) {
            if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
            if (v[k] === undefined || typeof v[k] === "function") continue;
            parts.push(MI__str(k) + ":" + MI__json(v[k]));
        }
        return "{" + parts.join(",") + "}";
    }
    return MI__str(String(v));
}
/* 클립 이름의 태그 → {salt, id, g} | null */
function MI__parseTag(name) {
    var m = MI__TAG_RE.exec(String(name === null || name === undefined ? "" : name));
    if (!m) return null;
    return { salt: m[1], id: parseInt(m[2], 10), g: parseInt(m[3], 10) };
}
/* 태그 글자 "[MI:salt-id.g]" */
function MI__makeTag(salt, id, g) {
    return "[MI:" + salt + "-" + id + "." + g + "]";
}
/* ticks → 프레임 (가장 가까운 프레임, S0-3 q: Premiere도 시작을 가장 가까운 프레임에 맞춘다) */
function MI__frameOf(ticks, ft) {
    return Math.round(Number(ticks) / Number(ft));
}
/* 프레임 → ticks 문자열. frame × frameTicks가 2^53 아래(약 9.8시간)면 정확하다 */
function MI__ticks(frame, ft) {
    return String(Math.round(Number(frame) * Number(ft)));
}
/* MI_PURE_END */

/* ── 공통 헬퍼 ── */

function MI__now() {
    return new Date().getTime();
}
function MI__errText(e) {
    var s = "";
    try { s = String(e && e.message ? e.message : e); } catch (x) { s = "?"; }
    try { if (e && e.line) s += " (line " + e.line + ")"; } catch (x2) {}
    return s;
}
/* 실패 응답 {"ok":false,"error":code,"detail":…} */
function MI__fail(code, detail) {
    return MI__json({ ok: false, error: code, detail: (detail === undefined || detail === null) ? "" : String(detail) });
}
/* 입력 JSON → 객체 (JSON이 아니거나 객체가 아니면 null) */
function MI__parse(payloadStr) {
    var p = parsePayload(String(payloadStr === undefined || payloadStr === null ? "" : payloadStr));
    if (!p || typeof p !== "object" || MI__isArr(p)) return null;
    return p;
}
/* 진입점 공통 확인 → {seq} | {err, detail}.
   빌드가 먼저다: 캐시된 옛 호스트나 다른 빌드는 아무것도 하지 않고 build-mismatch로 답한다 */
function MI__guard(p) {
    if (!p) return { err: "bad-payload", detail: "JSON 객체가 아니다" };
    if (String(p.build) !== MI_BUILD) return { err: "build-mismatch", detail: "host " + MI_BUILD + " / panel " + p.build };
    var seq = null;
    try { seq = app.project.activeSequence; } catch (e) { seq = null; }
    if (!seq) return { err: "no-sequence", detail: "활성 시퀀스 없음" };
    var name = "";
    try { name = String(seq.name); } catch (e2) {}
    if (name === PREVIEW_SEQ_NAME) return { err: "preview-active", detail: name };
    var id = "";
    try { id = String(seq.sequenceID); } catch (e3) {}
    if (p.seqId === undefined || p.seqId === null || String(p.seqId) !== id) {
        return { err: "seq-mismatch", detail: "활성 " + id + " (" + name + ") / 요청 " + p.seqId };
    }
    return { seq: seq };
}
/* 프레임당 ticks: videoFrameRate.ticks → timebase → 23.976 */
function MI__ft(seq) {
    var ft = 0;
    try { ft = Number(seq.getSettings().videoFrameRate.ticks); } catch (e) { ft = 0; }
    if (!(ft > 0)) {
        try { ft = Number(seq.timebase); } catch (e2) { ft = 0; }
    }
    if (!(ft > 0)) ft = 10594584000;
    return ft;
}
/* ticks → Time */
function MI__T(ticks) {
    var t = new Time();
    t.ticks = String(Math.round(Number(ticks)));
    return t;
}
/* 프레임 → Time (정확한 ticks) */
function MI__at(frame, ft) {
    var t = new Time();
    t.ticks = MI__ticks(frame, ft);
    return t;
}
/* 비디오 트랙 ti (없으면 null) */
function MI__track(seq, ti) {
    var n = 0;
    try { n = seq.videoTracks.numTracks; } catch (e) { return null; }
    if (!MI__isInt(ti) || ti < 0 || ti >= n) return null;
    try { return seq.videoTracks[ti]; } catch (e2) { return null; }
}
function MI__numTracks(seq) {
    try { return seq.videoTracks.numTracks; } catch (e) { return 0; }
}
function MI__locked(tr) {
    try { return tr.isLocked() === true; } catch (e) { return false; }
}
/* 트랙의 nodeId → 클립 표 (호출마다 새로 만든다. 키는 "n" + nodeId).
   nodeId는 처음 읽을 때 발급되므로(S0-3 §3 7) 이 표를 만들면 모든 클립이 번호를 받는다 */
function MI__nodeMap(tr) {
    var m = {};
    var cs, n = 0;
    try { cs = tr.clips; n = cs.numItems; } catch (e) { return m; }
    for (var k = 0; k < n; k++) {
        var c = null;
        try { c = cs[k]; } catch (e2) { continue; }
        if (!c) continue;
        var id = "";
        try { id = String(c.nodeId); } catch (e3) { continue; }
        m["n" + id] = c;
    }
    return m;
}
/* 클립 시작·끝 ticks (Number) */
function MI__s(c) {
    return Number(c.start.ticks);
}
function MI__e(c) {
    return Number(c.end.ticks);
}
function MI__mgt(c) {
    try { return c.getMGTComponent(); } catch (e) { return null; }
}
/* 클립 종류: "ae"(MGT 컴포넌트 있음) | "native"(MGT 없음 + Text 컴포넌트, Premiere에서 만든 템플릿) | "other" */
function MI__kind(c) {
    if (MI__mgt(c)) return "ae";
    var n = 0;
    try { n = c.components.numItems; } catch (e) { return "other"; }
    for (var i = 0; i < n; i++) {
        var mn = "";
        try { mn = String(c.components[i].matchName); } catch (e2) { continue; }
        if (String(mn).indexOf("Text") !== -1) return "native";
    }
    return "other";
}
/* AE MGT 속성 목록 (없으면 null) */
function MI__props(c) {
    var comp = MI__mgt(c);
    if (!comp) return null;
    try { return comp.properties; } catch (e) { return null; }
}
/* 속성 값 글자가 텍스트 JSON이면 textEditValue (읽지 못하면 ""), 텍스트가 아니면 null */
function MI__textOf(raw) {
    var s = String(raw);
    if (String(s).indexOf("\"textEditValue\"") === -1) return null;
    var o = parsePayload(s);
    if (o && o.textEditValue !== undefined && o.textEditValue !== null) return String(o.textEditValue);
    return "";
}
/* 네이티브 Source Text 값: 한 글자 이하(쓰기 전 헤더 한 글자, S0-3 w)는 빈 값 */
function MI__nativeVal(pr) {
    var v = "";
    try { v = String(pr.getValue()); } catch (e) { v = ""; }
    return v.length <= 1 ? "" : v;
}
/* 텍스트 값들: AE는 텍스트 속성의 textEditValue를 index 순으로, 네이티브는 Source Text 순으로 */
function MI__texts(c, kind) {
    var out = [];
    var i;
    if (kind === "ae") {
        var ps = MI__props(c);
        var n = 0;
        try { n = ps ? ps.numItems : 0; } catch (e) { n = 0; }
        for (i = 0; i < n; i++) {
            var v = "";
            try { v = String(ps[i].getValue()); } catch (e2) { continue; }
            var t = MI__textOf(v);
            if (t !== null) out.push(t);
        }
    } else if (kind === "native") {
        var nt = collectNativeTextProps(c);
        for (i = 0; i < nt.length; i++) out.push(MI__nativeVal(nt[i]));
    }
    return out;
}
/* 클립 자체의 속성 레이아웃: AE [[displayName, "t"|"o"], …] ("t" = 값에 textEditValue), 네이티브 {n}, 그 밖 null.
   패널 core clipLs(lay)가 해시한다 (옛 버전 MOGRT 클립 알아보기) */
function MI__lay(c, kind) {
    if (kind === "native") return { n: collectNativeTextProps(c).length };
    if (kind !== "ae") return null;
    var out = [];
    var ps = MI__props(c);
    var n = 0;
    try { n = ps ? ps.numItems : 0; } catch (e) { n = 0; }
    for (var i = 0; i < n; i++) {
        var dn = "";
        var v = "";
        try { dn = String(ps[i].displayName); } catch (e2) {}
        try { v = String(ps[i].getValue()); } catch (e3) {}
        out.push([dn, String(v).indexOf("\"textEditValue\"") !== -1 ? "t" : "o"]);
    }
    return out;
}
/* 효과·키프레임: {comps: 컴포넌트 수, keyed: [키가 있는 Motion/Opacity의 matchName]} */
function MI__deco(c) {
    var o = { comps: 0, keyed: [] };
    var n = 0;
    try { n = c.components.numItems; } catch (e) { return o; }
    o.comps = n;
    for (var i = 0; i < n; i++) {
        var cp = null;
        var mn = "";
        try { cp = c.components[i]; mn = String(cp.matchName); } catch (e2) { continue; }
        if (mn !== "AE.ADBE Motion" && mn !== "AE.ADBE Opacity") continue;
        var ps = null;
        var np = 0;
        try { ps = cp.properties; np = ps.numItems; } catch (e3) { continue; }
        for (var j = 0; j < np; j++) {
            var tv = false;
            try { tv = ps[j].isTimeVarying() === true; } catch (e4) { tv = false; }
            if (tv) { o.keyed.push(mn); break; }
        }
    }
    return o;
}
/* 클립의 속성 전체를 ParamDef로 (되돌리기용 'before').
   AE: getMogrtParams와 같은 규칙으로 type을 매긴다 (detectParamType, 텍스트 값이 든 그룹은 text).
       {index, type, displayName, value, rawValue}. colorHex는 넣지 않는다 → applyParamsToItem이 rawValue로
       정확히 되돌린다. boolean 값은 "true"/"false".
   네이티브: {index: 서수, type: "text", displayName: "텍스트 N", value, rawValue: "", nativeText: true} */
function MI__readParams(c, kind) {
    var out = [];
    var i;
    if (kind === "ae") {
        var ps = MI__props(c);
        var n = 0;
        try { n = ps ? ps.numItems : 0; } catch (e) { n = 0; }
        for (i = 0; i < n; i++) {
            var pr = null;
            try { pr = ps[i]; } catch (e2) { continue; }
            if (!pr) continue;
            var dn = "";
            try { dn = String(pr.displayName || ""); } catch (e3) {}
            var val = "";
            try { val = pr.getValue(); } catch (e4) { val = ""; }
            if (val === null || val === undefined) val = "";
            var sub = 0;
            try { sub = pr.numItems || 0; } catch (e5) { sub = 0; }
            var ty = detectParamType(val, dn, sub > 0, pr);
            var raw = String(val);
            if (ty === "group" && String(raw).indexOf("\"textEditValue\"") !== -1) ty = "text";
            var value = raw;
            if (ty === "text") {
                var tx = MI__textOf(raw);
                value = tx === null ? raw : tx;
            } else if (ty === "boolean") {
                value = raw.toLowerCase().replace(/^\s+|\s+$/g, "") === "true" ? "true" : "false";
            } else if (ty === "group") {
                value = "";
            }
            out.push({ index: i, type: ty, displayName: dn, value: value, rawValue: raw });
        }
    } else if (kind === "native") {
        var nt = collectNativeTextProps(c);
        for (i = 0; i < nt.length; i++) {
            out.push({ index: i, type: "text", displayName: "텍스트 " + (i + 1), value: MI__nativeVal(nt[i]), rawValue: "", nativeText: true });
        }
    }
    return out;
}
/* 클립의 프로젝트 항목 이름 (AE MOGRT = capsule 이름, S0-3 k). 네이티브는 null */
function MI__pin(c) {
    try {
        var pi = c.projectItem;
        return pi ? String(pi.name) : null;
    } catch (e) {
        return null;
    }
}
/* 클립 요약 {track, sf, ef, nodeId, name} */
function MI__brief(c, ti, ft) {
    var o = { track: ti, sf: 0, ef: 0, nodeId: "", name: "" };
    try { o.sf = MI__frameOf(MI__s(c), ft); } catch (e) {}
    try { o.ef = MI__frameOf(MI__e(c), ft); } catch (e2) {}
    try { o.nodeId = String(c.nodeId); } catch (e3) {}
    try { o.name = String(c.name); } catch (e4) {}
    return o;
}
/* 트랙의 클립 목록 [{sf, ef, nodeId, name, salt?, id?, g?}] — 시작순 (move 뒤 track.clips는 시작순이 아닐 수 있다, S0-3 r).
   loT/hiT(ticks, null이면 끝없음)와 겹치는 클립만. 시작만 먼저 읽어 창 밖은 건너뛴다 (S0-3 s) */
function MI__scanTrack(tr, ft, loT, hiT) {
    var out = [];
    var cs, n = 0;
    try { cs = tr.clips; n = cs.numItems; } catch (e) { return out; }
    for (var k = 0; k < n; k++) {
        var c = null;
        try { c = cs[k]; } catch (e1) { continue; }
        if (!c) continue;
        var s, en;
        try { s = MI__s(c); } catch (e2) { continue; }
        if (hiT !== null && s >= hiT) continue;
        try { en = MI__e(c); } catch (e3) { continue; }
        if (loT !== null && en <= loT) continue;
        var o = { sf: MI__frameOf(s, ft), ef: MI__frameOf(en, ft), nodeId: "", name: "", st: s };
        try { o.nodeId = String(c.nodeId); } catch (e4) {}
        try { o.name = String(c.name); } catch (e5) {}
        var tag = MI__parseTag(o.name);
        if (tag) {
            o.salt = tag.salt;
            o.id = tag.id;
            o.g = tag.g;
        }
        out.push(o);
    }
    out.sort(function (a, b) { return a.st - b.st; });
    for (var i = 0; i < out.length; i++) delete out[i].st;
    return out;
}

/* ══ 진입점: 읽기 (S2-1) ══ */

/* 호스트 버전·빌드와 활성 시퀀스 → {ok, v, build, prefix, seqId, seqName, isPreview, docId, frameTicks, zeroPoint, endFrame}.
   가드가 없다: 패널이 적용마다 먼저 불러 v 28과 빌드가 같은지 본다 (_miHostOk). 시퀀스가 없으면 seqId "" */
function MI_ping() {
    try {
        var o = { ok: true, v: MI_VERSION, build: MI_BUILD, prefix: "MI_", seqId: "", seqName: "", isPreview: false, docId: "", frameTicks: "", zeroPoint: "0", endFrame: 0 };
        try { o.docId = String(app.project.documentID || ""); } catch (e) {}
        var seq = null;
        try { seq = app.project.activeSequence; } catch (e2) { seq = null; }
        if (seq) {
            try { o.seqId = String(seq.sequenceID || ""); } catch (e3) {}
            try { o.seqName = String(seq.name || ""); } catch (e4) {}
            o.isPreview = o.seqName === PREVIEW_SEQ_NAME;
            var ft = MI__ft(seq);
            o.frameTicks = String(ft);
            try { o.zeroPoint = String(seq.zeroPoint); } catch (e5) {}
            try { o.endFrame = MI__frameOf(seq.end, ft); } catch (e6) {}
        }
        return MI__json(o);
    } catch (e) {
        return MI__fail("exception", MI__errText(e));
    }
}

/* 트랙 스캔 (최소 읽기: 시작·끝·nodeId·이름과 읽은 태그)
   payload {seqId, build, tracks: [트랙 번호] | null, fromFrame?, toFrame?}
   tracks가 null이면 V1(영상)을 뺀 모든 비디오 트랙. 없는 트랙 번호는 건너뛴다.
   fromFrame~toFrame과 겹치는 클립만 (없으면 트랙 전체).
   → {ok, frameTicks, numVideoTracks, tracks: [{i, locked, clips: [{sf, ef, nodeId, name, salt?, id?, g?}]}], ms} */
function MI_getTracks(payloadStr) {
    var t0 = MI__now();
    try {
        var p = MI__parse(payloadStr);
        var g = MI__guard(p);
        if (g.err) return MI__fail(g.err, g.detail);
        var seq = g.seq;
        var ft = MI__ft(seq);
        var nt = MI__numTracks(seq);
        var list = [];
        var i;
        if (p.tracks === undefined || p.tracks === null) {
            for (i = 1; i < nt; i++) list.push(i);
        } else if (MI__isArr(p.tracks)) {
            for (i = 0; i < p.tracks.length; i++) {
                var ti = p.tracks[i];
                if (!MI__isInt(ti) || ti < 0) return MI__fail("bad-payload", "tracks[" + i + "]");
                if (ti < nt && MI__idx(list, ti) === -1) list.push(ti);
            }
        } else {
            return MI__fail("bad-payload", "tracks는 배열 또는 null");
        }
        if (p.fromFrame !== undefined && p.fromFrame !== null && typeof p.fromFrame !== "number") return MI__fail("bad-payload", "fromFrame");
        if (p.toFrame !== undefined && p.toFrame !== null && typeof p.toFrame !== "number") return MI__fail("bad-payload", "toFrame");
        var loT = typeof p.fromFrame === "number" ? p.fromFrame * ft : null;
        var hiT = typeof p.toFrame === "number" ? p.toFrame * ft : null;
        var out = [];
        for (i = 0; i < list.length; i++) {
            var tr = MI__track(seq, list[i]);
            if (!tr) continue;
            out.push({ i: list[i], locked: MI__locked(tr), clips: MI__scanTrack(tr, ft, loT, hiT) });
        }
        return MI__json({ ok: true, frameTicks: String(ft), numVideoTracks: nt, tracks: out, ms: MI__now() - t0 });
    } catch (e) {
        return MI__fail("exception", MI__errText(e));
    }
}

/* 후보 클립의 무거운 읽기 (한 번에 40개까지)
   payload {seqId, build, items: [{track, nodeId}], want: {texts, lay, deco, params}} (want가 없으면 texts·lay·deco)
   → {ok, results: [{nodeId, found, track, sf, ef, name, kind, pin, texts?, lay?, deco?, params?}], ms}
   트랙마다 nodeId 표를 한 번만 만든다 */
function MI_readClipTexts(payloadStr) {
    var t0 = MI__now();
    try {
        var p = MI__parse(payloadStr);
        var g = MI__guard(p);
        if (g.err) return MI__fail(g.err, g.detail);
        var seq = g.seq;
        var ft = MI__ft(seq);
        var items = p.items;
        if (!MI__isArr(items)) return MI__fail("bad-payload", "items는 배열");
        if (items.length > MI__READ_MAX) return MI__fail("bad-payload", "items는 " + MI__READ_MAX + "개까지 (" + items.length + ")");
        var want = (p.want && typeof p.want === "object") ? p.want : { texts: true, lay: true, deco: true, params: false };
        var maps = {};
        var results = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i] || {};
            var r = { nodeId: String(it.nodeId), found: false };
            var ti = it.track;
            var tr = MI__track(seq, ti);
            if (tr) {
                if (!maps["t" + ti]) maps["t" + ti] = MI__nodeMap(tr);
                var c = maps["t" + ti]["n" + r.nodeId];
                if (c) {
                    var b = MI__brief(c, ti, ft);
                    var kind = MI__kind(c);
                    r.found = true;
                    r.track = ti;
                    r.sf = b.sf;
                    r.ef = b.ef;
                    r.name = b.name;
                    r.kind = kind;
                    r.pin = MI__pin(c);
                    if (want.texts) r.texts = MI__texts(c, kind);
                    if (want.lay) r.lay = MI__lay(c, kind);
                    if (want.deco) r.deco = MI__deco(c);
                    if (want.params) r.params = MI__readParams(c, kind);
                }
            }
            results.push(r);
        }
        return MI__json({ ok: true, results: results, ms: MI__now() - t0 });
    } catch (e) {
        return MI__fail("exception", MI__errText(e));
    }
}
/* MI:END */
