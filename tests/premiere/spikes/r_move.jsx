/* (r) TrackItem.move(Time) on AE and native clips: nodeId, name, params, effects, Motion keyframes; overlap behaviour.
   T_23976 V7 (idx 6). */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 6;
    var NAT = S03_MG + "/Lower Thirds/Classic Lower Third Two Lines.mogrt";
    S03_clearTrack(seq, TI);
    ensureQE();
    var qtr = qe.project.getActiveSequence().getVideoTrackAt(TI);
    function motionKeys(cl) {
        var mot = null;
        for (var c = 0; c < cl.components.numItems; c++) if (String(cl.components[c].matchName) === "AE.ADBE Motion") mot = cl.components[c];
        var pos = mot.properties[0];
        var ks = pos.getKeys(), a = [];
        var inT = Number(cl.inPoint.ticks);
        if (ks) for (var i = 0; i < ks.length; i++) a.push((Number(ks[i].ticks) - inT) / ft);
        return { tv: pos.isTimeVarying(), keys: a };
    }
    function keyMotion(cl) {
        var mot = null;
        for (var c = 0; c < cl.components.numItems; c++) if (String(cl.components[c].matchName) === "AE.ADBE Motion") mot = cl.components[c];
        var pos = mot.properties[0];
        var inT = Number(cl.inPoint.ticks);
        pos.setTimeVarying(true);
        var k1 = S03_T(inT + 12 * ft), k2 = S03_T(inT + 72 * ft);
        pos.addKey(k1); pos.setValueAtKey(k1, [0.3, 0.5], true);
        pos.addKey(k2); pos.setValueAtKey(k2, [0.7, 0.5], true);
    }
    function addFx(startF, name) {
        for (var i = 0; i < qtr.numItems; i++) {
            var it = qtr.getItemAt(i);
            if (!it || String(it.type) === "Empty") continue;
            if (Math.abs(Number(it.start.ticks) - startF * ft) < ft / 2) { it.addVideoEffect(qe.project.getVideoEffectByName(name)); return "ok"; }
        }
        return "not found";
    }
    function snap(cl) {
        var o = S03_brief(cl, ft);
        o.texts = S03_texts(cl);
        o.deco = S03_deco(cl);
        o.motion = motionKeys(cl);
        return o;
    }
    /* M1 AE at 100f */
    var M1 = seq.importMGT(S03_PRESETS[4].mogrtPath, String(100 * ft), TI, 0);
    M1.name = "M1 [MI:mv01-1.1]";
    S03_setText(M1, 0, "MOVE AE");
    keyMotion(M1);
    r.fx1 = addFx(100, "Tint");
    /* M2 native at 400f */
    var M2 = seq.importMGT(NAT, String(400 * ft), TI, 0);
    M2.name = "M2 [MI:mv01-2.1]";
    applyParamsToItem(M2, [{ index: 0, type: "text", value: "MOVE NATIVE 0" }, { index: 1, type: "text", value: "MOVE NATIVE 1" }]);
    keyMotion(M2);
    r.fx2 = addFx(400, "Crop");
    /* O neighbour at 700f */
    var O = seq.importMGT(S03_PRESETS[4].mogrtPath, String(700 * ft), TI, 0);
    O.name = "O [neighbour]";
    var m1 = S03_clipAt(seq, TI, 100 * ft), m2 = S03_clipAt(seq, TI, 400 * ft);
    r.M1_before = snap(m1); r.M2_before = snap(m2);
    /* move +48f */
    var t0 = S03_now();
    var ret1 = m1.move(S03_T(48 * ft));
    r.moveMs = S03_now() - t0;
    r.move1ret = String(ret1);
    r.M1_sameRef = S03_brief(m1, ft);
    var ret2 = m2.move(S03_T(-48 * ft));
    r.move2ret = String(ret2);
    r.M1_after = snap(S03_clipAt(seq, TI, 148 * ft));
    r.M2_after = snap(S03_clipAt(seq, TI, 352 * ft));
    /* overlap: move M1 (148..268) by +500f -> 648..768 overlaps O (700..820) */
    var m1b = S03_clipAt(seq, TI, 148 * ft);
    var ret3 = m1b.move(S03_T(500 * ft));
    r.move3ret = String(ret3);
    r.afterOverlapMove = S03_track(seq, TI);
    /* overlap from the right: move M2 (352..472) to start inside M1? M2 by +340f -> 692..812 */
    var m2b = S03_clipAt(seq, TI, 352 * ft);
    var ret4 = m2b ? m2b.move(S03_T(340 * ft)) : "no m2";
    r.move4ret = String(ret4);
    r.afterOverlapMove2 = S03_track(seq, TI);
    return JSON.stringify(r);
})();
