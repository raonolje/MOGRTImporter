/* list the project tree (read-only): name, type, nodeId, mediaPath, in/out */
(function () {
    var out = [];
    function walk(it, d) {
        for (var i = 0; i < it.children.numItems; i++) {
            var c = it.children[i];
            var mp = "", io = "";
            try { mp = String(c.getMediaPath()); } catch (e) {}
            if (c.type === 1) { try { io = " in=" + c.getInPoint().seconds + " out=" + c.getOutPoint().seconds; } catch (e2) { io = " io-err"; } }
            out.push(new Array(d + 1).join("  ") + c.name + " [t" + c.type + " node " + c.nodeId + "]" + io + (mp ? " mp=" + mp : ""));
            if (c.type === 2) walk(c, d + 1);
        }
    }
    walk(app.project.rootItem, 0);
    return out.join("\n");
})();
