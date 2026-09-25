(function(){ var out=[]; try {
 var P="C:/Users/RAONOLJE/AppData/Local/Temp/claude/C--Users-RAONOLJE-Documents-00-Claude-Project-02-MOGRT-Importer/56b630b1-ea58-40cc-a741-968558900505/scratchpad/native/baked_classic2.mogrt";
 var s=app.project.activeSequence;
 var it=s.importMGT(P, secToTicks(275), 5, 0);
 if(!it) return "import null";
 out.push("placed "+it.name+" "+it.start.seconds.toFixed(2)+"~"+it.end.seconds.toFixed(2));
 ensureQE(); var qs=qe.project.getActiveSequence();
 var tt=new Time(); tt.seconds=277.5; var tc=tt.getFormatted(s.getSettings().videoFrameRate, s.getSettings().videoDisplayFormat);
 var f=Folder.temp.fsName+"\\mi_baked2";
 qs.exportFramePNG(tc, f); out.push("png="+f+".png");
 } catch(e){ out.push("ERR:"+e.message+" line "+e.line); } return out.join("\n"); })();