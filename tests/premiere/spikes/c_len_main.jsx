/* (c)(k)(y) natural length D of the real presets' MOGRTs, identity strings, projectItem in/out.
   Uses S03_C_SET (indexes into S03_PRESETS). Places on T_23976 V2 (idx1) at 10 s * k, then removes the clips. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/presets_data.jsx");
(function () {
    var seq = S03_seq("T_23976");
    S03_activate(seq);
    var ft = S03_ft(seq);
    var res = [];
    for (var s = 0; s < S03_C_SET.length; s++) {
        var p = S03_PRESETS[S03_C_SET[s]];
        var r = { id: p.id };
        res.push(r);
        try {
            var sf = 240 * (S03_C_SET[s] + 1);
            var bef = S03_nodeIds(seq, 1);
            var t0 = S03_now();
            var ret = seq.importMGT(p.mogrtPath, String(sf * ft), 1, 0);
            r.importMs = S03_now() - t0;
            var cl = ret || S03_newClip(seq, 1, bef);
            if (!cl) { r.err = "no clip"; continue; }
            r.retIsClip = !!ret;
            r.sf = S03_frames(cl.start.ticks, ft);
            r.D_frames = S03_frames(cl.end.ticks, ft) - r.sf;
            r.D_sec = cl.end.seconds - cl.start.seconds;
            r.clipIn = cl.inPoint.seconds; r.clipOut = cl.outPoint.seconds;
            r.clipName = String(cl.name);
            var pi = cl.projectItem;
            r.piName = pi ? String(pi.name) : null;
            r.piNode = pi ? String(pi.nodeId) : null;
            r.treePath = pi ? String(pi.treePath) : null;
            r.mediaPath = pi ? String(pi.getMediaPath()) : null;
            if (pi) { r.piIn = pi.getInPoint().seconds; r.piOut = pi.getOutPoint().seconds; r.piDur = r.piOut - r.piIn; }
            var base = String(p.mogrtPath).replace(/\\/g, "/").split("/").pop().replace(/\.mogrt$/i, "");
            r.basename = base;
            r.nameEqBase = (r.piName === base);
            var comp = cl.getMGTComponent();
            r.mgt = !!comp;
            r.mogrtPathProp = comp ? String(comp.mogrtPath) : null;
            r.nProps = comp ? comp.properties.numItems : collectNativeTextProps(cl).length;
            r.presetParams = p.params.length;
            r.comps = cl.components.numItems;
            cl.remove(false, false);
        } catch (e) { r.err = e.message + " line " + e.line; }
    }
    return JSON.stringify(res);
})();
