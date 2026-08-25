import type { Segment } from '../../types/subtitle';

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

export function containsCJK(value: string): boolean {
  return CJK.test(value);
}

export function normalizeText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');
}

/**
 * 一条 cue 内可能同时有英文行和中文行（双语压制字幕的常见形态），
 * 按是否含 CJK 字符分流；整条都是中文时也接受，此时 en 留空由调用方决定如何展示。
 */
export function splitBilingualLines(lines: string[]): { en: string; zh?: string } {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  const zhLines = cleaned.filter(containsCJK);
  const enLines = cleaned.filter((line) => !containsCJK(line));
  return {
    en: enLines.join(' '),
    zh: zhLines.length ? zhLines.join(' ') : undefined
  };
}

/**
 * 去掉字幕里的排版标记，只留字。
 *
 * srt 里冒出 `{\pos(180,158)\fn楷体\fs9}` 是常事：不少压制字幕是从 ass 转过来的，
 * 转的时候只换了时间轴的写法，行内的样式指令原样留着。不剥掉的话这串东西会
 * 出现在台词列表、读模式的正文里，还会被当成词喂给分词。
 *
 * 只认以反斜杠开头的花括号块——那是 ass 覆写指令的固定长相，
 * 而台词里本来就写着的 `{something}` 得留着。
 */
export function stripMarkup(value: string): string {
  return value
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    // ass 的换行符，srt 一行内出现时当空格用
    .replace(/\\[Nn]/g, ' ')
    .replace(/\\h/g, ' ');
}

/** 小时段可选，分隔符 , 或 . 都接受，覆盖 srt 与 vtt 两种写法。 */
const TIMESTAMP = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const TIMELINE = new RegExp(`${TIMESTAMP.source}\\s*-->\\s*${TIMESTAMP.source}`);

function toSeconds(hours = '0', minutes = '0', seconds = '0', fraction = '0'): number {
  const millis = Number(fraction.padEnd(3, '0'));
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + millis / 1000;
}

export function parseTimeline(line: string): { start: number; end: number } | null {
  const match = TIMELINE.exec(line);
  if (!match) return null;
  return {
    start: toSeconds(match[1], match[2], match[3], match[4]),
    end: toSeconds(match[5], match[6], match[7], match[8])
  };
}

const SAME_TIMING_TOLERANCE = 0.05;

/**
 * 部分双语字幕把中英拆成两条时间轴相同的 cue（ass 里常见于两个 Style），
 * 这里把它们并回同一句。
 */
export function mergeSameTimingPairs(segments: Omit<Segment, 'id'>[]): Omit<Segment, 'id'>[] {
  const merged: Omit<Segment, 'id'>[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const sameTiming =
      previous &&
      Math.abs(previous.start - segment.start) < SAME_TIMING_TOLERANCE &&
      Math.abs(previous.end - segment.end) < SAME_TIMING_TOLERANCE;
    if (sameTiming && !previous.zh && segment.zh && !segment.en) {
      previous.zh = segment.zh;
      continue;
    }
    if (sameTiming && !previous.en && segment.en && !segment.zh) {
      previous.en = segment.en;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/**
 * 丢弃时长为 0 或首尾颠倒的脏 cue，并按开始时间排序后重新编号。
 */
export function finalizeSegments(segments: Omit<Segment, 'id'>[]): Segment[] {
  const sorted = segments
    .filter((segment) => segment.end > segment.start && (segment.en || segment.zh))
    .sort((a, b) => a.start - b.start);
  return mergeSameTimingPairs(sorted).map((segment, index) => ({ ...segment, id: index }));
}
