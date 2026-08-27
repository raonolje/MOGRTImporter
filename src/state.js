var state = {
	subtitles: [],
	trashBin: [],
	mogrtList: [],
	presets: {},
	presetTrash: [],
	rowStates: {},
	mogrtOriginals: {},
	nextId: 1,
	nextPresetId: 1,
	currentProjectKey: "default",
	currentSequenceKey: "default_seq",
	currentSequenceId: "",
	presetViewMode: "list"
};
var _cachedSystemFonts = null; // 시스템 폰트 캐시 (전역)
