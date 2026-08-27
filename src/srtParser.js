function timeToSec(t) {
	const parts = t.replace(",", ".").split(":");
	const h = parseInt(parts[0], 10) || 0;
	const m = parseInt(parts[1], 10) || 0;
	const s = parseFloat(parts[2]) || 0;
	return h * 3600 + m * 60 + s;
}
function parseSRT(text) {
	const results = [];
	const blocks = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\n+/);
	let idx = 1;
	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length < 2) continue;
		const firstLine = lines[0].trim();
		let lineOffset = 0;
		if (/^\d+$/.test(firstLine)) lineOffset = 1;
		const timeMatch = (lines[lineOffset]?.trim() ?? "").match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
		if (!timeMatch) continue;
		const textLines = lines.slice(lineOffset + 1).join("\n").trim();
		if (!textLines) continue;
		results.push({
			index: idx++,
			startTime: timeMatch[1].replace(",", "."),
			endTime: timeMatch[2].replace(",", "."),
			startSec: timeToSec(timeMatch[1]),
			endSec: timeToSec(timeMatch[2]),
			text: textLines
		});
	}
	return results;
}
