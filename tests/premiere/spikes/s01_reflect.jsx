/* S0-3 reflection (read-only): method lists of the objects the probes use */
(function () {
    function names(o, label) {
        var ms = [], ps = [];
        try { var m = o.reflect.methods; for (var i = 0; i < m.length; i++) ms.push(m[i].name); } catch (e) { ms.push("<no reflect " + e.message + ">"); }
        try { var p = o.reflect.properties; for (var j = 0; j < p.length; j++) ps.push(p[j].name); } catch (e2) {}
        return label + " M: " + ms.join(",") + "\n" + label + " P: " + ps.join(",");
    }
    var out = [];
    ensureQE();
    out.push(names(app.project, "app.project"));
    out.push(names(app.project.activeSequence, "Sequence"));
    out.push(names(app.project.activeSequence.videoTracks[0], "Track"));
    out.push(names(app.project.rootItem, "ProjectItem(root)"));
    out.push(names(qe.project, "qe.project"));
    out.push(names(qe.project.getActiveSequence(), "qe.seq"));
    out.push(names(qe.project.getActiveSequence().getVideoTrackAt(0), "qe.track"));
    return out.join("\n");
})();
