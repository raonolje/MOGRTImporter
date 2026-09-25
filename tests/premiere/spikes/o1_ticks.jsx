/* (o)(p)(q-snap) frame-exact ticks, start snap rule of importMGT / overwriteClip, end snap, zero point basis.
   Per sequence: V2 (idx1) exact frames, V3 (idx2) fractional frames. Clips are removed at the end. */
$.evalFile("C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/s03/spikes/lib_s03.jsx");
(function () {
    var AE = S03_MG + "/\ubc18\uc751\ud615 \ubc15\uc2a4 \uc790\ub9c9.mogrt"; /* 반응형 박스 자막.mogrt (small AE) */
    var names = ["T_23976", "T_2997", "T_25", "T_5994", "T_TC1h"];
    var res = {};
    for (var n = 0; n < names.length; n++) {
        var r = {};
        res[names[n]] = r;
        try {
            var seq = S03_seq(names[n]);
            S03_activate(seq);
            var ft = S03_ft(seq);
            r.ft = ft;
            r.zero = String(seq.zeroPoint);
            S03_clearTrack(seq, 1); S03_clearTrack(seq, 2);
            /* exact frame via importMGT ticks string */
            var t0 = S03_now();
            var a = seq.importMGT(AE, String(24 * ft), 1, 0);
            r.importMs = S03_now() - t0;
            r.imp24 = S03_frames(a.start.ticks, ft);
            r.imp24endDefault = S03_frames(a.end.ticks, ft);
            var pi = a.projectItem;
            /* exact frame via overwriteClip Time.ticks */
            t0 = S03_now();
            seq.overwriteClip(pi, S03_T(719 * ft), 1, 0);
            r.owMs = S03_now() - t0;
            var b = S03_clipAt(seq, 1, 719 * ft, 1);
            r.ow719 = b ? S03_frames(b.start.ticks, ft) : null;
            /* large frame (exactness near 2^53 limit) */
            if (names[n] === "T_23976") {
                seq.overwriteClip(pi, S03_T(700000 * ft), 1, 0);
                var big = S03_clipAt(seq, 1, 700000 * ft, 1);
                r.ow700000 = big ? S03_frames(big.start.ticks, ft) : null;
                r.ow700000ticks = big ? String(big.start.ticks) : null;
                r.want700000ticks = String(700000 * ft);
                if (big) big.remove(false, false);
            }
            /* fractional frames on V3 */
            var fr = [[719.6, "impT"], [1200.4, "impT"], [1439.6, "owT"], [1600.4, "owT"], [1800.6, "owS"], [2000.4, "owS"], [2200.5, "impT"]];
            var bef, c;
            for (var k = 0; k < fr.length; k++) {
                var f = fr[k][0], how = fr[k][1];
                bef = S03_nodeIds(seq, 2);
                var tk = Math.round(f * ft);
                if (how === "impT") seq.importMGT(AE, String(tk), 2, 0);
                else if (how === "owT") seq.overwriteClip(pi, S03_T(tk), 2, 0);
                else seq.overwriteClip(pi, S03_S(tk / S03_TPS), 2, 0);
                c = S03_newClip(seq, 2, bef);
                r[how + "_" + f] = c ? S03_frames(c.start.ticks, ft) : null;
                /* trim to 10 frames so the next placement does not overlap */
                if (c) c.end = S03_T((Math.floor(f) + 10) * ft);
            }
            /* end snap: set end between frames on the 24f clip */
            a.end = S03_T(Math.round(60.4 * ft)); r.end60_4 = S03_frames(a.end.ticks, ft);
            a.end = S03_T(Math.round(70.6 * ft)); r.end70_6 = S03_frames(a.end.ticks, ft);
            a.end = S03_S(80.5 * ft / S03_TPS); r.endSec80_5 = S03_frames(a.end.ticks, ft);
            a.end = S03_T(90 * ft); r.end90 = S03_frames(a.end.ticks, ft);
            /* zero point basis */
            seq.setPlayerPosition(String(24 * ft));
            ensureQE();
            r.cti24tc = String(qe.project.getActiveSequence().CTI.timecode);
            r.playerPos24 = S03_frames(seq.getPlayerPosition().ticks, ft);
            r.clipStartSec = a.start.seconds;
            if (names[n] === "T_TC1h") {
                /* place at zeroPoint + 48f: where does it land? */
                bef = S03_nodeIds(seq, 1);
                var zp = Number(seq.zeroPoint);
                seq.importMGT(AE, String(zp + 48 * ft), 1, 0);
                c = S03_newClip(seq, 1, bef);
                r.impZeroPlus48 = c ? S03_frames(c.start.ticks, ft) : null;
                r.impZeroPlus48tc = null;
                if (c) { seq.setPlayerPosition(String(c.start.ticks)); r.impZeroPlus48tc = String(qe.project.getActiveSequence().CTI.timecode); c.remove(false, false); }
                r.seqEndF = S03_frames(seq.end, ft);
                r.inPt = String(seq.getInPoint()); r.outPt = String(seq.getOutPoint());
            }
            r.leftV2 = S03_clearTrack(seq, 1); r.leftV3 = S03_clearTrack(seq, 2);
        } catch (e) { r.err = e.message + " line " + e.line; }
    }
    S03_activate(S03_seq("T_23976"));
    return JSON.stringify(res);
})();
