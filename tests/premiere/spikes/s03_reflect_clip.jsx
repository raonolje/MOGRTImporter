/* reflection of TrackItem / Component / ComponentParam / qe TrackItem on the V4 clip (read-only) + video effect names */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    function names(o, label) {
        var ms = [], ps = [];
        try { var m = o.reflect.methods; for (var i = 0; i < m.length; i++) ms.push(m[i].name); } catch (e) { ms.push("<no reflect>"); }
        try { var p = o.reflect.properties; for (var j = 0; j < p.length; j++) ps.push(p[j].name); } catch (e2) {}
        return label + " M: " + ms.join(",") + "\n" + label + " P: " + ps.join(",");
    }
    var seq = S03_seq("T_23976");
    var cl = seq.videoTracks[3].clips[0];
    var out = [];
    out.push(names(cl, "TrackItem"));
    out.push(names(cl.components[0], "Component"));
    out.push(names(cl.components[1].properties[0], "ComponentParam"));
    out.push("comps: " + (function () { var a = []; for (var i = 0; i < cl.components.numItems; i++) a.push(cl.components[i].displayName + "/" + cl.components[i].matchName); return a.join(" | "); })());
    ensureQE();
    var qt = qe.project.getActiveSequence().getVideoTrackAt(3).getItemAt(0);
    out.push(names(qt, "qe.TrackItem"));
    var list = String(qe.project.getVideoEffectList());
    var picks = [];
    var arr = list.split(",");
    for (var k = 0; k < arr.length; k++) { if (/blur|\ud750\ub9bc|gauss|\uac00\uc6b0\uc2a4|tint|crop|\uc790\ub974/i.test(arr[k])) picks.push(arr[k]); }
    out.push("effects(" + arr.length + ") picks: " + picks.join(" | "));
    return out.join("\n");
})();
