/* (w) MANUAL follow-up (read-only): after YOU reopen MI_test.prproj (Ctrl+O) or restart Premiere, run
     node tests/premiere/run.js --port 7778 <this file>
   and compare with out/w_final.txt: native default placeholder on T_BIG V2 clip 0, written native d3_NAT_LF on T_23976 V2,
   plus nodeIds/names of the q clips (T_23976 V6) to confirm persistence. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var big = S03_seq("T_BIG"), main = S03_seq("T_23976");
    function natOf(cl) { var p = collectNativeTextProps(cl); var a = []; for (var i = 0; i < p.length; i++) a.push(escape(String(p[i].getValue()))); return a; }
    r.defaultAfterReopen = natOf(big.videoTracks[1].clips[0]);
    var cs = main.videoTracks[1].clips;
    for (var i = 0; i < cs.numItems; i++) if (String(cs[i].name) === "d3_NAT_LF") r.writtenAfterReopen = natOf(cs[i]);
    var q = main.videoTracks[5].clips, ids = [];
    for (var k = 0; k < Math.min(5, q.numItems); k++) ids.push(String(q[k].nodeId));
    r.qNodeIds = ids;
    return JSON.stringify(r);
})();
