/* (o) prep: create T_2997, T_25, T_5994 (qe.project.newSequence + HD 1080p preset) and T_TC1h (23.976, zero point 01:00:00:00).
   Leaves T_23976 active at the end. Idempotent: skips names that already exist. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var P = "C:/Program Files/Adobe/Adobe Premiere Pro 2026/Settings/SequencePresets/HD 1080p/";
    var want = [["T_2997", "HD 1080p 29.97 fps.sqpreset"], ["T_25", "HD 1080p 25 fps.sqpreset"], ["T_5994", "HD 1080p 59.94 fps.sqpreset"], ["T_TC1h", "HD 1080p 23.976 fps.sqpreset"]];
    var r = { made: [] };
    ensureQE();
    for (var i = 0; i < want.length; i++) {
        if (S03_seq(want[i][0])) { r.made.push(want[i][0] + ": exists"); continue; }
        var f = new File(P + want[i][1]);
        if (!f.exists) { r.made.push(want[i][0] + ": preset missing"); continue; }
        var t0 = S03_now();
        var ret = qe.project.newSequence(want[i][0], f.fsName);
        var ms = S03_now() - t0;
        var s = S03_seq(want[i][0]);
        r.made.push(want[i][0] + ": ret=" + ret + " ms=" + ms + " found=" + (!!s) + (s ? " ft=" + S03_ft(s) + " V=" + s.videoTracks.numTracks + " active=" + app.project.activeSequence.name : ""));
    }
    var tc = S03_seq("T_TC1h");
    if (tc) {
        var ft = S03_ft(tc);
        var zp = String(86400 * ft);
        r.tcZeroBefore = String(tc.zeroPoint);
        try { r.setZeroRet = String(tc.setZeroPoint(zp)); } catch (e) { r.setZeroErr = e.message; }
        r.tcZeroAfter = String(tc.zeroPoint);
        r.tcZeroWanted = zp;
    }
    S03_activate(S03_seq("T_23976"));
    r.active = String(app.project.activeSequence.name);
    r.seqs = [];
    for (var k = 0; k < app.project.sequences.numSequences; k++) {
        var q = app.project.sequences[k];
        r.seqs.push(String(q.name) + " ft=" + S03_ft(q) + " V=" + q.videoTracks.numTracks + " zero=" + q.zeroPoint + " tb=" + q.timebase);
    }
    return JSON.stringify(r);
})();
