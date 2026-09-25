/* (q) run the UNCHANGED v27 applyToTimeline on one payload chunk file (S03_Q_FILES), on T_23976. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var out = [];
    for (var i = 0; i < S03_Q_FILES.length; i++) {
        var f = new File(S03_OUT + "/" + S03_Q_FILES[i]);
        f.encoding = "UTF-8";
        f.open("r"); var s = f.read(); f.close();
        var t0 = S03_now();
        var res = applyToTimeline(s);
        out.push(S03_Q_FILES[i] + ": " + res + " (" + (S03_now() - t0) + " ms)");
    }
    return out.join("\n");
})();
