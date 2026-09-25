/* (b) Branch R: restore the head of a neighbour that a placement trimmed.
   T_23976 V4 (idx 3). Neighbours N1 (restore via start) and N2 (restore via inPoint), each with text + name. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 3;
    var MG = S03_PRESETS[4].mogrtPath; /* preset_6 */
    S03_clearTrack(seq, TI);
    var first = seq.importMGT(MG, String(2000 * ft), TI, 0);
    var pi = first.projectItem;
    first.remove(false, false);
    /* N1 at 100f, N2 at 400f (natural 120f) */
    seq.overwriteClip(pi, S03_T(100 * ft), TI, 0);
    var N1 = S03_clipAt(seq, TI, 100 * ft);
    N1.name = "N1 [MI:test-1.1]";
    S03_setText(N1, 0, "N1 TEXT");
    seq.overwriteClip(pi, S03_T(400 * ft), TI, 0);
    var N2 = S03_clipAt(seq, TI, 400 * ft);
    N2.name = "N2 [MI:test-2.1]";
    S03_setText(N2, 0, "N2 TEXT");
    r.N1_0 = S03_brief(N1, ft); r.N2_0 = S03_brief(N2, ft);
    /* X1 at 40f -> [40,160) trims N1 head to 160; X2 at 340f -> [340,460) trims N2 head to 460 */
    seq.overwriteClip(pi, S03_T(40 * ft), TI, 0);
    var X1 = S03_clipAt(seq, TI, 40 * ft);
    seq.overwriteClip(pi, S03_T(340 * ft), TI, 0);
    var X2 = S03_clipAt(seq, TI, 340 * ft);
    r.N1_trimmed = S03_brief(S03_clipAt(seq, TI, 160 * ft), ft);
    r.N2_trimmed = S03_brief(S03_clipAt(seq, TI, 460 * ft), ft);
    /* clamp X ends to the neighbours' original starts */
    X1.end = S03_T(100 * ft); X2.end = S03_T(400 * ft);
    /* restore N1 via start */
    var n1 = S03_clipAt(seq, TI, 160 * ft);
    try { n1.start = S03_T(100 * ft); r.N1_via = "start"; } catch (e1) { r.N1_via = "start threw " + e1.message; }
    r.N1_restored = S03_brief(n1, ft);
    r.N1_refetch = S03_brief(S03_clipAt(seq, TI, 100 * ft), ft);
    /* restore N2 via inPoint (back by 60f) */
    var n2 = S03_clipAt(seq, TI, 460 * ft);
    var in2 = Number(n2.inPoint.ticks);
    try { n2.inPoint = S03_T(in2 - 60 * ft); r.N2_via = "inPoint"; } catch (e2) { r.N2_via = "inPoint threw " + e2.message; }
    r.N2_afterIn = S03_brief(n2, ft);
    /* then also try start on N2 if inPoint did not move the start */
    if (Math.abs(Number(n2.start.ticks) - 400 * ft) > ft / 2) {
        try { n2.start = S03_T(400 * ft); r.N2_via += "+start"; } catch (e3) { r.N2_via += " start threw " + e3.message; }
    }
    r.N2_restored = S03_brief(n2, ft);
    /* texts and names survive? */
    var c1 = S03_clipAt(seq, TI, 100 * ft), c2 = S03_clipAt(seq, TI, 400 * ft);
    r.N1_text = c1 ? S03_texts(c1)[0] : null; r.N2_text = c2 ? S03_texts(c2)[0] : null;
    r.track = S03_track(seq, TI);
    return JSON.stringify(r);
})();
