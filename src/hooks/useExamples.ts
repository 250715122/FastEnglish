import { useEffect, useRef, useState } from 'react';
import { devServerUrl } from '../lib/devServerUrl';

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
    fetch(devServerUrl('/api/dict/examples'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: missing })
    })
      .then((response) => (response.ok ? response.json() : { examples: {} }))
      .then((payload) => {
        if (cancelled) return;
        setExamples((previous) => ({ ...previous, ...payload.examples }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [words.join(',')]);

  return examples;
}
