/* (g) isTimeVarying on a keyframed Motion Position and on a keyframed MOGRT colour param; what v27 writes do to keyed params.
   T_23976 V6 (idx 5), preset_1 (box: colours at 5/7/10). */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 5;
    S03_clearTrack(seq, TI);
    var cl = seq.importMGT(S03_PRESETS[0].mogrtPath, "0", TI, 0);
    var inT = Number(cl.inPoint.ticks);
    r.inSec = cl.inPoint.seconds;
    /* Motion Position */
    var mot = null;
    for (var c = 0; c < cl.components.numItems; c++) if (String(cl.components[c].matchName) === "AE.ADBE Motion") mot = cl.components[c];
    var pos = mot.properties[0];
    r.posName = String(pos.displayName);
    r.posTV0 = pos.isTimeVarying();
    r.posKeysSupported = pos.areKeyframesSupported();
    pos.setTimeVarying(true);
    var k1 = S03_T(inT + 12 * ft), k2 = S03_T(inT + 72 * ft);
    pos.addKey(k1); pos.setValueAtKey(k1, [0.3, 0.5], true);
    pos.addKey(k2); pos.setValueAtKey(k2, [0.7, 0.5], true);
    r.posTV1 = pos.isTimeVarying();
    var ks = pos.getKeys();
    r.posKeys = []; for (var i = 0; i < ks.length; i++) r.posKeys.push((Number(ks[i].ticks) - inT) / ft);
    /* keys relative to clip start or clip in? try sequence-time key too */
    var k3 = S03_T(48 * ft);
    try { pos.addKey(k3); r.addSeqTimeKey = "ok"; } catch (e0) { r.addSeqTimeKey = "threw " + e0.message; }
    ks = pos.getKeys(); r.posKeysAfterSeqKey = ks.length;
    try { pos.removeKey(k3); } catch (e00) {}
    r.posValue = String(pos.getValue());
    var sv = pos.setValue([0.1, 0.1], true);
    r.posSetValueRet = String(sv);
    r.posValueAtK1after = String(pos.getValueAtKey(k1));
    /* MOGRT params: which support keyframes */
    var props = cl.getMGTComponent().properties;
    r.kfSupport = [];
    for (var p = 0; p < props.numItems; p++) {
        var s = "";
        try { s = props[p].areKeyframesSupported() ? "Y" : "n"; } catch (e1) { s = "x"; }
        r.kfSupport.push(p + ":" + s);
    }
    /* keyframe colour param 5 */
    var col = props[5];
    r.colName = String(col.displayName);
    r.colTV0 = col.isTimeVarying();
    r.colVal0 = String(col.getValue());
    try {
        col.setTimeVarying(true);
        col.addKey(k1); col.addKey(k2);
        col.setColorValue(255, 255, 0, 0, 1);  /* no key time: what happens? */
        r.colKeysetColorNoTime = "ok";
    } catch (e2) { r.colKeyErr = e2.message; }
    r.colTV1 = col.isTimeVarying();
    r.colNKeys = col.getKeys() ? col.getKeys().length : 0;
    try { r.colAtK1 = String(col.getValueAtKey(k1)); r.colAtK2 = String(col.getValueAtKey(k2)); } catch (e3) { r.colAtErr = e3.message; }
    /* v27 write on the keyed colour param */
    applyParamsToItem(cl, [{ index: 5, displayName: r.colName, type: "color", colorHex: "#00ff00", value: "#00ff00", rawValue: "" }]);
    r.colTVafterV27 = col.isTimeVarying();
    try { r.colAtK1afterV27 = String(col.getValueAtKey(k1)); r.colAtK2afterV27 = String(col.getValueAtKey(k2)); r.colValAfterV27 = String(col.getValue()); } catch (e4) { r.colAt2Err = e4.message; }
    /* keyed number param 11 (box roundness) */
    var num = props[11];
    r.numName = String(num.displayName);
    try { num.setTimeVarying(true); num.addKey(k1); num.setValueAtKey(k1, 10, true); num.addKey(k2); num.setValueAtKey(k2, 90, true); } catch (e5) { r.numErr = e5.message; }
    r.numTV = num.isTimeVarying();
    applyParamsToItem(cl, [{ index: 11, displayName: r.numName, type: "number", value: "50", rawValue: "50" }]);
    try { r.numAtK1after = String(num.getValueAtKey(k1)); r.numAtK2after = String(num.getValueAtKey(k2)); } catch (e6) {}
    /* keyed text param? */
    var tx = props[4];
    try { r.textKfSupported = tx.areKeyframesSupported(); } catch (e7) { r.textKfSupported = "x"; }
    r.deco = S03_deco(cl);
    return JSON.stringify(r);
})();
