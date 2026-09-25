/* (d)(f) which Source Text value format renders on a native Graphic? T_23976 V5 (idx4), clips at 2200/2320/2440/2560f (+bg on V1).
   v1 plain string (v27 behaviour), v2 JSON only, v3 8-byte header (4 UTF-16 units) + JSON, v4 4-byte header (2 units) + JSON. Field 1 untouched. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/native_json_data.jsx");
(function () {
    var r = {};
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq), TI = 4;
    var NAT = S03_MG + "/Lower Thirds/Classic Lower Third Two Lines.mogrt";
    S03_clearTrack(seq, TI);
    r.clearedV4 = S03_clearTrack(seq, 3); /* n0/n1 from d_native_render overlap these times */
    var json = S03_NJSON;
    var nbytes = json.length * 2;
    var h8 = String.fromCharCode(nbytes & 0xffff, (nbytes >>> 16) & 0xffff, 0, 0);
    var h4 = String.fromCharCode(nbytes & 0xffff, (nbytes >>> 16) & 0xffff);
    var vars = [["v1_plain", "PLAIN WRITE"], ["v2_json", json.replace("NATIVE JSON WRITE", "V2 JSON ONLY")],
        ["v3_h8json", h8 + json.replace("NATIVE JSON WRITE", "V3 HDR8 JSON")], ["v4_h4json", h4 + json.replace("NATIVE JSON WRITE", "V4 HDR4 JSON")]];
    var out = [];
    for (var i = 0; i < vars.length; i++) {
        var sf = 2200 + 120 * i;
        var o = { key: vars[i][0] };
        try {
            var cl = seq.importMGT(NAT, String(sf * ft), TI, 0);
            cl.name = "nf_" + vars[i][0];
            var nt = collectNativeTextProps(cl);
            var val = vars[i][1];
            if (i === 2 || i === 3) {
                /* header length must match the body after replacement */
                var body = val.substring(i === 2 ? 4 : 2);
                var nb = body.length * 2;
                val = (i === 2 ? String.fromCharCode(nb & 0xffff, (nb >>> 16) & 0xffff, 0, 0) : String.fromCharCode(nb & 0xffff, (nb >>> 16) & 0xffff)) + body;
            }
            o.setRet = String(nt[0].setValue(val, true));
            var rb = String(nt[0].getValue());
            o.readLen = rb.length; o.readHead = escape(rb.substring(0, 12));
            o.png = S03_exportPNG(seq, (sf + 60) * ft, S03_OUT + "/nf_" + vars[i][0]);
        } catch (e) { o.err = e.message + " line " + e.line; }
        out.push(o);
    }
    r.out = out;
    return JSON.stringify(r);
})();
