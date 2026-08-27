var _setStatus$3 = () => {};
function initTrash(setStatus) {
	_setStatus$3 = setStatus;
}
function renderTrash() {
	const trashWrap = document.getElementById("trashWrap");
	const trashCount = document.getElementById("trashCount");
	const emptyEl = document.getElementById("trashEmpty");
	if (trashCount) trashCount.textContent = state.trashBin.length > 0 ? "(" + state.trashBin.length + ")" : "";
	trashWrap.querySelectorAll(".trash-row").forEach((el) => el.parentNode?.removeChild(el));
	if (emptyEl) emptyEl.style.display = state.trashBin.length === 0 ? "flex" : "none";
	state.trashBin.forEach((item, ti) => {
		const row = document.createElement("div");
		row.className = "trash-row";
		const numEl = document.createElement("span");
		numEl.className = "trash-num";
		numEl.textContent = String(item.sub.index);
		const timeEl = document.createElement("span");
		timeEl.className = "trash-time";
		timeEl.textContent = item.sub.startTime;
		const textEl = document.createElement("span");
		textEl.className = "trash-text";
		textEl.textContent = item.sub.text;
		const restoreBtn = document.createElement("button");
		restoreBtn.className = "btn-restore";
		restoreBtn.textContent = "복구";
		restoreBtn.addEventListener("click", () => restoreSubtitle(ti));
		row.appendChild(numEl);
		row.appendChild(timeEl);
		row.appendChild(textEl);
		row.appendChild(restoreBtn);
		trashWrap.appendChild(row);
	});
}
function restoreSubtitle(trashIdx) {
	const item = state.trashBin.splice(trashIdx, 1)[0];
	const pos = Math.min(item.position, state.subtitles.length);
	state.subtitles.splice(pos, 0, item.sub);
	state.rowStates[item.sub.id] = item.state;
	renderAll();
	renderTrash();
	saveSessionToStorage();
	_setStatus$3("자막 " + item.sub.index + "번 복구됨", "ok");
}
function renderPresetTrash() {
	const presetTrashWrap = document.getElementById("presetTrashWrap");
	if (!presetTrashWrap) return;
	presetTrashWrap.innerHTML = "";
	const emptyEl = document.getElementById("presetTrashEmpty");
	if (state.presetTrash.length === 0) {
		if (emptyEl) emptyEl.style.display = "flex";
		return;
	}
	if (emptyEl) emptyEl.style.display = "none";
	state.presetTrash.forEach((item, ti) => {
		const row = document.createElement("div");
		row.className = "trash-row";
		const nameEl = document.createElement("span");
		nameEl.className = "trash-text";
		nameEl.textContent = item.preset.name;
		const mogrtEl = document.createElement("span");
		mogrtEl.className = "trash-time";
		mogrtEl.textContent = item.preset.mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "";
		const restoreBtn = document.createElement("button");
		restoreBtn.className = "btn-restore";
		restoreBtn.textContent = "복구";
		restoreBtn.addEventListener("click", () => {
			const restored = state.presetTrash.splice(ti, 1)[0];
			state.presets[restored.preset.id] = restored.preset;
			savePresetsToStorage();
			renderPresetList();
			renderPresetTrash();
			refreshAllSelects();
			_setStatus$3("프리셋 \"" + restored.preset.name + "\" 복구됨", "ok");
		});
		row.appendChild(nameEl);
		row.appendChild(mogrtEl);
		row.appendChild(restoreBtn);
		presetTrashWrap.appendChild(row);
	});
}
function bindTrashEvents() {
	document.getElementById("btnEmptyTrash")?.addEventListener("click", () => {
		state.trashBin = [];
		renderTrash();
		saveSessionToStorage();
		_setStatus$3("휴지통 비움", "ok");
	});
	document.getElementById("btnRestoreAll")?.addEventListener("click", () => {
		const count = state.trashBin.length;
		if (count === 0) return;
		const sorted = [...state.trashBin].sort((a, b) => a.position - b.position);
		state.trashBin = [];
		sorted.forEach((item) => {
			const pos = Math.min(item.position, state.subtitles.length);
			state.subtitles.splice(pos, 0, item.sub);
			state.rowStates[item.sub.id] = item.state;
		});
		renderAll();
		renderTrash();
		saveSessionToStorage();
		_setStatus$3(count + "개 자막 전체 복구됨", "ok");
	});
	document.getElementById("btnEmptyPresetTrash")?.addEventListener("click", () => {
		state.presetTrash = [];
		renderPresetTrash();
		savePresetsToStorage();
		_setStatus$3("프리셋 휴지통 비움", "ok");
	});
}
