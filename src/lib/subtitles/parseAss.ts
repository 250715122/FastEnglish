import type { Segment } from '../../types/subtitle';
import { finalizeSegments, normalizeText, splitBilingualLines } from './shared';

const ASS_TIME = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/;

function toSeconds(value: string): number | null {
  const match = ASS_TIME.exec(value.trim());
  if (!match) return null;
  // ass 用厘秒，补齐到毫秒
  const millis = Number(match[4].padEnd(3, '0'));
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + millis / 1000;
}

/** 去掉 {\pos(..)} 一类的覆写块，并把 ass 的换行与硬空格转成普通文本。 */
function cleanText(value: string): string {
  return value
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .trim();
}

export function parseAss(raw: string): Segment[] {
  const lines = normalizeText(raw).split('\n');
  const segments: Omit<Segment, 'id'>[] = [];

  let inEvents = false;
  let fields: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inEvents = /^\[events\]$/i.test(trimmed);
      continue;
    }
    if (!inEvents) continue;

    if (/^Format\s*:/i.test(trimmed)) {
      fields = trimmed
        .slice(trimmed.indexOf(':') + 1)
        .split(',')
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue\s*:/i.test(trimmed)) continue;

    const startIndex = fields.indexOf('start');
    const endIndex = fields.indexOf('end');
    const textIndex = fields.indexOf('text');
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) continue;

    // Text 字段本身可能含逗号，前面的字段按逗号切，剩下的全部还原为文本
    const parts = trimmed.slice(trimmed.indexOf(':') + 1).split(',');
    const head = parts.slice(0, textIndex);
    const text = parts.slice(textIndex).join(',');

    const start = toSeconds(head[startIndex] ?? '');
    const end = toSeconds(head[endIndex] ?? '');
    if (start == null || end == null) continue;

    segments.push({ start, end, ...splitBilingualLines(cleanText(text).split('\n')) });
  }

  return finalizeSegments(segments);
}
