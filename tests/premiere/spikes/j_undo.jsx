/* (j) undo steps per 8-item chunk, read through qe.project.undoStackIndex() (the History panel count stays manual).
   T_23976 V5 (idx4) at 3000f+: 8 x (overwriteClip + caption param + end + name). No undo is performed. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 4;
    ensureQE();
    function idx() { try { return qe.project.undoStackIndex(); } catch (e) { try { return "prop:" + qe.project.undoStackIndex; } catch (e2) { return "n/a " + e.message; } } }
    r.i0 = idx();
    S03_clearTrack(seq, TI);
    r.afterClear = idx();
    var P6 = S03_PRESETS[4];
    var first = seq.importMGT(P6.mogrtPath, String(3000 * ft), TI, 0);
    var pi = first.projectItem;
    r.afterImportMGT = idx();
    first.remove(false, false);
    r.afterRemove = idx();
    var steps = [];
    for (var k = 0; k < 8; k++) {
        var sf = 3000 + 96 * k;
        var a = idx();
        seq.overwriteClip(pi, S03_T(sf * ft), TI, 0);
        var b = idx();
        var cl = S03_clipAt(seq, TI, sf * ft);
        applyParamsToItem(cl, [{ index: 0, displayName: P6.params[0].displayName, type: "text", value: "UNDO " + k, rawValue: P6.params[0].rawValue }]);
        var c = idx();
        cl.end = S03_T((sf + 72) * ft);
        var d = idx();
        cl.name = "undo [MI:un01-" + k + ".1]";
        var e = idx();
        steps.push([a, b, c, d, e].join(">"));
    }
    r.steps = steps;
    r.iEnd = idx();
    return JSON.stringify(r);
})();
