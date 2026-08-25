import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export type AudioState = 'unknown' | 'none' | 'queued' | 'building' | 'ready' | 'error';

export type AudioTrack = {
  state: AudioState;
  /** 0-1，只有 building 期间有意义 */
  progress: number;
  /** 抽好的音轨字节数，用来告诉用户省了多少 */
  size: number;
  error: string | null;
  prepare: () => void;
};

type StatusResponse = {
  state: Exclude<AudioState, 'unknown'>;
  progress: number;
  size: number;
  error: string | null;
};

/**
 * 听模式要放的是服务端抽出来的音轨，得先知道它在不在。
 *
 * 抽取本身在服务端排队跑，这里只负责问状态；building 期间勤问一点，
 * 因为进度条是用户唯一能看出「它还在动」的东西。
 */
export function useAudioTrack(movieId: number | null): AudioTrack {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const movieRef = useRef(movieId);
  movieRef.current = movieId;

  const poll = useCallback(async () => {
    const id = movieRef.current;
    if (id == null) return null;
    try {
      const next = await api<StatusResponse>(`/api/movies/${id}/audio/status`);
      // 请求飞在路上时用户可能已经换片了，回来的结果就不能再用
      if (movieRef.current !== id) return null;
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setStatus(null);
    if (movieId == null) return;
    poll();
  }, [movieId, poll]);

  const active = status?.state === 'building' || status?.state === 'queued';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, [active, poll]);

  const prepare = useCallback(() => {
    const id = movieRef.current;
    if (id == null) return;
    // 先乐观地进 queued，否则从点下去到第一次轮询回来这段时间界面毫无反应
    setStatus({ state: 'queued', progress: 0, size: 0, error: null });
    api<StatusResponse>(`/api/movies/${id}/audio`, { method: 'POST' })
      .then((next) => {
        if (movieRef.current === id) setStatus(next);
      })
      .catch((error: Error) => {
        if (movieRef.current === id) {
          setStatus({ state: 'error', progress: 0, size: 0, error: error.message });
        }
      });
  }, []);

  return {
    state: status?.state ?? 'unknown',
    progress: status?.progress ?? 0,
    size: status?.size ?? 0,
    error: status?.error ?? null,
    prepare
  };
}
