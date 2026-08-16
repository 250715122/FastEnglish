/**
 * 把内部的 segments 结构写成通用 srt。
 * 存一份到视频旁边，PotPlayer、VLC 这些播放器不用装什么就能直接加载，
 * 字幕就不只在这个应用里有用了。
 */

/** srt 的时间戳是 00:00:05,000 这种逗号分隔毫秒的写法 */
function formatTimestamp(seconds) {
  const safe = Math.max(0, seconds || 0);
  const ms = Math.round(safe * 1000);
  const hh = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  const mmm = String(ms % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${mmm}`;
}

/**
 * 双语按「英文一行、中文一行」写，这是最通用的约定，
 * 播放器会把两行一起显示，不需要额外配置。
 */
function segmentsToSrt(segments) {
  const blocks = [];
  let index = 0;

  for (const segment of segments) {
    const lines = [segment.en, segment.zh].map((line) => (line || '').trim()).filter(Boolean);
    if (!lines.length) continue;
    index += 1;
    blocks.push(
      `${index}\n${formatTimestamp(segment.start)} --> ${formatTimestamp(segment.end)}\n${lines.join('\n')}`
    );
  }

  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

module.exports = { segmentsToSrt, formatTimestamp };
