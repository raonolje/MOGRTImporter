/* (q) detail around the damaged cues: clips (sf, ef, in, text) and the expected cue frames/texts nearby */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    var out = [];
    var spots = [["A", 5, [26, 54]], ["B", 6, [27]]];
    for (var v = 0; v < spots.length; v++) {
        var cues = [];
        for (var k = 0; k < 2; k++) {
            var f = new File(S03_OUT + "/q_" + spots[v][0] + "_" + k + ".json"); f.encoding = "UTF-8"; f.open("r"); var p = JSON.parse(f.read()); f.close();
            for (var j = 0; j < p.subtitles.length; j++) cues.push(p.subtitles[j]);
        }
        var cs = seq.videoTracks[spots[v][1]].clips;
        for (var s = 0; s < spots[v][2].length; s++) {
            var qn = spots[v][2][s];
            for (var q = qn - 2; q <= qn + 1; q++) {
                var cu = cues[q - 1];
                out.push(spots[v][0] + " cue " + q + " want [" + cu.frameA + "," + cu.frameB + ") startSec=" + cu.startSec + " key=" + Math.round(cu.startSec * 100) + " '" + cu.text + "'");
            }
            var lo = cues[qn - 3].frameA, hi = cues[qn].frameB;
            for (var c = 0; c < cs.numItems; c++) {
                var cl = cs[c], sf = Number(cl.start.ticks) / ft;
                if (sf >= lo - 1 && sf <= hi + 1) out.push("   clip [" + Math.round(sf * 100) / 100 + "," + Math.round(Number(cl.end.ticks) / ft * 100) / 100 + ") in=" + Math.round(Number(cl.inPoint.ticks) / ft) + " startKey=" + Math.round(cl.start.seconds * 100) + " '" + S03_texts(cl)[0].v + "'");
            }
        }
    }
    return out.join("\n");
})();
