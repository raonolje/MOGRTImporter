/* (v) NOT RUN BY THE AGENT — run it yourself while watching Premiere:
     node tests/premiere/run.js --port 7778 --timeout 30000 <this file>
   importMGT of a MOGRT whose fonts are not installed (mogrt/v_missing_font.mogrt, built by mk_missing_font.py).
   If a modal dialog appears, evalScript blocks until you close it: note the dialog title/text and how long it stayed.
   Places on T_23976 V5 (idx4) at 6000f. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    var P = "C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/mogrt/v_missing_font.mogrt";
    var t0 = S03_now();
    var cl = null;
    try { cl = seq.importMGT(P, String(6000 * ft), 4, 0); } catch (e) { r.err = e.message; }
    r.importMs = S03_now() - t0;
    r.placed = cl ? String(cl.name) : null;
    if (cl) {
        r.nText = collectNativeTextProps(cl).length;
        cl.name = "v_missing_font";
        r.png = S03_exportPNG(seq, (6000 + 60) * ft, S03_OUT + "/v_missing_font");
    }
    return JSON.stringify(r);
})();
