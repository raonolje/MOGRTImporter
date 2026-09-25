/* tidy: put the bg_gray.png out point back to its import default (w_final cleared it) and save */
(function () {
    var bg = null;
    for (var i = 0; i < app.project.rootItem.children.numItems; i++) if (String(app.project.rootItem.children[i].name) === "bg_gray.png") bg = app.project.rootItem.children[i];
    bg.setOutPoint(String(Math.round(4.97163333333333 * 254016000000)), 4);
    var o = bg.getOutPoint().seconds;
    return "bg out=" + o + " save=" + app.project.save();
})();
