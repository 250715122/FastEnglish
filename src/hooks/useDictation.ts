import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CopyRecord } from '../lib/copywork';

type Saved = {
  /** 听写成绩，按句子下标存最好的那次 */
  scores: Record<string, number>;
  /** 听写写到哪句了 */
  lastIndex: number;
  /** 抄写抄到哪句了。和听写各记各的——两种练法进度不该互相拽 */
  copyIndex: number;
  /** 抄写的历轮成绩，只留最近的 */
  records: CopyRecord[];
};

const EMPTY: Saved = { scores: {}, lastIndex: 0, copyIndex: 0, records: [] };

/** 抄写记录留多少条。够回头看出手速有没有长进，又不至于攒成一本流水账 */
const KEEP_RECORDS = 30;

/**
 * 写模式的进度存在本机。
 *
 * 没走服务端是有意的：默写和抄写都是自己跟自己较劲的练习，换台设备重头写一遍并不亏，
 * 为它加一张表、一套接口、一份同步逻辑，代价远超它值的那点。
 * 真要跨设备接着写，再搬上去也不迟。
 */
export function useDictation(userId: number, videoKey: string | null) {
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const key = videoKey ? `dictation:${userId}:${videoKey}` : null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSaved(EMPTY);
    if (!key) return;

    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled) return;
        // 老存档里没有 copyIndex 和 records，EMPTY 垫在前面补上
        if (raw) setSaved({ ...EMPTY, ...(JSON.parse(raw) as Saved) });
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const persist = useCallback(
    (next: Saved) => {
      if (!key) return;
      // 每写一句就落一次盘太碎，攒一下再写
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
      }, 400);
    },
    [key]
  );

  const record = useCallback(
    (index: number, percent: number) => {
      setSaved((previous) => {
        // 同一句写第二遍是为了写对，留最好的那次
        const best = Math.max(previous.scores[index] ?? 0, percent);
        const next = { ...previous, scores: { ...previous.scores, [index]: best }, lastIndex: index };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const remember = useCallback(
    (index: number) => {
      setSaved((previous) => {
        if (previous.lastIndex === index) return previous;
        const next = { ...previous, lastIndex: index };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const rememberCopy = useCallback(
    (index: number) => {
      setSaved((previous) => {
        if (previous.copyIndex === index) return previous;
        const next = { ...previous, copyIndex: index };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const addRecord = useCallback(
    (entry: CopyRecord) => {
      setSaved((previous) => {
        const next = { ...previous, records: [entry, ...previous.records].slice(0, KEEP_RECORDS) };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const clearRecords = useCallback(() => {
    setSaved((previous) => {
      const next = { ...previous, records: [] };
      persist(next);
      return next;
    });
  }, [persist]);

  const reset = useCallback(() => {
    setSaved(EMPTY);
    if (key) AsyncStorage.removeItem(key).catch(() => undefined);
  }, [key]);

  return {
    scores: saved.scores,
    lastIndex: saved.lastIndex,
    copyIndex: saved.copyIndex,
    records: saved.records,
    loaded,
    record,
    remember,
    rememberCopy,
    addRecord,
    clearRecords,
    reset
  };
}
