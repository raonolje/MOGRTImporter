/* (s)(5) build T_BIG part 2: 150 AE MOGRT clips (preset_6) on V3 every 96f, each = place + params + end + name + readback.
   Clips 0-74 get the full 15 preset params (v27 style), 75-149 only the caption text. Per-step ms recorded. Resumable, 40 s budget. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var r = { steps: [] };
    var T0 = S03_now();
    var seq = S03_seq("T_BIG");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 2;
    var P6 = S03_PRESETS[4];
    var tr = seq.videoTracks[TI];
    var k = tr.clips.numItems;
    var pi = k > 0 ? tr.clips[0].projectItem : null;
    var sums = { full: [0, 0, 0, 0, 0, 0], text: [0, 0, 0, 0, 0, 0] }, cnt = { full: 0, text: 0 };
    for (; k < 150; k++) {
        if (S03_now() - T0 > 40000) break;
        var sf = k * 96;
        var t = [S03_now()];
        var cl = null;
        if (!pi) { cl = seq.importMGT(P6.mogrtPath, String(sf * ft), TI, 0); pi = cl.projectItem; }
        else { seq.overwriteClip(pi, S03_T(sf * ft), TI, 0); cl = S03_clipAt(seq, TI, sf * ft); }
        t.push(S03_now());
        var mode = k < 75 ? "full" : "text";
        var params;
        if (mode === "full") {
            params = [];
            for (var q = 0; q < P6.params.length; q++) {
                var src = P6.params[q], o = { index: src.index, displayName: src.displayName, type: src.type, value: src.value, rawValue: src.rawValue };
                if (src.colorHex) o.colorHex = src.colorHex;
                params.push(o);
            }
        } else {
            params = [{ index: 0, displayName: P6.params[0].displayName, type: "text", value: "", rawValue: P6.params[0].rawValue }];
        }
        params[0].value = "\ud654\uc790 " + k + " \uc790\ub9c9 \ubb38\uc7a5";
        applyParamsToItem(cl, params);
        t.push(S03_now());
        cl.end = S03_T((sf + 72) * ft);
        t.push(S03_now());
        cl.name = "\ucca0\uc218 [MI:ab12-" + k + ".1]";
        t.push(S03_now());
        var tx = S03_texts(cl);
        t.push(S03_now());
        var nid = String(cl.nodeId);
        t.push(S03_now());
        for (var s = 0; s < 6; s++) sums[mode][s] += (t[s + 1] - t[s]);
        cnt[mode]++;
    }
    function avg(m) { var a = []; for (var i = 0; i < 6; i++) a.push(cnt[m] ? Math.round(sums[m][i] / cnt[m] * 10) / 10 : null); return a; }
    r.stepNames = "place, params, end, name, readTexts, nodeId";
    r.full = { n: cnt.full, avgMs: avg("full") };
    r.text = { n: cnt.text, avgMs: avg("text") };
    r.v3Clips = tr.clips.numItems;
    r.totalMs = S03_now() - T0;
    S03_activate(S03_seq("T_23976"));
    return JSON.stringify(r);
})();
