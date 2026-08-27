var _cs = null;
function getCS() {
	if (!_cs) _cs = new window.CSInterface();
	return _cs;
}
function evalScript(script) {
	return new Promise((resolve) => {
		getCS().evalScript(script, (res) => resolve(res || ""));
	});
}
function evalScriptWithPayload(funcName, payload) {
	const json = JSON.stringify(payload);
	return evalScript(`${funcName}(decodeURIComponent("${encodeURIComponent(json)}"))`);
}
