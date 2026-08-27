function renderParams(panel, list, onChange, exposedFontFields) {
	panel.innerHTML = "";
	if (!list || list.length === 0) {
		const p = document.createElement("p");
		p.style.cssText = "color:#555;font-size:11px;padding:6px 0;";
		p.textContent = "노출된 파라미터가 없습니다.";
		panel.appendChild(p);
		return;
	}
	renderParamList(panel, list, onChange, exposedFontFields);
}
function renderParamList(container, list, onChange, exposedFontFields) {
	const groupStates = {};
	let currentGroupEl = container;
	let currentGroupKey = "";
	for (const param of list) {
		if (param.type === "textsetting") {
			currentGroupKey = param.displayName + "_" + param.index;
			groupStates[currentGroupKey] = true;
			const grpHdr = document.createElement("div");
			grpHdr.className = "mogrt-group-header";
			const arrow = document.createElement("span");
			arrow.className = "mogrt-group-arrow open";
			arrow.textContent = "▾";
			grpHdr.appendChild(arrow);
			const title = document.createElement("span");
			title.textContent = param.displayName;
			grpHdr.appendChild(title);
			const grpBody = document.createElement("div");
			grpBody.className = "mogrt-group-body";
			const key = currentGroupKey;
			grpHdr.addEventListener("click", () => {
				groupStates[key] = !groupStates[key];
				grpBody.style.display = groupStates[key] ? "" : "none";
				arrow.textContent = groupStates[key] ? "▾" : "▸";
				arrow.className = "mogrt-group-arrow" + (groupStates[key] ? " open" : "");
			});
			container.appendChild(grpHdr);
			container.appendChild(grpBody);
			currentGroupEl = grpBody;
			continue;
		}
		if (param.type === "group") {
			currentGroupKey = param.displayName + "_" + param.index;
			groupStates[currentGroupKey] = true;
			const grpHdr = document.createElement("div");
			grpHdr.className = "mogrt-group-header";
			const arrow = document.createElement("span");
			arrow.className = "mogrt-group-arrow open";
			arrow.textContent = "▾";
			grpHdr.appendChild(arrow);
			const title = document.createElement("span");
			title.textContent = param.displayName;
			grpHdr.appendChild(title);
			const grpBody = document.createElement("div");
			grpBody.className = "mogrt-group-body";
			const key = currentGroupKey;
			grpHdr.addEventListener("click", () => {
				groupStates[key] = !groupStates[key];
				grpBody.style.display = groupStates[key] ? "" : "none";
				arrow.textContent = groupStates[key] ? "▾" : "▸";
				arrow.className = "mogrt-group-arrow" + (groupStates[key] ? " open" : "");
			});
			container.appendChild(grpHdr);
			container.appendChild(grpBody);
			currentGroupEl = grpBody;
			continue;
		}
		if (param.type === "comment") {
			const cmtEl = document.createElement("div");
			cmtEl.className = "mogrt-comment";
			cmtEl.textContent = param.displayName || param.value || "";
			currentGroupEl.appendChild(cmtEl);
			continue;
		}
		currentGroupEl.appendChild(buildParamControl(param, onChange, exposedFontFields));
	}
}
function buildParamControl(param, onChange, exposedFontFields) {
	const t = param.type;
	if (t === "text") {
		// exposedFontFields가 있으면 해당 인덱스 값 사용
		// 없으면 undefined 전달 → buildMogrtTextBlock에서 fontExposed 기반으로 결정
		const ef = exposedFontFields
			? (exposedFontFields[param.index] !== undefined ? exposedFontFields[param.index] : undefined)
			: undefined;
		return buildMogrtTextBlock(param, onChange, ef);
	}
	const rowEl = document.createElement("div");
	rowEl.className = "mogrt-prop-row";
	if (t === "color") buildColorControl(rowEl, param, onChange);
	else if (t === "number") buildNumberControl(rowEl, param, onChange);
	else if (t === "dropdown") buildDropdownControl(rowEl, param, onChange);
	else if (t === "boolean") buildBooleanControl(rowEl, param, onChange);
	else if (t === "point") buildPointControl(rowEl, param, onChange);
	else if (t === "angle") buildAngleControl(rowEl, param, onChange);
	else {
		const lbl = document.createElement("span");
		lbl.className = "mogrt-prop-label";
		lbl.textContent = param.displayName;
		const val = document.createElement("span");
		val.className = "mogrt-prop-value-text";
		val.textContent = param.value || "";
		rowEl.appendChild(lbl);
		rowEl.appendChild(val);
	}
	return rowEl;
}
function buildColorControl(rowEl, param, onChange) {
	const hexColor = param.colorHex || packedToHex(parsePackedColor(param.rawValue));
	const lbl = document.createElement("span");
	lbl.className = "mogrt-prop-label";
	lbl.textContent = param.displayName;
	const ctrl = document.createElement("div");
	ctrl.className = "mogrt-prop-ctrl";
	const swatchWrap = document.createElement("div");
	swatchWrap.className = "mogrt-color-swatch-wrap";
	swatchWrap.style.cursor = "pointer";
	const swatch = document.createElement("div");
	swatch.className = "mogrt-color-swatch";
	swatch.style.background = hexColor;
	swatchWrap.appendChild(swatch);
	swatchWrap.addEventListener("click", () => {
		CP.open(swatchWrap, param.colorHex || hexColor, (newHex) => {
			swatch.style.background = newHex;
			param.colorHex = newHex;
			param.value = newHex;
			onChange(param);
		});
	});
	ctrl.appendChild(swatchWrap);
	rowEl.appendChild(lbl);
	rowEl.appendChild(ctrl);
}
function buildNumberControl(rowEl, param, onChange) {
	const numVal = parseFloat(param.value) || 0;
	const minV = param.minValue ?? (numVal < 0 ? Math.min(-100, Math.floor(numVal * 2)) : 0);
	const maxV = param.maxValue ?? (numVal > 100 ? Math.max(Math.ceil(numVal * 2), 200) : 100);
	const range = maxV - minV;
	const step = range > 100 ? "0.1" : range > 10 ? "0.1" : "0.01";
	rowEl.className = "mogrt-prop-row mogrt-prop-row--slider";
	const topRow = document.createElement("div");
	topRow.className = "mogrt-slider-toprow";
	const lbl = document.createElement("span");
	lbl.className = "mogrt-prop-label";
	lbl.textContent = param.displayName;
	const valLbl = document.createElement("span");
	valLbl.className = "mogrt-num-value mogrt-num-editable";
	valLbl.title = "클릭하여 직접 입력";
	valLbl.textContent = numVal % 1 === 0 ? String(numVal) : numVal.toFixed(1);
	const sliderEl = document.createElement("input");
	sliderEl.type = "range";
	sliderEl.className = "mogrt-slider";
	sliderEl.min = String(minV);
	sliderEl.max = String(maxV);
	sliderEl.step = step;
	sliderEl.value = String(numVal);
	// 값 클릭 시 인라인 입력 전환
	valLbl.addEventListener("click", () => {
		const inpEdit = document.createElement("input");
		inpEdit.type = "number";
		inpEdit.className = "mogrt-num-inline-input";
		inpEdit.value = param.value;
		inpEdit.step = step;
		valLbl.replaceWith(inpEdit);
		inpEdit.focus(); inpEdit.select();
		const commit = () => {
			const v = parseFloat(inpEdit.value);
			if (!isNaN(v)) {
				param.value = String(v);
				sliderEl.value = String(Math.min(maxV, Math.max(minV, v)));
				valLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
				onChange(param);
			}
			inpEdit.replaceWith(valLbl);
		};
		inpEdit.addEventListener("blur", commit);
		inpEdit.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inpEdit.replaceWith(valLbl); });
	});
	sliderEl.addEventListener("input", () => {
		const v = parseFloat(sliderEl.value);
		valLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
		param.value = sliderEl.value;
		onChange(param);
	});
	topRow.appendChild(lbl);
	topRow.appendChild(valLbl);
	const sliderRow = document.createElement("div");
	sliderRow.className = "mogrt-slider-row";
	const minLbl = document.createElement("span");
	minLbl.className = "mogrt-range-lbl";
	minLbl.textContent = String(minV);
	const maxLbl = document.createElement("span");
	maxLbl.className = "mogrt-range-lbl";
	maxLbl.textContent = String(maxV);
	sliderRow.appendChild(minLbl);
	sliderRow.appendChild(sliderEl);
	sliderRow.appendChild(maxLbl);
	rowEl.appendChild(topRow);
	rowEl.appendChild(sliderRow);
}
function buildDropdownControl(rowEl, param, onChange) {
	const lbl = document.createElement("span");
	lbl.className = "mogrt-prop-label";
	lbl.textContent = param.displayName;
	const ctrl = document.createElement("div");
	ctrl.className = "mogrt-prop-ctrl";
	const sel = document.createElement("select");
	sel.className = "mogrt-dropdown";
	const opts = param.dropdownOptions || [];
	const curV = Math.round(parseFloat(param.value) || 0);
	if (opts.length > 0) opts.forEach((opt, i) => {
		const o = document.createElement("option");
		o.value = String(i);
		o.textContent = opt;
		if (i === curV) o.selected = true;
		sel.appendChild(o);
	});
	else {
		const minV = Math.round(param.minValue ?? 0);
		const maxV = Math.round(param.maxValue ?? 10);
		for (let i = minV; i <= maxV; i++) {
			const o = document.createElement("option");
			o.value = String(i);
			o.textContent = String(i);
			if (i === curV) o.selected = true;
			sel.appendChild(o);
		}
	}
	sel.addEventListener("change", () => {
		param.value = sel.value;
		onChange(param);
	});
	ctrl.appendChild(sel);
	rowEl.appendChild(lbl);
	rowEl.appendChild(ctrl);
}
function buildBooleanControl(rowEl, param, onChange) {
	const lbl = document.createElement("span");
	lbl.className = "mogrt-prop-label";
	lbl.textContent = param.displayName;
	const ctrl = document.createElement("div");
	ctrl.className = "mogrt-prop-ctrl";
	const toggle = document.createElement("label");
	toggle.className = "mogrt-toggle";
	const inpB = document.createElement("input");
	inpB.type = "checkbox";
	inpB.checked = param.value === "true" || param.value === "1";
	const slider = document.createElement("span");
	slider.className = "mogrt-toggle-slider";
	inpB.addEventListener("change", () => {
		param.value = inpB.checked ? "true" : "false";
		onChange(param);
	});
	toggle.appendChild(inpB);
	toggle.appendChild(slider);
	ctrl.appendChild(toggle);
	rowEl.appendChild(lbl);
	rowEl.appendChild(ctrl);
}
function buildPointControl(rowEl, param, onChange) {
	rowEl.className = "mogrt-prop-row mogrt-prop-row--point";
	const parts = (param.value || "0,0").split(",");
	let xVal = parseFloat(parts[0]) || 0;
	let yVal = parseFloat(parts[1]) || 0;
	const titleRow = document.createElement("div");
	titleRow.className = "mogrt-prop-row-title";
	const titleLbl = document.createElement("span");
	titleLbl.className = "mogrt-prop-label";
	titleLbl.textContent = param.displayName;
	titleRow.appendChild(titleLbl);
	rowEl.appendChild(titleRow);
	const pointWrap = document.createElement("div");
	pointWrap.className = "mogrt-point-wrap mogrt-point-drag-wrap";
	// 드래그 입력 헬퍼
	function makeDragValue(axisLabel, initVal, onAxisChange) {
		const wrap = document.createElement("div");
		wrap.className = "mogrt-drag-axis";
		const lbl = document.createElement("span");
		lbl.className = "mogrt-drag-axis-lbl";
		lbl.textContent = axisLabel;
		const valSpan = document.createElement("span");
		valSpan.className = "mogrt-drag-value";
		valSpan.title = "드래그하여 조절 / 더블클릭하여 직접 입력";
		valSpan.textContent = initVal % 1 === 0 ? String(initVal) : initVal.toFixed(1);
		let curVal = initVal;
		let dragStartX = 0, dragStartVal = 0, isDragging = false;
		valSpan.style.cursor = "ew-resize";
		valSpan.addEventListener("mousedown", (e) => {
			isDragging = true;
			dragStartX = e.clientX;
			dragStartVal = curVal;
			e.preventDefault();
			const onMove = (ev) => {
				if (!isDragging) return;
				const delta = (ev.clientX - dragStartX) * 1.0;
				curVal = Math.round((dragStartVal + delta) * 10) / 10;
				valSpan.textContent = curVal % 1 === 0 ? String(curVal) : curVal.toFixed(1);
				onAxisChange(curVal);
			};
			const onUp = () => {
				isDragging = false;
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				onChange(param);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
		// 더블클릭 시 인라인 입력 전환
		valSpan.addEventListener("dblclick", () => {
			const inp = document.createElement("input");
			inp.type = "number";
			inp.className = "mogrt-num-inline-input";
			inp.value = String(curVal);
			valSpan.replaceWith(inp);
			inp.focus(); inp.select();
			const commit = () => {
				const v = parseFloat(inp.value);
				if (!isNaN(v)) { curVal = v; valSpan.textContent = v % 1 === 0 ? String(v) : v.toFixed(1); onAxisChange(v); onChange(param); }
				inp.replaceWith(valSpan);
			};
			inp.addEventListener("blur", commit);
			inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inp.replaceWith(valSpan); });
		});
		wrap.appendChild(lbl);
		wrap.appendChild(valSpan);
		return wrap;
	}
	const xWrap = makeDragValue("X", xVal, (v) => { xVal = v; param.value = xVal + "," + yVal; });
	const yWrap = makeDragValue("Y", yVal, (v) => { yVal = v; param.value = xVal + "," + yVal; });
	pointWrap.appendChild(xWrap);
	pointWrap.appendChild(yWrap);
	rowEl.appendChild(pointWrap);
}
function buildAngleControl(rowEl, param, onChange) {
	let angleVal = parseFloat(param.value) || 0;
	rowEl.className = "mogrt-prop-row mogrt-prop-row--point";
	const titleRow = document.createElement("div");
	titleRow.className = "mogrt-prop-row-title";
	const titleLbl = document.createElement("span");
	titleLbl.className = "mogrt-prop-label";
	titleLbl.textContent = param.displayName;
	titleRow.appendChild(titleLbl);
	rowEl.appendChild(titleRow);
	// 드래그 입력 방식 (PP 프로퍼티스와 동일)
	const angleWrap = document.createElement("div");
	angleWrap.className = "mogrt-point-wrap mogrt-point-drag-wrap";
	const axisWrap = document.createElement("div");
	axisWrap.className = "mogrt-drag-axis";
	const angleLbl = document.createElement("span");
	angleLbl.className = "mogrt-drag-axis-lbl";
	angleLbl.textContent = "";
	const angleValSpan = document.createElement("span");
	angleValSpan.className = "mogrt-drag-value";
	angleValSpan.title = "드래그하여 조절 / 더블클릭하여 직접 입력";
	angleValSpan.style.cursor = "ew-resize";
	const degSuffix = document.createElement("span");
	degSuffix.className = "mogrt-angle-deg";
	degSuffix.textContent = " °";
	angleValSpan.textContent = angleVal % 1 === 0 ? String(angleVal) : angleVal.toFixed(1);
	let dragStartX2 = 0, dragStartVal2 = 0, isDragging2 = false;
	angleValSpan.addEventListener("mousedown", (e) => {
		isDragging2 = true;
		dragStartX2 = e.clientX;
		dragStartVal2 = angleVal;
		e.preventDefault();
		const onMove2 = (ev) => {
			if (!isDragging2) return;
			const delta = (ev.clientX - dragStartX2) * 0.5;
			angleVal = Math.round((dragStartVal2 + delta) * 10) / 10;
			angleValSpan.textContent = angleVal % 1 === 0 ? String(angleVal) : angleVal.toFixed(1);
			param.value = String(angleVal);
		};
		const onUp2 = () => {
			isDragging2 = false;
			document.removeEventListener("mousemove", onMove2);
			document.removeEventListener("mouseup", onUp2);
			onChange(param);
		};
		document.addEventListener("mousemove", onMove2);
		document.addEventListener("mouseup", onUp2);
	});
	angleValSpan.addEventListener("dblclick", () => {
		const inp = document.createElement("input");
		inp.type = "number";
		inp.className = "mogrt-num-inline-input";
		inp.value = String(angleVal);
		angleValSpan.replaceWith(inp);
		inp.focus(); inp.select();
		const commit = () => {
			const v = parseFloat(inp.value);
			if (!isNaN(v)) { angleVal = v; angleValSpan.textContent = v % 1 === 0 ? String(v) : v.toFixed(1); param.value = String(v); onChange(param); }
			inp.replaceWith(angleValSpan);
		};
		inp.addEventListener("blur", commit);
		inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inp.replaceWith(angleValSpan); });
	});
	axisWrap.appendChild(angleLbl);
	axisWrap.appendChild(angleValSpan);
	axisWrap.appendChild(degSuffix);
	angleWrap.appendChild(axisWrap);
	rowEl.appendChild(angleWrap);
}
function buildMogrtTextBlock(param, onChange, exposedFields = null) {
	// exposedFields가 undefined인 경우: param.fontExposed 기반으로 결정
	// fontExposed === true → null (전체 표시)
	// fontExposed === false → [] (텍스트만)
	// fontExposed === undefined → null (하위 호환: 전체 표시)
	if (exposedFields === undefined) {
		exposedFields = (param.fontExposed === false) ? [] : null;
	}
	const block = document.createElement("div");
	block.className = "mogrt-text-block";
	let parsed = {};
	try {
		if (param.rawValue) parsed = JSON.parse(param.rawValue);
	} catch (_) {}
	const textVal = parsed.textEditValue || param.value || "";
	const fontFamily = (parsed.fontEditValue || [])[0] || "";
	const fontSize = (parsed.fontSizeEditValue || [])[0] || 60;
	const isBold = (parsed.fontFSBoldValue || [])[0] || false;
	const isItalic = (parsed.fontFSItalicValue || [])[0] || false;
	const isAllCaps = (parsed.fontFSAllCapsValue || [])[0] || false;
	const isSmallCaps = (parsed.fontFSSmallCapsValue || [])[0] || false;
	const showFont = exposedFields === null || exposedFields.includes("font");
	const showSize = exposedFields === null || exposedFields.includes("size");
	const showBold = exposedFields === null || exposedFields.includes("bold");
	const showItalic = exposedFields === null || exposedFields.includes("italic");
	const showAllCaps = exposedFields === null || exposedFields.includes("allcaps");
	const showSmallCaps = exposedFields === null || exposedFields.includes("smallcaps");
	const showAnyStyle = showBold || showItalic || showAllCaps || showSmallCaps;
	const lbl = document.createElement("div");
	lbl.className = "mogrt-text-block-label";
	lbl.textContent = param.displayName;
	block.appendChild(lbl);
	const textarea = document.createElement("textarea");
	textarea.className = "mogrt-text-area";
	textarea.value = textVal;
	textarea.rows = 2;
	block.appendChild(textarea);
	let fontSel = null;
	if (showFont) {
		const fontRow = document.createElement("div");
		fontRow.className = "mogrt-font-row";
		// 시스템 폰트 풀 (프리셋 편집과 동일)
		const baseFontsInline = [
			{ display: "나눔고딕", postscript: "NanumGothic" },
			{ display: "나눔명조", postscript: "NanumMyeongjo" },
			{ display: "맑은 고딕", postscript: "MalgunGothic" },
			{ display: "Arial", postscript: "ArialMT" },
			{ display: "Helvetica", postscript: "Helvetica" },
			{ display: "Times New Roman", postscript: "TimesNewRomanPSMT" }
		];
		const fontPoolInline = _cachedSystemFonts && _cachedSystemFonts.length > 0 ? _cachedSystemFonts : baseFontsInline;
		const fontInPoolInline = fontPoolInline.find(f => f.postscript === fontFamily || f.display === fontFamily);
		const fontListInline = fontFamily && !fontInPoolInline
			? [{ display: fontFamily, postscript: fontFamily }, ...fontPoolInline]
			: fontPoolInline;
			const sortedFontListInline = fontListInline.slice().sort(function(a, b) {
				var aK = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(a.display);
				var bK = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(b.display);
				if (aK && !bK) return -1;
				if (!aK && bK) return 1;
				var cmp = a.display.localeCompare(b.display);
				if (cmp !== 0) return cmp;
				if (a.subfamily && !b.subfamily) return 1;
				if (!a.subfamily && b.subfamily) return -1;
				if (a.subfamily && b.subfamily) return a.subfamily.localeCompare(b.subfamily);
				return 0;
			});
			fontSel = document.createElement("select");
			fontSel.className = "mogrt-font-select";
			sortedFontListInline.forEach(function(f) {
				const opt = document.createElement("option");
				opt.value = f.postscript;
				// 서브패밀리가 있으면 "패밀리 서브패밀리" 형태로 표시
				opt.textContent = f.subfamily ? (f.display + " " + f.subfamily) : f.display;
				if (f.postscript === fontFamily || f.display === fontFamily) opt.selected = true;
				fontSel.appendChild(opt);
			});
			fontSel.addEventListener("change", () => { updateRawValue(); }); // fontSel.value = postscript 이름
		fontRow.appendChild(fontSel);
		block.appendChild(fontRow);
	}
	let boldBtn = null;
	let italicBtn = null;
	let allCapsBtn = null;
	let smallCapsBtn = null;
	if (showAnyStyle) {
		const styleRow = document.createElement("div");
		styleRow.className = "mogrt-style-row";
		function makeStyleBtn(label, title, active, extraStyle) {
			const btn = document.createElement("button");
			btn.className = "mogrt-style-btn" + (active ? " active" : "");
			btn.textContent = label;
			btn.title = title;
			btn.type = "button";
			if (extraStyle) btn.style.cssText = extraStyle;
			return btn;
		}
		if (showBold) {
			boldBtn = makeStyleBtn("B", "Bold", isBold, "font-weight:bold;");
			boldBtn.addEventListener("click", () => {
				boldBtn.classList.toggle("active");
				updateRawValue();
			});
			styleRow.appendChild(boldBtn);
		}
		if (showItalic) {
			italicBtn = makeStyleBtn("I", "Italic", isItalic, "font-style:italic;");
			italicBtn.addEventListener("click", () => {
				italicBtn.classList.toggle("active");
				updateRawValue();
			});
			styleRow.appendChild(italicBtn);
		}
		if (showAllCaps) {
			allCapsBtn = makeStyleBtn("TT", "All Caps", isAllCaps);
			allCapsBtn.addEventListener("click", () => {
				allCapsBtn.classList.toggle("active");
				updateRawValue();
			});
			styleRow.appendChild(allCapsBtn);
		}
		if (showSmallCaps) {
			smallCapsBtn = makeStyleBtn("Tt", "Small Caps", isSmallCaps);
			smallCapsBtn.addEventListener("click", () => {
				smallCapsBtn.classList.toggle("active");
				updateRawValue();
			});
			styleRow.appendChild(smallCapsBtn);
		}
		block.appendChild(styleRow);
	}
	let sizeSlider = null;
	let sizeValLbl = null;
	if (showSize) {
		const sizeRow = document.createElement("div");
		sizeRow.className = "mogrt-size-row";
		const sizeTopRow = document.createElement("div");
		sizeTopRow.className = "mogrt-slider-toprow";
		const sizeLbl = document.createElement("span");
		sizeLbl.className = "mogrt-prop-label";
		sizeLbl.textContent = "Font Size";
		sizeValLbl = document.createElement("span");
		sizeValLbl.className = "mogrt-num-value";
		sizeValLbl.textContent = String(fontSize);
		sizeValLbl.title = "클릭하여 직접 입력";
		sizeValLbl.style.cursor = "text";
		sizeSlider = document.createElement("input");
		sizeSlider.type = "range";
		sizeSlider.className = "mogrt-slider";
		sizeSlider.min = String(param.minValue ?? 1);
		sizeSlider.max = String(param.maxValue ?? 400);
		sizeSlider.step = "0.1";
		sizeSlider.value = String(fontSize);
		sizeSlider.addEventListener("input", () => {
			const v = parseFloat(sizeSlider.value);
			sizeValLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
			updateRawValue();
		});
		// 값 클릭 시 인라인 입력 전환
		sizeValLbl.addEventListener("click", () => {
			const inp = document.createElement("input");
			inp.type = "number";
			inp.className = "mogrt-num-inline-input";
			inp.value = sizeSlider.value;
			inp.style.cssText = "width:52px;background:#1a1a1a;border:1px solid #64b5f6;color:#64b5f6;font-size:11px;text-align:right;padding:1px 3px;border-radius:2px;";
			sizeValLbl.replaceWith(inp);
			inp.focus(); inp.select();
			const commit = () => {
				const v = parseFloat(inp.value);
				if (!isNaN(v)) {
					sizeSlider.value = String(v);
					sizeValLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
					updateRawValue();
				}
				inp.replaceWith(sizeValLbl);
			};
			inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") inp.replaceWith(sizeValLbl); });
			inp.addEventListener("blur", commit);
		});
		sizeTopRow.appendChild(sizeLbl);
		sizeTopRow.appendChild(sizeValLbl);
		sizeRow.appendChild(sizeTopRow);
		sizeRow.appendChild(sizeSlider);
			if (exposedFields === null || exposedFields.length > 0) block.appendChild(sizeRow);
		}
		textarea.addEventListener("input", () => {
			param.value = textarea.value;
			if (typeof parsed.textEditValue !== "undefined") {
			parsed.textEditValue = textarea.value;
			if (Array.isArray(parsed.fontTextRunLength)) parsed.fontTextRunLength[0] = textarea.value.length;
			param.rawValue = JSON.stringify(parsed);
		}
		onChange(param);
	});
	function updateRawValue() {
		const currentFont = fontSel ? fontSel.value : fontFamily;
		const currentSize = sizeSlider ? parseFloat(sizeSlider.value) || fontSize : fontSize;
		if (showFont) parsed.fontEditValue = [currentFont];
		if (showSize) parsed.fontSizeEditValue = [currentSize];
		if (showBold) parsed.fontFSBoldValue = [boldBtn?.classList.contains("active") ?? isBold];
		if (showItalic) parsed.fontFSItalicValue = [italicBtn?.classList.contains("active") ?? isItalic];
		if (showAllCaps) parsed.fontFSAllCapsValue = [allCapsBtn?.classList.contains("active") ?? isAllCaps];
		if (showSmallCaps) parsed.fontFSSmallCapsValue = [smallCapsBtn?.classList.contains("active") ?? isSmallCaps];
		if (typeof parsed.textEditValue === "undefined") parsed.textEditValue = textarea.value;
		param.rawValue = JSON.stringify(parsed);
		onChange(param);
	}
	return block;
}
