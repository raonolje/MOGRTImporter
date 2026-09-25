/* (x) step 1: import the ORIGINAL temp MOGRTs. T_23976 V5 (idx 4): x_same_path at 0f, x_q at 1000f. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var DIR = "C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/mogrt/";
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 4;
    S03_clearTrack(seq, TI);
    function place(path, sf) {
        var t0 = S03_now();
        var cl = seq.importMGT(path, String(sf * ft), TI, 0);
        var o = { ms: S03_now() - t0 };
        var pi = cl.projectItem;
        o.pi = pi ? String(pi.nodeId) + " " + pi.name + " | " + pi.getMediaPath() : null;
        o.D = S03_frames(cl.end.ticks, ft) - S03_frames(cl.start.ticks, ft);
        o.lay = S03_lay(cl);
        return o;
    }
    r.X1 = place(DIR + "x_same_path.mogrt", 0);
    r.Q1 = place(DIR + "x_q.mogrt", 1000);
    /* v27 getMogrtParams on the same path: indices listed? (imports on active seq V1 at 0 and removes) */
    var t0 = S03_now();
    var gp = getMogrtParams(DIR + "x_same_path.mogrt");
    r.getMogrtParamsMs = S03_now() - t0;
    try {
        var pj = JSON.parse(gp);
        var idx = [];
        for (var i = 0; i < pj.params.length; i++) idx.push(pj.params[i].index + ":" + pj.params[i].type + ":" + pj.params[i].displayName);
        r.getMogrtParams = idx;
    } catch (e) { r.getMogrtParams = String(gp).substring(0, 300); }
    r.V1afterGetParams = seq.videoTracks[0].clips.numItems;
    return JSON.stringify(r);
})();
