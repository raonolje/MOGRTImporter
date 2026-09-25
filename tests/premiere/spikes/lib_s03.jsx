/* S0-3 probe helpers (ES3, ASCII only). Loaded by each probe with $.evalFile(absolute path).
   Globals use the S03_ prefix so they cannot collide with v27 / MI_ / MID_ names. */
var S03_TPS = 254016000000;
var S03_MG = Folder.userData.fsName.replace(/\\/g, "/") + "/Adobe/Common/Motion Graphics Templates";
var S03_OUT = "C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/out";

function S03_now() { return new Date().getTime(); }

function S03_seq(name) {
    var ss = app.project.sequences;
    for (var i = 0; i < ss.numSequences; i++) { if (String(ss[i].name) === name) return ss[i]; }
    return null;
}

/* make a T_ sequence active (guard needs a T_ active sequence) */
function S03_activate(seq) {
    if (!seq) return false;
    if (String(seq.name).indexOf("T_") !== 0) return false;
    app.project.activeSequence = seq;
    return String(app.project.activeSequence.sequenceID) === String(seq.sequenceID);
}

function S03_ft(seq) { return Number(seq.getSettings().videoFrameRate.ticks); }

function S03_frames(ticksStr, ft) { return Number(ticksStr) / ft; }

function S03_T(ticks) { var t = new Time(); t.ticks = String(ticks); return t; }
function S03_S(sec) { var t = new Time(); t.seconds = sec; return t; }

function S03_clearTrack(seq, ti) {
    var tr = seq.videoTracks[ti];
    var n = 0;
    for (var c = tr.clips.numItems - 1; c >= 0; c--) { try { if (tr.clips[c].remove(false, false)) n++; } catch (e) {} }
    return n;
}

function S03_clipAt(seq, ti, startTicks, tolFrames) {
    var tr = seq.videoTracks[ti];
    var ft = S03_ft(seq);
    var tol = (tolFrames === undefined ? 0.5 : tolFrames) * ft;
    for (var c = 0; c < tr.clips.numItems; c++) {
        var cl = tr.clips[c];
        if (Math.abs(Number(cl.start.ticks) - Number(startTicks)) <= tol) return cl;
    }
    return null;
}

function S03_nodeIds(seq, ti) {
    var o = {};
    var tr = seq.videoTracks[ti];
    for (var c = 0; c < tr.clips.numItems; c++) { o[String(tr.clips[c].nodeId)] = true; }
    return o;
}

/* newest clip on the track = the one whose nodeId was not there before */
function S03_newClip(seq, ti, before) {
    var tr = seq.videoTracks[ti];
    for (var c = 0; c < tr.clips.numItems; c++) { if (!before[String(tr.clips[c].nodeId)]) return tr.clips[c]; }
    return null;
}

function S03_brief(cl, ft) {
    if (!cl) return null;
    var o = {};
    try { o.name = String(cl.name); } catch (e) {}
    try { o.nodeId = String(cl.nodeId); } catch (e) {}
    try { o.sf = Number(cl.start.ticks) / ft; } catch (e) {}
    try { o.ef = Number(cl.end.ticks) / ft; } catch (e) {}
    try { o.inF = Number(cl.inPoint.ticks) / ft; } catch (e) {}
    try { o.outF = Number(cl.outPoint.ticks) / ft; } catch (e) {}
    try { o.startTicks = String(cl.start.ticks); } catch (e) {}
    return o;
}

function S03_track(seq, ti) {
    var tr = seq.videoTracks[ti], ft = S03_ft(seq), a = [];
    for (var c = 0; c < tr.clips.numItems; c++) a.push(S03_brief(tr.clips[c], ft));
    return a;
}

/* text values of a clip: AE MGT text params (textEditValue) or native Source Text */
function S03_texts(cl) {
    var out = [];
    var comp = null;
    try { comp = cl.getMGTComponent(); } catch (e) {}
    if (comp && comp.properties) {
        var ps = comp.properties;
        for (var i = 0; i < ps.numItems; i++) {
            var v = "";
            try { v = String(ps[i].getValue()); } catch (e) { continue; }
            if (v.indexOf('"textEditValue"') !== -1) {
                try { out.push({ i: i, n: String(ps[i].displayName), v: JSON.parse(v).textEditValue }); } catch (e2) { out.push({ i: i, n: String(ps[i].displayName), v: "<parse fail>" }); }
            }
        }
        return out;
    }
    var nt = collectNativeTextProps(cl);
    for (var k = 0; k < nt.length; k++) {
        var nv = "";
        try { nv = String(nt[k].getValue()); } catch (e3) {}
        out.push({ i: k, n: "Source Text", v: nv });
    }
    return out;
}

/* layout: AE -> [[name,"t"|"o"]...]; native -> {n} */
function S03_lay(cl) {
    var comp = null;
    try { comp = cl.getMGTComponent(); } catch (e) {}
    if (comp && comp.properties) {
        var ps = comp.properties, a = [];
        for (var i = 0; i < ps.numItems; i++) {
            var v = "";
            try { v = String(ps[i].getValue()); } catch (e2) {}
            a.push([String(ps[i].displayName), v.indexOf('"textEditValue"') !== -1 ? "t" : "o"]);
        }
        return a;
    }
    return { n: collectNativeTextProps(cl).length };
}

/* deco: component count + Motion/Opacity keyed */
function S03_deco(cl) {
    var o = { comps: 0, keyed: false, names: [] };
    try { o.comps = cl.components.numItems; } catch (e) {}
    for (var c = 0; c < o.comps; c++) {
        var cp = cl.components[c];
        var dn = String(cp.displayName);
        o.names.push(dn);
        var mn = String(cp.matchName);
        if (mn === "AE.ADBE Motion" || mn === "AE.ADBE Opacity") {
            for (var p = 0; p < cp.properties.numItems; p++) {
                try { if (cp.properties[p].isTimeVarying()) o.keyed = true; } catch (e2) {}
            }
        }
    }
    return o;
}

/* set text through v27 applyParamsToItem (index given, type text) */
function S03_setText(cl, idx, text) {
    applyParamsToItem(cl, [{ index: idx, type: "text", value: text, rawValue: "" }]);
}

function S03_mgtProps(cl) {
    var comp = cl.getMGTComponent();
    return comp ? comp.properties : null;
}

function S03_exportPNG(seq, ticks, file) {
    ensureQE();
    seq.setPlayerPosition(String(ticks));
    var qs = qe.project.getActiveSequence();
    var tc = qs.CTI.timecode;
    /* 26.5.1: forward-slash paths throw "Unknown error exception"; backslashes without extension work (.png is appended) */
    qs.exportFramePNG(tc, String(file).replace(/\.png$/i, "").replace(/\//g, "\\"));
    return tc;
}
