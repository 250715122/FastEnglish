import type { Segment } from '../../types/subtitle';
import { finalizeSegments, normalizeText, parseTimeline, splitBilingualLines, stripMarkup } from './shared';

const BLOCK_HEADERS = /^(WEBVTT|NOTE|STYLE|REGION)\b/;

/**
 * 与 srt 的差别只在于头部块和时间行尾部的 cue setting，时间行本身用同一套解析。
 */
export function parseVtt(raw: string): Segment[] {
  const lines = normalizeText(raw).split('\n');
  const segments: Omit<Segment, 'id'>[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (BLOCK_HEADERS.test(lines[index].trim())) continue;

    const timeline = parseTimeline(lines[index]);
    if (!timeline) continue;

    const textLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() !== '' && !parseTimeline(lines[cursor])) {
      textLines.push(stripMarkup(lines[cursor]));
      cursor += 1;
    }

    segments.push({ ...timeline, ...splitBilingualLines(textLines) });
    index = cursor - 1;
  }

  return finalizeSegments(segments);
}
