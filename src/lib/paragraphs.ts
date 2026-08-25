import type { Segment } from '../types/subtitle';

export type Paragraph = {
  /** 段内第一句和最后一句在整片台词里的下标，闭区间 */
  from: number;
  to: number;
  start: number;
  end: number;
};

/**
 * 一句接一句列出来的字幕读起来像流水账，段落感全靠说话人之间的停顿。
 * 两句之间空得够久就断一段——电影里那正是换场、换话题的地方。
 */
export function buildParagraphs(segments: Segment[], gapSeconds: number, maxLines = 20): Paragraph[] {
  const result: Paragraph[] = [];
  let from = 0;

  const close = (to: number) => {
    result.push({ from, to, start: segments[from].start, end: segments[to].end });
  };

  for (let index = 1; index < segments.length; index += 1) {
    const gap = segments[index].start - segments[index - 1].end;
    /**
     * 光看停顿不够：一场连珠炮似的对话能几百句不带喘气的，
     * 排出来又是一大坨。到了行数上限就断一次，纯粹为了读得下去。
     */
    if (gap >= gapSeconds || index - from >= maxLines) {
      close(index - 1);
      from = index;
    }
  }

  if (segments.length) close(segments.length - 1);
  return result;
}

/** 二分找出某一句落在第几段，连播时靠它把页面滚到对应的段落 */
export function paragraphOf(paragraphs: Paragraph[], index: number): number {
  let low = 0;
  let high = paragraphs.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const paragraph = paragraphs[middle];
    if (index < paragraph.from) high = middle - 1;
    else if (index > paragraph.to) low = middle + 1;
    else return middle;
  }
  return -1;
}
