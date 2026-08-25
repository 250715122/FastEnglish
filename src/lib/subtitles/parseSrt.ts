import type { Segment } from '../../types/subtitle';
import { finalizeSegments, normalizeText, parseTimeline, splitBilingualLines, stripMarkup } from './shared';

/**
 * 不依赖块首的序号行，直接以时间行为锚点，兼容缺序号或序号错乱的文件。
 */
export function parseSrt(raw: string): Segment[] {
  const lines = normalizeText(raw).split('\n');
  const segments: Omit<Segment, 'id'>[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const timeline = parseTimeline(lines[index]);
    if (!timeline) continue;

    const textLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() !== '' && !parseTimeline(lines[cursor])) {
      textLines.push(stripMarkup(lines[cursor]));
      cursor += 1;
    }
    // 下一条 cue 的序号行会被当作文本收进来，这里剔除纯数字尾行
    if (textLines.length > 1 && /^\d+$/.test(textLines[textLines.length - 1].trim())) {
      textLines.pop();
    }

    segments.push({ ...timeline, ...splitBilingualLines(textLines) });
    index = cursor - 1;
  }

  return finalizeSegments(segments);
}
