/* (s) build T_BIG part 1: create the sequence (23.976, qe.newSequence) and lay 600 stills on V1 (1 s each). Resumable, 40 s budget. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var T0 = S03_now();
    var seq = S03_seq("T_BIG");
    if (!seq) {
        ensureQE();
        qe.project.newSequence("T_BIG", "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Settings\\SequencePresets\\HD 1080p\\HD 1080p 23.976 fps.sqpreset");
        seq = S03_seq("T_BIG");
        r.created = !!seq;
    }
    S03_activate(seq);
    var ft = S03_ft(seq);
    var bg = null;
    for (var i = 0; i < app.project.rootItem.children.numItems; i++) if (String(app.project.rootItem.children[i].name) === "bg_gray.png") bg = app.project.rootItem.children[i];
    var tr = seq.videoTracks[0];
    var have = tr.clips.numItems;
    var k = have, placed = 0;
    var t1 = S03_now();
    for (; k < 600; k++) {
        if (S03_now() - T0 > 40000) break;
        seq.overwriteClip(bg, S03_T(k * 24 * ft), 0, 0);
        placed++;
    }
    r.owMsPerClip = placed ? (S03_now() - t1) / placed : 0;
    r.placed = placed;
    r.v1Clips = tr.clips.numItems;
    /* last still: trim to 24f */
    try { var last = tr.clips[tr.clips.numItems - 1]; if (Number(last.end.ticks) > 600 * 24 * ft) last.end = S03_T(600 * 24 * ft); } catch (e) {}
    r.totalMs = S03_now() - T0;
    S03_activate(S03_seq("T_23976"));
    return JSON.stringify(r);
})();
