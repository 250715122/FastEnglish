import { useEventListener } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';

export type PlayerProbe = {
  status: string;
  /** 播放器自己报的错，没有就是 null */
  error: string | null;
  playing: boolean;
  muted: boolean;
  volume: number;
  /** 播放位置在往前走没有。判断「在放但没声」和「压根没在放」全靠它 */
  advancing: boolean;
  /**
   * 已缓冲到的位置（秒）。跟 advancing 分工不同：跳转之后位置不动是正常的，
   * 这时候要看的是数据还进不进得来——在爬就是在缓冲，一动不动才是真卡死。
   */
  buffered: number;
};

/**
 * 把播放器的真实状态摆到界面上。**只读，不做任何补救。**
 *
 * 之所以要这个：原声放不出来的问题排查了很多轮，服务端日志只能证明
 * 「分片发出去了」，证明不了手机那头在干什么。分片一路 200 却没声音时，
 * 到底是播放器在放而喇叭哑了、还是播放器压根没动，光看服务端分不出来，
 * 只能靠猜——已经因此错过好几次方向。
 *
 * 特意不带自动重连：那个试过，在慢链路上会把能放的搞成放不了，见 docs/手机上手.md。
 */
export function usePlayerProbe(player: VideoPlayer): PlayerProbe {
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  useEventListener(player, 'statusChange', (event) => {
    setStatus(String(event.status));
    setError(event.error ? event.error.message : null);
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    setPlaying(isPlaying);
  });

  /**
   * 位置有没有在动，得自己盯。timeUpdate 在卡住时照样会发，
   * 光收到事件不代表画面/声音在往前走，所以比的是 currentTime 本身。
   */
  const seenRef = useRef({ at: 0, time: -1 });
  const [buffered, setBuffered] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setBuffered(player.bufferedPosition);

      const now = player.currentTime;
      const seen = seenRef.current;
      if (Math.abs(now - seen.time) > 0.05) {
        seenRef.current = { at: Date.now(), time: now };
        setAdvancing(true);
        return;
      }
      // 停了一秒以上才算没在走，否则暂停的一瞬间会闪
      if (Date.now() - seen.at > 1000) setAdvancing(false);
    }, 500);
    return () => clearInterval(timer);
  }, [player]);

  return {
    status,
    error,
    playing,
    muted: player.muted,
    volume: player.volume,
    advancing,
    buffered
  };
}
