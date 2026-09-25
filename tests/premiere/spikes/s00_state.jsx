/* S0-3 state probe (read-only): project, sequences, tracks, root items */
(function () {
    var o = [];
    function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"'; }
    var proj = app.project;
    o.push('"proj":' + q(proj.path));
    o.push('"docId":' + q(proj.documentID));
    var act = proj.activeSequence;
    o.push('"active":' + q(act ? act.name : ""));
    var seqs = [];
    for (var i = 0; i < proj.sequences.numSequences; i++) {
        var s = proj.sequences[i];
        var st = s.getSettings();
        var vt = [];
        for (var t = 0; t < s.videoTracks.numTracks; t++) {
            vt.push(s.videoTracks[t].clips.numItems);
        }
        seqs.push('{"name":' + q(s.name) + ',"id":' + q(s.sequenceID) + ',"fr":' + q(st.videoFrameRate.ticks) + ',"w":' + st.videoFrameWidth +
            ',"zero":' + q(s.zeroPoint) + ',"end":' + q(s.end) + ',"vclips":[' + vt.join(",") + '],"atr":' + s.audioTracks.numTracks + '}');
    }
    o.push('"seqs":[' + seqs.join(",") + ']');
    var root = proj.rootItem;
    var items = [];
    for (var r = 0; r < root.children.numItems; r++) {
        var it = root.children[r];
        var mp = "";
        try { mp = it.getMediaPath(); } catch (e) {}
        items.push('{"name":' + q(it.name) + ',"type":' + it.type + ',"mp":' + q(mp) + ',"tree":' + q(it.treePath) + '}');
    }
    o.push('"root":[' + items.join(",") + ']');
    o.push('"numProjects":' + app.projects.numProjects);
    o.push('"version":' + q(app.version));
    return "{" + o.join(",") + "}";
})();
