import { useEvent, useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { PlaybackBar } from './src/components/PlaybackBar';
import { RecentSubtitles } from './src/components/RecentSubtitles';
import { SegmentList } from './src/components/SegmentList';
import { SettingsDrawer } from './src/components/SettingsDrawer';
import { SourcePanel } from './src/components/SourcePanel';
import { SubtitleFinder, type FinderState } from './src/components/SubtitleFinder';
import { SubtitleSearchPanel } from './src/components/SubtitleSearchPanel';
import { ThumbnailStrip } from './src/components/ThumbnailStrip';
import { TopBar } from './src/components/TopBar';
import { VideoStage } from './src/components/VideoStage';
import { MarksScreen, type MarksTab } from './src/components/MarksScreen';
import { NoteEditor } from './src/components/NoteEditor';
import { WordbookScreen } from './src/components/WordbookScreen';
import { WordPanel } from './src/components/WordPanel';
import sampleData from './src/data/sampleSegments.json';
import { useCurrentSegment } from './src/hooks/useCurrentSegment';
import { useFavorites } from './src/hooks/useFavorites';
import { useKeyboardShortcuts } from './src/hooks/useKeyboardShortcuts';
import { useMastery } from './src/hooks/useMastery';
import { useNotes, type Note } from './src/hooks/useNotes';
import type { SentenceRecord } from './src/hooks/useSentenceRecords';
import { useSpeech } from './src/hooks/useSpeech';
import { useVocabulary } from './src/hooks/useVocabulary';
import type { DifficultyLevel } from './src/lib/vocabulary/study';
import { bundledVideo, bundledVideoLabel } from './src/lib/bundledVideo';
import { formatTime } from './src/lib/formatTime';
import { readTextFile } from './src/lib/readTextFile';
import {
  findSimilarCached,
  listCachedSubtitles,
  loadCachedSubtitle,
  removeCachedSubtitle,
  saveCachedSubtitle,
  type CachedSubtitleMeta
} from './src/lib/subtitleCache';
import { mergeBilingual, parseSubtitles } from './src/lib/subtitles';
import {
  downloadSubtitle,
  searchBilingualSubtitles,
  type SubtitleCandidate
} from './src/lib/subtitleSearch/openSubtitles';
import type { Segment, VideoSourceSpec } from './src/types/subtitle';

/** 没有字幕时按固定长度切段，保证任何视频都能逐段跳转。 */
const FALLBACK_SEGMENT_SECONDS = 12;

/**
 * sentence 模式的区间跟着当前句移动，range 模式由用户圈定后固定不动。
 * range 的 end 在只点了段首时为 null，此时先不循环，否则播放会被锁在段首那句、走不到段尾。
 */
type LoopState = { mode: 'sentence'; start: number; end: number } | { mode: 'range'; start: number; end: number | null } | null;

const sampleSegments = sampleData.segments as Segment[];

/**
 * 拿视频文件名当搜索词，去掉扩展名、发布组标记和年份。
 * 网址来源猜不出片名，返回空串表示"猜不出来"。
 */
function guessTitleFrom(label: string): string {
  if (!label || /^https?:/i.test(label)) return '';
  return label
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(
      /\b(1080p|2160p|720p|480p|4k|uhd|hdr|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|10bit|aac|ac3|dts|truehd|atmos|repack|proper|extended|remastered|unrated)\b/gi,
      ' '
    )
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function App() {
  const [videoSource, setVideoSource] = useState<VideoSourceSpec | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [subtitleLabel, setSubtitleLabel] = useState('未加载');
  const [status, setStatus] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [showChinese, setShowChinese] = useState(true);
  /** 单句循环和自定义段落循环是同一件事，区别只在于区间是否跟着当前句走 */
  const [loop, setLoop] = useState<LoopState>(null);
  const [duration, setDuration] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [cacheEntries, setCacheEntries] = useState<CachedSubtitleMeta[]>([]);
  // 初次进来什么都没有，直接把选片入口摊开，省得用户去找
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [level, setLevel] = useState<DifficultyLevel>('normal');
  const [showMastered, setShowMastered] = useState(false);
  const [wordbookOpen, setWordbookOpen] = useState(false);
  const [marksTab, setMarksTab] = useState<MarksTab | null>(null);
  const [editingNote, setEditingNote] = useState<{ segment: Segment; index: number; text: string } | null>(null);
  const [narrowTab, setNarrowTab] = useState<'lines' | 'words'>('lines');
  const [finder, setFinder] = useState<FinderState>({
    status: 'idle',
    title: '',
    english: [],
    chinese: [],
    canonicalTitle: null
  });

  const { width } = useWindowDimensions();
  const stacked = width < 980;

  const { speak } = useSpeech();
  /** 当前这份字幕是为哪个视频加载的，null 表示还没关联到任何视频 */
  const subtitleOwnerRef = useRef<string | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  segmentsRef.current = segments;
  // 自动套用时要读最新的缓存列表，但它变化不该重跑那个 effect
  const cacheEntriesRef = useRef<CachedSubtitleMeta[]>([]);
  cacheEntriesRef.current = cacheEntries;

  useEffect(() => {
    listCachedSubtitles().then(setCacheEntries).catch(() => undefined);
  }, []);

  const playerSource = useMemo(() => {
    if (!videoSource) return null;
    if (videoSource.kind === 'bundled' && videoSource.module != null) return videoSource.module;
    return { uri: videoSource.uri };
  }, [videoSource]);

  const player = useVideoPlayer(playerSource, (instance) => {
    instance.loop = false;
    // 字幕跟随完全依赖这个事件；设为 0 时 timeUpdate 不会触发
    instance.timeUpdateEventInterval = 0.25;
  });

  const timeUpdate = useEvent(player, 'timeUpdate');
  const reportedTime = timeUpdate?.currentTime ?? 0;

  /**
   * 播放器每 250ms 才回报一次位置，跳句后这段空档里 reportedTime 还是旧值，
   * 字幕会慢半拍，连点两次还会基于同一个旧位置算出同一句。
   * 所以跳转后先认目标位置，等播放器真的追上来再交还给它。
   */
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const currentTime = seekTarget ?? reportedTime;

  const seekTo = useCallback(
    (time: number) => {
      player.currentTime = time;
      setSeekTarget(time);
    },
    [player]
  );

  const lastReportedRef = useRef(0);
  useEffect(() => {
    const jumped = Math.abs(reportedTime - lastReportedRef.current) > 1;
    lastReportedRef.current = reportedTime;
    if (seekTarget == null) return;
    // 追上目标，或播放器自己跳到了别处（比如用户拖了原生进度条），都该交还控制权
    if (Math.abs(reportedTime - seekTarget) < 0.35 || jumped) setSeekTarget(null);
  }, [reportedTime, seekTarget]);

  // seek 没能生效时（位置不可达、片源还没就绪）别把字幕永久卡在目标位置上
  useEffect(() => {
    if (seekTarget == null) return;
    const timer = setTimeout(() => setSeekTarget(null), 700);
    return () => clearTimeout(timer);
  }, [seekTarget]);

  // web 端的 expo-video 只发 timeUpdate 和 statusChange，不发 sourceLoad，时长得从这两处取
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') setDuration(player.duration || 0);
  });

  useEffect(() => {
    if (player.duration && Math.abs(player.duration - duration) > 1) {
      setDuration(player.duration);
    }
  }, [currentTime, duration, player]);

  const fallbackSegments = useMemo<Segment[]>(() => {
    if (segments.length || !duration) return [];
    const result: Segment[] = [];
    let id = 0;
    for (let start = 0; start < duration; start += FALLBACK_SEGMENT_SECONDS) {
      result.push({ id, start, end: Math.min(start + FALLBACK_SEGMENT_SECONDS, duration), en: '' });
      id += 1;
    }
    return result;
  }, [segments.length, duration]);

  const displaySegments = segments.length ? segments : fallbackSegments;
  const { index: activeIndex, segment: currentSegment } = useCurrentSegment(displaySegments, currentTime, offset);

  const vocabulary = useVocabulary(segments, level);
  const mastery = useMastery();
  const favorites = useFavorites();
  const notes = useNotes();
  const currentWords = useMemo(
    () => vocabulary.wordsOf(segments.length ? currentSegment : undefined),
    [currentSegment, segments.length, vocabulary]
  );

  const seekToSegment = useCallback(
    (segment: Segment, index?: number) => {
      seekTo(segment.start + offset);
      // 单句循环跟着用户手点的句子走；圈定的段落不受影响
      if (index != null) {
        setLoop((previous) =>
          previous?.mode === 'sentence' ? { mode: 'sentence', start: index, end: index } : previous
        );
      }
      player.play();
    },
    [offset, player, seekTo]
  );

  // 越过区间末句结尾就跳回首句，单句循环是 start === end 的特例
  useEffect(() => {
    if (loop?.end == null) return;
    const first = displaySegments[loop.start];
    const last = displaySegments[loop.end];
    if (!first || !last) return;
    if (currentTime - offset > last.end) {
      seekTo(first.start + offset);
    }
  }, [currentTime, displaySegments, loop, offset, seekTo]);

  const goToPrevious = useCallback(() => {
    if (!displaySegments.length) return;
    const position = currentTime - offset;
    const index =
      activeIndex > 0
        ? activeIndex - 1
        : displaySegments.reduce((found, segment, i) => (segment.end < position ? i : found), -1);
    if (index >= 0) seekToSegment(displaySegments[index], index);
  }, [activeIndex, currentTime, displaySegments, offset, seekToSegment]);

  const goToNext = useCallback(() => {
    if (!displaySegments.length) return;
    const position = currentTime - offset;
    const index =
      activeIndex >= 0 && activeIndex < displaySegments.length - 1
        ? activeIndex + 1
        : displaySegments.findIndex((segment) => segment.start > position);
    if (index >= 0) seekToSegment(displaySegments[index], index);
  }, [activeIndex, currentTime, displaySegments, offset, seekToSegment]);

  const speakSegment = useCallback(
    (segment: Segment) => {
      if (!segment.en) return;
      player.pause();
      speak(segment.en, { rate: 0.75 });
    },
    [player, speak]
  );

  /**
   * 停在片头空白或两句之间时没有"当前句"，此时按循环键不该毫无反应，
   * 退而求其次圈住即将播到的那一句。
   */
  const loopAnchor = useCallback(() => {
    if (activeIndex >= 0) return activeIndex;
    if (!displaySegments.length) return -1;
    const position = currentTime - offset;
    const upcoming = displaySegments.findIndex((segment) => segment.end > position);
    return upcoming >= 0 ? upcoming : displaySegments.length - 1;
  }, [activeIndex, currentTime, displaySegments, offset]);

  const toggleLoop = useCallback(() => {
    setLoop((previous) => {
      if (previous?.mode === 'sentence') return null;
      const index = loopAnchor();
      if (index < 0) return previous;
      return { mode: 'sentence', start: index, end: index };
    });
  }, [loopAnchor]);

  /**
   * 段首段尾各点一次圈出一段；只点了段首时保持不循环，让播放能走到段尾。
   * 不传下标就用当前播放到的句子，这是控制条按钮和 [ ] 快捷键的用法；
   * 台词行上的按钮则直接把那一行的下标传进来。
   */
  const markLoopStart = useCallback(
    (target?: number) => {
      const index = target ?? loopAnchor();
      if (index < 0) return;
      setLoop((previous) => ({
        mode: 'range',
        start: index,
        end: previous?.mode === 'range' && previous.end != null && previous.end > index ? previous.end : null
      }));
    },
    [loopAnchor]
  );

  const markLoopEnd = useCallback(
    (target?: number) => {
      const index = target ?? loopAnchor();
      if (index < 0) return;
      setLoop((previous) => ({
        mode: 'range',
        start: previous?.mode === 'range' && previous.start < index ? previous.start : index,
        end: index
      }));
    },
    [loopAnchor]
  );

  /** 台词行上的单句循环开关，再点一次就停 */
  const loopSingle = useCallback((index: number) => {
    if (index < 0) return;
    setLoop((previous) =>
      previous?.mode === 'sentence' && previous.start === index
        ? null
        : { mode: 'sentence', start: index, end: index }
    );
  }, []);

  const clearLoop = useCallback(() => setLoop(null), []);

  const loopRange = useMemo(() => {
    if (!loop) return null;
    const first = displaySegments[loop.start];
    if (!first) return null;
    const last = loop.end == null ? null : displaySegments[loop.end];
    return {
      startLabel: formatTime(first.start),
      endLabel: last ? formatTime(last.end) : null,
      count: last ? loop.end! - loop.start + 1 : 1
    };
  }, [displaySegments, loop]);

  /** 圈定的段首段尾光看时间不直观，点一下直接跳过去听，确认圈对了没 */
  const jumpToLoopEdge = useCallback(
    (edge: 'start' | 'end') => {
      if (!loop) return;
      const index = edge === 'start' ? loop.start : loop.end ?? loop.start;
      const segment = displaySegments[index];
      if (!segment) return;
      seekTo(segment.start + offset);
      player.play();
    },
    [displaySegments, loop, offset, player, seekTo]
  );

  const replayLoop = useCallback(() => {
    if (!loop) return;
    const first = displaySegments[loop.start];
    if (!first) return;
    seekTo(first.start + offset);
    player.play();
  }, [displaySegments, loop, offset, player, seekTo]);

  const togglePlay = useCallback(() => {
    if (!videoSource) return;
    if (player.playing) player.pause();
    else player.play();
  }, [player, videoSource]);

  useKeyboardShortcuts({
    onTogglePlay: togglePlay,
    onPrevious: goToPrevious,
    onNext: goToNext,
    onRepeat: () => currentSegment && speakSegment(currentSegment),
    onToggleLoop: toggleLoop,
    onToggleChinese: () => setShowChinese((previous) => !previous),
    onMarkLoopStart: markLoopStart,
    onMarkLoopEnd: markLoopEnd,
    onClearLoop: clearLoop
  });

  const applySubtitles = useCallback(
    (parsed: Segment[], label: string, options?: { cacheKey?: string; skipCache?: boolean }) => {
      setSegments(parsed);
      setSubtitleLabel(label);
      setOffset(0);
      // 换了字幕，之前圈的段落索引已经对不上了
      setLoop(null);
      setStatus(null);
      // 字幕到位就意味着准备工作结束，让出整块屏幕给学习区
      setSettingsOpen(false);

      // 所有字幕来源都经过这里，缓存写在这一处就够了
      const key = options?.cacheKey ?? videoSource?.label ?? null;
      subtitleOwnerRef.current = key;
      if (key && !options?.skipCache) {
        saveCachedSubtitle(key, label, parsed)
          .then(setCacheEntries)
          .catch(() => undefined);
      }
    },
    [videoSource]
  );

  /**
   * 片名就写在视频文件名里，没必要让用户再敲一遍。
   * 搜索不消耗下载额度，所以选完片子直接搜，把结果摆到眼前。
   */
  const runAutoSearch = useCallback(async (title: string) => {
    const keyword = title.trim();
    if (!keyword) {
      setFinder({ status: 'idle', title: '', english: [], chinese: [], canonicalTitle: null });
      return;
    }

    setFinder({ status: 'searching', title: keyword, english: [], chinese: [], canonicalTitle: null });
    try {
      const result = await searchBilingualSubtitles({ query: keyword });
      // 片名对不上的结果留着也只会让人下错片，这里直接不要
      const english = result.english.filter((item) => !item.offTopic);
      const chinese = result.chinese.filter((item) => !item.offTopic);
      setFinder({
        status: english.length || chinese.length ? 'ready' : 'empty',
        title: keyword,
        english,
        chinese,
        canonicalTitle: result.canonicalTitle
      });
    } catch (error) {
      setFinder({
        status: 'error',
        title: keyword,
        english: [],
        chinese: [],
        canonicalTitle: null,
        message: `搜索失败：${(error as Error).message}`
      });
    }
  }, []);

  /**
   * 选到视频后自动套用之前为它存过的字幕。
   * 用户手动加载、但还没关联到任何视频的字幕不会被覆盖。
   */
  useEffect(() => {
    if (!videoSource) return;
    const key = videoSource.label;
    if (subtitleOwnerRef.current === key) return;
    if (segmentsRef.current.length && subtitleOwnerRef.current === null) return;

    let cancelled = false;
    // 换片子了，上一部的搜索结果不能留着
    setFinder({ status: 'searching', title: guessTitleFrom(key), english: [], chinese: [], canonicalTitle: null });

    loadCachedSubtitle(key)
      .then(async (cached) => {
        if (cancelled) return;
        if (cached) {
          applySubtitles(cached.segments, cached.label, { cacheKey: key, skipCache: true });
          setStatus(`已套用本机保存的字幕：${cached.label}`);
          return;
        }

        // 文件名对不上就退一步按片名找，换个版本的片源也不用重新下一遍
        const similar = findSimilarCached(key, cacheEntriesRef.current);
        if (similar) {
          const fallback = await loadCachedSubtitle(similar.key);
          if (cancelled) return;
          if (fallback) {
            applySubtitles(fallback.segments, fallback.label, { cacheKey: key, skipCache: false });
            setStatus(`这个视频没存过字幕，套用了名字相近的「${similar.key}」，不对的话可以清除重搜`);
            return;
          }
        }

        // 本机确实没有，就拿文件名自动去搜，不必让用户再手动走一遍
        if (!cancelled) runAutoSearch(guessTitleFrom(key));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [applySubtitles, runAutoSearch, videoSource]);

  const applyCachedSubtitle = useCallback(
    async (entry: CachedSubtitleMeta) => {
      const cached = await loadCachedSubtitle(entry.key);
      if (!cached) {
        setCacheEntries(await removeCachedSubtitle(entry.key));
        setStatus('这条字幕缓存已失效，已从列表移除');
        return;
      }
      applySubtitles(cached.segments, cached.label, { cacheKey: entry.key, skipCache: true });
      setStatus(`已套用保存的字幕：${cached.label}`);
    },
    [applySubtitles]
  );

  const dropCachedSubtitle = useCallback(async (entry: CachedSubtitleMeta) => {
    setCacheEntries(await removeCachedSubtitle(entry.key));
  }, []);

  const toggleFavorite = useCallback(
    (segment: Segment, index: number) => {
      const videoKey = videoSource?.label;
      if (!videoKey) {
        setStatus('先选一个视频，收藏才知道这句属于哪部片');
        return;
      }
      favorites.toggle({ videoKey, videoLabel: subtitleLabel || videoKey, index, segment });
    },
    [favorites, subtitleLabel, videoSource]
  );

  const isFavoriteAt = useCallback(
    (index: number) => (videoSource ? favorites.isFavorite(videoSource.label, index) : false),
    [favorites, videoSource]
  );

  const noteTextAt = useCallback(
    (index: number) => (videoSource ? notes.noteAt(videoSource.label, index)?.text ?? null : null),
    [notes, videoSource]
  );

  const openNoteEditor = useCallback(
    (segment: Segment, index: number) => {
      if (!videoSource) {
        setStatus('先选一个视频，注释才知道该记在哪一句上');
        return;
      }
      setEditingNote({ segment, index, text: notes.noteAt(videoSource.label, index)?.text ?? '' });
    },
    [notes, videoSource]
  );

  const saveNote = useCallback(
    (text: string) => {
      const videoKey = videoSource?.label;
      if (!videoKey || !editingNote) return;
      notes.save({
        videoKey,
        videoLabel: subtitleLabel || videoKey,
        index: editingNote.index,
        segment: editingNote.segment,
        text
      });
    },
    [editingNote, notes, subtitleLabel, videoSource]
  );

  /**
   * 回到标记时的那一句。同一部片直接跳；换了片子就只能先把那部片的字幕换回来，
   * 本地视频的地址是一次性的，得让用户重新选一次片源。
   */
  const jumpToRecord = useCallback(
    async (record: SentenceRecord) => {
      if (videoSource?.label === record.videoKey) {
        const target = displaySegments[record.index];
        if (target) {
          seekToSegment(target, record.index);
          setMarksTab(null);
          return;
        }
        // 字幕换过版本，下标对不上了，就按标记时记下的时间点找
        seekTo(record.start + offset);
        setMarksTab(null);
        setStatus('这句在当前字幕里的位置对不上，已按标记时的时间点跳转');
        return;
      }

      const cached = await loadCachedSubtitle(record.videoKey);
      if (!cached) {
        setStatus(`这句来自「${record.videoKey}」，本机没有它的字幕了，选回那部片再看`);
        return;
      }
      applySubtitles(cached.segments, cached.label, { cacheKey: record.videoKey, skipCache: true });
      setMarksTab(null);
      setStatus(`已切到「${record.videoKey}」的字幕，选上这部片的视频就能接着看第 ${record.index + 1} 句`);
    },
    [applySubtitles, displaySegments, offset, seekTo, seekToSegment, videoSource]
  );

  const loadSubtitleFrom = useCallback(
    async (uri: string, name: string, webFile?: globalThis.File) => {
      if (!uri) {
        setStatus('请先填写字幕地址');
        return;
      }
      setStatus('正在解析字幕…');
      try {
        const text = await readTextFile(uri, webFile);
        const parsed = parseSubtitles(text, name);
        if (!parsed.length) {
          setStatus('没有从这个文件里解析出字幕，请确认格式为 srt / vtt / ass');
          return;
        }
        applySubtitles(parsed, `${name}（${parsed.length} 句）`);
      } catch (error) {
        setStatus(`字幕加载失败：${(error as Error).message}`);
      }
    },
    [applySubtitles]
  );

  const pickVideo = useCallback(async () => {
    setStatus('已请求打开文件选择框，若没有弹出请看下方说明');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'video/*',
        copyToCacheDirectory: true,
        multiple: false,
        // base64 默认是 true，网页端会把整个文件读成 data URL，几个 GB 的片源直接读失败
        base64: false
      });
      if (result.canceled || !result.assets?.length) {
        setStatus('没有选择文件');
        return;
      }
      const asset = result.assets[0];
      setVideoSource({ kind: 'local', uri: asset.uri, label: asset.name });
      setStatus(null);
    } catch (error) {
      setStatus(`打开文件选择框失败：${(error as Error).message}`);
    }
  }, []);

  const pickSubtitle = useCallback(async () => {
    setStatus('已请求打开文件选择框，若没有弹出请看下方说明');
    try {
      // 字幕文件的 MIME 类型不统一（srt 常常为空），限定类型会导致文件选不中
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
        base64: false
      });
      if (result.canceled || !result.assets?.length) {
        setStatus('没有选择文件');
        return;
      }
      const asset = result.assets[0];
      await loadSubtitleFrom(asset.uri, asset.name, asset.file);
    } catch (error) {
      setStatus(`打开文件选择框失败：${(error as Error).message}`);
    }
  }, [loadSubtitleFrom]);

  /**
   * 中英各下一份再按时间轴配对，比找现成的双语压制字幕更容易命中，
   * 而且英文轨来自独立字幕，断句通常更规整。
   */
  const downloadAndMerge = useCallback(
    async (english: SubtitleCandidate | null, chinese: SubtitleCandidate | null) => {
      if (!english && !chinese) return;
      setSearchBusy(true);
      setStatus('正在下载字幕…');
      try {
        let englishSegments: Segment[] = [];
        let chineseSegments: Segment[] = [];
        const names: string[] = [];

        if (english) {
          const result = await downloadSubtitle({ fileId: english.fileId });
          englishSegments = parseSubtitles(result.text, result.fileName);
          names.push(result.fileName);
          if (result.remaining >= 0) setQuotaRemaining(result.remaining);
        }
        if (chinese) {
          const result = await downloadSubtitle({ fileId: chinese.fileId });
          chineseSegments = parseSubtitles(result.text, result.fileName);
          names.push(result.fileName);
          if (result.remaining >= 0) setQuotaRemaining(result.remaining);
        }

        const merged =
          englishSegments.length && chineseSegments.length
            ? mergeBilingual(englishSegments, chineseSegments)
            : englishSegments.length
              ? englishSegments
              : chineseSegments;

        if (!merged.length) {
          setStatus('字幕下载成功，但没有解析出内容');
          return;
        }
        const matched = merged.filter((segment) => segment.en && segment.zh).length;
        const detail = englishSegments.length && chineseSegments.length ? `，其中 ${matched} 句配上了中文` : '';
        applySubtitles(merged, `${names.join(' + ')}（${merged.length} 句${detail}）`);
      } catch (error) {
        setStatus(`字幕下载失败：${(error as Error).message}`);
      } finally {
        setSearchBusy(false);
      }
    },
    [applySubtitles]
  );

  const loadSample = useCallback(() => {
    setVideoSource({ kind: 'remote', uri: sampleData.videoUri, label: sampleData.title });
    // videoSource 这一帧还没更新，缓存 key 得显式给出
    applySubtitles(sampleSegments, `${sampleData.title}（${sampleSegments.length} 句）`, {
      cacheKey: sampleData.title,
      skipCache: true
    });
  }, [applySubtitles]);

  const useBundled = useCallback(() => {
    if (bundledVideo == null) return;
    const resolved = Image.resolveAssetSource(bundledVideo);
    setVideoSource({
      kind: 'bundled',
      uri: resolved?.uri ?? '',
      label: bundledVideoLabel,
      module: bundledVideo
    });
    setStatus(null);
  }, []);

  const showThumbnails =
    Platform.OS !== 'web' && !segments.length && !!videoSource?.uri && fallbackSegments.length > 0;

  /**
   * 顶栏只放得下一小段文字，长网址会把片名挤没。
   * label 同时是字幕缓存的 key，不能动，另算一个用于显示的短名。
   */
  const videoTitle = useMemo(() => {
    const label = videoSource?.label;
    if (!label) return '未选择视频';
    if (!/^https?:/i.test(label)) return label;
    try {
      const file = decodeURIComponent(new URL(label).pathname.split('/').filter(Boolean).pop() ?? '');
      return file || new URL(label).hostname;
    } catch {
      return label;
    }
  }, [videoSource]);

  const guessedTitle = useMemo(() => guessTitleFrom(videoSource?.label ?? ''), [videoSource]);

  // 宽屏是右侧固定一栏，窄屏是标签页里的一整页，内容完全一样
  const wordPanel = (
    <WordPanel
      segment={segments.length ? currentSegment : undefined}
      segments={displaySegments}
      currentIndex={activeIndex}
      words={currentWords}
      status={vocabulary.status}
      level={level}
      onLevelChange={setLevel}
      showMastered={showMastered}
      onToggleShowMastered={() => setShowMastered((previous) => !previous)}
      isMastered={mastery.isMastered}
      onToggleMastered={mastery.toggle}
      onSpeak={speakSegment}
      onJump={(index) => {
        const target = displaySegments[index];
        if (target) seekToSegment(target, index);
      }}
      onOpenWordbook={() => setWordbookOpen(true)}
      phrases={vocabulary.phrasesOf(activeIndex)}
      stacked={stacked}
    />
  );

  const settings = (
    <>
      <SourcePanel
        initialVideoUrl={sampleData.videoUri}
        videoLabel={videoSource?.label ?? '未选择'}
        subtitleLabel={subtitleLabel}
        status={status}
        canUseBundled={bundledVideo != null}
        onLoadVideoUrl={(url) => {
          if (!url) {
            setStatus('请先填写视频地址');
            return;
          }
          setVideoSource({ kind: 'remote', uri: url, label: url });
          setStatus(null);
        }}
        onPickVideo={pickVideo}
        onUseBundled={useBundled}
        onLoadSubtitleUrl={(url) => loadSubtitleFrom(url, url.split('/').pop() || 'subtitle')}
        onPickSubtitle={pickSubtitle}
        onLoadSample={loadSample}
        onClearSubtitle={() => {
          setSegments([]);
          setSubtitleLabel('未加载');
          setLoop(null);
          subtitleOwnerRef.current = null;
        }}
      />

      <RecentSubtitles
        entries={cacheEntries}
        activeKey={videoSource?.label}
        onLoad={applyCachedSubtitle}
        onRemove={dropCachedSubtitle}
      />

      {/* 换视频时用 key 重建面板，让片名输入框跟着新文件名走 */}
      <SubtitleSearchPanel
        key={videoSource?.label ?? 'no-video'}
        initialQuery={guessedTitle}
        busy={searchBusy}
        quotaRemaining={quotaRemaining}
        onDownloadPair={downloadAndMerge}
      />
    </>
  );

  return (
    <View style={styles.container}>
      <TopBar
        videoLabel={videoTitle}
        subtitleLabel={subtitleLabel}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((previous) => !previous)}
        favoriteCount={favorites.favorites.length}
        noteCount={notes.notes.length}
        onOpenFavorites={() => setMarksTab('favorites')}
        onOpenNotes={() => setMarksTab('notes')}
      />

      {status ? (
        <TouchableOpacity style={styles.statusStrip} onPress={() => setStatus(null)} activeOpacity={0.8}>
          <Text style={styles.statusText}>{status}</Text>
          <Text style={styles.statusClose}>×</Text>
        </TouchableOpacity>
      ) : null}

      <View style={[styles.body, stacked && styles.bodyStacked]}>
        <View style={styles.main}>
          <VideoStage
            player={player}
            hasSource={!!videoSource}
            currentSegment={segments.length ? currentSegment : undefined}
            showChinese={showChinese}
          />

          {/* 没片子时这些按钮全是灰的，只会挡住第一步该干什么 */}
          {!videoSource ? (
            <View style={styles.startRow}>
              <TouchableOpacity style={styles.startPrimary} onPress={loadSample} activeOpacity={0.8}>
                <Text style={styles.startPrimaryText}>先用示例片段试一下</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.startGhost} onPress={pickVideo} activeOpacity={0.8}>
                <Text style={styles.startGhostText}>选本地视频</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.startGhost} onPress={() => setSettingsOpen(true)} activeOpacity={0.8}>
                <Text style={styles.startGhostText}>粘贴网址</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <PlaybackBar
              onPrevious={goToPrevious}
              onNext={goToNext}
              onRepeat={() => currentSegment && speakSegment(currentSegment)}
              loopMode={loop?.mode ?? null}
              loopRange={loopRange}
              onToggleLoop={toggleLoop}
              onMarkLoopStart={markLoopStart}
              onMarkLoopEnd={markLoopEnd}
              onClearLoop={clearLoop}
              onReplayLoop={replayLoop}
              onJumpToLoopStart={() => jumpToLoopEdge('start')}
              onJumpToLoopEnd={() => jumpToLoopEdge('end')}
              showChinese={showChinese}
              onToggleChinese={() => setShowChinese((previous) => !previous)}
              offset={offset}
              onOffsetChange={(delta) => setOffset((previous) => Number((previous + delta).toFixed(2)))}
              hasSegments={displaySegments.length > 0}
              hasCurrent={!!currentSegment?.en}
            />
          )}

          {showThumbnails && videoSource ? (
            <ThumbnailStrip
              videoUri={videoSource.uri}
              starts={fallbackSegments.map((segment) => segment.start)}
              onSelect={(start) => {
                seekTo(start);
                player.play();
              }}
            />
          ) : null}

          {/* 窄屏放不下两列，台词和单词各占一个标签页，视频始终留在上面 */}
          {stacked && videoSource ? (
            <View style={styles.tabs}>
              <TouchableOpacity
                style={[styles.tab, narrowTab === 'lines' && styles.tabActive]}
                onPress={() => setNarrowTab('lines')}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, narrowTab === 'lines' && styles.tabTextActive]}>
                  台词{displaySegments.length ? ` ${displaySegments.length}` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, narrowTab === 'words' && styles.tabActive]}
                onPress={() => setNarrowTab('words')}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, narrowTab === 'words' && styles.tabTextActive]}>
                  单词{currentWords.length ? ` ${currentWords.length}` : ''}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 没视频时标签栏是隐藏的，这时必须落回台词面，否则没有入口切回来 */}
          {!stacked || !videoSource || narrowTab === 'lines' ? (
            <View style={styles.listWrap}>
              <Text style={styles.listTitle}>
                {segments.length
                  ? `台词 ${segments.length} 句 · ${formatTime(segments[0].start)} - ${formatTime(segments[segments.length - 1].end)}`
                  : videoSource
                    ? `还没有字幕，暂按 12 秒切成 ${displaySegments.length} 个片段`
                    : '台词'}
              </Text>
              {!segments.length && videoSource ? (
                <SubtitleFinder
                  state={finder}
                  busy={searchBusy}
                  onRetry={runAutoSearch}
                  onDownload={downloadAndMerge}
                />
              ) : null}

              <SegmentList
                segments={displaySegments}
                activeIndex={activeIndex}
                loop={loop}
                onSelect={seekToSegment}
                onSpeak={speakSegment}
                onLoopFrom={markLoopStart}
                onLoopTo={markLoopEnd}
                onLoopSingle={loopSingle}
                onClearLoop={clearLoop}
                isFavorite={isFavoriteAt}
                onToggleFavorite={toggleFavorite}
                noteAt={noteTextAt}
                onEditNote={openNoteEditor}
                // 有视频时上方的找字幕面板已经在引导了，这里不必再说一遍
                emptyHint={videoSource ? '' : '点右上角「视频与字幕」选一个视频开始。'}
              />
            </View>
          ) : (
            wordPanel
          )}
        </View>

        {stacked ? null : wordPanel}
      </View>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} title="视频与字幕">
        {settings}
      </SettingsDrawer>

      {wordbookOpen ? (
        <WordbookScreen
          words={vocabulary.allWords}
          segments={displaySegments}
          title={`${videoSource?.label ?? '全片单词'} · 共 ${vocabulary.allWords.length} 个词`}
          level={level}
          onLevelChange={setLevel}
          isMastered={mastery.isMastered}
          onToggleMastered={mastery.toggle}
          onJump={(index) => {
            const target = displaySegments[index];
            if (target) seekToSegment(target, index);
          }}
          onClose={() => setWordbookOpen(false)}
        />
      ) : null}

      {marksTab ? (
        <MarksScreen
          tab={marksTab}
          onTabChange={setMarksTab}
          favorites={favorites.favorites}
          notes={notes.notes}
          currentVideoKey={videoSource?.label ?? null}
          onJump={jumpToRecord}
          onRemoveFavorite={favorites.remove}
          onRemoveNote={notes.remove}
          onEditNote={(note: Note) => {
            const target = displaySegments[note.index];
            // 注释列表里可能有别的片子的句子，那些没法在这儿改
            if (videoSource?.label === note.videoKey && target) {
              setMarksTab(null);
              setEditingNote({ segment: target, index: note.index, text: note.text });
            } else {
              setStatus(`这条注释属于「${note.videoKey}」，切到那部片才能改`);
            }
          }}
          onClose={() => setMarksTab(null)}
        />
      ) : null}

      {editingNote ? (
        <NoteEditor
          segment={editingNote.segment}
          index={editingNote.index}
          initialText={editingNote.text}
          onSave={saveNote}
          onClose={() => setEditingNote(null)}
        />
      ) : null}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f8fa'
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff8e6'
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    color: '#8a6d1f'
  },
  statusClose: {
    fontSize: 16,
    color: '#b9a05c'
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12
  },
  bodyStacked: {
    flexDirection: 'column'
  },
  main: {
    flex: 1,
    minWidth: 0
  },
  listWrap: {
    flex: 0.9,
    minHeight: 150,
    marginTop: 2
  },
  listTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 14
  },
  startPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#2f80ed'
  },
  startPrimaryText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600'
  },
  startGhost: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#eef1f5'
  },
  startGhostText: {
    fontSize: 14,
    color: '#333'
  },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    marginBottom: 8
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#eef1f5'
  },
  tabActive: {
    backgroundColor: '#2f80ed'
  },
  tabText: {
    fontSize: 13,
    color: '#444'
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600'
  }
});
