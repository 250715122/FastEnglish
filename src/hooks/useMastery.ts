import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * 已掌握的词全局共享，不分电影。
 *
 * 和收藏一样改成了一次一个词：勾选是连着点的，整份列表覆盖在多用户下
 * 会互相冲掉，而单个词的增删天然幂等。
 */
export function useMastery(userId: number | null) {
  const [mastered, setMastered] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!userId) {
      setMastered(new Set());
      return;
    }
    try {
      const payload = await api<{ words: string[] }>('/api/vocab/mastery');
      setMastered(new Set(payload.words ?? []));
    } catch {
      setMastered(new Set());
    }
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = useCallback(
    (key: string) => {
      const word = key.toLowerCase();
      // 不能在 setState 的更新函数里算这个值：React 可能延后执行它，
      // 等发请求时读到的还是上一轮的结果
      const nextMastered = !mastered.has(word);

      setMastered((previous) => {
        const next = new Set(previous);
        if (nextMastered) next.add(word);
        else next.delete(word);
        return next;
      });

      api('/api/vocab/mastery', { method: 'PUT', body: { word, mastered: nextMastered } }).catch(
        () => reload()
      );
    },
    [mastered, reload]
  );

  const isMastered = useCallback((key: string) => mastered.has(key.toLowerCase()), [mastered]);

  return { isMastered, toggle, masteredCount: mastered.size, mastered, reload };
}
