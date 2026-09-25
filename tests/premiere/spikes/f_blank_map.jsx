/* (f) component order <-> visible field, by blanking: a written native Source Text renders empty (see d_native_formats),
   so writing ONLY component k shows which on-screen line component k is. T_23976 V4 (idx3):
   Basic Lower Third: default @2200, write k=0 @2320, write k=1 @2440. bg on V1 till 2700f. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 3;
    var BASIC = S03_MG + "/Basic Lower Third.mogrt";
    r.clearedV5 = S03_clearTrack(seq, 4);
    S03_clearTrack(seq, TI);
    var plan = [["fb_basic_default", -1], ["fb_basic_w0", 0], ["fb_basic_w1", 1]];
    var out = [];
    for (var i = 0; i < plan.length; i++) {
        var sf = 2200 + 120 * i;
        var cl = seq.importMGT(BASIC, String(sf * ft), TI, 0);
        cl.name = plan[i][0];
        if (plan[i][1] >= 0) collectNativeTextProps(cl)[plan[i][1]].setValue("W", true);
        out.push(plan[i][0] + " " + S03_exportPNG(seq, (sf + 60) * ft, S03_OUT + "/" + plan[i][0]));
    }
    r.out = out;
    return JSON.stringify(r);
})();
