import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { uploadVideo } from '../lib/upload';

export type Movie = {
  id: number;
  name: string;
  title: string;
  size: number;
  inStudyList: boolean;
  addedAt: number | null;
  lastOpenedAt: number | null;
  lastPosition: number;
  subtitleLabel: string | null;
  streamUrl: string;
  /** scan 是服务器上本来就有的公共片库，upload 是谁传上来的 */
  source: 'scan' | 'upload';
  visibility: 'public' | 'private';
  isMine: boolean;
  ownerName: string | null;
};

export type UploadState = {
  fileName: string;
  ratio: number;
  error: string | null;
} | null;

/**
 * 片库是服务器扫 MOVIE_ROOT 得到的，所有人看到同一份；
 * 学习列表是自己挑进来的那些，带着上次看到第几秒。
 */
export function useLibrary(userId: number | null) {
  const [library, setLibrary] = useState<Movie[]>([]);
  const [studyList, setStudyList] = useState<Movie[]>([]);
  const [configured, setConfigured] = useState(true);
  const [root, setRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(
    async (rescan = false) => {
      if (!userId) {
        setLibrary([]);
        setStudyList([]);
        return;
      }
      setLoading(true);
      try {
        const [all, mine] = await Promise.all([
          api<{ items: Movie[]; configured: boolean; root: string | null }>(
            `/api/movies${rescan ? '?refresh=1' : ''}`
          ),
          api<{ items: Movie[] }>('/api/movies/study')
        ]);
        setLibrary(all.items ?? []);
        setConfigured(all.configured);
        setRoot(all.root);
        setStudyList(mine.items ?? []);
      } catch {
        setLibrary([]);
        setStudyList([]);
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addToStudy = useCallback(
    async (movieId: number) => {
      await api('/api/movies/study', { method: 'POST', body: { movieId } }).catch(() => undefined);
      refresh();
    },
    [refresh]
  );

  const removeFromStudy = useCallback(
    async (movieId: number) => {
      await api(`/api/movies/study?movieId=${movieId}`, { method: 'DELETE' }).catch(() => undefined);
      refresh();
    },
    [refresh]
  );

  /** 记住看到第几秒，下次点开直接续上。播放中会反复调用，失败了不必打扰用户 */
  const saveProgress = useCallback(
    (movieId: number, position: number, subtitleLabel?: string | null) => {
      api('/api/movies/study/progress', {
        method: 'PUT',
        body: { movieId, position, subtitleLabel: subtitleLabel ?? null }
      }).catch(() => undefined);
    },
    []
  );

  /** 设为公开后别的用户就能在片库里看到并加入自己的学习列表 */
  const setPublic = useCallback(
    async (movieId: number, isPublic: boolean) => {
      await api(`/api/movies/${movieId}/visibility`, {
        method: 'PUT',
        body: { public: isPublic }
      }).catch(() => undefined);
      refresh();
    },
    [refresh]
  );

  const removeMovie = useCallback(
    async (movieId: number) => {
      await api(`/api/movies/${movieId}`, { method: 'DELETE' }).catch(() => undefined);
      refresh();
    },
    [refresh]
  );

  const [upload, setUpload] = useState<UploadState>(null);

  const uploadMovie = useCallback(
    async (source: { uri: string; file?: Blob }, fileName: string) => {
      setUpload({ fileName, ratio: 0, error: null });
      const handle = uploadVideo(source, fileName, (ratio) =>
        setUpload((previous) => (previous ? { ...previous, ratio } : previous))
      );

      try {
        await handle.promise;
        setUpload(null);
        refresh();
      } catch (error) {
        // 失败信息留在界面上，别默默消失——传了半天什么都没发生最让人困惑
        setUpload({ fileName, ratio: 0, error: (error as Error).message });
      }
    },
    [refresh]
  );

  return {
    library,
    studyList,
    configured,
    root,
    loading,
    upload,
    refresh,
    addToStudy,
    removeFromStudy,
    saveProgress,
    setPublic,
    removeMovie,
    uploadMovie,
    dismissUpload: () => setUpload(null)
  };
}
