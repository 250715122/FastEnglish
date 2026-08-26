import { useEvent, useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountScreen } from './src/components/AccountScreen';
import { LibraryScreen } from './src/components/LibraryScreen';
import { LoginScreen } from './src/components/LoginScreen';
import { useListenMode } from './src/hooks/useListenMode';
import { CopyworkScreen } from './src/components/CopyworkScreen';
import { DictationScreen } from './src/components/DictationScreen';
import { PlaybackBar } from './src/components/PlaybackBar';
import { ReaderScreen } from './src/components/ReaderScreen';
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
import { useAudioTrack } from './src/hooks/useAudioTrack';
import { useAuth, type User } from './src/hooks/useAuth';
import { useCurrentSegment } from './src/hooks/useCurrentSegment';
import { useDictation } from './src/hooks/useDictation';
import { useFavorites } from './src/hooks/useFavorites';
import { useKeyboardShortcuts } from './src/hooks/useKeyboardShortcuts';
import { useLibrary, type Movie } from './src/hooks/useLibrary';
import { useMastery } from './src/hooks/useMastery';
import { useNotes, type Note } from './src/hooks/useNotes';
import type { SentenceRecord } from './src/hooks/useSentenceRecords';
import { useSpeech } from './src/hooks/useSpeech';
import { useVocabulary } from './src/hooks/useVocabulary';
import type { SpeechPart } from './src/lib/vocabulary/readWord';
import type { DifficultyLevel } from './src/lib/vocabulary/study';
import { audioUrl, streamUrl } from './src/lib/api';
import { configureAudioSession, reclaimAudioSession } from './src/lib/audioSession';
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

/** 合成音可选的语速档位。压到 0.6 以下机器味太重，1.0 以上就失去了合成音的意义。 */
const SYNTH_RATES = [0.6, 0.75, 0.9, 1.0];

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

/**
 * 认证外壳。登录状态定下来之前什么都不渲染——
 * 下面那一大堆 hook 全都要按用户取数据，没有用户就跑不了。
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthGate />
    </SafeAreaProvider>
  );
}

function AuthGate() {
  const auth = useAuth();

  // iOS 的静音拨片默认会把播放器一起哑掉，进来就先把音频会话定好
  useEffect(() => {
    configureAudioSession();

    /**
     * 回到前台再定一次。息屏、来电、切去别的 App 都会把会话交出去，
     * 回来时不重新拿，播放器就只剩画面没有声音。
     */
    const watch = AppState.addEventListener('change', (state) => {
      if (state === 'active') reclaimAudioSession();
    });
    return () => watch.remove();
  }, []);

  if (auth.status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#2f80ed" />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (auth.status === 'anonymous' || !auth.user) {
    return (
      <>
        <LoginScreen
          error={auth.error}
          hasUsers={auth.hasUsers}
          canRegister={auth.canRegister}
          needsInvite={auth.needsInvite}
          onLogin={auth.login}
          onRegister={auth.register}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  // key 让换用户时整棵树重建，不会留着上一个人的收藏和进度
  return (
    <StudyApp
      key={auth.user.id}
      user={auth.user}
      sessions={auth.sessions}
      onLogout={auth.logout}
      onChangePassword={auth.changePassword}
      onLogoutOthers={auth.logoutOthers}
    />
  );
}

type StudyAppProps = {
  user: User;
  sessions: number;
  onLogout: () => void;
  onChangePassword: (current: string, next: string) => Promise<number>;
  onLogoutOthers: () => Promise<number>;
};

function StudyApp({ user, sessions, onLogout, onChangePassword, onLogoutOthers }: StudyAppProps) {
  const [view, setView] = useState<'library' | 'study'>('library');
  const [activeMovie, setActiveMovie] = useState<Movie | null>(null);
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
  /** 读模式和写模式都是盖满整屏的另一套界面，看和听则是原地换个放法 */
  const [studyMode, setStudyMode] = useState<'read' | 'write' | null>(null);
  /** 写模式底下两种练法：听着写，还是照着抄 */
  const [writeTab, setWriteTab] = useState<'dictation' | 'copy'>('dictation');
  /**
   * 从单词页跳去看某句台词时，记下当时翻着的那个词，界面上留一条回去的路。
   * 单词页本身是收起来而不是卸载的，所以回去看到的还是原来那一屏。
   */
  const [wordbookReturn, setWordbookReturn] = useState<string | null>(null);
  const [marksTab, setMarksTab] = useState<MarksTab | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<{ segment: Segment; index: number; text: string } | null>(null);
  const [narrowTab, setNarrowTab] = useState<'lines' | 'words'>('lines');
  /**
   * 念一句台词时用谁的声音：片子自己的，还是合成的。
   * 原声是真人语调、连读和情绪，练听力得听它；合成音胜在语速能压慢、吐字清楚，
   * 而且换片、跨片都还在，不依赖片源。
   */
  const [voice, setVoice] = useState<'original' | 'synth'>('original');
  /**
   * 合成音的语速。原片是几倍速就几倍速，这里只调合成音，
   * 所以从原声切到合成音时节奏会变——压慢正是合成音的用处，能调是为了让你自己找那个点。
   */
  const [synthRate, setSynthRate] = useState(0.75);
  const cycleSynthRate = useCallback(() => {
    setSynthRate((previous) => SYNTH_RATES[(SYNTH_RATES.indexOf(previous) + 1) % SYNTH_RATES.length]);
  }, []);
  const [finder, setFinder] = useState<FinderState>({
    status: 'idle',
    title: '',
    english: [],
    chinese: [],
    canonicalTitle: null
  });

  const { width } = useWindowDimensions();
  // 刘海和 Home 指示条会盖住顶栏与播放条，左右是横屏时的凹口
  const insets = useSafeAreaInsets();
  const safeArea = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right
  };
  const stacked = width < 980;

  const { speak, stop: stopSpeech } = useSpeech();
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

  /**
   * 听模式放的是服务端抽出来的音轨，只有它真的备好了才切过去。
   *
   * 默认开不开跟着网络环境走，见 useListenMode。
   */
  const { listenMode, chooseListenMode, remote } = useListenMode();
  const audio = useAudioTrack(listenMode ? activeMovie?.id ?? null : null);
  const listening = listenMode && audio.state === 'ready' && activeMovie != null;

  /**
   * 音轨加载不动时换个地址重挂用的序号，见 audioUrl。
   *
   * 换片或进出听模式都从头开始；同一部片子最多自动重来 MAX_AUDIO_RETRIES 次，
   * 免得片源真有问题时在这儿空转。用户还可以从听模式那边手动点重连。
   */
  const MAX_AUDIO_RETRIES = 3;
  const [audioAttempt, setAudioAttempt] = useState(0);
  useEffect(() => {
    setAudioAttempt(0);
  }, [activeMovie?.id, listenMode]);

  const playerSource = useMemo(() => {
    if (!videoSource) return null;

    /**
     * 听模式下音轨没备好就什么都不放，绝不退回去拉原片。
     *
     * 原先是「在那之前先放着原片」，局域网上看不出问题，外网上是致命的：
     * 服务端日志里手机在同时拉 4.8 GB 的原片和 65 MB 的音轨，平分那条 1 Mbps 的链路，
     * 音轨只剩 32 KB/s，拿不完 moov 索引表就撞上 AVPlayer 的 60 秒超时。
     * 听模式本来就不显示画面，这会儿的原片一帧都用不上。
     */
    if (listenMode && activeMovie) {
      if (!listening) return null;
      return {
        uri: audioUrl(activeMovie.id, audioAttempt),
        // 锁屏卡片和控制中心显示的就是这里，不给就只剩一个孤零零的播放键
        metadata: { title: activeMovie.title || activeMovie.name, artist: 'FastEnglish 听模式' }
      };
    }
    if (videoSource.kind === 'bundled' && videoSource.module != null) return videoSource.module;
    return { uri: videoSource.uri };
  }, [activeMovie, audioAttempt, listenMode, listening, videoSource]);

  const player = useVideoPlayer(playerSource, (instance) => {
    instance.loop = false;
    // 字幕跟随完全依赖这个事件；设为 0 时 timeUpdate 不会触发
    instance.timeUpdateEventInterval = 0.25;
  });

  /**
   * 只有听模式才让它在后台接着放。
   *
   * 看模式锁屏就该停：人已经不看画面了，继续解码只是白耗电。而听模式本来就是
   * 「不用看画面」，锁屏后断掉反而是丢功能——揣兜里走路听正是它该用的场景。
   *
   * 锁屏卡片要求音频模式是 doNotMix 或 auto，这是系统的硬性要求，
   * 设成混音模式的话卡片根本不出现。
   */
  useEffect(() => {
    /**
     * Expo Go 的 Info.plist 里没有 UIBackgroundModes=audio（那是 app.json 的
     * config plugin 在真正出包时才写进去的）。缺这个授权时，后台播放和锁屏卡片
     * 这两项在 iOS 上可能直接抛出来。一抛这个 effect 就断在半路，
     * 后面的 audioMixingMode 再也设不上，而这条恰恰是听模式出声的前提。
     * 所以分开设，谁不行谁自己失败。
     */
    try {
      player.staysActiveInBackground = listening;
      player.showNowPlayingNotification = listening;
    } catch {
      // 拿不到后台播放就算了，前台照样能听
    }
    player.audioMixingMode = listening ? 'doNotMix' : 'auto';

    /**
     * 听模式给缓冲设个上限，否则跳一次要等半分钟以上。
     *
     * 默认 preferredForwardBufferDuration 是 0，意思是「播放器自己看着办」，
     * AVPlayer 在两小时的资源上选得极其激进：服务端日志里一次跳转能引发
     * 连续五十多个分片请求，约 5 MB，外网那点带宽下正好是一分钟量级。
     * 而双击一句台词只需要几秒的音频。
     *
     * waitsToMinimizeStalling 默认 true，它会等到自认为「能一口气播完不卡」
     * 才出声，慢链路上这个估算同样保守得离谱。
     *
     * 压到 30 秒（3 个分片）就够：音轨只有 64 kbps，也就是 8 KB/s，
     * 30 秒的存量足以扛住抖动。看模式不动，画面要的余量比这大得多。
     *
     * 得整个对象赋值，改单个字段不生效，这是 expo-video 明说的。
     */
    player.bufferOptions = listening
      ? { preferredForwardBufferDuration: 30, waitsToMinimizeStalling: false }
      : {};
  }, [listening, player]);

  const timeUpdate = useEvent(player, 'timeUpdate');
  const reportedTime = timeUpdate?.currentTime ?? 0;

  /**
   * 原片和音轨是两个不同的地址，来回切会把播放器的位置清零。
   * 这里一直记着最后一次回报的位置：切换发生的那一帧它还是切换前的值，
   * 因为新源的 timeUpdate 还没来得及发出来。
   */
  const lastGoodTimeRef = useRef(0);
  useEffect(() => {
    if (reportedTime > 0) lastGoodTimeRef.current = reportedTime;
  }, [reportedTime]);

  /**
   * 画面用的是原生控件，播放键不归我们管，只能从这个事件里接管。
   *
   * 但不是所有播放都该被接管：我们自己为了跳句、重播段落而调 play 的那些不算，
   * 那才是真要放画面。所以自己发起的先在这里挂个号，事件里认号放行。
   */
  const allowPlayRef = useRef(false);
  const playVideo = useCallback(() => {
    allowPlayRef.current = true;
    // 朗读、锁屏、来电都可能把音频会话拿走，出声之前先要回来
    reclaimAudioSession();
    player.play();
    // 播放器本来就在放的话不会再发事件，这张放行条就没人来销，
    // 留着会吞掉用户下一次真按播放
    setTimeout(() => {
      allowPlayRef.current = false;
    }, 400);
  }, [player]);

  /** 每次渲染换成最新的那份，事件回调里读它就不会拿到过期的档位和字幕 */
  const interceptPlayRef = useRef<() => void>(() => undefined);

  const playingRef = useRef(false);
  /** 读模式那一页没有播放器可看，播放键的样子只能靠这个状态 */
  const [playing, setPlaying] = useState(false);
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    playingRef.current = isPlaying;
    setPlaying(isPlaying);
    if (!isPlaying) return;
    if (allowPlayRef.current) {
      allowPlayRef.current = false;
      return;
    }
    /**
     * 必须排到这一轮之后再动手。播放器发完这个事件，紧接着还要把 play 同步到
     * 它挂着的每个 video 上，在这儿直接按停会被那一步当场撤销，然后又发一次事件，
     * 两边来回弹个没完。等同步做完再按，一次就稳住了。
     */
    queueMicrotask(() => interceptPlayRef.current());
  });

  /** 换源后等播放器就绪，再把位置和播放状态接回去 */
  const resumeRef = useRef<{ time: number; playing: boolean } | null>(null);
  const listeningRef = useRef(false);

  /**
   * 换个地址把音轨重挂一遍，位置带过去。地址不变的话播放器不会重新 replace，
   * 那个已经卡住的 asset 就一直挂在那儿，见 audioUrl 里的说明。
   */
  const reloadAudio = useCallback(() => {
    resumeRef.current = { time: lastGoodTimeRef.current, playing: false };
    setAudioAttempt((n) => n + 1);
  }, []);

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

  /**
   * 「放到这句结尾就停」用的刹车点。
   *
   * 播放器只会一路播下去，没有「只放这一段」这回事，所以记下该在哪儿收，
   * 由跟着 currentTime 走的那个 effect 来踩。
   *
   * resolve 一并存着，是为了让串着放的收藏列表知道这句什么时候完；
   * 被下一句顶掉、或者用户自己跳走时也必须 resolve，
   * 否则等它的那个 await 会永远悬着，整串就卡死在那儿了。
   */
  const oneShotRef = useRef<{ until: number; resolve: () => void } | null>(null);

  /** 念一个单词要分好几段（单词、释义、例句），中途叫停时靠它把后面几段甩掉 */
  const wordSessionRef = useRef(0);

  /**
   * 合成音档下点播放键会一句接一句念下去，这几个是它的开关。
   *
   * 一切「用户改主意了」的动作都要把它掐掉——跳到另一句、单点跟读、按停止，
   * 否则那串 await 会在被打断后自顾自接着念下一句。判断全压在自增的 session 上：
   * 被打断的 speak 同样会兑现 Promise，光看兑现区分不出是念完了还是被顶掉了。
   */
  const readingSessionRef = useRef(0);
  const readingRef = useRef(false);
  const [reading, setReading] = useState(false);
  const cancelReadAloud = useCallback(() => {
    readingSessionRef.current += 1;
    readingRef.current = false;
    setReading(false);
  }, []);

  const releaseOneShot = useCallback(() => {
    const shot = oneShotRef.current;
    oneShotRef.current = null;
    shot?.resolve();
  }, []);

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
  const [playerStatus, setPlayerStatus] = useState<string>('idle');
  useEventListener(player, 'statusChange', ({ status }) => {
    setPlayerStatus(String(status));

    /**
     * 音轨拉挂了就换个地址重挂一次，把播放位置带过去。
     *
     * 切网络时在飞的连接会断，AVPlayer 会把这个 asset 记成失败，之后同一个地址
     * 怎么点都是原来那个错误——用户实测切回 WiFi 也放不出来，重启 app 才好。
     * 换成带序号的地址才会真的重建一个。
     */
    if (status === 'error' && listening && audioAttempt < MAX_AUDIO_RETRIES) {
      resumeRef.current = { time: lastGoodTimeRef.current, playing: playingRef.current };
      setAudioAttempt((n) => n + 1);
      return;
    }

    if (status !== 'readyToPlay') return;
    setDuration(player.duration || 0);

    const resume = resumeRef.current;
    if (!resume) return;
    resumeRef.current = null;
    if (resume.time > 0.5) seekTo(resume.time);
    if (resume.playing) playVideo();
  });

  useEffect(() => {
    if (listeningRef.current === listening) return;
    listeningRef.current = listening;
    resumeRef.current = { time: lastGoodTimeRef.current, playing: playingRef.current };
  }, [listening]);

  /**
   * 卡在 loading 上不动也得救，而且这才是实际遇到的样子。
   *
   * 原先只认 status === 'error'，但切过网络之后 AVPlayer 是**僵在 loading**、
   * 从不报错的：分片一路 200 拿着，界面显示「loading · 已暂停」，永远等不到那个
   * error，所以自动重挂一次都没触发过。
   *
   * **但光看「loading 持续了多久」会误杀跳转。** 之前就是纯计时的：双击一句远处的
   * 台词，缓冲还在正常进行，15 秒一到就被推倒重来，重来又从头开始，三次重试正好
   * 三四十秒——用户看到的「要等半分钟才出声」就是它自己造成的。服务端日志里
   * 播放列表被取了 6 次、seg00000 取了 3 次，全是这么来的。
   *
   * 所以判据换成「有没有数据进来」：bufferedPosition 在缓冲时会往前爬，
   * asset 被判死时一动不动。只有完全不动够久了才重挂。
   */
  const STUCK_MS = 25000;
  useEffect(() => {
    if (!listening || playerStatus !== 'loading') return;
    if (audioAttempt >= MAX_AUDIO_RETRIES) return;

    let flatSince = Date.now();
    let seen = Number.NaN;
    const timer = setInterval(() => {
      const buffered = player.bufferedPosition;
      if (buffered !== seen) {
        seen = buffered;
        flatSince = Date.now();
        return;
      }
      if (Date.now() - flatSince >= STUCK_MS) reloadAudio();
    }, 1000);
    return () => clearInterval(timer);
  }, [audioAttempt, listening, player, playerStatus, reloadAudio]);

  // 进了听模式音轨还没抽过，直接开工，不用再让用户多点一次
  const { state: audioState, prepare: prepareAudio } = audio;
  useEffect(() => {
    if (listenMode && audioState === 'none') prepareAudio();
  }, [listenMode, audioState, prepareAudio]);

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
  const mastery = useMastery(user.id);
  const favorites = useFavorites(user.id);
  const notes = useNotes(user.id);
  const library = useLibrary(user.id);
  const dictation = useDictation(user.id, videoSource?.label ?? null);
  /**
   * 单击台词选中的那一句。它和"正在播的那一句"是两回事：挑一句琢磨单词时
   * 画面不该跟着乱跳，右侧讲解就认这一句；没选中时才交还给播放进度。
   */
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const studyIndex = selectedIndex ?? activeIndex;
  const studySegment = selectedIndex != null ? displaySegments[selectedIndex] : currentSegment;

  // 换了字幕，下标就指向别的句子了，留着只会指错
  useEffect(() => {
    setSelectedIndex(null);
  }, [segments]);

  const currentWords = useMemo(
    () => vocabulary.wordsOf(segments.length ? studySegment : undefined),
    [studySegment, segments.length, vocabulary]
  );

  const seekToSegment = useCallback(
    (segment: Segment, index?: number) => {
      // 用户自己挑了另一句，之前那个「放完这句就停」的约定作废，不然会当场停住
      releaseOneShot();
      cancelReadAloud();
      seekTo(segment.start + offset);
      // 真跳过去了就没有"选中另一句"这回事，讲解交还给播放进度
      setSelectedIndex(null);
      // 单句循环跟着用户手点的句子走；圈定的段落不受影响
      if (index != null) {
        setLoop((previous) =>
          previous?.mode === 'sentence' ? { mode: 'sentence', start: index, end: index } : previous
        );
      }
      playVideo();
    },
    [cancelReadAloud, offset, playVideo, releaseOneShot, seekTo]
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

  useEffect(() => {
    const shot = oneShotRef.current;
    if (!shot) return;
    if (currentTime - offset <= shot.until) return;
    oneShotRef.current = null;
    player.pause();
    shot.resolve();
  }, [currentTime, offset, player]);

  /** 用片子自己的声音放一句，从头放到尾就停 */
  const playOriginal = useCallback(
    (start: number, end: number) => {
      stopSpeech();
      releaseOneShot();
      cancelReadAloud();
      seekTo(start + offset);
      playVideo();
      return new Promise<void>((resolve) => {
        oneShotRef.current = { until: end, resolve };
      });
    },
    [cancelReadAloud, offset, playVideo, releaseOneShot, seekTo, stopSpeech]
  );

  /** 合成音念一句，片子还在响就听不清了 */
  const playSynth = useCallback(
    (text: string, rate: number) => {
      releaseOneShot();
      cancelReadAloud();
      player.pause();
      return speak(text, { rate });
    },
    [cancelReadAloud, player, releaseOneShot, speak]
  );

  /** 原声要有片源才谈得上；只挂了字幕没选视频时只能退回合成音 */
  const canUseOriginal = voice === 'original' && !!videoSource;

  /**
   * 「跟读」永远是机器念给你听，两个档位下都一样。
   *
   * 原声重听并没有丢：原声档下双击那一行本来就会跳过去从这句开始放原片，
   * 一个按钮跟着档位改名反而让人拿不准按下去会听到什么。
   */
  const speakSegment = useCallback(
    (segment: Segment) => {
      if (!segment.en) return;
      playSynth(segment.en, synthRate);
    },
    [playSynth, synthRate]
  );

  /**
   * 「去第 X 句」的统一入口，双击台词行和上/下一句都走它：放一遍就停。
   *
   * 放完这一句就停下、并且钉在这一句上，右侧讲解也跟着钉住——双击的意思本来就是
   * 「我要琢磨这一句」，而不是从这儿开始看下去。想接着往下放就按播放键，
   * 那边会从钉住的这句起一路放。合成音档同理，只是画面不动，改成念出来。
   *
   * 圈了循环是例外：交给循环自己绕圈，再插一道「放完就停」两边会打架，一句放完当场停住。
   */
  const goToIndex = useCallback(
    (segment: Segment, index: number) => {
      if (loop) {
        seekToSegment(segment, index);
        return;
      }
      if (canUseOriginal) {
        setSelectedIndex(index);
        playOriginal(segment.start, segment.end);
        return;
      }
      // 没有英文可念的句子退回跳转，否则这一下点了毫无反应
      if (!segment.en) {
        seekToSegment(segment, index);
        return;
      }
      setSelectedIndex(index);
      playSynth(segment.en, synthRate);
    },
    [canUseOriginal, loop, playOriginal, playSynth, seekToSegment, synthRate]
  );

  /**
   * 从哪一句起算上一句下一句。原声档跟着播放进度走；
   * 合成音档下画面是停着的，进度早就不代表「现在在看哪句」，只能认选中的那句。
   */
  const navAnchor = canUseOriginal ? activeIndex : studyIndex;

  const goToPrevious = useCallback(() => {
    if (!displaySegments.length) return;
    const position = currentTime - offset;
    const index =
      navAnchor > 0
        ? navAnchor - 1
        : displaySegments.reduce((found, segment, i) => (segment.end < position ? i : found), -1);
    if (index >= 0) goToIndex(displaySegments[index], index);
  }, [currentTime, displaySegments, goToIndex, navAnchor, offset]);

  const goToNext = useCallback(() => {
    if (!displaySegments.length) return;
    const position = currentTime - offset;
    const index =
      navAnchor >= 0 && navAnchor < displaySegments.length - 1
        ? navAnchor + 1
        : displaySegments.findIndex((segment) => segment.start > position);
    if (index >= 0) goToIndex(displaySegments[index], index);
  }, [currentTime, displaySegments, goToIndex, navAnchor, offset]);

  /**
   * 只收自己起的那一摊。没有待兑现的一次性播放，说明这会儿的画面是用户自己在放，
   * 不该顺手按停——离开收藏页时清理会走到这儿，那时按停就成了莫名其妙的暂停。
   */
  const stopSaying = useCallback(() => {
    stopSpeech();
    wordSessionRef.current += 1;
    cancelReadAloud();
    if (!oneShotRef.current) return;
    releaseOneShot();
    player.pause();
  }, [cancelReadAloud, player, releaseOneShot, stopSpeech]);

  /**
   * 把所有出声的东西一次收干净，离开这部片子时用。
   *
   * 跟 stopSaying 的区别在最后一行：那个只收自己起的一次性播放，用户自己
   * 按着放的画面不动；这里是**无条件**停，因为人已经不在这部片子上了。
   *
   * 声音有四摊，少收一摊就会跟到下一部片子上去：播放器、朗读、念单词、
   * 还有那个「放到某处就停」的约定。之前只切了界面，播放器留在原地接着响，
   * 回列表挑了另一部还在放上一部的声音。
   */
  const stopEverything = useCallback(() => {
    stopSpeech();
    wordSessionRef.current += 1;
    cancelReadAloud();
    releaseOneShot();
    player.pause();
    // 循环圈的是这部片子的句子下标，换片之后指向的就是别的台词了
    setLoop(null);
  }, [cancelReadAloud, player, releaseOneShot, stopSpeech]);

  /**
   * 收藏和注释横跨好几部片，只有当前这部才有原声可放，其余的退回合成音。
   *
   * 时间点用记录里存的那份而不是重新查字幕：字幕换过版本下标就对不上了，
   * 而记录里的秒数是当时按下收藏那一刻的，跟片子始终对得上。
   */
  const sayRecord = useCallback(
    (record: SentenceRecord) => {
      if (canUseOriginal && videoSource?.label === record.videoKey) {
        return playOriginal(record.start, record.end);
      }
      if (!record.en) return Promise.resolve();
      return playSynth(record.en, synthRate);
    },
    [canUseOriginal, playOriginal, playSynth, synthRate, videoSource]
  );

  /**
   * 词条里「片中其他出处」那几句就在片子里，点一下当场用原声放，放完就停。
   * 不给这个按钮的话，听一句就得跳走一趟，跳走了又回不到刚才翻到的那个词。
   */
  const playOccurrence = useCallback(
    (index: number) => {
      const segment = displaySegments[index];
      if (segment) playOriginal(segment.start, segment.end);
    },
    [displaySegments, playOriginal]
  );

  /** 读模式里点某一段的原声：从这段头一句放到末一句就停 */
  const playRange = useCallback(
    (from: number, to: number) => {
      const first = displaySegments[from];
      const last = displaySegments[to];
      if (first && last) playOriginal(first.start, last.end);
    },
    [displaySegments, playOriginal]
  );

  /** 单词、短语、词典例句在片子里没有对应的声音，只能合成，不受发音来源开关影响 */
  const speakText = useCallback(
    (text: string) => {
      if (!text) return;
      playSynth(text, 0.8);
    },
    [playSynth]
  );

  /**
   * 全片单词页连播时念一个词。单词、释义、例句是分开的几段，中英各用各的发音人。
   *
   * 段与段之间守着 wordSessionRef：按停止时 Speech.stop() 会让当前这段的 Promise 兑现，
   * 不守着就会当场接着念下一段。和 oneShotRef 是同一类问题。
   */
  const sayWord = useCallback(
    async (parts: SpeechPart[]) => {
      releaseOneShot();
      // 台词还在逐句念的话，两个声音会叠在一起，谁也听不清
      cancelReadAloud();
      player.pause();
      const session = (wordSessionRef.current += 1);
      for (const part of parts) {
        // 单个词压到 0.6 听着发飘，固定 0.8，不跟句子的语速档位
        await speak(part.text, { rate: 0.8, language: part.lang });
        if (wordSessionRef.current !== session) return;
      }
    },
    [cancelReadAloud, player, releaseOneShot, speak]
  );

  /** 只掐念单词这一摊。单词页开关自己的连播时会走到这儿，不该顺手动画面和台词朗读 */
  const stopWord = useCallback(() => {
    wordSessionRef.current += 1;
    stopSpeech();
  }, [stopSpeech]);

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
      playVideo();
    },
    [displaySegments, loop, offset, playVideo, seekTo]
  );

  const replayLoop = useCallback(() => {
    if (!loop) return;
    const first = displaySegments[loop.start];
    if (!first) return;
    seekTo(first.start + offset);
    playVideo();
  }, [displaySegments, loop, offset, playVideo, seekTo]);

  /**
   * 合成音档下的连续朗读：从某一句起一路念下去，画面全程停着。
   *
   * 播放头仍然跟着念到的这一句挪，于是字幕层、行高亮、自动滚动照旧跟着 currentTime 走，
   * 不用为朗读另做一套跟随；顺带也让你随时能切回原声接着这儿看。
   */
  const readAloudFrom = useCallback(
    async (startIndex: number, range?: { from: number; to: number; wrap?: boolean }) => {
      /**
       * 圈定的循环段落念到头要绕回去，读模式里点某一段却是念完就停——
       * 那是「把这段读给我听」，不是「把这段循环给我听」。
       * 读模式的段落循环两者都要，所以由调用方拿 wrap 明说。
       */
      const bounds = range ?? (loop?.end != null ? { from: loop.start, to: loop.end } : null);
      const wrap = range ? !!range.wrap : true;
      let index = bounds ? Math.min(Math.max(startIndex, bounds.from), bounds.to) : startIndex;
      if (index < 0 || index >= displaySegments.length) return;

      const session = (readingSessionRef.current += 1);
      readingRef.current = true;
      setReading(true);
      releaseOneShot();
      player.pause();

      while (index >= 0 && index < displaySegments.length) {
        const segment = displaySegments[index];
        setSelectedIndex(index);
        seekTo(segment.start + offset);

        // 空行没词可念，也得让出一拍，否则这个循环会空转到卡死
        if (segment.en) await speak(segment.en, { rate: synthRate });
        else await new Promise((resolve) => setTimeout(resolve, 60));
        if (readingSessionRef.current !== session) return;

        index += 1;
        if (bounds && index > bounds.to) {
          if (!wrap) break;
          index = bounds.from;
        }
      }

      readingRef.current = false;
      setReading(false);
    },
    [displaySegments, loop, offset, player, releaseOneShot, seekTo, speak, synthRate]
  );

  const stopReadAloud = useCallback(() => {
    cancelReadAloud();
    stopSpeech();
  }, [cancelReadAloud, stopSpeech]);

  // 切回原声档就没有「逐句念」这回事了，还念着的那串得当场收掉
  useEffect(() => {
    if (voice !== 'synth') stopReadAloud();
  }, [stopReadAloud, voice]);

  /**
   * 读模式里按段循环，跟着发音开关走：原声就让播放器在这段里绕圈，
   * 合成音就一句接一句念、念到段尾绕回段首。
   *
   * 两条路都把 loop 记下来，界面才知道是哪一段在循环；也让中途切换发音档时
   * 循环的是同一段。合成音这一路不需要片源，所以没选视频时它照样能用。
   */
  const loopParagraph = useCallback(
    (from: number, to: number) => {
      const first = displaySegments[from];
      if (!first) return;

      // 再点一次就是收工，两种声音都得停
      if (loop?.mode === 'range' && loop.start === from && loop.end === to) {
        setLoop(null);
        stopReadAloud();
        player.pause();
        return;
      }

      releaseOneShot();
      setLoop({ mode: 'range', start: from, end: to });

      if (!canUseOriginal) {
        readAloudFrom(from, { from, to, wrap: true });
        return;
      }

      stopSpeech();
      cancelReadAloud();
      seekTo(first.start + offset);
      playVideo();
    },
    [
      canUseOriginal,
      cancelReadAloud,
      displaySegments,
      loop,
      offset,
      player,
      playVideo,
      readAloudFrom,
      releaseOneShot,
      seekTo,
      stopReadAloud,
      stopSpeech
    ]
  );

  /**
   * 播放键的意思是「从选中的那一句起，顺着往下放」。
   *
   * 双击某一句只放一遍就停，接着往下走全靠这个键；单击选中一句再按它，就从那儿开始放。
   * 合成音档下画面不动，改成一句接一句念，已经在念了就当停止键使——
   * 原生控件上除了它没有别的键可按。
   */
  interceptPlayRef.current = () => {
    if (voice === 'synth' && segments.length) {
      player.pause();
      if (readingRef.current) {
        stopReadAloud();
        return;
      }
      readAloudFrom(selectedIndex ?? loopAnchor());
      return;
    }

    // 手按了播放就是想一路看下去，双击留下的那道「放完这句就停」不该再拦
    releaseOneShot();
    if (selectedIndex == null) return;
    const segment = displaySegments[selectedIndex];
    // 从这儿起交还给播放进度，右侧讲解不该还钉在原地
    setSelectedIndex(null);
    if (!segment) return;
    /**
     * 播放头已经在这句里（或刚放完停在它末尾）就别倒回去：
     * 那是暂停之后接着放，不是又挑了一句。
     */
    const position = currentTime - offset;
    if (position >= segment.start && position < segment.end + 1) return;
    seekTo(segment.start + offset);
  };

  const togglePlay = useCallback(() => {
    if (!videoSource) return;
    // 手按了播放就是想一路看下去，之前那个「放完这句就停」不该再拦
    releaseOneShot();
    if (player.playing) player.pause();
    else player.play();
  }, [player, releaseOneShot, videoSource]);

  // 默写那一页满屏都在等你敲字，空格和方向键得让给输入框
  useKeyboardShortcuts(
    {
      onTogglePlay: togglePlay,
      onPrevious: goToPrevious,
      onNext: goToNext,
      onRepeat: () => currentSegment && speakSegment(currentSegment),
      onToggleLoop: toggleLoop,
      onToggleChinese: () => setShowChinese((previous) => !previous),
      onMarkLoopStart: markLoopStart,
      onMarkLoopEnd: markLoopEnd,
      onClearLoop: clearLoop
    },
    studyMode !== 'write'
  );

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
        // 片源动辄几个 GB，复制进缓存要干等几十秒、多占一倍空间，缓存还可能被系统清掉。
        // 这一路只播不读，播放器能直接吃 Android 的 content:// 和 iOS 的安全作用域地址。
        // 选字幕那处不能照抄，原因见 pickSubtitle
        copyToCacheDirectory: false,
        multiple: false,
        // base64 默认是 true，网页端会把整个文件读成 data URL，几个 GB 的片源直接读失败
        base64: false
      });
      if (result.canceled || !result.assets?.length) {
        setStatus('没有选择文件');
        return;
      }
      const asset = result.assets[0];
      // 同 openMovie：换片之前先把上一部的声音收干净
      stopEverything();
      setActiveMovie(null);
      setVideoSource({ kind: 'local', uri: asset.uri, label: asset.name });
      setStatus(null);
    } catch (error) {
      setStatus(`打开文件选择框失败：${(error as Error).message}`);
    }
  }, [stopEverything]);

  /**
   * 从学习列表点进来。片子走后端串流，label 仍用文件名——
   * 字幕缓存和收藏都拿它当键，换成别的会认不出以前存过的东西。
   */
  const openMovie = useCallback(
    (movie: Movie) => {
      // 上一部还在响的话会盖着新片子，换源那一下并不保证把声音掐掉
      stopEverything();
      if (!movie.inStudyList) library.addToStudy(movie.id);
      setActiveMovie(movie);
      setVideoSource({ kind: 'remote', uri: streamUrl(movie.id), label: movie.name });
      setView('study');
      setSettingsOpen(false);
      setStatus(movie.lastPosition > 0 ? `上次看到 ${formatTime(movie.lastPosition)}` : null);
    },
    [library, stopEverything]
  );

  /**
   * 回学习列表。除了停声音，读/写模式那几层也得收掉：
   * 它们盖在整屏上，留着的话下次点进另一部片子会直接落在上一部的读模式里，
   * 而那会儿新片子的字幕还没加载。
   */
  const backToLibrary = useCallback(() => {
    stopEverything();
    setStudyMode(null);
    setView('library');
  }, [stopEverything]);

  /**
   * 选一部片子传到后端。这里必须让 DocumentPicker 复制到缓存
   * （和只是本地播放的 pickVideo 相反）：原生端要有一个能流式读取的 file:// 路径，
   * content:// 那种地址上传库读不了。
   */
  const uploadVideoFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'video/*',
        copyToCacheDirectory: Platform.OS !== 'web',
        multiple: false,
        base64: false
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      await library.uploadMovie({ uri: asset.uri, file: asset.file }, asset.name);
    } catch (error) {
      setStatus(`上传失败：${(error as Error).message}`);
    }
  }, [library]);

  /** 换片子时回到上次看到的位置，等播放器把新片源准备好再跳 */
  const resumedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeMovie || duration <= 0) return;
    if (resumedRef.current === activeMovie.id) return;
    resumedRef.current = activeMovie.id;
    if (activeMovie.lastPosition > 1) player.currentTime = activeMovie.lastPosition;
  }, [activeMovie, duration, player]);

  /** 进度每 5 秒记一次就够，每次 timeUpdate 都发会把后端打满 */
  const savedAtRef = useRef(0);
  useEffect(() => {
    if (!activeMovie || currentTime <= 0) return;
    if (Date.now() - savedAtRef.current < 5000) return;
    savedAtRef.current = Date.now();
    library.saveProgress(activeMovie.id, currentTime, segments.length ? subtitleLabel : null);
  }, [activeMovie, currentTime, library, segments.length, subtitleLabel]);

  const pickSubtitle = useCallback(async () => {
    setStatus('已请求打开文件选择框，若没有弹出请看下方说明');
    try {
      // 字幕文件的 MIME 类型不统一（srt 常常为空），限定类型会导致文件选不中
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        // 这里要把文件读成文本，而 Android 在 false 时给的是 content:// 地址，
        // expo-file-system 读不了。字幕才一百多 KB，复制开销可以忽略
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

  // 缩略图要从视频里取帧，听模式下放的是纯音轨，取不出东西来
  const showThumbnails =
    Platform.OS !== 'web' &&
    !listenMode &&
    !segments.length &&
    !!videoSource?.uri &&
    fallbackSegments.length > 0;

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

  /** 全片单词页空着时把原因摆出来。对着一片空白，谁也猜不到是词典没查成 */
  const wordbookHint =
    vocabulary.status === 'loading'
      ? '正在查词典，整部片子扫一遍要几秒。'
      : vocabulary.status === 'missing'
        ? '词典数据还没下载。在项目目录跑 npm run fetch-dict，下完重开这一页。'
        : vocabulary.status === 'error'
          ? `词典没查成功：${vocabulary.error ?? '未知原因'}`
          : vocabulary.status === 'no-english'
            ? '这份字幕里没有英文，没有词可查。'
            : undefined;

  // 宽屏是右侧固定一栏，窄屏是标签页里的一整页，内容完全一样
  const wordPanel = (
    <WordPanel
      segment={segments.length ? studySegment : undefined}
      segments={displaySegments}
      currentIndex={studyIndex}
      words={currentWords}
      status={vocabulary.status}
      error={vocabulary.error}
      level={level}
      onLevelChange={setLevel}
      showMastered={showMastered}
      onToggleShowMastered={() => setShowMastered((previous) => !previous)}
      isMastered={mastery.isMastered}
      onToggleMastered={mastery.toggle}
      onSpeak={speakSegment}
      onSpeakText={speakText}
      onJump={(index) => {
        const target = displaySegments[index];
        if (target) seekToSegment(target, index);
      }}
      onPlayOriginal={videoSource ? playOccurrence : undefined}
      onOpenWordbook={() => setWordbookOpen(true)}
      phrases={vocabulary.phrasesOf(studyIndex)}
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

  // 片库页和学习页都得能开，抽出来免得写两遍
  const accountPanel = accountOpen ? (
    <AccountScreen
      user={user}
      sessions={sessions}
      stats={{
        studying: library.studyList.length,
        favorites: favorites.favorites.length,
        notes: notes.notes.length,
        mastered: mastery.masteredCount
      }}
      onChangePassword={onChangePassword}
      onLogoutOthers={onLogoutOthers}
      onLogout={onLogout}
      onClose={() => setAccountOpen(false)}
    />
  ) : null;

  if (view === 'library') {
    return (
      <View style={[styles.container, safeArea]}>
        <LibraryScreen
          studyList={library.studyList}
          library={library.library}
          configured={library.configured}
          root={library.root}
          loading={library.loading}
          upload={library.upload}
          userName={user.displayName}
          onOpen={openMovie}
          onAdd={library.addToStudy}
          onRemove={library.removeFromStudy}
          onRescan={() => library.refresh(true)}
          onOpenAccount={() => setAccountOpen(true)}
          onUpload={uploadVideoFile}
          onSetPublic={library.setPublic}
          onDelete={library.removeMovie}
          onDismissUpload={library.dismissUpload}
        />
        {accountPanel}
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={[styles.container, safeArea]}>
      <TopBar
        videoLabel={videoTitle}
        subtitleLabel={subtitleLabel}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((previous) => !previous)}
        favoriteCount={favorites.favorites.length}
        noteCount={notes.notes.length}
        onOpenFavorites={() => setMarksTab('favorites')}
        onOpenNotes={() => setMarksTab('notes')}
        onBackToLibrary={backToLibrary}
        onOpenAccount={() => setAccountOpen(true)}
        userName={user.displayName}
        compact={stacked}
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
            listenMode={listenMode}
            audio={audio}
            onReloadAudio={reloadAudio}
            onExitListen={() => chooseListenMode(false)}
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
              voice={voice}
              onSelectVoice={setVoice}
              voiceAvailable={!!videoSource}
              synthRate={synthRate}
              onCycleSynthRate={cycleSynthRate}
              reading={reading}
              onStopReading={stopReadAloud}
              loopMode={loop?.mode ?? null}
              loopRange={loopRange}
              onToggleLoop={toggleLoop}
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
              listenMode={listenMode}
              remote={remote}
              // 抽音轨要读服务器上的原片，本机选的文件和粘的网址都做不到
              onSelectListen={activeMovie ? chooseListenMode : null}
              onOpenReader={() => setStudyMode('read')}
              onOpenDictation={() => setStudyMode('write')}
            />
          )}

          {showThumbnails && videoSource ? (
            <ThumbnailStrip
              videoUri={videoSource.uri}
              starts={fallbackSegments.map((segment) => segment.start)}
              onSelect={(start) => {
                seekTo(start);
                playVideo();
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
              {/*
                全片单词原先只挂在右侧面板的表头上。宽屏那一栏一直摊着还看得见，
                手机上它藏在「单词」标签页里、又缩在角落，等于没有入口。
              */}
              <TouchableOpacity style={styles.tab} onPress={() => setWordbookOpen(true)} activeOpacity={0.8}>
                <Text style={styles.tabText}>
                  全片单词{vocabulary.allWords.length ? ` ${vocabulary.allWords.length}` : ''}
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
                selectedIndex={selectedIndex}
                loop={loop}
                onSelect={(_segment, index) => setSelectedIndex(index)}
                onActivate={goToIndex}
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

      {/*
        换了字幕就得从头来过，key 一变整页重建；同一部片子里则一直挂着，
        跳去看一句台词再回来，页码和翻开的词都还在。

        一个词都没有时也照样挂着。以前是空的就整个不渲染，于是词典查砸了的时候
        点「全片单词」屏幕上什么都不发生——最难查的就是这种一声不吭的失败。
      */}
      <WordbookScreen
        key={subtitleLabel ?? 'none'}
        hidden={!wordbookOpen}
        words={vocabulary.allWords}
        segments={displaySegments}
        // 数量交给页面自己按当前难度算，这里再报一个总数只会和它打架
        title={videoSource?.label ?? '全片单词'}
        emptyHint={wordbookHint}
        level={level}
        onLevelChange={setLevel}
        isMastered={mastery.isMastered}
        onToggleMastered={mastery.toggle}
        onJump={(index, fromWord) => {
          const target = displaySegments[index];
          if (!target) return;
          seekToSegment(target, index);
          setWordbookOpen(false);
          setWordbookReturn(fromWord);
        }}
        onSpeakText={speakText}
        onPlayOriginal={videoSource ? playOccurrence : undefined}
        onReadParts={sayWord}
        onStopReading={stopWord}
        onClose={() => {
          setWordbookOpen(false);
          setWordbookReturn(null);
        }}
      />

      {studyMode === 'read' ? (
        <ReaderScreen
          segments={displaySegments}
          activeIndex={activeIndex}
          title={videoSource?.label ?? '全片台词'}
          playing={playing}
          reading={reading}
          voice={voice}
          onSelectVoice={setVoice}
          onTogglePlay={togglePlay}
          onPrevious={goToPrevious}
          onNext={goToNext}
          onPlayOriginal={videoSource ? playRange : null}
          onPlaySynth={(from, to) => readAloudFrom(from, { from, to })}
          loopRange={loop?.end != null ? { start: loop.start, end: loop.end } : null}
          onLoopParagraph={loopParagraph}
          onStop={stopSaying}
          onSeekIndex={(index) => {
            const target = displaySegments[index];
            if (target) seekToSegment(target, index);
          }}
          onClose={() => setStudyMode(null)}
        />
      ) : null}

      {studyMode === 'write' && writeTab === 'dictation' ? (
        <DictationScreen
          segments={displaySegments}
          title={videoSource?.label ?? '默写'}
          // 接着上次写到的地方；这部片子还没写过就从眼下这一句开始
          startIndex={dictation.lastIndex || Math.max(activeIndex, 0)}
          scores={dictation.scores}
          onScore={dictation.record}
          onVisit={dictation.remember}
          onPlayOriginal={videoSource ? playOccurrence : null}
          onSpeak={speakText}
          onStop={stopSaying}
          onSwitchToCopy={() => setWriteTab('copy')}
          onClose={() => setStudyMode(null)}
        />
      ) : null}

      {studyMode === 'write' && writeTab === 'copy' ? (
        <CopyworkScreen
          segments={displaySegments}
          title={videoSource?.label ?? '抄写'}
          startIndex={dictation.copyIndex || Math.max(activeIndex, 0)}
          records={dictation.records}
          onFinishRound={dictation.addRecord}
          onVisit={dictation.rememberCopy}
          onClearRecords={dictation.clearRecords}
          onPlayOriginal={videoSource ? playRange : null}
          onPlaySynth={(from, to) => readAloudFrom(from, { from, to })}
          onStop={stopSaying}
          onSwitchToDictation={() => setWriteTab('dictation')}
          onClose={() => setStudyMode(null)}
        />
      ) : null}

      {/* 自己关掉的不需要退路，只有被例句拽走的那次才挂这条 */}
      {!wordbookOpen && wordbookReturn ? (
        <View style={[styles.returnBar, { bottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            onPress={() => {
              setWordbookOpen(true);
              setWordbookReturn(null);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.returnText}>← 回到单词 {wordbookReturn}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setWordbookReturn(null)} hitSlop={8}>
            <Text style={styles.returnClose}>×</Text>
          </TouchableOpacity>
      </View>
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
          voice={voice}
          onSelectVoice={setVoice}
          synthRate={synthRate}
          onCycleSynthRate={cycleSynthRate}
          canPlayOriginal={(record) => canUseOriginal && videoSource?.label === record.videoKey}
          onPlay={sayRecord}
          onStopPlay={stopSaying}
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

      {accountPanel}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f8fa'
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f6f8'
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
  returnBar: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#2f80ed',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 15
  },
  returnText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600'
  },
  returnClose: {
    fontSize: 15,
    color: '#cfe0ff'
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
