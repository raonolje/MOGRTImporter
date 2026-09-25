/* (i)(u) prep: import the synthetic caption SRT and create a caption track on T_TC1h (zero point 01:00:00:00) and on T_23976.
   The user then exports each caption track from the Korean UI (manual). Idempotent: skips if the SRT item already exists. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var SRC = "C:\\Users\\RAONOLJE\\AppData\\Local\\Temp\\claude\\C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer\\56b630b1-ea58-40cc-a741-968558900505\\scratchpad\\s03\\srt\\s03_caption_src.srt";
    function find() {
        for (var i = 0; i < app.project.rootItem.children.numItems; i++) if (String(app.project.rootItem.children[i].name) === "s03_caption_src.srt") return app.project.rootItem.children[i];
        return null;
    }
    var it = find();
    if (!it) { r.importRet = String(app.project.importFiles([SRC], true, app.project.rootItem, false)); it = find(); }
    r.item = it ? String(it.nodeId) : null;
    if (!it) return JSON.stringify(r);
    var names = ["T_TC1h", "T_23976"];
    for (var n = 0; n < names.length; n++) {
        var seq = S03_seq(names[n]);
        S03_activate(seq);
        var t0 = S03_now();
        var ret;
        try { ret = seq.createCaptionTrack(it, 0, Sequence.CAPTION_FORMAT_SUBTITLE); } catch (e) { ret = "threw " + e.message; }
        r[names[n]] = { ret: String(ret), ms: S03_now() - t0, zero: String(seq.zeroPoint) };
    }
    S03_activate(S03_seq("T_23976"));
    return JSON.stringify(r);
})();
