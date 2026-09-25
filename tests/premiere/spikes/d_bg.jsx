/* (d)(f) import a gray still and lay it on T_23976 V1 under the test clips (0..2160f), then re-export the frames */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var BG = "C:\\Users\\RAONOLJE\\AppData\\Local\\Temp\\claude\\C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer\\56b630b1-ea58-40cc-a741-968558900505\\scratchpad\\s03\\media\\bg_gray.png";
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    var item = null;
    function find() {
        for (var i = 0; i < app.project.rootItem.children.numItems; i++) if (String(app.project.rootItem.children[i].name) === "bg_gray.png") return app.project.rootItem.children[i];
        return null;
    }
    item = find();
    if (!item) { r.importRet = String(app.project.importFiles([BG], true, app.project.rootItem, false)); item = find(); }
    r.item = item ? String(item.nodeId) : null;
    if (item && seq.videoTracks[0].clips.numItems === 0) {
        seq.overwriteClip(item, S03_T(0), 0, 0);
        var c = seq.videoTracks[0].clips[0];
        r.defaultLenF = S03_frames(c.end.ticks, ft);
        c.end = S03_T(2160 * ft);
        r.bg = S03_brief(c, ft);
    }
    var ex = [];
    for (var t = 1; t <= 2; t++) {
        var tr = seq.videoTracks[t];
        for (var k = 0; k < tr.clips.numItems; k++) {
            var cl = tr.clips[k];
            ex.push(cl.name + " @" + S03_exportPNG(seq, Number(cl.start.ticks) + 60 * ft, S03_OUT + "/" + cl.name));
        }
    }
    r.ex = ex;
    return JSON.stringify(r);
})();
