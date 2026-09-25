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

/* ── 쓰기 호스트의 순수 규칙 (S2-2) ── */

/* 배치 작업 7종 */
var MI__OPS = ["place", "update", "replace", "move", "moveRegen", "adopt", "legacyMove"];
/* 템플릿 길이 D를 모를 때(durSec 없음, 이 청크에서 아직 놓지 않음) 뒤쪽을 살피는 범위 (초).
   패널은 D를 늘 보낸다 (preset.mogrtDurSec 또는 definition.json 길이). 모르면 60초 안의 남의 클립을 tail 충돌로 본다 */
var MI__DMAX_SEC = 60;
/* 한 번에 받는 작업 수 상한 (청크 기본 8, S0-3 결정 5) */
var MI__CHUNK_MAX = 60;
/* MI_removeClips 한 번에 받는 수 상한 */
var MI__REMOVE_MAX = 200;

/* nodeId 목록 → {"n"+id: true} */
function MI__set(arr) {
    var m = {};
    if (!MI__isArr(arr)) return m;
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] !== null && arr[i] !== undefined) m["n" + String(arr[i])] = true;
    }
    return m;
}
/* 작업 하나의 형식 확인 → 문제 글자 | "" */
function MI__checkItem(it) {
    if (!it || typeof it !== "object" || MI__isArr(it)) return "item이 객체가 아니다";
    if (typeof it.key !== "string" || !it.key) return "key";
    if (MI__idx(MI__OPS, it.op) === -1) return "op: " + it.op;
    if (!MI__isInt(it.track) || it.track < 0) return "track";
    var timed = it.op !== "update" && it.op !== "adopt" ? true : !it.keepTime;
    if (timed) {
        if (!MI__isInt(it.sf) || it.sf < 0) return "sf";
        if (!MI__isInt(it.ef) || it.ef <= it.sf) return "ef";
    }
    if (it.op === "place" || it.op === "replace" || it.op === "moveRegen" || it.op === "legacyMove") {
        if (typeof it.mogrtPath !== "string" || !it.mogrtPath) return "mogrtPath";
    }
    var o = it.own;
    if (o !== undefined && o !== null) {
        if (typeof o !== "object" || !MI__isInt(o.track) || o.track < 0 || o.nodeId === undefined || o.nodeId === null || String(o.nodeId) === "") return "own";
    }
    var ra = it.removeAfter;
    if (ra !== undefined && ra !== null) {
        if (typeof ra !== "object" || !MI__isInt(ra.track) || ra.track < 0 || ra.nodeId === undefined || ra.nodeId === null || String(ra.nodeId) === "") return "removeAfter";
    }
    if (it.op === "legacyMove") {
        if (!o && !ra) return "legacyMove에는 own이나 removeAfter가 있어야 한다";
    } else if (it.op !== "place" && !o) {
        return "own";
    }
    if (it.params !== undefined && it.params !== null && !MI__isArr(it.params)) return "params";
    if (it.name !== undefined && it.name !== null && typeof it.name !== "string") return "name";
    if (it.guard !== undefined && it.guard !== null && !MI__isArr(it.guard)) return "guard";
    return "";
}
/* 놓을 자리 확인 (순수). list = 트랙의 클립 [{id, s, e}] (ticks), [sfT, efT)에 놓고 [sfT, hiT)까지 덮인다 (hiT = sf + max(ef−sf, D)).
   skip: 치울 클립(own·removeAfter, {"n"+id: true}), guard: 머리를 되돌릴 이웃 (우리 클립만 — 남의 클립은 늘 충돌이다).
   noTail: 옮기기(move)처럼 아무것도 덮어쓰지 않는 경우 — 안쪽에서 시작하는 클립은 끝만 맞추고 뒤쪽은 보지 않는다.
   → {conflict: null | {reason: "occupied"|"tail", id}, efT(맞춘 끝), clamped, guards: [list 항목]}
     - 시작 프레임을 덮고 있는 클립(시작 ≤ sf, 끝이 반 프레임 넘게 안쪽): occupied
     - (sf, ef) 안에서 시작: 이웃이면 끝을 그 시작에 맞춘다(clamped), 아니면 occupied
     - [ef, hi)에서 시작: 이웃이면 guards, 아니면 tail (놓으면 머리가 잘리거나 지워진다)
     - 맞춘 길이가 한 프레임보다 짧으면 occupied */
function MI__occupy(list, sfT, efT, hiT, ft, skip, guard, noTail) {
    var res = { conflict: null, efT: efT, clamped: false, guards: [] };
    var xs = [];
    var i;
    for (i = 0; i < list.length; i++) xs.push(list[i]);
    xs.sort(function (a, b) { return a.s - b.s; });
    for (i = 0; i < xs.length; i++) {
        var x = xs[i];
        if (skip && skip["n" + x.id]) continue;
        if (x.e <= sfT || x.s >= hiT) continue;
        var isG = guard && guard["n" + x.id] === true;
        if (x.s <= sfT) {
            if (x.e > sfT + ft / 2) {
                res.conflict = { reason: "occupied", id: x.id };
                return res;
            }
            continue;
        }
        if (x.s < res.efT) {
            if (noTail || isG) {
                res.efT = x.s;
                res.clamped = true;
                if (!noTail) res.guards.push(x);
                continue;
            }
            res.conflict = { reason: "occupied", id: x.id };
            return res;
        }
        if (noTail) continue;
        if (isG) {
            res.guards.push(x);
        } else {
            res.conflict = { reason: "tail", id: x.id };
            return res;
        }
    }
    if (res.efT - sfT < ft) res.conflict = { reason: "occupied", id: "" };
    return res;
}
/* fromT 뒤(초과)에서 시작하는 첫 클립의 시작 (skip 제외, 없으면 null) — 제자리 갱신의 끝 맞추기 */
function MI__nextStart(list, fromT, skip) {
    var best = null;
    for (var i = 0; i < list.length; i++) {
        var x = list[i];
        if (skip && skip["n" + x.id]) continue;
        if (x.s > fromT && (best === null || x.s < best)) best = x.s;
    }
    return best;
}
/* 작업 key(uid "salt-id")의 salt, 아니면 "" (태그 없는 레거시 작업의 key 등) */
function MI__saltOf(key) {
    var m = /^([a-z0-9]{4})-\d+$/.exec(String(key === null || key === undefined ? "" : key));
    return m ? m[1] : "";
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
/* 속성 값 글자가 텍스트 JSON이면 textEditValue (읽지 못하면 ""), 텍스트가 아니면 null.
   v27 JSON 폴리필 stringify는 U+2028/2029를 이스케이프하지 않아 applyParamsToItem이 쓴 값에 날 글자로 남는데,
   eval 폴리필 parse는 문자열 속 날 U+2028을 문법 오류로 본다 (S0-3 h). JSON에서 두 글자는 문자열 안에만 올 수 있으므로
   JSON 유니코드 이스케이프(MI__esc)로 바꿔 읽는다 */
function MI__textOf(raw) {
    var s = String(raw);
    if (String(s).indexOf("\"textEditValue\"") === -1) return null;
    var o = parsePayload(s.replace(new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g"), MI__esc));
    if (o && o.textEditValue !== undefined && o.textEditValue !== null) return String(o.textEditValue);
    return "";
}
/* 네이티브 Source Text 값: 한 글자 이하(쓰기 전 헤더 한 글자, S0-3 w)는 빈 값 */
function MI__nativeVal(pr) {
    var v = "";
    try { v = String(pr.getValue()); } catch (e) { v = ""; }
    return v.length <= 1 ? "" : v;
}
/* 텍스트 값들: AE는 텍스트 속성의 textEditValue를 index 순으로, 네이티브는 Source Text 순으로.
   네이티브는 구운 클립·기본값 클립 모두 한 글자 헤더만 읽혀 늘 ""이다 (S0-3 w) — rh·문장으로 맞추기(adopt)에 쓸 수 없다.
   패널은 네이티브 줄의 문구를 되읽기가 아니라 자기가 구운 문구로 기록한다 */
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
            /* 64비트 ARGB 색상은 2^56 이상이다. v27 detectParamType은 이름(한글이 분해형이면 못 찾는다)이나
               알파 1 범위(2^56 ~ 2^56+2^48)로만 알아봐서, v27이 알파 255로 쓴 색은 number가 된다(2026-09-25 실측) */
            if (ty === "number" || ty === "angle") {
                var numv = parseFloat(raw);
                if (!isNaN(numv) && numv >= 72057594037927936) ty = "color";
            }
            var value = raw;
            if (ty === "text") {
                var tx = MI__textOf(raw);
                value = tx === null ? raw : tx;
            } else if (ty === "boolean") {
                value = raw.toLowerCase().replace(/^\s+|\s+$/g, "") === "true" ? "true" : "false";
            } else if (ty === "group") {
                value = "";
            }
            var entry = { index: i, type: ty, displayName: dn, value: value, rawValue: raw };
            /* 색상: 64비트 raw는 double로 읽혀 정밀도가 깎이고, 그 값을 다시 쓰면 0이 된다(2026-09-25 실측).
               getColorValue()의 [a, r, g, b]를 함께 두고 되쓸 때 setColorValue로 정확히 되돌린다 */
            if (ty === "color") {
                try {
                    var ca = pr.getColorValue();
                    if (ca && ca.length >= 4) entry.colorArgb = [Number(ca[0]), Number(ca[1]), Number(ca[2]), Number(ca[3])];
                } catch (e6) {}
            }
            out.push(entry);
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

/* ══ 쓰기 헬퍼 (S2-2) ══ */

/* 청크 하나의 작업 맥락 (한 번의 MI_placeChunk 호출 안에서만 산다) */
function MI__ctx(seq, ft) {
    return { seq: seq, ft: ft, maps: {}, tags: {}, cache: {}, dur: {}, comps: {}, damaged: [] };
}
/* 트랙 ti의 nodeId 표 (청크 안에서 다시 쓰고, 트랙을 바꾸면 MI__dirty로 버린다) */
function MI__cmap(ctx, ti) {
    var k = "t" + ti;
    if (!ctx.maps[k]) {
        var tr = MI__track(ctx.seq, ti);
        ctx.maps[k] = tr ? MI__nodeMap(tr) : {};
    }
    return ctx.maps[k];
}
/* 트랙의 클립이 늘거나 줄거나 움직였다 → nodeId 표를 버린다 (TrackItem 참조는 다시 찾는다) */
function MI__dirty(ctx, ti) {
    if (ti === undefined || ti === null) {
        ctx.maps = {};
        return;
    }
    delete ctx.maps["t" + ti];
}
function MI__find(ctx, ti, id) {
    return MI__cmap(ctx, ti)["n" + String(id)] || null;
}
/* 트랙 ti의 태그 색인 (청크 첫 루프에서 한 번): [{id, sf, uid, g}]. 자르기로 같은 태그가 둘인지 보는 데 쓴다 */
function MI__tagIndex(ctx, ti) {
    var k = "t" + ti;
    if (ctx.tags[k]) return ctx.tags[k];
    var out = [];
    var tr = MI__track(ctx.seq, ti);
    var cs, n = 0;
    try { cs = tr.clips; n = cs.numItems; } catch (e) { n = 0; }
    for (var i = 0; i < n; i++) {
        var c = null;
        try { c = cs[i]; } catch (e1) { continue; }
        if (!c) continue;
        var tg = null;
        try { tg = MI__parseTag(String(c.name)); } catch (e2) { tg = null; }
        if (!tg) continue;
        var o = { id: "", sf: 0, uid: tg.salt + "-" + tg.id, g: tg.g };
        try { o.id = String(c.nodeId); o.sf = MI__frameOf(MI__s(c), ctx.ft); } catch (e3) { continue; }
        out.push(o);
    }
    ctx.tags[k] = out;
    return out;
}
/* 트랙의 클립 중 [loT, hiT)와 겹치는 것 [{c, id, s, e}] (시작순). 시작만 먼저 읽어 창 밖은 건너뛴다 */
function MI__win(tr, loT, hiT) {
    var out = [];
    var cs, n = 0;
    try { cs = tr.clips; n = cs.numItems; } catch (e) { return out; }
    for (var k = 0; k < n; k++) {
        var c = null;
        try { c = cs[k]; } catch (e1) { continue; }
        if (!c) continue;
        var s, en;
        try { s = MI__s(c); } catch (e2) { continue; }
        if (s >= hiT) continue;
        try { en = MI__e(c); } catch (e3) { continue; }
        if (en <= loT) continue;
        var id = "";
        try { id = String(c.nodeId); } catch (e4) {}
        out.push({ c: c, id: id, s: s, e: en });
    }
    out.sort(function (a, b) { return a.s - b.s; });
    return out;
}
/* 트랙의 모든 nodeId {"n"+id: true} (새로 놓인 클립을 차집합으로 찾는다) */
function MI__idSet(tr) {
    var m = {};
    var cs, n = 0;
    try { cs = tr.clips; n = cs.numItems; } catch (e) { return m; }
    for (var k = 0; k < n; k++) {
        try { m["n" + String(cs[k].nodeId)] = true; } catch (e1) {}
    }
    return m;
}
/* ids0에 없고 시작이 sf ±1 프레임인 클립들 (overwriteClip은 클립을 돌려주지 않는다) */
function MI__newClips(tr, ids0, sf, ft) {
    var out = [];
    var cs, n = 0;
    try { cs = tr.clips; n = cs.numItems; } catch (e) { return out; }
    for (var k = 0; k < n; k++) {
        var c = null;
        var id = "";
        try { c = cs[k]; id = String(c.nodeId); } catch (e1) { continue; }
        if (ids0["n" + id]) continue;
        var f = 0;
        try { f = MI__frameOf(MI__s(c), ft); } catch (e2) { continue; }
        if (Math.abs(f - sf) <= 1) out.push(c);
    }
    return out;
}
/* 이름 쓰기 → 되읽어 같으면 true (spike #1: TrackItem.name은 저장·재시작 뒤에도 남는다) */
function MI__setName(c, name) {
    try { c.name = name; } catch (e) { return false; }
    var now = "";
    try { now = String(c.name); } catch (e2) { return false; }
    return now === name;
}
/* 속성 이름을 확인하고 쓴다 (index 쓰기의 위험을 막는다: 재저장된 MOGRT의 옛 구조 클립, S0-3 x·결정 16).
   → {written, skipped: [이름], keyed: [이름]}
   AE: props[p.index]의 displayName과 텍스트 여부가 p와 같을 때만 그 자리에 쓴다. 아니면 목록 안에서 같은 이름·같은
       텍스트 여부인 param 가운데 k번째(k = 그 param들 사이의 index 순서)와 같은 순서의 속성에 쓴다. 그것도 없으면 skipped.
       같은 이름·텍스트 여부인 param이 목록에 둘 이상이면 index 일치는 보지 않고 순서로만 맞춘다(k번째 param → k번째 속성,
       k = 묶음 안 index 순서): index가 밀린 옛 구조에서 index 일치와 순서 맞추기를 섞으면 두 param이 한 속성에 몰려 하나가
       빠지거나 서로 바뀐다.
       isTimeVarying(키프레임)인 속성은 keyed로 두고 쓰지 않는다 (setValue가 true를 돌려주고 조용히 무시된다, spike #8·S0-3 g).
       확인한 목록(index를 고친 사본)을 v27 applyParamsToItem에 한 번에 넘긴다. group·textsetting은 쓰지 않는다(v27과 같다).
   네이티브: Source Text에는 절대 쓰지 않는다 — 스크립트로 쓴 글자는 빈 글자로 렌더된다 (S0-3 §3-1a). 문구는 구운 .mogrt로
       놓고, 문구가 바뀌면 패널이 replace로 계획한다 (S1-11).
       fresh(이 호출에서 구운 경로로 새로 놓은 클립: place·replace·moveRegen·legacyMove)면 nativeText param은 템플릿에 이미
       들어 있다고 보고 쓰지도 skipped에 넣지도 않는다 — 되읽기로는 확인할 수 없다 (S0-3 w: Source Text는 한 글자 헤더 → "").
       기존 클립(update·adopt·move)에서는 지금 값과 같은 param은 건너뛰고(쓸 것 없음), 다른 값은 skipped(partial).
   그 밖(영상 등): 모두 skipped */
function MI__applyParamsSafe(c, kind, params, fresh) {
    var res = { written: 0, skipped: [], keyed: [] };
    if (!MI__isArr(params) || !params.length) return res;
    var i, j, p, ty, dn;
    if (kind === "ae") {
        var ps = MI__props(c);
        var n = 0;
        try { n = ps ? ps.numItems : 0; } catch (e) { n = 0; }
        var info = [];
        for (i = 0; i < n; i++) {
            var pr = null;
            var pdn = "";
            var pv = "";
            try { pr = ps[i]; pdn = String(pr.displayName); } catch (e1) {}
            try { pv = String(pr.getValue()); } catch (e2) {}
            info.push({ pr: pr, dn: pdn, t: String(pv).indexOf("\"textEditValue\"") !== -1 });
        }
        /* 같은 이름·텍스트 여부인 param 묶음과 묶음 안 순서 k (index 순, 같거나 없으면 목록 순) */
        var grp = {};
        for (i = 0; i < params.length; i++) {
            p = params[i];
            if (!p || typeof p !== "object") continue;
            ty = String(p.type || "").toLowerCase();
            if (ty === "group" || ty === "textsetting") continue;
            dn = String(p.displayName === undefined || p.displayName === null ? "" : p.displayName);
            var mk = (ty === "text" ? "t|" : "o|") + dn;
            if (!grp[mk]) grp[mk] = [];
            grp[mk].push(i);
        }
        var rank = {};
        var byIndex = function (a, b) {
            var ia = MI__isInt(params[a].index) ? params[a].index : 1e9 + a;
            var ib = MI__isInt(params[b].index) ? params[b].index : 1e9 + b;
            return ia !== ib ? ia - ib : a - b;
        };
        for (var gk in grp) {
            if (!Object.prototype.hasOwnProperty.call(grp, gk)) continue;
            grp[gk].sort(byIndex);
            for (j = 0; j < grp[gk].length; j++) rank["i" + grp[gk][j]] = j;
        }
        var used = {};
        var list = [];
        var directWritten = 0;
        for (i = 0; i < params.length; i++) {
            p = params[i];
            if (!p || typeof p !== "object") continue;
            ty = String(p.type || "").toLowerCase();
            if (ty === "group" || ty === "textsetting") continue;
            dn = String(p.displayName === undefined || p.displayName === null ? "" : p.displayName);
            var wantT = ty === "text";
            var sk = (wantT ? "t|" : "o|") + dn;
            var ord = rank["i" + i];
            var idx = -1;
            if (grp[sk].length === 1 && MI__isInt(p.index) && p.index >= 0 && p.index < n && info[p.index].dn === dn && info[p.index].t === wantT) {
                idx = p.index;
            } else {
                var cnt = 0;
                for (j = 0; j < n; j++) {
                    if (info[j].dn === dn && info[j].t === wantT) {
                        if (cnt === ord) { idx = j; break; }
                        cnt++;
                    }
                }
            }
            if (idx === -1 || used["i" + idx]) {
                res.skipped.push(dn);
                continue;
            }
            var tv = false;
            try { tv = info[idx].pr.isTimeVarying() === true; } catch (e3) { tv = false; }
            if (tv) {
                res.keyed.push(dn);
                continue;
            }
            used["i" + idx] = true;
            /* 되읽은 색상(colorArgb, MI__readParams)은 setColorValue로 알파까지 그대로 되쓴다.
               v27은 colorHex(알파 255) 또는 raw double을 쓰는데, 64비트 raw는 0이 된다 */
            if (ty === "color" && MI__isArr(p.colorArgb) && p.colorArgb.length >= 4) {
                var cw = false;
                try { info[idx].pr.setColorValue(Number(p.colorArgb[0]), Number(p.colorArgb[1]), Number(p.colorArgb[2]), Number(p.colorArgb[3]), 1); cw = true; } catch (e5) {}
                if (!cw) {
                    try { info[idx].pr.setColorValue(Number(p.colorArgb[0]), Number(p.colorArgb[1]), Number(p.colorArgb[2]), Number(p.colorArgb[3])); cw = true; } catch (e6) {}
                }
                if (cw) { directWritten++; continue; }
            }
            var q = {};
            for (var f in p) {
                if (Object.prototype.hasOwnProperty.call(p, f)) q[f] = p[f];
            }
            q.index = idx;
            list.push(q);
        }
        if (list.length) {
            try { applyParamsToItem(c, list); } catch (e4) { res.error = MI__errText(e4); }
        }
        res.written = list.length + directWritten;
    } else if (kind === "native") {
        var nt = collectNativeTextProps(c);
        for (i = 0; i < params.length; i++) {
            p = params[i];
            if (!p || typeof p !== "object" || String(p.type || "").toLowerCase() !== "text") continue;
            if (fresh === true && p.nativeText === true) continue;
            var k = MI__isInt(p.index) ? p.index : -1;
            dn = String(p.displayName || ("텍스트 " + (k + 1)));
            var want = String(p.value === undefined || p.value === null ? "" : p.value);
            if (k >= 0 && k < nt.length && MI__nativeVal(nt[k]) === want) continue;
            res.skipped.push(dn);
        }
    } else {
        for (i = 0; i < params.length; i++) {
            p = params[i];
            if (!p || typeof p !== "object") continue;
            ty = String(p.type || "").toLowerCase();
            if (ty === "group" || ty === "textsetting") continue;
            res.skipped.push(String(p.displayName || ""));
        }
    }
    return res;
}
/* 되읽기: nodeId, 트랙·프레임, 이름, 종류, texts, lay, pin (withDeco면 deco) → r에 채운다 */
function MI__readback(r, c, ti, ft, withDeco) {
    var kind = MI__kind(c);
    var b = MI__brief(c, ti, ft);
    r.nodeId = b.nodeId;
    r.track = ti;
    r.sf = b.sf;
    r.ef = b.ef;
    r.name = b.name;
    r.kind = kind;
    r.texts = MI__texts(c, kind);
    r.lay = MI__lay(c, kind);
    r.pin = MI__pin(c);
    if (withDeco) r.deco = MI__deco(c);
    return kind;
}
/* 되돌리기용 'before' 스냅숏 {track, sf, ef, g, name, kind, m, pi, params} (m은 패널이 아는 템플릿 경로 own.m) */
function MI__snapOf(c, ti, ft, m) {
    var b = MI__brief(c, ti, ft);
    var kind = MI__kind(c);
    var tg = MI__parseTag(b.name);
    var pi = null;
    try { pi = c.projectItem; } catch (e) { pi = null; }
    var piId = null;
    try { piId = pi ? String(pi.nodeId) : null; } catch (e2) { piId = null; }
    return { track: ti, sf: b.sf, ef: b.ef, g: tg ? tg.g : null, name: b.name, kind: kind, m: m ? String(m) : null, pi: piId, params: MI__readParams(c, kind) };
}

/* ── 새로 놓기: 자리 확인 → 이웃 스냅숏 → importMGT/overwriteClip → 끝 → 이웃 머리 되돌리기 ── */

/* 자리 계획. spec {ti, sf, ef, endT?(정확한 끝 ticks), path, pi?(덮어 놓을 projectItem), durSec, guard, skip, salt?}
   salt가 있으면 그 salt로 태그된 클립(이 목록의 클립)도 이웃으로 본다 — 옛 템플릿 되놓기만 쓴다 (MI__restoreOld)
   → {conflict} | {ti, sf, efT, clamped, path, pi, guards} */
function MI__planPut(ctx, spec) {
    var ft = ctx.ft;
    var tr = MI__track(ctx.seq, spec.ti);
    if (!tr) return { fail: "no-track" };
    var dF = null;
    if (typeof spec.durSec === "number" && spec.durSec > 0) {
        dF = Math.round(spec.durSec * MI__TPS / ft);
    } else if (spec.path && ctx.dur["p" + spec.path] !== undefined) {
        dF = Math.round(ctx.dur["p" + spec.path] * MI__TPS / ft);
    }
    var span = spec.ef - spec.sf;
    var reach = dF !== null ? dF : Math.round(MI__DMAX_SEC * MI__TPS / ft);
    if (reach > span) span = reach;
    var sfT = spec.sf * ft;
    var efT = typeof spec.endT === "number" ? spec.endT : spec.ef * ft;
    var hiT = (spec.sf + span) * ft;
    if (efT > hiT) hiT = efT;
    var win = MI__win(tr, sfT, hiT);
    var guard = spec.guard || {};
    if (spec.salt) {
        var g2 = {};
        for (var gk in guard) {
            if (Object.prototype.hasOwnProperty.call(guard, gk)) g2[gk] = guard[gk];
        }
        for (var wi = 0; wi < win.length; wi++) {
            var wt = null;
            try { wt = MI__parseTag(String(win[wi].c.name)); } catch (e) { wt = null; }
            if (wt && wt.salt === spec.salt) g2["n" + win[wi].id] = true;
        }
        guard = g2;
    }
    var oc = MI__occupy(win, sfT, efT, hiT, ft, spec.skip || {}, guard, false);
    if (oc.conflict) return { conflict: oc.conflict, durKnown: dF !== null };
    return { ti: spec.ti, sf: spec.sf, efT: oc.efT, clamped: oc.clamped, path: spec.path || "", pi: spec.pi || null, guards: oc.guards };
}
/* 클립 하나를 트랙 ti의 sf에 놓는다 → {clip, how} | {status, reason, detail}.
   pi(또는 이 청크에서 캐시한 projectItem)가 있으면 overwriteClip으로 놓고 nodeId 차집합(sf ±1)으로 찾는다.
   캐시로 처음 놓은 클립의 lay가 importMGT 클립과 다르면(같은 capsule로 재저장된 MOGRT는 overwriteClip이 옛 구조를 놓는다,
   S0-3 x ③) 그 클립을 지우고 캐시를 끈다. 못 찾거나 예외면 캐시를 끄고 importMGT로 간다 (S0-3 결정 13).
   importMGT가 돌려준 클립이 이 트랙에 없으면(트랙 번호 ≥ 트랙 수면 마지막 트랙에 놓인다, #14) 지우고 misplaced */
function MI__put(ctx, ti, sf, path, pi) {
    var seq = ctx.seq;
    var ft = ctx.ft;
    var tr = MI__track(seq, ti);
    if (!tr) return { status: "failed", reason: "no-track" };
    var ids0 = MI__idSet(tr);
    var ck = path ? "p" + path : "";
    var cache = ck && ctx.cache[ck] ? ctx.cache[ck] : null;
    var usePi = pi || (cache && !cache.off ? cache.pi : null);
    if (usePi) {
        var ok = false;
        try { ok = seq.overwriteClip(usePi, MI__at(sf, ft), ti, 0); } catch (e) { ok = false; }
        MI__dirty(ctx, ti);
        var found = ok === false ? [] : MI__newClips(MI__track(seq, ti), ids0, sf, ft);
        if (found.length === 1) {
            var nc = found[0];
            if (!pi && cache && !cache.verified) {
                if (MI__json(MI__lay(nc, MI__kind(nc))) !== cache.lay) {
                    try { nc.remove(false, false); } catch (e2) {}
                    MI__dirty(ctx, ti);
                    cache.off = true;
                } else {
                    cache.verified = true;
                    return { clip: nc, how: "overwrite" };
                }
            } else {
                return { clip: nc, how: "overwrite" };
            }
        } else {
            if (cache && !pi) cache.off = true;
            if (found.length > 1) return { status: "failed", reason: "import-null", detail: "overwriteClip 뒤 새 클립 " + found.length + "개" };
        }
    }
    if (!path) return { status: "failed", reason: "import-null", detail: "템플릿 경로 없음" };
    var c = null;
    try { c = seq.importMGT(path, MI__ticks(sf, ft), ti, 0); } catch (e3) { return { status: "failed", reason: "import-null", detail: MI__errText(e3) }; }
    MI__dirty(ctx);
    if (!c) return { status: "failed", reason: "import-null", detail: path };
    var id = "";
    try { id = String(c.nodeId); } catch (e4) { id = ""; }
    var got = id && !ids0["n" + id] ? MI__find(ctx, ti, id) : null;
    var gf = null;
    try { gf = got ? MI__frameOf(MI__s(got), ft) : null; } catch (e5) { gf = null; }
    if (!got || gf === null || Math.abs(gf - sf) > 1) {
        try { c.remove(false, false); } catch (e6) {}
        MI__dirty(ctx);
        return { status: "misplaced", reason: "misplaced", detail: "nodeId " + id + (gf === null ? " 다른 트랙" : " 시작 " + gf + "f") };
    }
    if (ck && !ctx.cache[ck]) {
        var gpi = null;
        try { gpi = got.projectItem; } catch (e7) { gpi = null; }
        if (gpi) ctx.cache[ck] = { pi: gpi, lay: MI__json(MI__lay(got, MI__kind(got))), verified: false, off: false };
    }
    return { clip: got, how: "import" };
}
/* 계획대로 놓는다: 이웃 스냅숏 → 놓기 → D·컴포넌트 수 기록(경로마다 처음 한 번) → 끝을 efT로 → 이웃 머리 되돌리기(분기 R).
   → {clip, efT, clamped, how} | {status, reason, detail}. 되돌리지 못한 이웃은 ctx.damaged (패널이 그 줄을 다시 놓는다, 분기 C) */
function MI__doPut(ctx, plan) {
    var snaps = [];
    var i;
    for (i = 0; i < plan.guards.length; i++) {
        var gx = plan.guards[i];
        var inT = null;
        try { inT = Number(gx.c.inPoint.ticks); } catch (e) { inT = null; }
        snaps.push({ id: gx.id, s: gx.s, e: gx.e, inT: inT });
    }
    var put = MI__put(ctx, plan.ti, plan.sf, plan.path, plan.pi);
    if (!put.clip) return put;
    var c = put.clip;
    if (plan.path && ctx.dur["p" + plan.path] === undefined) {
        var dT = 0;
        try { dT = MI__e(c) - MI__s(c); } catch (e2) { dT = 0; }
        if (dT > 0) {
            ctx.dur["p" + plan.path] = dT / MI__TPS;
            var nComp = 0;
            try { nComp = c.components.numItems; } catch (e3) { nComp = 0; }
            ctx.comps["p" + plan.path] = nComp;
        }
    }
    try { c.end = MI__T(plan.efT); } catch (e4) {}
    MI__dirty(ctx, plan.ti);
    MI__restoreGuards(ctx, plan.ti, snaps);
    var id = "";
    try { id = String(c.nodeId); } catch (e5) {}
    var again = MI__find(ctx, plan.ti, id);
    return { clip: again || c, efT: plan.efT, clamped: plan.clamped, how: put.how };
}
/* 잘린 이웃의 머리를 되돌린다 (S0-3 결정 1: inPoint −= Δ 다음 start −= Δ, 다시 읽어 start·end·inPoint 확인).
   지워졌거나(통째로 덮임) 되돌리지 못한 이웃은 ctx.damaged에 넣는다 */
function MI__restoreGuards(ctx, ti, snaps) {
    if (!snaps.length) return;
    MI__dirty(ctx, ti);
    for (var i = 0; i < snaps.length; i++) {
        var g = snaps[i];
        var c = MI__find(ctx, ti, g.id);
        if (!c) {
            MI__damage(ctx, g.id);
            continue;
        }
        var s = 0;
        var e = 0;
        try { s = MI__s(c); e = MI__e(c); } catch (e1) { MI__damage(ctx, g.id); continue; }
        if (s === g.s && e === g.e) continue;
        if (e !== g.e || s < g.s) {
            MI__damage(ctx, g.id);
            continue;
        }
        var d = s - g.s;
        try {
            var inNow = Number(c.inPoint.ticks);
            c.inPoint = MI__T(inNow - d);
            c.start = MI__T(g.s);
        } catch (e2) {}
        var s2 = 0;
        var e2b = 0;
        var in2 = null;
        try { s2 = MI__s(c); e2b = MI__e(c); in2 = Number(c.inPoint.ticks); } catch (e3) {}
        if (s2 !== g.s || e2b !== g.e || (g.inT !== null && in2 !== g.inT)) MI__damage(ctx, g.id);
    }
    MI__dirty(ctx, ti);
}
function MI__damage(ctx, id) {
    if (MI__idx(ctx.damaged, id) === -1) ctx.damaged.push(id);
}
/* nodeId로 지운다 → "removed" | "gone"(이미 없음) | "left"(지웠는데 남음) */
function MI__removeNode(ctx, ti, id) {
    var c = MI__find(ctx, ti, id);
    if (!c) return "gone";
    var ok = false;
    try { ok = c.remove(false, false); } catch (e) { ok = false; }
    MI__dirty(ctx, ti);
    if (ok === false) return MI__find(ctx, ti, id) ? "left" : "gone";
    return MI__find(ctx, ti, id) ? "left" : "removed";
}
/* 작업이 실패했을 때 건드린 클립을 원래 자리 [s0, e0)로 되돌린다: 시작이 다르면 move(s0 − 지금 시작), 그다음 end = e0.
   되읽어 다르면 ctx.damaged (패널이 그 줄을 다시 놓는다, 분기 C) → true | false */
function MI__putBack(ctx, ti, id, s0, e0) {
    MI__dirty(ctx, ti);
    var c = MI__find(ctx, ti, id);
    if (!c) {
        MI__damage(ctx, id);
        return false;
    }
    var s = null;
    try { s = MI__s(c); } catch (e) { s = null; }
    if (s !== null && s !== s0) {
        try { c.move(MI__T(s0 - s)); } catch (e1) {}
        MI__dirty(ctx, ti);
        c = MI__find(ctx, ti, id) || c;
    }
    try { c.end = MI__T(e0); } catch (e2) {}
    var s2 = null;
    var e2v = null;
    try { s2 = MI__s(c); e2v = MI__e(c); } catch (e3) {}
    if (s2 !== s0 || e2v !== e0) {
        MI__damage(ctx, id);
        return false;
    }
    return true;
}
/* 같은 트랙의 옛 클립(ids)이 sfT를 걸치면(시작 < sfT < 끝) 끝을 sfT로 줄인다 → [{id, s, e}](되돌리기용) | null.
   걸친 채로 새 클립을 놓으면 overwrite가 옛 클립을 둘로 자르고, 뒤 조각은 새 nodeId·같은 이름(같은 태그)으로 남아
   nodeId로 지워지지 않는다 (#1b). 줄이지 못한 클립이 있으면 줄인 것을 되돌리고 null */
function MI__trimOld(ctx, ti, ids, sfT) {
    var out = [];
    var i;
    for (i = 0; i < ids.length; i++) {
        var c = MI__find(ctx, ti, ids[i]);
        if (!c) continue;
        var s = 0;
        var e = 0;
        try { s = MI__s(c); e = MI__e(c); } catch (e1) { continue; }
        if (!(s < sfT && e > sfT)) continue;
        try { c.end = MI__T(sfT); } catch (e2) {}
        out.push({ id: ids[i], s: s, e: e });
        var e2v = null;
        try { e2v = MI__e(c); } catch (e3) { e2v = null; }
        if (e2v === null || e2v > sfT) {
            for (var k = 0; k < out.length; k++) MI__putBack(ctx, ti, out[k].id, out[k].s, out[k].e);
            return null;
        }
    }
    if (out.length) MI__dirty(ctx, ti);
    return out;
}

/* ── 작업 실행 ── */

/* 결과 틀 */
function MI__res(it) {
    return {
        key: it && typeof it.key === "string" ? it.key : "",
        status: "",
        track: it && MI__isInt(it.track) ? it.track : null,
        sf: it && MI__isInt(it.sf) ? it.sf : null,
        ef: it && MI__isInt(it.ef) ? it.ef : null,
        g: it && MI__isInt(it.g) ? it.g : null,
        nodeId: "",
        clamped: false,
        reason: "",
        skipped: [],
        keyed: [],
        before: null,
        motion: "none"
    };
}
/* 첫 루프: 작업이 건드리는 기존 클립을 찾고 'before'를 읽는다 (어떤 작업보다 먼저, spec placement 14 e).
   own을 nodeId로 찾는다. 없으면(태그 클립만) own.track에서 key(uid)와 sf ±1인 태그 클립: 하나면 그것, 둘 이상이면 ambiguous, 없으면 stale-plan.
   찾은 클립과 같은 태그(uid·gen)의 클립이 트랙에 둘 이상이면(자르기, spike #1b) ambiguous.
   own.sf와 1프레임 넘게 다르면(계획 뒤에 옮겨졌다) stale-plan.
   → {status?, reason?, ti, id, kind, before, pi(projectItem 참조, replace 되돌리기용), sT, eT, raTi, raId} */
function MI__locate(ctx, it) {
    var pr = { status: "", reason: "", detail: "", ti: -1, id: "", kind: "", before: null, pi: null, sT: 0, eT: 0, raTi: -1, raId: "" };
    var bad = MI__checkItem(it);
    if (bad) {
        pr.status = "failed";
        pr.reason = "bad-item";
        pr.detail = bad;
        return pr;
    }
    if (it.removeAfter) {
        pr.raTi = it.removeAfter.track;
        pr.raId = String(it.removeAfter.nodeId);
    }
    if (it.op === "place") return pr;
    var o = it.own ? it.own : it.removeAfter;
    var ft = ctx.ft;
    if (!MI__track(ctx.seq, o.track)) {
        pr.status = "stale-plan";
        pr.reason = "no-track";
        return pr;
    }
    var c = MI__find(ctx, o.track, o.nodeId);
    var i;
    if (c) {
        var tg = null;
        try { tg = MI__parseTag(String(c.name)); } catch (e) { tg = null; }
        if (tg) {
            var ix = MI__tagIndex(ctx, o.track);
            var same = 0;
            for (i = 0; i < ix.length; i++) {
                if (ix[i].uid === tg.salt + "-" + tg.id && ix[i].g === tg.g) same++;
            }
            if (same > 1) {
                pr.status = "ambiguous";
                pr.detail = "같은 태그 클립 " + same + "개";
                return pr;
            }
        }
        var cf = null;
        try { cf = MI__frameOf(MI__s(c), ft); } catch (e2) { cf = null; }
        if (MI__isInt(o.sf) && (cf === null || Math.abs(cf - o.sf) > 1)) {
            pr.status = "stale-plan";
            pr.reason = "moved";
            pr.detail = "시작 " + cf + "f (계획 " + o.sf + "f)";
            return pr;
        }
    } else {
        if (it.own && it.name !== undefined && it.name !== null && MI__isInt(o.sf)) {
            var tix = MI__tagIndex(ctx, o.track);
            var hits = [];
            for (i = 0; i < tix.length; i++) {
                if (tix[i].uid === it.key && Math.abs(tix[i].sf - o.sf) <= 1) hits.push(tix[i]);
            }
            if (hits.length > 1) {
                pr.status = "ambiguous";
                pr.detail = "같은 태그 클립 " + hits.length + "개";
                return pr;
            }
            if (hits.length === 1) c = MI__find(ctx, o.track, hits[0].id);
        }
        if (!c) {
            pr.status = "stale-plan";
            pr.reason = "not-found";
            pr.detail = "nodeId " + o.nodeId;
            return pr;
        }
    }
    pr.ti = o.track;
    pr.id = String(c.nodeId);
    pr.kind = MI__kind(c);
    try { pr.sT = MI__s(c); pr.eT = MI__e(c); } catch (e3) {}
    if (it.op === "update" || it.op === "adopt") {
        pr.before = MI__readParams(c, pr.kind);
    } else {
        pr.before = MI__snapOf(c, o.track, ft, it.own ? it.own.m : null);
        try { pr.pi = c.projectItem || null; } catch (e4) { pr.pi = null; }
        /* replace가 실패해 되놓을 때 같은 구조인지 보려고 옛 클립의 lay를 둔다 */
        if (it.op === "replace") pr.lay = MI__json(MI__lay(c, pr.kind));
    }
    return pr;
}
/* 새로 놓은 클립 마무리: 속성(이름 확인, 네이티브는 구운 문구라 fresh), 이름(태그), 되읽기(deco 포함) → r.status */
function MI__finishNew(ctx, it, r, put, okStatus) {
    var c = put.clip;
    var ap = MI__applyParamsSafe(c, MI__kind(c), it.params, true);
    r.skipped = ap.skipped;
    r.keyed = ap.keyed;
    r.clamped = put.clamped === true;
    var nameOk = true;
    if (it.name !== undefined && it.name !== null) nameOk = MI__setName(c, it.name);
    MI__readback(r, c, it.track, ctx.ft, true);
    if (!nameOk) {
        r.status = "failed";
        r.reason = "tag-write";
        return;
    }
    r.status = ap.skipped.length || ap.keyed.length ? "partial" : okStatus;
}
function MI__opPlace(ctx, it, pr, r) {
    var plan = MI__planPut(ctx, { ti: it.track, sf: it.sf, ef: it.ef, path: it.mogrtPath, durSec: it.durSec, guard: MI__set(it.guard), skip: {} });
    if (plan.fail) {
        r.status = "failed";
        r.reason = plan.fail;
        return;
    }
    if (plan.conflict) {
        r.status = "conflict";
        r.reason = plan.conflict.reason;
        r.detail = plan.conflict.id + (plan.durKnown ? "" : " (템플릿 길이를 몰라 " + MI__DMAX_SEC + "초 안을 봤다)");
        return;
    }
    var put = MI__doPut(ctx, plan);
    if (!put.clip) {
        r.status = put.status || "failed";
        r.reason = put.reason || "";
        r.detail = put.detail || "";
        return;
    }
    MI__finishNew(ctx, it, r, put, "placed");
}
/* update / adopt: 제자리. 이름 확인 쓰기 → (keepTime이 아니면) 끝 = min(ef, 다음 클립 시작) → 이름 → 되읽기 */
function MI__opUpdate(ctx, it, pr, r) {
    var ft = ctx.ft;
    var c = MI__find(ctx, pr.ti, pr.id);
    if (!c) {
        r.status = "stale-plan";
        r.reason = "not-found";
        return;
    }
    var ap = MI__applyParamsSafe(c, pr.kind, it.params);
    r.skipped = ap.skipped;
    r.keyed = ap.keyed;
    if (!it.keepTime) {
        var s0 = MI__s(c);
        var efT = it.ef * ft;
        var tr = MI__track(ctx.seq, pr.ti);
        var skip = {};
        skip["n" + pr.id] = true;
        var nx = MI__nextStart(MI__win(tr, s0, efT), s0, skip);
        var endT = efT;
        if (nx !== null && nx < endT) {
            endT = nx;
            r.clamped = true;
        }
        if (endT - s0 >= ft) {
            try { c.end = MI__T(endT); } catch (e) {}
        } else {
            r.reason = "zero-length";
        }
    }
    var nameOk = true;
    if (it.name !== undefined && it.name !== null) nameOk = MI__setName(c, it.name);
    MI__readback(r, c, pr.ti, ft, false);
    if (!nameOk) {
        r.status = "failed";
        r.reason = "tag-write";
        return;
    }
    r.status = ap.skipped.length || ap.keyed.length ? "partial" : (it.op === "adopt" ? "adopted" : "updated");
}
/* move: TrackItem.move(Δ) — nodeId·이름·속성·효과·키프레임이 그대로다 (S0-3 r). move는 겹침을 막지 않으므로
   목적 범위 [sf, ef)를 먼저 확인한다: 시작을 덮은 클립이 있으면 conflict, 안쪽에서 시작하는 클립이 있으면 끝을 맞춘다.
   길이를 먼저 줄인 뒤 옮기고 끝을 ef × frameTicks로 쓴다. 같은 트랙 안에서만 (다른 트랙은 moveRegen).
   move가 예외를 던지거나 시작이 sf에 오지 않으면 클립을 원래 [시작, 끝)으로 되돌린다 (못 하면 damaged) */
function MI__opMove(ctx, it, pr, r) {
    var ft = ctx.ft;
    if (pr.ti !== it.track) {
        r.status = "failed";
        r.reason = "bad-item";
        r.detail = "move는 같은 트랙 안에서만 (다른 트랙은 moveRegen)";
        return;
    }
    var c = MI__find(ctx, pr.ti, pr.id);
    if (!c) {
        r.status = "stale-plan";
        r.reason = "not-found";
        return;
    }
    var tr = MI__track(ctx.seq, pr.ti);
    var sfT = it.sf * ft;
    var skip = {};
    skip["n" + pr.id] = true;
    var oc = MI__occupy(MI__win(tr, sfT, it.ef * ft), sfT, it.ef * ft, it.ef * ft, ft, skip, {}, true, false);
    if (oc.conflict) {
        r.status = "conflict";
        r.reason = oc.conflict.reason;
        r.detail = oc.conflict.id;
        return;
    }
    r.clamped = oc.clamped;
    var s0 = MI__s(c);
    var e0 = MI__e(c);
    var len = oc.efT - sfT;
    if (e0 - s0 > len) {
        try { c.end = MI__T(s0 + len); } catch (e) {}
    }
    var moveErr = "";
    if (sfT !== s0) {
        try { c.move(MI__T(sfT - s0)); } catch (e2) { moveErr = MI__errText(e2); }
    }
    MI__dirty(ctx, pr.ti);
    var m = MI__find(ctx, pr.ti, pr.id) || c;
    var nowF = null;
    if (!moveErr) {
        try { m.end = MI__T(oc.efT); } catch (e3) {}
        try { nowF = MI__frameOf(MI__s(m), ft); } catch (e4) { nowF = null; }
    }
    if (moveErr || nowF !== it.sf) {
        r.status = "failed";
        r.reason = "move";
        r.detail = moveErr || ("시작 " + nowF + "f");
        MI__putBack(ctx, pr.ti, pr.id, s0, e0);
        MI__readback(r, MI__find(ctx, pr.ti, pr.id) || m, pr.ti, ft, false);
        return;
    }
    var ap = MI__applyParamsSafe(m, pr.kind, it.params);
    r.skipped = ap.skipped;
    r.keyed = ap.keyed;
    var nameOk = true;
    if (it.name !== undefined && it.name !== null) nameOk = MI__setName(m, it.name);
    MI__readback(r, m, pr.ti, ft, false);
    if (!nameOk) {
        r.status = "failed";
        r.reason = "tag-write";
        return;
    }
    r.status = ap.skipped.length || ap.keyed.length ? "partial" : "moved";
}
/* moveRegen / legacyMove: 새 자리에 새로 놓고(gen+1 또는 legacyMove의 gen 1) 확인한 뒤 옛 클립(own, removeAfter)을 nodeId로 지운다.
   지우지 못하면 reason old-left (새 클립은 남는다). 자리가 막혀 있으면 아무것도 바꾸지 않는다.
   같은 트랙의 옛 클립이 sf를 걸치면 놓기 전에 끝을 sf로 줄인다 (MI__trimOld: 걸친 채 놓으면 뒤 조각이 옛 태그로 남는다).
   못 놓으면 줄인 끝을 되돌린다. 태그 쓰기가 실패해 옛 클립을 남길 때는 줄인 끝 그대로 둔다 (되돌리면 새 클립과 겹친다) */
function MI__opRegen(ctx, it, pr, r) {
    var skip = {};
    var olds = [];
    if (pr.id && pr.ti === it.track) {
        skip["n" + pr.id] = true;
        olds.push(pr.id);
    }
    if (pr.raId && pr.raTi === it.track && !(pr.raId === pr.id && pr.raTi === pr.ti)) {
        skip["n" + pr.raId] = true;
        olds.push(pr.raId);
    }
    var plan = MI__planPut(ctx, { ti: it.track, sf: it.sf, ef: it.ef, path: it.mogrtPath, durSec: it.durSec, guard: MI__set(it.guard), skip: skip });
    if (plan.fail) {
        r.status = "failed";
        r.reason = plan.fail;
        return;
    }
    if (plan.conflict) {
        r.status = "conflict";
        r.reason = plan.conflict.reason;
        r.detail = plan.conflict.id;
        return;
    }
    var cut = MI__trimOld(ctx, it.track, olds, it.sf * ctx.ft);
    if (cut === null) {
        r.status = "conflict";
        r.reason = "occupied";
        r.detail = "옛 클립의 끝을 sf로 줄이지 못했다";
        return;
    }
    var put = MI__doPut(ctx, plan);
    if (!put.clip) {
        for (var k = 0; k < cut.length; k++) MI__putBack(ctx, it.track, cut[k].id, cut[k].s, cut[k].e);
        r.status = put.status || "failed";
        r.reason = put.reason || "";
        r.detail = put.detail || "";
        return;
    }
    MI__finishNew(ctx, it, r, put, "moved");
    /* 새 클립에 태그를 쓰지 못했으면 옛 클립을 남긴다 (패널이 다음 계획에서 새 클립을 태그 없는 클립으로 다룬다) */
    if (r.status === "failed") return;
    var left = false;
    if (pr.id && MI__removeNode(ctx, pr.ti, pr.id) === "left") left = true;
    if (pr.raId && !(pr.raId === pr.id && pr.raTi === pr.ti) && MI__removeNode(ctx, pr.raTi, pr.raId) === "left") left = true;
    if (left) r.reason = "old-left";
}
/* replace: 템플릿이 다른 클립을 바꾼다 = 먼저 지우고 놓기. 자리 확인은 지우기 전에 한다.
   놓지 못하면 옛 템플릿을 'before'로 되놓는다: AE는 옛 클립의 projectItem(overwriteClip), 없으면 own.m(importMGT).
   되놓으면 failed + restored-old, 못 하면 failed + lost-old. 되놓을 길이 없으면(네이티브는 projectItem이 없다) own.m
   (구운 경로)이 없을 때 아예 시작하지 않는다 (conflict template-unknown) */
function MI__opReplace(ctx, it, pr, r) {
    var own = it.own;
    if ((pr.kind !== "ae" || !pr.pi) && !(own && own.m)) {
        r.status = "conflict";
        r.reason = "template-unknown";
        return;
    }
    var skip = {};
    if (pr.ti === it.track) skip["n" + pr.id] = true;
    var plan = MI__planPut(ctx, { ti: it.track, sf: it.sf, ef: it.ef, path: it.mogrtPath, durSec: it.durSec, guard: MI__set(it.guard), skip: skip });
    if (plan.fail) {
        r.status = "failed";
        r.reason = plan.fail;
        return;
    }
    if (plan.conflict) {
        r.status = "conflict";
        r.reason = plan.conflict.reason;
        r.detail = plan.conflict.id;
        return;
    }
    if (MI__removeNode(ctx, pr.ti, pr.id) === "left") {
        r.status = "failed";
        r.reason = "old-left";
        return;
    }
    var put = MI__doPut(ctx, plan);
    if (put.clip) {
        MI__finishNew(ctx, it, r, put, "replaced");
        return;
    }
    r.status = "failed";
    r.detail = (put.reason || "") + (put.detail ? ": " + put.detail : "");
    var back = MI__restoreOld(ctx, pr, it);
    if (back) {
        r.reason = "restored-old";
        if (!back.sameLay) r.detail += " (되놓은 클립의 속성 구조가 옛 클립과 다르다)";
        MI__readback(r, back.clip, pr.ti, ctx.ft, false);
    } else {
        r.reason = "lost-old";
    }
}
/* replace가 실패했을 때 옛 템플릿을 옛 자리에 되놓는다 (속성·이름은 before로) → {clip, sameLay} | null.
   옛 템플릿의 기본 길이 D는 새 템플릿의 것과 달라 [sf, sf + D_old)가 새 자리 확인 범위를 넘을 수 있다 (D를 모르면 60초를 본다).
   그 안에서 이웃으로 보는 것은 작업의 guard와 같은 salt 태그 클립(이 목록의 클립: 머리를 되돌리고, 통째로 덮이면 damaged →
   패널이 다시 놓는다)뿐이다. 남의 클립이 있으면 되놓지 않는다(null → lost-old, 패널은 before로 다시 만든다) — 되놓기가
   사용자 클립을 지우면 되돌릴 길이 없다.
   공유 projectItem으로 놓은 클립의 구조가 옛 클립과 다르면(같은 capsule로 재저장된 MOGRT는 overwriteClip이 다른 버전을
   놓을 수 있다, S0-3 x ③) 지우고 옛 경로 m(importMGT)으로 다시 놓는다 */
function MI__restoreOld(ctx, pr, it) {
    var b = pr.before;
    if (!b) return null;
    var usePi = pr.kind === "ae" ? pr.pi : null;
    var spec = { ti: pr.ti, sf: b.sf, ef: Math.max(b.ef, b.sf + 1), endT: pr.eT, path: b.m || "", pi: usePi, durSec: 0, guard: MI__set(it.guard), skip: {}, salt: MI__saltOf(it.key) };
    var plan = MI__planPut(ctx, spec);
    if (plan.fail || plan.conflict) return null;
    var put = MI__doPut(ctx, plan);
    if (!put.clip) return null;
    var c = put.clip;
    var same = !pr.lay || MI__json(MI__lay(c, MI__kind(c))) === pr.lay;
    if (!same && usePi && b.m) {
        var id0 = "";
        try { id0 = String(c.nodeId); } catch (e) { id0 = ""; }
        MI__removeNode(ctx, pr.ti, id0);
        spec.pi = null;
        plan = MI__planPut(ctx, spec);
        if (plan.fail || plan.conflict) return null;
        put = MI__doPut(ctx, plan);
        if (!put.clip) return null;
        c = put.clip;
        same = MI__json(MI__lay(c, MI__kind(c))) === pr.lay;
    }
    MI__applyParamsSafe(c, MI__kind(c), b.params);
    MI__setName(c, b.name);
    return { clip: c, sameLay: same };
}

/* ══ 진입점: 쓰기 (S2-2) ══ */

/* 비디오 트랙을 minCount개까지 늘린다 (배치 전에, spec placement 3).
   QE addTracks는 활성 시퀀스의 마지막 트랙 뒤에 더하고 기존 번호는 그대로 둔다 (spike #3). 더한 뒤 activeSequence를 다시 읽어 센다.
   payload {seqId, build, minCount} → {ok, before, after, added} | add-failed */
function MI_ensureVideoTracks(payloadStr) {
    try {
        var p = MI__parse(payloadStr);
        var g = MI__guard(p);
        if (g.err) return MI__fail(g.err, g.detail);
        if (!MI__isInt(p.minCount) || p.minCount < 1 || p.minCount > 99) return MI__fail("bad-payload", "minCount는 1~99");
        var before = MI__numTracks(g.seq);
        if (before >= p.minCount) return MI__json({ ok: true, before: before, after: before, added: 0 });
        if (!ensureQE()) return MI__fail("add-failed", "QE를 쓸 수 없다");
        try {
            qe.project.getActiveSequence().addTracks(p.minCount - before, before, 0);
        } catch (e) {
            return MI__fail("add-failed", MI__errText(e));
        }
        var seq2 = null;
        try { seq2 = app.project.activeSequence; } catch (e2) { seq2 = null; }
        var after = seq2 ? MI__numTracks(seq2) : 0;
        if (after < p.minCount) return MI__fail("add-failed", "트랙 " + before + " → " + after + " (필요 " + p.minCount + ")");
        return MI__json({ ok: true, before: before, after: after, added: after - before });
    } catch (e3) {
        return MI__fail("exception", MI__errText(e3));
    }
}

/* 배치 청크 (작업 7종). payload {seqId, build, frameTicks, budgetMs(기본 7000), items: [
     {key, op: place|update|replace|move|moveRegen|adopt|legacyMove, g, track, sf, ef, keepTime,
      own: {track, sf, nodeId, m?} | null, mogrtPath, durSec, params: [ParamDef], name: 글자 | null,
      guard: [nodeId], motion: null, removeAfter: {track, nodeId} | null}]}
   → {ok, done, results: [{key, status, track, sf, ef, g, nodeId, clamped, reason, detail?, name, kind, texts, lay, pin,
      skipped, keyed, before, motion, deco?}], damaged: [nodeId], dur: {경로: 초}, comps: {경로: 개수}, ms}
   status: placed|updated|replaced|moved|adopted|partial|conflict|ambiguous|locked|stale-plan|misplaced|failed
   - 첫 루프: 모든 작업의 기존 클립을 찾고 'before'를 읽는다 (어떤 배치보다 먼저).
   - 둘째 루프: 작업마다 따로 try/catch. 트랙이 없으면 failed no-track(importMGT는 없는 번호를 마지막 트랙에 놓는다, #14),
     잠겼으면 locked. 예산(budgetMs)을 넘으면 새 작업을 시작하지 않는다 (done < items.length, 첫 작업은 늘 한다).
   - name이 null이면 이름을 건드리지 않는다 (레거시 안전 경로는 태그를 쓰지 않는다).
   - 새로 놓는 자리 [sf, max(ef, sf + D))는 확인한다: 남의 클립이면 conflict(occupied|tail), guard 이웃은 머리를 되돌리고
     (분기 R, 분기 P는 불가 — S0-3 a), 되돌리지 못한 이웃은 damaged (패널이 다시 놓는다, 분기 C).
   - 끝은 늘 ef × frameTicks (clamped면 다음 클립 시작). 시작은 sf × frameTicks.
   - replace가 실패해 옛 템플릿을 되놓을 때는 guard와 같은 salt 태그 클립만 이웃으로 본다: 옛 템플릿 길이 안에 남의 클립이
     있으면 되놓지 않고 lost-old (MI__restoreOld).
   - 네이티브(구운 경로)를 새로 놓는 작업(place·replace·moveRegen·legacyMove)의 nativeText param은 skipped가 아니다 — 문구는
     구운 .mogrt에 있다. update·adopt·move에서 값이 다른 nativeText param은 skipped(partial): 문구를 바꾸려면 replace로 보낸다.
     네이티브 되읽기 texts는 늘 ""다 (S0-3 w).
   - projectItem 캐시는 이 호출 안에서만 쓴다 (S0-3 결정 13). */
function MI_placeChunk(payloadStr) {
    var t0 = MI__now();
    try {
        var p = MI__parse(payloadStr);
        var g = MI__guard(p);
        if (g.err) return MI__fail(g.err, g.detail);
        var seq = g.seq;
        var ft = MI__ft(seq);
        if (p.frameTicks !== undefined && p.frameTicks !== null && Number(p.frameTicks) !== ft) {
            return MI__fail("bad-payload", "frameTicks " + p.frameTicks + " / 시퀀스 " + ft);
        }
        var items = p.items;
        if (!MI__isArr(items)) return MI__fail("bad-payload", "items는 배열");
        if (items.length > MI__CHUNK_MAX) return MI__fail("bad-payload", "items는 " + MI__CHUNK_MAX + "개까지 (" + items.length + ")");
        var budget = typeof p.budgetMs === "number" && p.budgetMs > 0 ? p.budgetMs : 7000;
        var ctx = MI__ctx(seq, ft);
        var i;
        var pre = [];
        for (i = 0; i < items.length; i++) {
            try {
                pre.push(MI__locate(ctx, items[i]));
            } catch (e) {
                pre.push({ status: "failed", reason: "exception", detail: MI__errText(e) });
            }
        }
        var results = [];
        var done = 0;
        for (i = 0; i < items.length; i++) {
            if (i > 0 && MI__now() - t0 >= budget) break;
            var it = items[i];
            var pr = pre[i];
            var r = MI__res(it);
            try {
                if (pr.before) r.before = pr.before;
                if (pr.status) {
                    r.status = pr.status;
                    r.reason = pr.reason || "";
                    if (pr.detail) r.detail = pr.detail;
                } else if (it.track >= MI__numTracks(seq)) {
                    r.status = "failed";
                    r.reason = "no-track";
                } else if (MI__locked(MI__track(seq, it.track)) || (pr.ti >= 0 && MI__locked(MI__track(seq, pr.ti))) || (pr.raTi >= 0 && MI__track(seq, pr.raTi) && MI__locked(MI__track(seq, pr.raTi)))) {
                    r.status = "locked";
                } else if (it.op === "place") {
                    MI__opPlace(ctx, it, pr, r);
                } else if (it.op === "update" || it.op === "adopt") {
                    MI__opUpdate(ctx, it, pr, r);
                } else if (it.op === "move") {
                    MI__opMove(ctx, it, pr, r);
                } else if (it.op === "replace") {
                    MI__opReplace(ctx, it, pr, r);
                } else {
                    MI__opRegen(ctx, it, pr, r);
                }
            } catch (e2) {
                r.status = "failed";
                r.reason = "exception";
                r.detail = MI__errText(e2);
                MI__dirty(ctx);
            }
            results.push(r);
            done++;
        }
        var dur = {};
        var comps = {};
        for (var k in ctx.dur) {
            if (Object.prototype.hasOwnProperty.call(ctx.dur, k)) {
                dur[k.substring(1)] = ctx.dur[k];
                comps[k.substring(1)] = ctx.comps[k];
            }
        }
        return MI__json({ ok: true, done: done, results: results, damaged: ctx.damaged, dur: dur, comps: comps, ms: MI__now() - t0 });
    } catch (e3) {
        return MI__fail("exception", MI__errText(e3));
    }
}

/* nodeId로 지운다 (패널이 이미 되읽은 텍스트로 정했다 — ES3에는 NFC가 없어 문장 비교는 패널 몫).
   payload {seqId, build, items: [{key, track, nodeId, expectName: 글자 | null}]}
   → {ok, results: [{key, status: removed|notFound|notOurs|locked|failed, before: {track, sf, ef, g, name, kind, m, pi, params}}], ms}
   expectName이 있으면 이름이 다를 때(사용자가 이름을 바꿨다) 지우지 않는다. remove(false,false)는 true를 돌려준다 (spike #6) */
function MI_removeClips(payloadStr) {
    var t0 = MI__now();
    try {
        var p = MI__parse(payloadStr);
        var g = MI__guard(p);
        if (g.err) return MI__fail(g.err, g.detail);
        var items = p.items;
        if (!MI__isArr(items)) return MI__fail("bad-payload", "items는 배열");
        if (items.length > MI__REMOVE_MAX) return MI__fail("bad-payload", "items는 " + MI__REMOVE_MAX + "개까지");
        var ctx = MI__ctx(g.seq, MI__ft(g.seq));
        var results = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i] || {};
            var r = { key: typeof it.key === "string" ? it.key : "", status: "", before: null };
            try {
                if (!MI__isInt(it.track) || it.nodeId === undefined || it.nodeId === null || String(it.nodeId) === "") {
                    r.status = "failed";
                    r.reason = "bad-item";
                } else if (!MI__track(g.seq, it.track)) {
                    r.status = "notFound";
                } else {
                    var c = MI__find(ctx, it.track, it.nodeId);
                    if (!c) {
                        r.status = "notFound";
                    } else if (MI__locked(MI__track(g.seq, it.track))) {
                        r.status = "locked";
                    } else if (it.expectName !== undefined && it.expectName !== null && String(c.name) !== String(it.expectName)) {
                        r.status = "notOurs";
                        r.name = String(c.name);
                    } else {
                        r.before = MI__snapOf(c, it.track, ctx.ft, null);
                        var st = MI__removeNode(ctx, it.track, String(it.nodeId));
                        r.status = st === "left" ? "failed" : "removed";
                        if (st === "left") r.reason = "old-left";
                    }
                }
            } catch (e) {
                r.status = "failed";
                r.reason = "exception";
                r.detail = MI__errText(e);
                MI__dirty(ctx);
            }
            results.push(r);
        }
        return MI__json({ ok: true, results: results, ms: MI__now() - t0 });
    } catch (e2) {
        return MI__fail("exception", MI__errText(e2));
    }
}
/* MI:END */
