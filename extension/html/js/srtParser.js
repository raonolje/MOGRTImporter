/**
 * SRT 파서 - SRT 파일 문자열을 파싱하여 자막 객체 배열로 반환
 * @param {string} srtText
 * @returns {Array<{index: number, startTime: string, endTime: string, startSec: number, endSec: number, text: string}>}
 */
function parseSRT(srtText) {
    var results = [];
    // 줄 끝 정규화
    var normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // 빈 줄 기준으로 블록 분리
    var blocks = normalized.trim().split(/\n\s*\n/);

    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i].trim();
        if (!block) continue;
        var lines = block.split('\n');
        if (lines.length < 2) continue;

        var idx = parseInt(lines[0].trim(), 10);
        if (isNaN(idx)) continue;

        var timeLine = lines[1].trim();
        var timeMatch = timeLine.match(
            /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
        );
        if (!timeMatch) continue;

        var startSec = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 +
                       parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
        var endSec   = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 +
                       parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;

        var textLines = lines.slice(2).join('\n').trim();
        // HTML 태그 제거
        textLines = textLines.replace(/<[^>]+>/g, '');

        results.push({
            index: idx,
            startTime: timeLine.split('-->')[0].trim(),
            endTime: timeLine.split('-->')[1].trim(),
            startSec: startSec,
            endSec: endSec,
            text: textLines
        });
    }
    return results;
}

/**
 * 초 단위를 SRT 시간 문자열로 변환
 */
function secToTimecode(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.round((sec - Math.floor(sec)) * 1000);
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ',' + padMs(ms);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function padMs(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }
