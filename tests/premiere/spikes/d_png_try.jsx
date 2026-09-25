/* find a working exportFramePNG call form */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = [];
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    ensureQE();
    seq.setPlayerPosition(String(60 * ft));
    var qs = qe.project.getActiveSequence();
    var tc = String(qs.CTI.timecode);
    r.push("tc=" + tc);
    var forms = [
        ["noext_fwd", S03_OUT + "/try_a"],
        ["png_bs", (S03_OUT + "/try_b.png").replace(/\//g, "\\")],
        ["noext_bs", (S03_OUT + "/try_c").replace(/\//g, "\\")]
    ];
    for (var i = 0; i < forms.length; i++) {
        try { var ret = qs.exportFramePNG(tc, forms[i][1]); r.push(forms[i][0] + " ok ret=" + ret); } catch (e) { r.push(forms[i][0] + " threw " + e.message); }
    }
    try { var ret2 = qs.exportFrameJPEG(tc, S03_OUT + "/try_d"); r.push("jpeg noext ok ret=" + ret2); } catch (e2) { r.push("jpeg threw " + e2.message); }
    $.sleep(1500);
    var f = new Folder(S03_OUT).getFiles("try_*");
    for (var k = 0; k < f.length; k++) r.push("file " + f[k].name + " " + f[k].length);
    return r.join("\n");
})();
