/* (d)(f) export a PNG at the midpoint of every clip placed by d_f_prep.jsx (T_23976 V2/V3) */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = [];
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    for (var t = 1; t <= 2; t++) {
        var tr = seq.videoTracks[t];
        for (var c = 0; c < tr.clips.numItems; c++) {
            var cl = tr.clips[c];
            var mid = Number(cl.start.ticks) + 60 * ft;
            try { r.push(cl.name + " @" + S03_exportPNG(seq, mid, S03_OUT + "/" + cl.name)); } catch (e) { r.push(cl.name + " ERR " + e.message); }
        }
    }
    seq.setPlayerPosition("0");
    return r.join("\n");
})();
