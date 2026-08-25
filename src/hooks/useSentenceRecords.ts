import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

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

/** 片名里可能带 #，所以从右边找分隔符 */
function splitId(id: string): { videoKey: string; index: number } | null {
  const at = id.lastIndexOf('#');
  if (at < 0) return null;
  const index = Number(id.slice(at + 1));
  if (!Number.isInteger(index)) return null;
  return { videoKey: id.slice(0, at), index };
}

/**
 * 读写这类记录的公共部分。
 *
 * 以前是把整份列表发上去覆盖，多用户下会互相抹掉——两个人同时收藏，
 * 后提交的那份里没有对方刚加的那条，对方的就没了。现在改成一条一条地增删，
 * 服务端按 (用户, 片子, 句子下标) 做唯一约束。
 */
export function useSentenceRecords<T extends SentenceRecord>(
  endpoint: string,
  userId: number | null
) {
  const [items, setItems] = useState<T[]>([]);

  const reload = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    try {
      const payload = await api<{ items: T[] }>(endpoint);
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      setItems([]);
    }
  }, [endpoint, userId]);

  // 换用户就得整份换掉，否则会看到上一个人的记录
  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * 先改本地再发请求，点下去立刻有反馈；失败了从服务端拉回真实状态，
   * 免得界面显示的和实际存下的不一致。
   */
  const upsert = useCallback(
    async (record: T) => {
      setItems((previous) => {
        const rest = previous.filter((item) => item.id !== record.id);
        return [record, ...rest];
      });
      try {
        await api(endpoint, { method: 'PUT', body: record });
      } catch {
        reload();
      }
    },
    [endpoint, reload]
  );

  const removeById = useCallback(
    async (id: string) => {
      const parts = splitId(id);
      setItems((previous) => previous.filter((item) => item.id !== id));
      if (!parts) return;
      try {
        await api(
          `${endpoint}?videoKey=${encodeURIComponent(parts.videoKey)}&index=${parts.index}`,
          { method: 'DELETE' }
        );
      } catch {
        reload();
      }
    },
    [endpoint, reload]
  );

  return { items, upsert, remove: removeById, reload };
}
