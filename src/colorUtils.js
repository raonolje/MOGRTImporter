function h2(v) {
	const s = Math.floor(v).toString(16);
	return s.length < 2 ? "0" + s : s;
}
function parsePackedColor(rawVal) {
	return parseFloat(rawVal ?? "0") || 0;
}
function packedToHex(packed) {
	if (packed <= 0) return "#000000";
	if (packed < 4294967296) {
		const r = Math.floor(packed / 65536) % 256;
		const g = Math.floor(packed / 256) % 256;
		const b = packed % 256;
		return "#" + h2(r) + h2(g) + h2(b);
	} else {
		const rem0 = packed - 72057594037927940;
		if (rem0 < 0) return "#000000";
		const r = Math.floor(rem0 / 1099511627776) % 256;
		const rem1 = rem0 - r * 1099511627776;
		const g = Math.floor(rem1 / 16777216) % 256;
		const rem2 = rem1 - g * 16777216;
		const b = Math.floor(rem2 / 256) % 256;
		return "#" + h2(r) + h2(g) + h2(b);
	}
}
function hexToRgb(hex) {
	const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
	if (!m) return null;
	return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function rgbToHex(r, g, b) {
	return "#" + h2(Math.max(0, Math.min(255, r))) + h2(Math.max(0, Math.min(255, g))) + h2(Math.max(0, Math.min(255, b)));
}
// HSV <-> RGB 변환
function hsvToRgb(h, s, v) {
	s /= 100; v /= 100;
	const i = Math.floor(h / 60) % 6;
	const f = h / 60 - Math.floor(h / 60);
	const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
	const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];
	return { r: Math.round(r*255), g: Math.round(g*255), b: Math.round(b*255) };
}
function rgbToHsv(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
	let h = 0;
	if (d !== 0) {
		if (max === r) h = ((g - b) / d + 6) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
	}
	return { h, s: max === 0 ? 0 : d / max * 100, v: max * 100 };
}
// ── 전역 커스텀 컬러피커 ──
const CP = (() => {
	let _popup, _canvas, _cursor, _hueBar, _hueThumb, _hexInp, _rInp, _gInp, _bInp, _preview;
	let _hue = 0, _sat = 100, _val = 100;
	let _onChange = null;
	let _draggingCanvas = false, _draggingHue = false;
	function _drawCanvas() {
		const ctx = _canvas.getContext('2d');
		const w = _canvas.width, h = _canvas.height;
		const base = hsvToRgb(_hue, 100, 100);
		const grad1 = ctx.createLinearGradient(0, 0, w, 0);
		grad1.addColorStop(0, '#fff');
		grad1.addColorStop(1, `rgb(${base.r},${base.g},${base.b})`);
		ctx.fillStyle = grad1; ctx.fillRect(0, 0, w, h);
		const grad2 = ctx.createLinearGradient(0, 0, 0, h);
		grad2.addColorStop(0, 'transparent');
		grad2.addColorStop(1, '#000');
		ctx.fillStyle = grad2; ctx.fillRect(0, 0, w, h);
	}
	function _drawHueBar() {
		const ctx = _hueBar.getContext('2d');
		const w = _hueBar.width, h = _hueBar.height;
		const grad = ctx.createLinearGradient(0, 0, w, 0);
		[0,60,120,180,240,300,360].forEach((deg, i) => {
			const c = hsvToRgb(deg, 100, 100);
			grad.addColorStop(i/6, `rgb(${c.r},${c.g},${c.b})`);
		});
		ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
	}
	function _updateCursor() {
		const w = _canvas.width, h = _canvas.height;
		const x = _sat / 100 * w, y = (1 - _val / 100) * h;
		_cursor.style.left = x + 'px'; _cursor.style.top = y + 'px';
	}
	function _updateHueThumb() {
		_hueThumb.style.left = (_hue / 360 * _hueBar.width) + 'px';
	}
	function _syncUI(hex) {
		const rgb = hexToRgb(hex);
		if (!rgb) return;
		_preview.style.background = hex;
		_hexInp.value = hex;
		_rInp.value = rgb.r; _gInp.value = rgb.g; _bInp.value = rgb.b;
	}
	function _emitColor() {
		const rgb = hsvToRgb(_hue, _sat, _val);
		const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
		_syncUI(hex);
		if (_onChange) _onChange(hex);
	}
	function _setFromHex(hex) {
		const rgb = hexToRgb(hex);
		if (!rgb) return;
		const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
		_hue = hsv.h; _sat = hsv.s; _val = hsv.v;
		_drawCanvas(); _updateCursor(); _updateHueThumb();
		_syncUI(hex);
		if (_onChange) _onChange(hex);
	}
	function _onCanvasPointer(e) {
		const rect = _canvas.getBoundingClientRect();
		const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
		const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
		_sat = x / rect.width * 100;
		_val = (1 - y / rect.height) * 100;
		_updateCursor(); _emitColor();
	}
	function _onHuePointer(e) {
		const rect = _hueBar.getBoundingClientRect();
		const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
		_hue = x / rect.width * 360;
		_drawCanvas(); _updateHueThumb(); _emitColor();
	}
	function _init() {
		_popup = document.getElementById('customColorPicker');
		_canvas = document.getElementById('cpCanvas');
		_cursor = document.getElementById('cpCursor');
		_hueBar = document.getElementById('cpHueBar');
		_hueThumb = document.getElementById('cpHueThumb');
		_hexInp = document.getElementById('cpHexInput');
		_rInp = document.getElementById('cpR');
		_gInp = document.getElementById('cpG');
		_bInp = document.getElementById('cpB');
		_preview = document.getElementById('cpPreviewSwatch');
		_drawHueBar();
		// 캔버스 드래그
		_canvas.addEventListener('mousedown', e => { _draggingCanvas = true; _onCanvasPointer(e); });
		document.addEventListener('mousemove', e => { if (_draggingCanvas) _onCanvasPointer(e); });
		document.addEventListener('mouseup', () => { _draggingCanvas = false; });
		// Hue 슬라이더 드래그
		_hueBar.addEventListener('mousedown', e => { _draggingHue = true; _onHuePointer(e); });
		document.addEventListener('mousemove', e => { if (_draggingHue) _onHuePointer(e); });
		document.addEventListener('mouseup', () => { _draggingHue = false; });
		// HEX 입력
		_hexInp.addEventListener('change', () => {
			let v = _hexInp.value.trim();
			if (!v.startsWith('#')) v = '#' + v;
			if (/^#[0-9a-fA-F]{6}$/.test(v)) _setFromHex(v.toLowerCase());
			else _hexInp.value = rgbToHex(hsvToRgb(_hue,_sat,_val).r, hsvToRgb(_hue,_sat,_val).g, hsvToRgb(_hue,_sat,_val).b);
		});
		_hexInp.addEventListener('keydown', e => { if (e.key === 'Enter') _hexInp.blur(); });
		// RGB 입력
		const onRgb = () => {
			const r = Math.max(0,Math.min(255,parseInt(_rInp.value)||0));
			const g = Math.max(0,Math.min(255,parseInt(_gInp.value)||0));
			const b = Math.max(0,Math.min(255,parseInt(_bInp.value)||0));
			_setFromHex(rgbToHex(r,g,b));
		};
		[_rInp,_gInp,_bInp].forEach(inp => {
			inp.addEventListener('change', onRgb);
			inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
		});
		// 외부 클릭 시 닫기
		document.addEventListener('mousedown', e => {
			if (_popup.classList.contains('open') && !_popup.contains(e.target) && !e.target.closest('.mogrt-color-swatch-wrap')) {
				_popup.classList.remove('open');
			}
		});
	}
	function open(anchorEl, hexColor, onChangeCb) {
		if (!_popup) _init();
		_onChange = onChangeCb;
		const rgb = hexToRgb(hexColor) || { r: 255, g: 255, b: 255 };
		const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
		_hue = hsv.h; _sat = hsv.s; _val = hsv.v;
		_drawCanvas(); _updateCursor(); _updateHueThumb(); _syncUI(hexColor);
		// 팝업 위치 계산
		const rect = anchorEl.getBoundingClientRect();
		const popW = 220, popH = 290;
		let top = rect.bottom + 4, left = rect.left;
		if (top + popH > window.innerHeight) top = rect.top - popH - 4;
		if (left + popW > window.innerWidth) left = window.innerWidth - popW - 4;
		_popup.style.top = top + 'px'; _popup.style.left = left + 'px';
		_popup.classList.add('open');
	}
	return { open };
})();
