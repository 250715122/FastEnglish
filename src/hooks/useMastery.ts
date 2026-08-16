import { useCallback, useEffect, useRef, useState } from 'react';
import { devServerUrl } from '../lib/devServerUrl';

/**
 * 已掌握的词全局共享，不分电影。
 * 勾选往往是连着点好几个，攒一下再写盘。
 */
export function useMastery() {
  const [mastered, setMastered] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(devServerUrl('/api/vocab/mastery'))
      .then((response) => (response.ok ? response.json() : { words: [] }))
      .then((payload) => setMastered(new Set(payload.words ?? [])))
      .catch(() => undefined);
  }, []);

  const persist = useCallback((words: Set<string>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch(devServerUrl('/api/vocab/mastery'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: [...words] })
      }).catch(() => undefined);
    }, 600);
  }, []);

  const toggle = useCallback(
    (key: string) => {
      setMastered((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const isMastered = useCallback((key: string) => mastered.has(key), [mastered]);

  return { isMastered, toggle, masteredCount: mastered.size, mastered };
}
