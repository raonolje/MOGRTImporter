/* (s) scan cost on T_BIG (600 stills on V1, 150 AE MOGRT on V3): min-detail read per clip, cached vs uncached collection,
   window filter, per-call nodeId map. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_BIG");
    S03_activate(seq);
    var ft = S03_ft(seq);
    function minDetail(ti, cached) {
        var tr = seq.videoTracks[ti];
        var t0 = S03_now();
        var cs = tr.clips, n = cs.numItems, a = [];
        for (var c = 0; c < n; c++) {
            var cl = cached ? cs[c] : tr.clips[c];
            a.push([Number(cl.start.ticks), Number(cl.end.ticks), String(cl.nodeId), String(cl.name)]);
        }
        var ms = S03_now() - t0;
        return { n: n, ms: ms, msPerClip: Math.round(ms / n * 100) / 100 };
    }
    r.v1_uncached = minDetail(0, false);
    r.v1_cached = minDetail(0, true);
    r.v3_uncached = minDetail(2, false);
    r.v3_cached = minDetail(2, true);
    /* start-only pass then details inside a +-30 s window around 5 min */
    var tr3 = seq.videoTracks[2], cs3 = tr3.clips, n3 = cs3.numItems;
    var lo = (300 - 30) * S03_TPS, hi = (300 + 30) * S03_TPS;
    var t0 = S03_now(), inWin = 0;
    for (var c = 0; c < n3; c++) {
        var cl = cs3[c];
        var st = Number(cl.start.ticks);
        if (st >= lo && st < hi) { inWin++; var x = [Number(cl.end.ticks), String(cl.nodeId), String(cl.name)]; }
    }
    r.v3_window = { n: n3, inWindow: inWin, ms: S03_now() - t0 };
    var tr1 = seq.videoTracks[0], cs1 = tr1.clips, n1 = cs1.numItems;
    t0 = S03_now(); inWin = 0;
    for (c = 0; c < n1; c++) { var st1 = Number(cs1[c].start.ticks); if (st1 >= lo && st1 < hi) inWin++; }
    r.v1_startOnly = { n: n1, inWindow: inWin, ms: S03_now() - t0 };
    /* per-call nodeId map for V3, then 10 lookups */
    t0 = S03_now();
    var map = {};
    for (c = 0; c < n3; c++) { var cc = cs3[c]; map[String(cc.nodeId)] = cc; }
    r.v3_nodeMapMs = S03_now() - t0;
    var ids = [];
    for (c = 0; c < 10; c++) ids.push(String(cs3[c * 15].nodeId));
    t0 = S03_now();
    var found = 0;
    for (c = 0; c < ids.length; c++) { var hit = map[ids[c]]; if (hit && String(hit.name).indexOf("[MI:") > 0) found++; }
    r.v3_10lookupsMs = S03_now() - t0; r.found = found;
    /* is track.clips sorted by start after placements? */
    var sorted = true, prev = -1;
    for (c = 0; c < n3; c++) { var s0 = Number(cs3[c].start.ticks); if (s0 < prev) sorted = false; prev = s0; }
    r.v3_sorted = sorted;
    S03_activate(S03_seq("T_23976"));
    return JSON.stringify(r);
})();
