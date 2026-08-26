var _setStatus$2 = () => {};
var _openPresetModal = () => {};
function initPresetList(setStatus, openPresetModal) {
	_setStatus$2 = setStatus;
	_openPresetModal = openPresetModal;
}
function updatePresetTabCount() {
	const cnt = Object.keys(state.presets).length;
	const el = document.getElementById("presetCount");
	if (el) el.textContent = cnt > 0 ? "(" + cnt + ")" : "";
}
function renderPresetList() {
	const presetList = document.getElementById("presetList");
	if (!presetList) return;
	presetList.innerHTML = "";
	const ids = Object.keys(state.presets);
	if (ids.length === 0) {
		const empty = document.createElement("p");
		empty.className = "empty-hint";
		empty.textContent = "저장된 프리셋이 없습니다. + 프리셋 추가 버튼으로 추가하세요.";
		presetList.appendChild(empty);
		updatePresetTabCount();
		return;
	}
	if (state.presetViewMode === "card") {
		presetList.className = "preset-grid";
		ids.forEach((pid) => presetList.appendChild(makePresetCard(pid)));
	} else {
		presetList.className = "";
		ids.forEach((pid) => presetList.appendChild(makePresetRow(pid)));
	}
	updatePresetTabCount();
}
function makePresetRow(pid) {
	const preset = state.presets[pid];
	const row = document.createElement("div");
	row.className = "preset-row";
	const nameEl = document.createElement("span");
	nameEl.className = "preset-name";
	nameEl.textContent = preset.name;
	const mogrtEl = document.createElement("span");
	mogrtEl.className = "preset-mogrt";
	mogrtEl.textContent = preset.mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "";
	const editBtn = document.createElement("button");
	editBtn.className = "btn";
	editBtn.textContent = "편집";
	editBtn.style.cssText = "font-size:10px;padding:2px 8px;";
	editBtn.addEventListener("click", () => _openPresetModal(pid));
	const delBtn = document.createElement("button");
	delBtn.className = "btn danger";
	delBtn.textContent = "삭제";
	delBtn.style.cssText = "font-size:10px;padding:2px 8px;";
	delBtn.addEventListener("click", () => deletePreset(pid));
	row.appendChild(nameEl);
	row.appendChild(mogrtEl);
	row.appendChild(editBtn);
	row.appendChild(delBtn);
	return row;
}
function makePresetCard(pid) {
	const preset = state.presets[pid];
	const card = document.createElement("div");
	card.className = "preset-card";
	const thumb = document.createElement("div");
	thumb.className = "preset-thumb";
	if (preset.thumbnailData) {
		// 실제 스크린샷 주도 표시
		const thumbImg = document.createElement("img");
		thumbImg.src = preset.thumbnailData;
		thumbImg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:4px 4px 0 0;";
		thumb.appendChild(thumbImg);
	} else {
		// 쓰네일 없으면 기존 텍스트 합성 폴백
		const thumbInner = document.createElement("div");
		thumbInner.className = "preset-thumb-inner";
		let sampleStr = preset.name || "샘플 자막";
		let fontFamily = "";
		let fontSize = 60;
		let isBold = false;
		let isItalic = false;
		let mainColor = "#ffffff";
		if (preset.params) {
			const textParam = preset.params.find((p) => p.type === "text");
			if (textParam?.rawValue) try {
				const parsed = JSON.parse(textParam.rawValue);
				sampleStr = parsed.textEditValue || textParam.value || sampleStr;
				fontFamily = parsed.fontEditValue?.[0] || "";
				fontSize = parsed.fontSizeEditValue?.[0] || 60;
				isBold = parsed.fontFSBoldValue?.[0] || false;
				isItalic = parsed.fontFSItalicValue?.[0] || false;
			} catch (_) {}
			for (const p of preset.params) if (p.type === "color") {
				mainColor = p.colorHex || packedToHex(parsePackedColor(p.rawValue)) || "#ffffff";
				break;
			}
		}
		const scaleInner = document.createElement("div");
		scaleInner.className = "preset-thumb-scale-inner";
		const sampleText = document.createElement("div");
		sampleText.className = "preset-thumb-text";
		sampleText.style.color = mainColor;
		sampleText.style.fontFamily = fontFamily || "inherit";
		sampleText.style.fontSize = fontSize + "px";
		sampleText.style.fontWeight = isBold ? "bold" : "normal";
		sampleText.style.fontStyle = isItalic ? "italic" : "normal";
		sampleText.style.textShadow = "0 1px 4px rgba(0,0,0,0.9)";
		sampleText.style.whiteSpace = "nowrap";
		sampleText.style.position = "absolute";
		sampleText.style.bottom = "60px";
		sampleText.style.left = "50%";
		sampleText.style.transform = "translateX(-50%)";
		sampleText.style.textAlign = "center";
		sampleText.textContent = sampleStr;
		scaleInner.appendChild(sampleText);
		thumbInner.appendChild(scaleInner);
		thumb.appendChild(thumbInner);
		requestAnimationFrame(() => {
			const thumbW = thumb.offsetWidth || 200;
			const thumbH = thumb.offsetHeight || thumbW * .5625;
			const scaleX = thumbW / 1920;
			const scaleY = thumbH / 540;
			const scale = Math.min(scaleX, scaleY);
			scaleInner.style.transform = `scale(${scale})`;
		});
	}
	const nameEl = document.createElement("div");
	nameEl.className = "preset-card-name";
	nameEl.textContent = preset.name;
	const mogrtEl = document.createElement("div");
	mogrtEl.className = "preset-card-mogrt";
	mogrtEl.textContent = preset.mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "";
	const btnWrap = document.createElement("div");
	btnWrap.className = "preset-card-btns";
	const editBtn = document.createElement("button");
	editBtn.className = "btn";
	editBtn.textContent = "편집";
	editBtn.style.cssText = "font-size:10px;padding:2px 8px;flex:1;";
	editBtn.addEventListener("click", () => _openPresetModal(pid));
	const delBtn = document.createElement("button");
	delBtn.className = "btn danger";
	delBtn.textContent = "삭제";
	delBtn.style.cssText = "font-size:10px;padding:2px 8px;flex:1;";
	delBtn.addEventListener("click", () => deletePreset(pid));
	btnWrap.appendChild(editBtn);
	btnWrap.appendChild(delBtn);
	card.appendChild(thumb);
	card.appendChild(nameEl);
	card.appendChild(mogrtEl);
	card.appendChild(btnWrap);
	return card;
}
function deletePreset(pid) {
	if (!state.presets[pid]) return;
	const usedBy = state.subtitles.filter((sub) => state.rowStates[sub.id]?.presetId === pid).map((sub) => sub.index);
	let msg = "\"" + state.presets[pid].name + "\" 프리셋을 삭제하시겠습니까?";
	if (usedBy.length > 0) msg += "\n\n⚠ 이 프리셋은 자막 " + usedBy.join(", ") + "번에 적용되어 있습니다.\n삭제하면 해당 자막의 프리셋 설정이 초기화됩니다.";
	showConfirm(msg, () => doDeletePreset(pid));
}
function doDeletePreset(pid) {
	state.presetTrash.push({
		preset: JSON.parse(JSON.stringify(state.presets[pid])),
		deletedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
	delete state.presets[pid];
	state.subtitles.forEach((sub) => {
		const rs = state.rowStates[sub.id];
		if (rs?.presetId === pid) {
			rs.presetId = "";
			rs.params = [];
			rs._allParams = [];
			const row = document.getElementById("row-" + sub.id);
			if (row) row.className = "sub-row no-mogrt";
			const sel = document.getElementById("sel-" + sub.id);
			if (sel) {
				sel.innerHTML = "";
				const none = document.createElement("option");
				none.value = "";
				none.textContent = "-- 프리셋 선택 --";
				sel.appendChild(none);
			}
			const panel = document.getElementById("params-" + sub.id);
			if (panel) {
				panel.innerHTML = "";
				panel.className = "sub-params";
			}
		}
	});
	savePresetsToStorage();
	saveSessionToStorage();
	renderPresetList();
	renderPresetTrash();
	refreshAllSelects();
	const deletedName = state.presetTrash[state.presetTrash.length - 1]?.preset.name ?? "";
	_setStatus$2("프리셋 \"" + deletedName + "\" 휴지통으로 이동", "ok");
}
function bindPresetViewToggle() {
	const btnViewList = document.getElementById("btnViewList");
	const btnViewCard = document.getElementById("btnViewCard");
	btnViewList?.addEventListener("click", () => {
		state.presetViewMode = "list";
		btnViewList.classList.add("active");
		btnViewCard?.classList.remove("active");
		renderPresetList();
	});
	btnViewCard?.addEventListener("click", () => {
		state.presetViewMode = "card";
		btnViewCard.classList.add("active");
		btnViewList?.classList.remove("active");
		renderPresetList();
	});
}
