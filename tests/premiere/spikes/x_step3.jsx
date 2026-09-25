/* (x) step 3: after the re-author, what does overwriteClip(cached projectItem) place? (v27 applyToTimeline path + itemCache)
   Q item 000f4291 (same capsule, renamed controls) and 기본 자막 item (old capsule, file now replaced). */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 4;
    var q1 = S03_clipAt(seq, TI, 1000 * ft), q2 = S03_clipAt(seq, TI, 1240 * ft), x1 = S03_clipAt(seq, TI, 0);
    r.samePI_q1q2 = String(q1.projectItem.nodeId) + " / " + String(q2.projectItem.nodeId);
    seq.overwriteClip(q1.projectItem, S03_T(1500 * ft), TI, 0);
    r.owQ = S03_lay(S03_clipAt(seq, TI, 1500 * ft));
    seq.overwriteClip(x1.projectItem, S03_T(1800 * ft), TI, 0);
    var c = S03_clipAt(seq, TI, 1800 * ft);
    r.owOldBasic = { pi: String(c.projectItem.nodeId) + " " + c.projectItem.name, lay: S03_lay(c) };
    /* texts of Q1 vs Q2 vs overwrite clip (defaults) */
    r.textsQ1 = S03_texts(q1); r.textsQ2 = S03_texts(q2); r.textsOwQ = S03_texts(S03_clipAt(seq, TI, 1500 * ft));
    return JSON.stringify(r);
})();
