import { useEffect, useRef, useState } from 'react';
import { apiUrl, authHeaders } from '../lib/api';

export type WordExamples = {
  word: string;
  /** 带中文翻译的例句，只有常用词有 */
  translated: { text: string; trans: string } | null;
  /** 按词性分组的英文例句，用来给"它还能这样用"配例子 */
  byPos: Record<string, Array<{ text: string; sense: string }>>;
};

/** 只查当前句里露面的那几个词，服务端查过一次就落盘了，切回来是瞬时的 */
export function useExamples(words: string[]) {
  const [examples, setExamples] = useState<Record<string, WordExamples>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const missing = words.filter((word) => word && !requested.current.has(word));
    if (!missing.length) return;
    for (const word of missing) requested.current.add(word);

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(apiUrl('/api/dict/examples'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ words: missing })
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json();
        if (cancelled) return;
        setExamples((previous) => ({ ...previous, ...payload.examples }));
      } catch {
        // 没查成就把标记撤掉，否则这几个词这一整轮会话都不会再试。
        // 令牌还没读出来时的那一次 401 尤其不该是永久的。
        for (const word of missing) requested.current.delete(word);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [words.join(',')]);

  return examples;
}
