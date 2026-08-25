import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { REMOTE } from '../lib/api';

/**
 * 听模式的默认值跟着网络环境走：在外面默认听，在家默认看。
 *
 * 外网下看模式一小时要 2 GB 以上，听模式只要 29 MB，默认反了是要付流量费的；
 * 可在家连着局域网时又没理由不看画面。所以两种环境各记各的选择——
 * 存一个键的话，你在家关掉听模式，出门就又得手动开一次，等于没做。
 */
const KEY = REMOTE ? 'fastenglish.listen.remote' : 'fastenglish.listen.local';

export function useListenMode() {
  const [listenMode, setListenMode] = useState(REMOTE);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        // 没存过就保持按环境给的默认，别把 null 当成「关」
        if (cancelled || saved == null) return;
        setListenMode(saved === 'on');
      })
      .catch(() => {
        // 读不出来就用默认值，不值得为此打断进入学习页
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback((on: boolean) => {
    setListenMode(on);
    AsyncStorage.setItem(KEY, on ? 'on' : 'off').catch(() => undefined);
  }, []);

  return { listenMode, chooseListenMode: choose, remote: REMOTE };
}
