/* (a) Branch P: projectItem.setOutPoint(in+len) then overwriteClip / importMGT; neighbour intact? restore in/out; already placed clips unaffected?
   T_23976 V3 (idx 2). preset_6 diary MOGRT. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 2;
    var MG = S03_PRESETS[4].mogrtPath; /* preset_6 */
    r.cleared = S03_clearTrack(seq, TI);
    var A = seq.importMGT(MG, "0", TI, 0);
    A.end = S03_T(24 * ft);
    var pi = A.projectItem;
    r.piName = String(pi.name); r.piNode = String(pi.nodeId);
    var in0 = pi.getInPoint(), out0 = pi.getOutPoint();
    r.piIn0 = in0.seconds; r.piOut0 = out0.seconds; r.piOut0ticks = String(out0.ticks);
    /* neighbour N at 72f natural length */
    seq.overwriteClip(pi, S03_T(72 * ft), TI, 0);
    var N = S03_clipAt(seq, TI, 72 * ft);
    N.name = "N [neighbour]";
    var nBefore = S03_brief(N, ft);
    r.N0 = nBefore;
    /* set out point: len = 30 frames. Try the signature variants and read back */
    var len = 30;
    var wantOut = Number(in0.ticks) + len * ft;
    var how = "";
    try { pi.setOutPoint(String(wantOut), 4); how = "ticksString,4"; } catch (e1) { how = "ticksString threw " + e1.message; }
    r.outAfterTicksStr = pi.getOutPoint().seconds;
    if (Math.abs(Number(pi.getOutPoint().ticks) - wantOut) > ft / 2) {
        try { pi.setOutPoint(wantOut / S03_TPS, 4); how += " | seconds,4"; } catch (e2) { how += " | seconds threw " + e2.message; }
        r.outAfterSeconds = pi.getOutPoint().seconds;
    }
    if (Math.abs(Number(pi.getOutPoint().ticks) - wantOut) > ft / 2) {
        try { pi.setOutPoint(S03_T(wantOut), 4); how += " | Time,4"; } catch (e3) { how += " | Time threw " + e3.message; }
        r.outAfterTime = pi.getOutPoint().seconds;
    }
    r.setOutHow = how;
    r.piOutSet = pi.getOutPoint().seconds;
    r.piInSet = pi.getInPoint().seconds;
    /* B: overwriteClip at 30f, expected [30,60) */
    var t0 = S03_now();
    seq.overwriteClip(pi, S03_T(30 * ft), TI, 0);
    r.owMs = S03_now() - t0;
    var B = S03_clipAt(seq, TI, 30 * ft);
    r.B = S03_brief(B, ft);
    r.N_afterB = S03_brief(S03_clipAt(seq, TI, 72 * ft), ft);
    /* C: importMGT at 300f while out point is set: does importMGT honour it? */
    var bef = S03_nodeIds(seq, TI);
    var Cret = seq.importMGT(MG, String(300 * ft), TI, 0);
    var C = Cret || S03_newClip(seq, TI, bef);
    r.C = S03_brief(C, ft);
    r.C_piNode = C && C.projectItem ? String(C.projectItem.nodeId) : null;
    /* restore: setOutPoint(original) */
    try { pi.setOutPoint(String(out0.ticks), 4); r.restoreHow = "ticksString,4"; } catch (e4) { r.restoreHow = "threw " + e4.message; }
    r.piOutRestored = pi.getOutPoint().seconds;
    r.B_afterRestore = S03_brief(S03_clipAt(seq, TI, 30 * ft), ft);
    r.C_afterRestore = S03_brief(S03_clipAt(seq, TI, 300 * ft), ft);
    r.N_afterRestore = S03_brief(S03_clipAt(seq, TI, 72 * ft), ft);
    r.A_afterRestore = S03_brief(S03_clipAt(seq, TI, 0), ft);
    /* D: new placement after restore at 500f: natural length again? */
    seq.overwriteClip(pi, S03_T(500 * ft), TI, 0);
    r.D = S03_brief(S03_clipAt(seq, TI, 500 * ft), ft);
    /* clearOutPoint variant */
    try { pi.setOutPoint(String(Number(in0.ticks) + 10 * ft), 4); pi.clearOutPoint(); r.afterClearOut = pi.getOutPoint().seconds; r.afterClearIn = pi.getInPoint().seconds; } catch (e5) { r.clearErr = e5.message; }
    seq.overwriteClip(pi, S03_T(700 * ft), TI, 0);
    r.E_afterClear = S03_brief(S03_clipAt(seq, TI, 700 * ft), ft);
    /* put the item back exactly as it was */
    try { pi.setOutPoint(String(out0.ticks), 4); pi.setInPoint(String(in0.ticks), 4); } catch (e6) {}
    r.piFinal = [pi.getInPoint().seconds, pi.getOutPoint().seconds];
    r.track = S03_track(seq, TI);
    return JSON.stringify(r);
})();
