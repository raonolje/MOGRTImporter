/* (d) line breaks + (f) native field order: clean T_23976 V2-V7, place the test clips, export a PNG at each clip's midpoint.
   V2 (idx1): d1 AE LF, d2 AE CR, d3 native LF, d4 native CR, d5 AE Korean LF, d6 native Korean LF
   V3 (idx2): f1 Classic Lower Third Two Lines, f2 Basic Lower Third, f3 MOGRT샘플 (FIELD_ZERO/FIELD_ONE by component order) */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var r = { cleared: 0, clips: [] };
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    for (var t = 1; t < seq.videoTracks.numTracks; t++) r.cleared += S03_clearTrack(seq, t);
    var AE = S03_PRESETS[0].mogrtPath; /* preset_1 auto line-break box, caption idx 4 */
    var NAT = S03_MG + "/Lower Thirds/Classic Lower Third Two Lines.mogrt";
    var BASIC = S03_MG + "/Basic Lower Third.mogrt";
    var SAMPLE = S03_MG + "/MOGRT\uc0d8\ud50c.mogrt";
    var LF = "\n", CR = "\r";
    var ko1 = "\uccab\uc9f8 \uc904 \ud14d\uc2a4\ud2b8", ko2 = "\ub458\uc9f8 \uc904 \ud14d\uc2a4\ud2b8";
    var plan = [
        ["d1_AE_LF", AE, 1, 0, [{ index: 4, type: "text", value: "LINE ONE" + LF + "LINE TWO" }]],
        ["d2_AE_CR", AE, 1, 240, [{ index: 4, type: "text", value: "LINE ONE" + CR + "LINE TWO" }]],
        ["d3_NAT_LF", NAT, 1, 480, [{ index: 0, type: "text", value: "LINE ONE" + LF + "LINE TWO" }, { index: 1, type: "text", value: "SECOND FIELD" }]],
        ["d4_NAT_CR", NAT, 1, 720, [{ index: 0, type: "text", value: "LINE ONE" + CR + "LINE TWO" }, { index: 1, type: "text", value: "SECOND FIELD" }]],
        ["d5_AE_KO_LF", AE, 1, 960, [{ index: 4, type: "text", value: ko1 + LF + ko2 }]],
        ["d6_NAT_KO_LF", NAT, 1, 1200, [{ index: 0, type: "text", value: ko1 + LF + ko2 }, { index: 1, type: "text", value: "SECOND FIELD" }]],
        ["f1_ClassicTwoLines", NAT, 2, 1440, [{ index: 0, type: "text", value: "FIELD_ZERO" }, { index: 1, type: "text", value: "FIELD_ONE" }]],
        ["f2_BasicLowerThird", BASIC, 2, 1680, [{ index: 0, type: "text", value: "FIELD_ZERO" }, { index: 1, type: "text", value: "FIELD_ONE" }]],
        ["f3_MOGRT_sample", SAMPLE, 2, 1920, [{ index: 0, type: "text", value: "FIELD_ZERO" }]]
    ];
    for (var i = 0; i < plan.length; i++) {
        var p = plan[i], o = { key: p[0], sf: p[3] };
        try {
            var cl = seq.importMGT(p[1], String(p[3] * ft), p[2], 0);
            cl.name = p[0];
            applyParamsToItem(cl, p[4]);
            o.texts = S03_texts(cl);
            o.nNative = collectNativeTextProps(cl).length;
            var comps = [];
            for (var c = 0; c < cl.components.numItems; c++) comps.push(String(cl.components[c].displayName));
            o.comps = comps.join(",");
            var mid = (p[3] + 60) * ft;
            o.tc = S03_exportPNG(seq, mid, S03_OUT + "/" + p[0] + ".png");
        } catch (e) { o.err = e.message + " line " + e.line; }
        r.clips.push(o);
    }
    return JSON.stringify(r);
})();
