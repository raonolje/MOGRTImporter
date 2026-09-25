(function(){ var out=[]; try {
 var P=$.getenv("APPDATA")+"/Adobe/Common/Motion Graphics Templates/Lower Thirds/Classic Lower Third Two Lines.mogrt";
 var s=app.project.activeSequence;
 var J="{\"mTextParam\":{\"mAlignment\":0,\"mDefaultRun\":[],\"mHeight\":0,\"mHindiDigits\":false,\"mIndic\":false,\"mIsVerticalText\":false,\"mLeading\":0,\"mLigatures\":false,\"mRTL\":false,\"mShadowAngle\":171.86990356445312,\"mShadowBlur\":20,\"mShadowColor\":0,\"mShadowOffset\":3,\"mShadowOpacity\":100,\"mShadowVisible\":true,\"mStyleSheet\":{\"mBaselineShift\":{\"mParamValues\":[[0,-20]]},\"mFillColor\":{\"mParamValues\":[[0,16777215]]},\"mFillOverStroke\":{\"mParamValues\":[[0,false]]},\"mFillVisible\":{\"mParamValues\":[[0,true]]},\"mFontName\":{\"mParamValues\":[[0,\"RobotoSlab-Bold\"]]},\"mFontSize\":{\"mParamValues\":[[0,53.250003814697266]]},\"mKerning\":{\"mParamValues\":[[0,0]]},\"mStrokeColor\":{\"mParamValues\":[[0,16777215]]},\"mStrokeVisible\":{\"mParamValues\":[[0,false]]},\"mStrokeWidth\":{\"mParamValues\":[[0,1]]},\"mText\":\"NATIVE \ud55c\uae00 OK\",\"mTracking\":{\"mParamValues\":[[0,0]]},\"mTsumi\":{\"mParamValues\":[[0,0]]}},\"mTabWidth\":400,\"mWidth\":0},\"mVersion\":1}";
 var nb=J.length*2;
 var hdr=String.fromCharCode(nb & 0xFFFF, (nb>>>16)&0xFFFF, 0, 0);
 var variants=[["hdr+json", hdr+J], ["json", J]];
 for(var v=0; v<variants.length; v++){
   var t0=200+v*10;
   var it=s.importMGT(P, secToTicks(t0), 5, 0);
   if(!it){ out.push(variants[v][0]+": import null"); continue; }
   var tp=collectNativeTextProps(it);
   var r=""; try{ r=tp[0].setValue(variants[v][1], true); }catch(e){ r="ex "+e.message; }
   var back=""; try{ var gv=String(tp[0].getValue()); back=gv.length+" chars, first="+gv.charCodeAt(0); }catch(e){ back="ex"; }
   ensureQE(); var qs=qe.project.getActiveSequence();
   var tt=new Time(); tt.seconds=t0+2.5; var tc=tt.getFormatted(s.getSettings().videoFrameRate, s.getSettings().videoDisplayFormat);
   var f=Folder.temp.fsName+"\\mi_native_"+v;
   try{ qs.exportFramePNG(tc, f); }catch(e){}
   out.push(variants[v][0]+": setValue="+r+" readback="+back+" png="+f+".png");
 }
 } catch(e){ out.push("ERR:"+e.message+" line "+e.line); } return out.join("\n"); })();