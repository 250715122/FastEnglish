import { useCallback, useEffect, useRef, useState } from 'react';

export type QueueItem = { id: string };

/** 句与句之间留一口气，连着放会糊成一片，跟不上 */
const GAP_MS = 450;

type Options<T extends QueueItem> = {
  /** 放一句，返回的 Promise 在这句放完时兑现 */
  play: (item: T) => Promise<void>;
  /** 打断当前这句 */
  stop: () => void;
};

/**
 * 一串句子挨个放下来，用来把收藏当复习列表过一遍。
 *
 * 怎么发声不归它管——合成音和原片声音的时长、结束时机完全不同，
 * 交给外面给的 play 返回一个 Promise，这里只负责排队、高亮和打断。
 *
 * 所有「该不该继续」的判断都压在 sessionRef 上：停止、重新开始、切换列表都让它自增，
 * 于是上一轮遗留的 await 醒来时自己就失效了。不这么做的话，打断旧的那一下
 * 会把新的一轮也带走——被打断的 Promise 同样会兑现，光看它兑现了区分不出是哪种结局。
 */
export function useSentenceQueue<T extends QueueItem>({ play, stop }: Options<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const sessionRef = useRef(0);

  // 放在 ref 里，playAll/playOne 才能保持稳定，不会每次渲染都换一个新函数
  const playRef = useRef(play);
  playRef.current = play;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const halt = useCallback(() => {
    sessionRef.current += 1;
    stopRef.current();
  }, []);

  const stopAll = useCallback(() => {
    halt();
    setActiveId(null);
    setPlayingAll(false);
  }, [halt]);

  const playOne = useCallback(
    async (item: T) => {
      halt();
      const session = sessionRef.current;
      setPlayingAll(false);
      setActiveId(item.id);

      await playRef.current(item);
      if (sessionRef.current !== session) return;
      setActiveId(null);
    },
    [halt]
  );

  const playAll = useCallback(
    async (items: T[]) => {
      if (!items.length) return;

      halt();
      const session = sessionRef.current;
      setPlayingAll(true);

      for (const item of items) {
        if (sessionRef.current !== session) return;
        setActiveId(item.id);

        try {
          await playRef.current(item);
        } catch {
          // 某一句放不出来不该让整串卡死，跳过去接着下一句
        }
        if (sessionRef.current !== session) return;

        await new Promise((resolve) => setTimeout(resolve, GAP_MS));
        if (sessionRef.current !== session) return;
      }

      setActiveId(null);
      setPlayingAll(false);
    },
    [halt]
  );

  // 离开这个界面还在放就成了背景音，找不到地方关
  useEffect(() => stopAll, [stopAll]);

  return { activeId, playingAll, playOne, playAll, stop: stopAll };
}
