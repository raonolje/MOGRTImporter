/* (w) native readback before/after project save (no reopen: closing projects is forbidden in this run),
   (a) control: setOutPoint on a still project item, (y) native D from placement, (u) caption frame on T_TC1h, then save. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var big = S03_seq("T_BIG"), main = S03_seq("T_23976");
    function nat(seq, ti, k) { var p = collectNativeTextProps(seq.videoTracks[ti].clips[k]); var a = []; for (var i = 0; i < p.length; i++) a.push(escape(String(p[i].getValue()))); return a; }
    function findClip(seq, ti, name) { var cs = seq.videoTracks[ti].clips; for (var i = 0; i < cs.numItems; i++) if (String(cs[i].name) === name) return cs[i]; return null; }
    r.defaultBefore = nat(big, 1, 0);
    var d3 = findClip(main, 1, "d3_NAT_LF");
    function natOf(cl) { var p = collectNativeTextProps(cl); var a = []; for (var i = 0; i < p.length; i++) a.push(escape(String(p[i].getValue()))); return a; }
    r.writtenBefore = natOf(d3);
    /* (a) control on a still */
    var bg = null;
    for (var i = 0; i < app.project.rootItem.children.numItems; i++) if (String(app.project.rootItem.children[i].name) === "bg_gray.png") bg = app.project.rootItem.children[i];
    var o0 = bg.getOutPoint();
    bg.setOutPoint(String(Number(bg.getInPoint().ticks) + 48 * 10594584000), 4);
    r.stillOutAfterSet = [o0.seconds, bg.getOutPoint().seconds];
    bg.clearOutPoint();
    r.stillOutAfterClear = bg.getOutPoint().seconds;
    /* (y) native D */
    S03_activate(main);
    var ft = S03_ft(main);
    var nc = main.importMGT(S03_MG + "/Lower Thirds/Classic Lower Third Two Lines.mogrt", String(5000 * ft), 4, 0);
    r.nativeD_frames = (Number(nc.end.ticks) - Number(nc.start.ticks)) / ft;
    r.nativeIn = nc.inPoint.seconds;
    nc.remove(false, false);
    /* (u) caption at 1.5 s on T_TC1h */
    var tc = S03_seq("T_TC1h");
    S03_activate(tc);
    r.tc1h_png = S03_exportPNG(tc, Math.round(1.5 * S03_TPS / 10594584000) * 10594584000, S03_OUT + "/u_TC1h_1500ms");
    r.tc1h_png2 = S03_exportPNG(tc, Math.round(3.5 * S03_TPS / 10594584000) * 10594584000, S03_OUT + "/u_TC1h_3500ms");
    tc.setPlayerPosition("0");
    S03_activate(main);
    /* save */
    var t0 = S03_now();
    r.saveRet = String(app.project.save());
    r.saveMs = S03_now() - t0;
    r.defaultAfter = nat(big, 1, 0);
    r.writtenAfter = natOf(findClip(main, 1, "d3_NAT_LF"));
    return JSON.stringify(r);
})();
