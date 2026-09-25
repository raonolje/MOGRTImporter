"""Bake text into a copy of a Premiere-native .mogrt (Source Text default blob) and write a probe JSX that imports it."""
import zipfile, io, gzip, re, base64, struct, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.environ["APPDATA"], "Adobe", "Common", "Motion Graphics Templates", "Lower Thirds", "Classic Lower Third Two Lines.mogrt")
TEXTS = ["BAKED 첫째 줄", "둘째 필드 OK"]  # component order

def patch_prproj_xml(xml):
    idx = [0]
    def repl(m):
        head, b64, tail = m.group(1), m.group(2), m.group(3)
        b = base64.b64decode(b64.strip())
        n = struct.unpack("<Q", b[:8])[0]
        d = json.loads(b[8:8 + n].decode("utf-16le"))
        i = idx[0]; idx[0] += 1
        if i < len(TEXTS):
            d["mTextParam"]["mStyleSheet"]["mText"] = TEXTS[i]
        js = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-16le")
        nb = struct.pack("<Q", len(js)) + js + b[8 + n:]
        return head + base64.b64encode(nb).decode("ascii") + tail
    pat = re.compile(r'(<Name>Source Text</Name>.*?<StartKeyframeValue Encoding="base64"[^>]*>)([^<]+)(<)', re.S)
    out = pat.sub(repl, xml)
    return out, idx[0]

def patch_prgraphic(data):
    inner = zipfile.ZipFile(io.BytesIO(data))
    buf = io.BytesIO()
    zo = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    count = 0
    for info in inner.infolist():
        raw = inner.read(info.filename)
        if info.filename.endswith(".prproj"):
            xml = gzip.decompress(raw).decode("utf-8")
            xml, c = patch_prproj_xml(xml); count += c
            raw = gzip.compress(xml.encode("utf-8"))
        zo.writestr(info, raw)
    zo.close()
    return buf.getvalue(), count

z = zipfile.ZipFile(SRC)
dst = os.path.join(HERE, "baked_classic2.mogrt")
zo = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
report = []
for info in z.infolist():
    data = z.read(info.filename)
    if info.filename == "definition.json":
        import uuid
        d = json.loads(data.decode("utf-8"))
        d["capsuleID"] = str(uuid.uuid4())
        d["capsuleName"] = d.get("capsuleName", "") + " (MI baked)"
        ti = 0
        for c in d.get("clientControls", []):
            if c.get("type") == 6 and ti < len(TEXTS):
                for e in (c.get("value") or {}).get("strDB", []):
                    e["str"] = TEXTS[ti]
                ti += 1
        data = json.dumps(d, ensure_ascii=False).encode("utf-8")
        report.append("definition.json: capsuleID %s, %d TextLayer values" % (d["capsuleID"], ti))
    if info.filename.endswith(".prgraphic"):
        data, c = patch_prgraphic(data)
        report.append("%s: %d Source Text patched" % (info.filename, c))
    zo.writestr(info, data)
zo.close()
print("\n".join(report))

jsx = r'''(function(){ var out=[]; try {
 var P="__P__";
 var s=app.project.activeSequence;
 var it=s.importMGT(P, secToTicks(275), 5, 0);
 if(!it) return "import null";
 out.push("placed "+it.name+" "+it.start.seconds.toFixed(2)+"~"+it.end.seconds.toFixed(2));
 ensureQE(); var qs=qe.project.getActiveSequence();
 var tt=new Time(); tt.seconds=277.5; var tc=tt.getFormatted(s.getSettings().videoFrameRate, s.getSettings().videoDisplayFormat);
 var f=Folder.temp.fsName+"\\mi_baked2";
 qs.exportFramePNG(tc, f); out.push("png="+f+".png");
 } catch(e){ out.push("ERR:"+e.message+" line "+e.line); } return out.join("\n"); })();'''.replace("__P__", dst.replace("\\", "/"))
open(os.path.join(HERE, "bake_probe.jsx"), "w", encoding="utf-8").write(jsx)
