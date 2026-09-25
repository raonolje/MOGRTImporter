/* (d)(f)(w) does a native Graphic render its text at all? default (unwritten) vs written, frames at +12/+60/+100.
   T_23976 V4 (idx3): n0 default at 2200f, n1 written at 2400f; bg extended to 2700f. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 3;
    var NAT = S03_MG + "/Lower Thirds/Classic Lower Third Two Lines.mogrt";
    seq.videoTracks[0].clips[0].end = S03_T(2700 * ft);
    S03_clearTrack(seq, TI);
    var n0 = seq.importMGT(NAT, String(2200 * ft), TI, 0);
    n0.name = "n0_default";
    var n1 = seq.importMGT(NAT, String(2400 * ft), TI, 0);
    n1.name = "n1_written";
    var nt = collectNativeTextProps(n1);
    r.n0_raw = [];
    var nt0 = collectNativeTextProps(n0);
    for (var i = 0; i < nt0.length; i++) { var v = String(nt0[i].getValue()); r.n0_raw.push(v.length + ":" + escape(v).substring(0, 80)); }
    nt[0].setValue("WRITTEN ZERO", true);
    nt[1].setValue("WRITTEN ONE", true);
    r.n1_read = [String(nt[0].getValue()), String(nt[1].getValue())];
    var ex = [];
    var offs = [12, 60, 100];
    for (var k = 0; k < offs.length; k++) {
        ex.push(S03_exportPNG(seq, (2200 + offs[k]) * ft, S03_OUT + "/n0_default_" + offs[k]));
        ex.push(S03_exportPNG(seq, (2400 + offs[k]) * ft, S03_OUT + "/n1_written_" + offs[k]));
    }
    r.ex = ex;
    return JSON.stringify(r);
})();
