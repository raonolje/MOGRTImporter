/* (e) Test isolation: Sequence.clone -> rename -> activate -> place -> reactivate original -> deleteSequence. No dialogs expected. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var src = S03_seq("T_23976");
    var n0 = app.project.sequences.numSequences;
    var t0 = S03_now();
    var cr = src.clone();
    r.cloneMs = S03_now() - t0;
    r.cloneRet = String(cr) + " (" + typeof cr + ")";
    r.nAfterClone = app.project.sequences.numSequences;
    r.activeAfterClone = String(app.project.activeSequence.name);
    var cl = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
        var s = app.project.sequences[i];
        if (String(s.sequenceID) !== String(src.sequenceID) && String(s.name).indexOf("T_23976") === 0) cl = s;
    }
    r.cloneName = cl ? String(cl.name) : null;
    if (!cl) return JSON.stringify(r);
    cl.name = "T_iso";
    r.renamed = String(cl.name);
    r.cloneFt = S03_ft(cl);
    r.cloneV = cl.videoTracks.numTracks;
    t0 = S03_now();
    r.activated = S03_activate(cl);
    r.activateMs = S03_now() - t0;
    /* place a native graphic on V2 of the clone */
    t0 = S03_now();
    var it = cl.importMGT(S03_MG + "/Lower Thirds/Classic Lower Third Two Lines.mogrt", "0", 1, 0);
    r.importMs = S03_now() - t0;
    r.placed = it ? String(it.name) : null;
    r.srcClipsV2 = src.videoTracks[1].clips.numItems;
    r.cloneClipsV2 = cl.videoTracks[1].clips.numItems;
    t0 = S03_now();
    r.backToSrc = S03_activate(src);
    r.reactivateMs = S03_now() - t0;
    t0 = S03_now();
    var dr = app.project.deleteSequence(cl);
    r.deleteMs = S03_now() - t0;
    r.deleteRet = String(dr);
    r.nAfterDelete = app.project.sequences.numSequences;
    r.n0 = n0;
    r.active = String(app.project.activeSequence.name);
    /* is the sequence project item gone from the root bin too? */
    var left = [];
    for (var k = 0; k < app.project.rootItem.children.numItems; k++) left.push(String(app.project.rootItem.children[k].name));
    r.rootItems = left;
    return JSON.stringify(r);
})();
