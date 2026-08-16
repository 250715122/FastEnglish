import { useMemo } from 'react';
import type { Segment } from '../types/subtitle';

/** 二分查找覆盖该时刻的句子，找不到时返回最近的下一句之前的位置。 */
export function findSegmentIndex(segments: Segment[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (time < segment.start) {
      high = middle - 1;
    } else if (time > segment.end) {
      low = middle + 1;
    } else {
      return middle;
    }
  }
  return result;
}

/**
 * offset 为字幕整体平移量（秒），用来抹平字幕版本与片源版本之间的差异。
 */
export function useCurrentSegment(segments: Segment[], currentTime: number, offset: number) {
  return useMemo(() => {
    if (!segments.length) return { index: -1, segment: undefined as Segment | undefined };
    const index = findSegmentIndex(segments, currentTime - offset);
    return { index, segment: index >= 0 ? segments[index] : undefined };
  }, [segments, currentTime, offset]);
}
