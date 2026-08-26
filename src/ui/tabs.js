var TAB_MAP = {
	"tabBtnList": "tab-list",
	"tabBtnPresets": "tab-presets",
	"tabBtnTrash": "tab-trash"
};
function initTabs() {
	for (const [btnId, contentId] of Object.entries(TAB_MAP)) {
		const btn = document.getElementById(btnId);
		if (!btn) {
			console.warn("[tabs] 버튼 없음:", btnId);
			continue;
		}
		btn.addEventListener("click", () => {
			activateTab(contentId);
		});
	}
}
function activateTab(contentId) {
	for (const btnId of Object.keys(TAB_MAP)) {
		const btn = document.getElementById(btnId);
		if (btn) btn.classList.remove("active");
	}
	for (const cid of Object.values(TAB_MAP)) {
		const el = document.getElementById(cid);
		if (el) el.classList.remove("active");
	}
	const contentEl = document.getElementById(contentId);
	if (contentEl) contentEl.classList.add("active");
	for (const [btnId, cid] of Object.entries(TAB_MAP)) if (cid === contentId) {
		const btn = document.getElementById(btnId);
		if (btn) btn.classList.add("active");
	}
}
