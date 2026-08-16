import { useCallback, useMemo } from 'react';
import type { Segment } from '../types/subtitle';
import { recordId, useSentenceRecords, type SentenceRecord } from './useSentenceRecords';

export type Favorite = SentenceRecord;

/**
 * 收藏的句子跨电影共存，按收藏时间倒序。
 */
export function useFavorites() {
  const { items, update, remove } = useSentenceRecords<Favorite>('/api/vocab/favorites');

  /** 同一部片里同一句只收藏一次，再点就是取消 */
  const toggle = useCallback(
    (params: { videoKey: string; videoLabel: string; index: number; segment: Segment }) => {
      const { videoKey, videoLabel, index, segment } = params;
      if (!videoKey) return;
      const id = recordId(videoKey, index);

      update((previous) =>
        previous.some((item) => item.id === id)
          ? previous.filter((item) => item.id !== id)
          : [
              {
                id,
                videoKey,
                videoLabel,
                index,
                start: segment.start,
                end: segment.end,
                en: segment.en || '',
                zh: segment.zh || '',
                savedAt: Date.now()
              },
              ...previous
            ]
      );
    },
    [update]
  );

  const ids = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const isFavorite = useCallback((videoKey: string, index: number) => ids.has(recordId(videoKey, index)), [ids]);

  const favorites = useMemo(() => [...items].sort((a, b) => b.savedAt - a.savedAt), [items]);

  return { favorites, isFavorite, toggle, remove };
}
