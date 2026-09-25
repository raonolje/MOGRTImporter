/* (x) step 2: the temp files were overwritten (x_same_path: 8-prop -> 15-prop other capsule; x_q: same capsule, renamed controls).
   Import again, compare project items and layouts; namedParams (index -1) through v27 updateClipAtTime on old and new clips. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var DIR = "C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/mogrt/";
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 4;
    function place(path, sf) {
        var cl = seq.importMGT(path, String(sf * ft), TI, 0);
        var o = {};
        var pi = cl.projectItem;
        o.pi = pi ? String(pi.nodeId) + " " + pi.name + " | " + pi.getMediaPath() : null;
        o.lay = S03_lay(cl);
        return o;
    }
    r.X2 = place(DIR + "x_same_path.mogrt", 240);
    r.Q2 = place(DIR + "x_q.mogrt", 1240);
    r.X1_layNow = S03_lay(S03_clipAt(seq, TI, 0));
    r.Q1_layNow = S03_lay(S03_clipAt(seq, TI, 1000 * ft));
    /* project items now */
    var items = [];
    var bin = null;
    for (var b = 0; b < app.project.rootItem.children.numItems; b++) if (app.project.rootItem.children[b].type === 2) bin = app.project.rootItem.children[b];
    for (var k = 0; k < bin.children.numItems; k++) items.push(String(bin.children[k].nodeId) + " " + bin.children[k].name);
    r.binItems = items;
    /* namedParams via v27 updateClipAtTime: raw values taken from preset_1 (new layout) */
    var P1 = S03_PRESETS[0].params;
    function np(idx, value) {
        var src = P1[idx];
        var o = { index: -1, displayName: src.displayName, type: src.type, value: value, rawValue: src.rawValue };
        if (src.type === "color") { o.colorHex = value; }
        return o;
    }
    var named = [np(4, "NAMED CAPTION"), np(6, "NAMED POINT"), np(10, "#ff0000"), np(12, "99")];
    function upd(startF, params) {
        var pl = { videoTrackIndex: TI, startSec: startF * ft / S03_TPS, endSec: (startF + 120) * ft / S03_TPS, mogrtPath: "", params: params };
        return updateClipAtTime(JSON.stringify(pl));
    }
    function readByName(cl, nm) {
        var ps = cl.getMGTComponent().properties;
        for (var i = 0; i < ps.numItems; i++) {
            if (String(ps[i].displayName) === nm) {
                var v = String(ps[i].getValue());
                if (v.indexOf('"textEditValue"') !== -1) { try { v = JSON.parse(v).textEditValue; } catch (e) {} }
                return i + ":" + v;
            }
        }
        return "absent";
    }
    function probe(cl) {
        return { cap: readByName(cl, "\uc804\uccb4 \ud14d\uc2a4\ud2b8"), pt: readByName(cl, "\ud3ec\uc778\ud2b8 \ud14d\uc2a4\ud2b8"), sub: readByName(cl, "\uc11c\ube0c \ud3ec\uc778\ud2b8 \ud14d\uc2a4\ud2b8"),
            box: readByName(cl, "\ubc15\uc2a4 \uc0c9\uc0c1"), padX: readByName(cl, "\ubc15\uc2a4 \uac00\ub85c \uc5ec\ubc31") };
    }
    r.X1_before = probe(S03_clipAt(seq, TI, 0));
    r.upd_X1 = upd(0, named);
    r.X1_named = probe(S03_clipAt(seq, TI, 0));
    r.upd_X2 = upd(240, named);
    r.X2_named = probe(S03_clipAt(seq, TI, 240 * ft));
    /* the v27 danger: index 4 (new layout caption) on the OLD clip */
    var idxWrite = [{ index: 4, displayName: P1[4].displayName, type: "text", value: "INDEX4 CAPTION", rawValue: P1[4].rawValue }];
    r.upd_X1_idx = upd(0, idxWrite);
    r.X1_idx = probe(S03_clipAt(seq, TI, 0));
    /* faux style after a named text write with rawValue "" */
    var capProp = null, ps = S03_clipAt(seq, TI, 240 * ft).getMGTComponent().properties;
    for (var i = 0; i < ps.numItems; i++) if (String(ps[i].displayName) === "\uc804\uccb4 \ud14d\uc2a4\ud2b8") capProp = ps[i];
    var before = JSON.parse(String(capProp.getValue()));
    r.fauxBefore = [before.fontFSBoldValue, before.fontFSAllCapsValue, before.fontEditValue];
    upd(240, [{ index: -1, displayName: "\uc804\uccb4 \ud14d\uc2a4\ud2b8", type: "text", value: "NO RAW", rawValue: "" }]);
    var after = JSON.parse(String(capProp.getValue()));
    r.fauxAfterEmptyRaw = [after.fontFSBoldValue, after.fontFSAllCapsValue, after.fontEditValue, after.textEditValue];
    return JSON.stringify(r);
})();
