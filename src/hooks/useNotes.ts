import { useCallback, useMemo } from 'react';
import type { Segment } from '../types/subtitle';
import { recordId, useSentenceRecords, type SentenceRecord } from './useSentenceRecords';

export type Note = SentenceRecord & {
  text: string;
  updatedAt: number;
};

/**
 * 自己写的注释。词典能解释词和短语，但语气、指代、文化梗这些只能自己记，
 * 所以一句话一条，改完覆盖，清空就等于删掉。
 */
export function useNotes() {
  const { items, update, remove } = useSentenceRecords<Note>('/api/vocab/notes');

  const save = useCallback(
    (params: { videoKey: string; videoLabel: string; index: number; segment: Segment; text: string }) => {
      const { videoKey, videoLabel, index, segment, text } = params;
      if (!videoKey) return;
      const id = recordId(videoKey, index);
      const trimmed = text.trim();

      update((previous) => {
        if (!trimmed) return previous.filter((item) => item.id !== id);

        const existing = previous.find((item) => item.id === id);
        const now = Date.now();
        const record: Note = {
          id,
          videoKey,
          videoLabel,
          index,
          start: segment.start,
          end: segment.end,
          en: segment.en || '',
          zh: segment.zh || '',
          // 首次写下的时间保持不变，列表按它排序才不会因为改一个字就跳到最前
          savedAt: existing?.savedAt ?? now,
          updatedAt: now,
          text: trimmed
        };

        return existing
          ? previous.map((item) => (item.id === id ? record : item))
          : [record, ...previous];
      });
    },
    [update]
  );

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const noteAt = useCallback(
    (videoKey: string, index: number) => byId.get(recordId(videoKey, index)) ?? null,
    [byId]
  );

  const notes = useMemo(() => [...items].sort((a, b) => b.savedAt - a.savedAt), [items]);

  return { notes, noteAt, save, remove };
}
