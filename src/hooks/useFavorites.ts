import { useCallback, useMemo } from 'react';
import type { Segment } from '../types/subtitle';
import { recordId, useSentenceRecords, type SentenceRecord } from './useSentenceRecords';

export type Favorite = SentenceRecord;

/**
 * 收藏的句子跨电影共存，按收藏时间倒序。
 */
export function useFavorites(userId: number | null) {
  const { items, upsert, remove, reload } = useSentenceRecords<Favorite>(
    '/api/vocab/favorites',
    userId
  );

  const ids = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  /** 同一部片里同一句只收藏一次，再点就是取消 */
  const toggle = useCallback(
    (params: { videoKey: string; videoLabel: string; index: number; segment: Segment }) => {
      const { videoKey, videoLabel, index, segment } = params;
      if (!videoKey) return;
      const id = recordId(videoKey, index);

      if (ids.has(id)) {
        remove(id);
        return;
      }

      upsert({
        id,
        videoKey,
        videoLabel,
        index,
        start: segment.start,
        end: segment.end,
        en: segment.en || '',
        zh: segment.zh || '',
        savedAt: Date.now()
      });
    },
    [ids, remove, upsert]
  );

  const isFavorite = useCallback(
    (videoKey: string, index: number) => ids.has(recordId(videoKey, index)),
    [ids]
  );

  const favorites = useMemo(() => [...items].sort((a, b) => b.savedAt - a.savedAt), [items]);

  return { favorites, isFavorite, toggle, remove, reload };
}
