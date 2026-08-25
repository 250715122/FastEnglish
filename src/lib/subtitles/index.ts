import type { Segment } from '../../types/subtitle';
import { parseAss } from './parseAss';
import { parseSrt } from './parseSrt';
import { parseVtt } from './parseVtt';
import { finalizeSegments } from './shared';

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export function detectFormat(text: string, filename?: string): SubtitleFormat {
  const extension = filename?.toLowerCase().match(/\.(srt|vtt|ass|ssa)$/)?.[1];
  if (extension === 'vtt') return 'vtt';
  if (extension === 'ass' || extension === 'ssa') return 'ass';
  if (extension === 'srt') return 'srt';

  const head = text.slice(0, 400);
  if (/^\uFEFF?WEBVTT/.test(head)) return 'vtt';
  if (/\[Script Info\]|\[V4\+? Styles\]|\[Events\]/i.test(head)) return 'ass';
  return 'srt';
}

export function parseSubtitles(text: string, filename?: string): Segment[] {
  switch (detectFormat(text, filename)) {
    case 'vtt':
      return parseVtt(text);
    case 'ass':
      return parseAss(text);
    default:
      return parseSrt(text);
  }
}

const PAIRING_TOLERANCE = 1.5;

/**
 * 中英分别是两个文件时按时间轴配对：以英文轴为准，给每句找开始时间最接近的中文句。
 */
export function mergeBilingual(english: Segment[], chinese: Segment[]): Segment[] {
  const merged = english.map((segment) => {
    let best: Segment | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of chinese) {
      const distance = Math.abs(candidate.start - segment.start);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    const zh = best && bestDistance <= PAIRING_TOLERANCE ? best.zh || best.en : undefined;
    return { start: segment.start, end: segment.end, en: segment.en, zh: zh || segment.zh };
  });
  return finalizeSegments(merged);
}

export { parseAss, parseSrt, parseVtt };
