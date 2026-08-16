import { useCallback, useEffect, useRef, useState } from 'react';
import { devServerUrl } from '../lib/devServerUrl';

/** 收藏和注释记的是同一件事：某部片的某一句，外加当时的原文和时间点 */
export type SentenceRecord = {
  id: string;
  /** 视频文件名，用它判断这句属于哪部片 */
  videoKey: string;
  videoLabel: string;
  index: number;
  start: number;
  end: number;
  en: string;
  zh: string;
  savedAt: number;
};

export function recordId(videoKey: string, index: number) {
  return `${videoKey}#${index}`;
}

/**
 * 读写这类记录的公共部分。写盘攒一下再发：改注释是连着敲字的，
 * 每敲一下发一次请求既费劲也容易把顺序搞乱。
 */
export function useSentenceRecords<T extends SentenceRecord>(endpoint: string) {
  const [items, setItems] = useState<T[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(devServerUrl(endpoint))
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((payload) => setItems(Array.isArray(payload.items) ? payload.items : []))
      .catch(() => undefined);
  }, [endpoint]);

  const persist = useCallback(
    (next: T[]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fetch(devServerUrl(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: next })
        }).catch(() => undefined);
      }, 500);
    },
    [endpoint]
  );

  /** 所有改动都走这里，保证内存和待写盘的内容始终一致 */
  const update = useCallback(
    (change: (previous: T[]) => T[]) => {
      setItems((previous) => {
        const next = change(previous);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const remove = useCallback(
    (id: string) => update((previous) => previous.filter((item) => item.id !== id)),
    [update]
  );

  return { items, update, remove };
}
