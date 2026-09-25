/* (q) compare T_23976 V6 (variant A, ms-rounded) and V7 (variant B, ms-truncated) with the expected 60 cue frames:
   clip count, cues without an exact clip, overlaps, head cuts (clip start later than the cue / inPoint shifted), extra clips. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    var res = {};
    var files = [["A", 5, ["q_A_0.json", "q_A_1.json"]], ["B", 6, ["q_B_0.json", "q_B_1.json"]]];
    for (var v = 0; v < files.length; v++) {
        var cues = [];
        for (var k = 0; k < 2; k++) {
            var f = new File(S03_OUT + "/" + files[v][2][k]); f.encoding = "UTF-8"; f.open("r"); var p = JSON.parse(f.read()); f.close();
            for (var j = 0; j < p.subtitles.length; j++) cues.push(p.subtitles[j]);
        }
        var tr = seq.videoTracks[files[v][1]], cs = tr.clips, n = cs.numItems, clips = [];
        for (var c = 0; c < n; c++) {
            var cl = cs[c];
            clips.push({ sf: Number(cl.start.ticks) / ft, ef: Number(cl.end.ticks) / ft, inF: Number(cl.inPoint.ticks) / ft, t: S03_texts(cl)[0].v });
        }
        clips.sort(function (a, b) { return a.sf - b.sf; });
        var minIn = 1e12;
        for (c = 0; c < clips.length; c++) if (clips[c].inF < minIn) minIn = clips[c].inF;
        var r = { clips: n, cues: cues.length, exact: 0, missing: [], headCut: [], wrongText: [], overlaps: 0, endFrac: 0 };
        for (c = 1; c < clips.length; c++) if (clips[c].sf < clips[c - 1].ef - 0.01) r.overlaps++;
        for (c = 0; c < clips.length; c++) { if (Math.abs(clips[c].ef - Math.round(clips[c].ef)) > 0.001) r.endFrac++; if (clips[c].inF > minIn + 0.5) r.headCut.push(Math.round(clips[c].sf) + "(+" + Math.round(clips[c].inF - minIn) + "f)"); }
        for (var q = 0; q < cues.length; q++) {
            var want = cues[q].frameA, hit = null;
            for (c = 0; c < clips.length; c++) if (Math.abs(clips[c].sf - want) < 0.5) hit = clips[c];
            if (!hit) { r.missing.push(q + 1); continue; }
            if (hit.t !== cues[q].text) r.wrongText.push(q + 1);
            else r.exact++;
        }
        res[files[v][0]] = r;
    }
    return JSON.stringify(res);
})();
