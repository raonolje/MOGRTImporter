/* (m) readback cost of texts / lay / deco on 20 AE (T_BIG V3) and 20 native clips (T_BIG V2, placed here if missing). */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_BIG");
    S03_activate(seq);
    var ft = S03_ft(seq);
    var NAT = S03_MG + "/Lower Thirds/Classic Lower Third Two Lines.mogrt";
    var tr2 = seq.videoTracks[1];
    if (tr2.clips.numItems < 20) {
        var t0 = S03_now();
        for (var k = tr2.clips.numItems; k < 20; k++) { var c0 = seq.importMGT(NAT, String((k * 96 + 24) * ft), 1, 0); c0.end = S03_T((k * 96 + 90) * ft); }
        r.nativeImportMsEach = Math.round((S03_now() - t0) / 20);
    }
    function measure(ti) {
        var cs = seq.videoTracks[ti].clips;
        var sum = { texts: 0, lay: 0, deco: 0, all: 0 }, n = 0;
        for (var c = 0; c < 20; c++) {
            var cl = cs[c];
            var a = S03_now(); S03_texts(cl); var b = S03_now(); S03_lay(cl); var d = S03_now(); S03_deco(cl); var e = S03_now();
            sum.texts += b - a; sum.lay += d - b; sum.deco += e - d; sum.all += e - a; n++;
        }
        return { n: n, texts: sum.texts / n, lay: sum.lay / n, deco: sum.deco / n, all: sum.all / n };
    }
    r.ae = measure(2);
    r.native = measure(1);
    /* native readback stability (w): two reads of the same untouched clip, then after save */
    var nc = seq.videoTracks[1].clips[0];
    var p = collectNativeTextProps(nc);
    r.w_read1 = [escape(String(p[0].getValue())), escape(String(p[1].getValue()))];
    r.w_read2 = [escape(String(p[0].getValue())), escape(String(p[1].getValue()))];
    S03_activate(S03_seq("T_23976"));
    return JSON.stringify(r);
})();
