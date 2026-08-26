import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime } from '../lib/formatTime';
import { buildParagraphs, paragraphOf, type Paragraph } from '../lib/paragraphs';
import type { Segment } from '../types/subtitle';

type Lang = 'en' | 'zh' | 'both';

type Props = {
  segments: Segment[];
  /** 正在播的那一句，用来高亮和自动翻到对应段落 */
  activeIndex: number;
  title: string;
  playing: boolean;
  /** 合成音正一句接一句念着，念着时播放键要变成停止 */
  reading: boolean;
  /** 底下那颗播放键放谁的声音。读模式里够不着播放条，这个开关得跟到这儿来 */
  voice: 'original' | 'synth';
  onSelectVoice: (voice: 'original' | 'synth') => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** 放这一段的原声，放到段尾就停。没片源时为 null */
  onPlayOriginal: ((from: number, to: number) => void) | null;
  /** 合成音逐句念这一段，念完就停 */
  onPlaySynth: (from: number, to: number) => void;
  /** 正在循环的句子区间，用来标出是哪一段在循环。没有循环时为 null */
  loopRange: { start: number; end: number } | null;
  /** 反复放这一段，再点一次停。放原声还是合成音由上面的发音开关定 */
  onLoopParagraph: (from: number, to: number) => void;
  onStop: () => void;
  /** 点某一句：跳过去接着往下播，页面留在原地 */
  onSeekIndex: (index: number) => void;
  onClose: () => void;
};

const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'en', label: '英文' },
  { id: 'zh', label: '中文' },
  { id: 'both', label: '中英' }
];

/** 停顿多久算换一段。台词密的片子选小的，慢节奏的片子选大的 */
const GAPS = [2, 5, 10, 20];

/** 一页摆几段。想通读就多摆几段，想逐段精读就少摆几段 */
const PER_PAGE = [3, 5, 8, 12, 20];

const SIZES = [
  { label: '小', body: 15, line: 24 },
  { label: '中', body: 17, line: 27 },
  { label: '大', body: 20, line: 31 }
];

export function ReaderScreen({
  segments,
  activeIndex,
  title,
  playing,
  reading,
  voice,
  onSelectVoice,
  onTogglePlay,
  onPrevious,
  onNext,
  onPlayOriginal,
  onPlaySynth,
  loopRange,
  onLoopParagraph,
  onStop,
  onSeekIndex,
  onClose
}: Props) {
  const [lang, setLang] = useState<Lang>('both');
  const [gap, setGap] = useState(5);
  const [perPage, setPerPage] = useState(5);
  const [size, setSize] = useState(1);
  const [flow, setFlow] = useState(true);
  const [follow, setFollow] = useState(true);
  const [page, setPage] = useState(0);
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Paragraph>>(null);

  const paragraphs = useMemo(() => buildParagraphs(segments, gap), [gap, segments]);
  const activePara = useMemo(() => paragraphOf(paragraphs, activeIndex), [activeIndex, paragraphs]);
  const font = SIZES[size];

  const pageCount = Math.max(1, Math.ceil(paragraphs.length / perPage));
  const pageParas = useMemo(
    () => paragraphs.slice(page * perPage, page * perPage + perPage),
    [page, perPage, paragraphs]
  );

  const toTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: false });

  /** 正在播的那一段落在第几页 */
  const playingPage = activePara >= 0 ? Math.floor(activePara / perPage) : -1;

  /**
   * 手动翻页时暂时别跟，翻回正在播的那一页就自动续上。
   *
   * 两个一直都开着的话是抢方向盘：片子每往前走一段，自动翻页就把页码拽回去，
   * 想翻回开头重读根本翻不动。可一关就永久关掉也不对——翻两页看看，
   * 回头播放早跑到别的页去了，人还傻等在这一页，还以为坏了。
   * 所以只把「翻走」当成暂时离开，回到正在播的那一页就算归位。
   */
  const turnTo = (next: number) => {
    const target = Math.min(Math.max(next, 0), pageCount - 1);
    setPage(target);
    setFollow(target === playingPage);
    toTop();
  };

  // 改了分段秒数或每页段数，原来的页码指向的就不是同一批内容了
  useEffect(() => {
    setPage(0);
    toTop();
  }, [gap, perPage]);

  /**
   * 跟着播放走：先把那一段所在的页翻过来，再滚到它。
   * 只在换段的时候动——逐句滚的话读到一半页面就被拽走了。
   */
  useEffect(() => {
    if (!follow || activePara < 0) return;
    const target = Math.floor(activePara / perPage);
    if (target !== page) {
      setPage(target);
      return;
    }
    const local = activePara - page * perPage;
    if (local >= 0 && local < pageParas.length) {
      listRef.current?.scrollToIndex({ index: local, viewPosition: 0.2, animated: true });
    }
  }, [activePara, follow, page, pageParas.length, perPage]);

  const jumpToPlaying = () => {
    if (activePara < 0) return;
    if (playingPage !== page) setPage(playingPage);
    setFollow(true);
    const local = activePara - playingPage * perPage;
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: local, viewPosition: 0.2, animated: true });
    }, 60);
  };

  /** 播放跑到别的页去了，而这一页是自己翻来的 */
  const strayed = !follow && playingPage >= 0 && playingPage !== page;

  if (!segments.length) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.head}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.back}>← 返回</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.empty}>还没有字幕。加载一份字幕后，整部片子的台词会在这儿排成一篇文章。</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.count}>
          {paragraphs.length} 段 · {segments.length} 句
        </Text>
      </View>

      <View style={styles.tools}>
        {LANGS.map((item) => (
          <Chip key={item.id} label={item.label} on={lang === item.id} onPress={() => setLang(item.id)} />
        ))}
        <View style={styles.spacer} />
        {/* 停顿阈值直接写秒数：不同片子的说话节奏差得远，只能自己调到读着顺 */}
        <Chip label={`分段 ${gap}s`} onPress={() => setGap(GAPS[(GAPS.indexOf(gap) + 1) % GAPS.length])} />
        <Chip
          label={`每页 ${perPage} 段`}
          onPress={() => setPerPage(PER_PAGE[(PER_PAGE.indexOf(perPage) + 1) % PER_PAGE.length])}
        />
        <Chip label={`字号 ${font.label}`} onPress={() => setSize((previous) => (previous + 1) % SIZES.length)} />
        {/* 通读时要的是文章的样子，对照着抠一句时要的是一句一行，两种都留着 */}
        <Chip label={flow ? '排版 成段' : '排版 逐句'} on={flow} onPress={() => setFlow((previous) => !previous)} />
        {/*
         * 「跟播」两个字没人看得懂。它管的就一件事：播到哪一段，页面自己翻到哪一页，
         * 所以直接叫自动翻页。关掉之后底下会说清楚现在是什么状况。
         */}
        <Chip
          label={follow ? '自动翻页 开' : '自动翻页 关'}
          on={follow}
          onPress={() => setFollow((previous) => !previous)}
        />
        {/* 底下那颗播放键用谁的声音。播放条被这一屏盖住了，开关得跟过来。没片源就只有合成音可选 */}
        {onPlayOriginal ? (
          <Chip
            label={voice === 'original' ? '播放 原声' : '播放 合成音'}
            on
            onPress={() => onSelectVoice(voice === 'original' ? 'synth' : 'original')}
          />
        ) : null}
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.content}
        data={pageParas}
        keyExtractor={(item) => String(item.from)}
        // 段落高矮不一，滚到还没渲染的段会失败：先按均高粗定位，等这批渲染出来再对齐
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: index * (averageItemLength || 200), animated: false });
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index, viewPosition: 0.2, animated: false });
          }, 80);
        }}
        renderItem={({ item, index }) => {
          const lines: number[] = [];
          for (let i = item.from; i <= item.to; i += 1) lines.push(i);
          const number = page * perPage + index + 1;
          const onScreen = number - 1 === activePara;
          // 循环区间是按句子下标存的，和这一段的首尾对得上才算「这一段在循环」
          const looping = !!loopRange && loopRange.start === item.from && loopRange.end === item.to;
          // 这一段到底有没有词可排。缺译文的段落不该留一条空线出来
          const hasEn = lang !== 'zh' && lines.some((i) => !!segments[i].en);
          const hasZh = lang !== 'en' && lines.some((i) => !!segments[i].zh);

          return (
            <View style={[styles.para, onScreen && styles.paraReading, looping && styles.paraLooping]}>
              <View style={styles.paraHead}>
                <Text style={styles.paraNo}>{number}</Text>
                <TouchableOpacity onPress={() => onSeekIndex(item.from)} hitSlop={6}>
                  <Text style={styles.paraTime}>
                    {formatTime(item.start)} - {formatTime(item.end)}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.paraLines}>{lines.length} 句</Text>
                <View style={styles.spacer} />
                {/* 读到哪段就听哪段，放完这一段就停，不会一路播下去 */}
                {onPlayOriginal ? (
                  <TouchableOpacity onPress={() => onPlayOriginal(item.from, item.to)} hitSlop={6}>
                    <Text style={styles.paraPlay}>▶ 原声</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => onPlaySynth(item.from, item.to)} hitSlop={6}>
                  <Text style={styles.paraPlay}>跟读</Text>
                </TouchableOpacity>
                {/* 一段没听懂就把它按住反复放，比来回点「原声」省事 */}
                <TouchableOpacity onPress={() => onLoopParagraph(item.from, item.to)} hitSlop={6}>
                  <Text style={[styles.paraPlay, looping && styles.paraLoopOn]}>
                    {looping ? '■ 停止循环' : '↻ 循环'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/*
               * 成段：整段英文接成一片，整段中文跟在它底下，读起来是文章而不是字幕表。
               * 每句仍能点、能高亮，只是换行交给排版，不再一句占一行。
               */}
              {flow ? (
                <>
                  {hasEn ? (
                    <Text style={[styles.en, { fontSize: font.body, lineHeight: font.line }]}>
                      {lines.map((i) =>
                        segments[i].en ? (
                          <Text
                            key={i}
                            style={i === activeIndex ? styles.lineOn : undefined}
                            onPress={() => onSeekIndex(i)}
                          >
                            {segments[i].en}{' '}
                          </Text>
                        ) : null
                      )}
                    </Text>
                  ) : null}
                  {hasZh ? (
                    <Text
                      style={[
                        styles.zh,
                        // 中英同屏时画条细线隔开，两片字挨在一起会看成一段
                        hasEn && styles.flowZh,
                        hasEn
                          ? { fontSize: font.body - 2, lineHeight: font.line - 3 }
                          : { fontSize: font.body, lineHeight: font.line }
                      ]}
                    >
                      {/*
                       * 句间补个空格。中文字幕常常不带句末标点，直接接起来会读成
                       * 「没事吧肖恩肖恩听着」，断不出这是四个人在说四句话。
                       */}
                      {lines.map((i) =>
                        segments[i].zh ? (
                          <Text
                            key={i}
                            style={i === activeIndex ? styles.lineOn : undefined}
                            onPress={() => onSeekIndex(i)}
                          >
                            {segments[i].zh}{' '}
                          </Text>
                        ) : null
                      )}
                    </Text>
                  ) : null}
                  {/* 字幕里有些句子没配译文，整段都没有时别只剩个光段头 */}
                  {!hasEn && !hasZh ? (
                    <Text style={styles.missing}>{lang === 'zh' ? '这一段没有中文' : '这一段没有台词'}</Text>
                  ) : null}
                </>
              ) : (
                // 逐句：中文紧跟在自己那句英文下面，对照着抠一句时用这个
                lines.map((i) => {
                  const segment = segments[i];
                  const en = lang !== 'zh' ? segment.en : '';
                  const zh = lang !== 'en' ? segment.zh : '';
                  if (!en && !zh) return null;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.line, i === activeIndex && styles.lineOn]}
                      onPress={() => onSeekIndex(i)}
                      activeOpacity={0.6}
                    >
                      {en ? <Text style={[styles.en, { fontSize: font.body, lineHeight: font.line }]}>{en}</Text> : null}
                      {zh ? (
                        <Text style={[styles.zh, { fontSize: font.body - 2, lineHeight: font.line - 3 }]}>{zh}</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          );
        }}
      />

      {/*
       * 自己翻走之后，正在播的那一段就在别处了。不说一声的话，
       * 屏幕上没有任何东西在动，看着就像播放停了或者跟播坏了。
       */}
      {strayed ? (
        <TouchableOpacity style={styles.strayed} onPress={jumpToPlaying} activeOpacity={0.8}>
          <Text style={styles.strayedText}>
            正在播第 {activePara + 1} 段（第 {playingPage + 1} 页）· 点这里跟过去
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.pager}>
        <TouchableOpacity onPress={() => turnTo(page - 1)} hitSlop={6} disabled={page === 0}>
          <Text style={[styles.pageButton, page === 0 && styles.pageButtonOff]}>‹ 上一页</Text>
        </TouchableOpacity>
        <Text style={styles.pageLabel}>
          第 {page + 1} / {pageCount} 页
        </Text>
        <TouchableOpacity onPress={() => turnTo(page + 1)} hitSlop={6} disabled={page >= pageCount - 1}>
          <Text style={[styles.pageButton, page >= pageCount - 1 && styles.pageButtonOff]}>下一页 ›</Text>
        </TouchableOpacity>
      </View>

      {/* 读的时候手不在播放器上，最起码的几个键得跟到这一页来。窄屏放不下就折行，别顶出屏幕 */}
      <View style={[styles.bar, { paddingBottom: 10 + insets.bottom }]}>
        <TouchableOpacity onPress={onPrevious} hitSlop={6}>
          <Text style={styles.barButton}>上一句</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.play, reading && styles.playStop]}
          onPress={reading ? onStop : onTogglePlay}
          activeOpacity={0.8}
        >
          <Text style={styles.playText}>{reading ? '■ 停止朗读' : playing ? '⏸ 暂停' : '▶ 播放'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNext} hitSlop={6}>
          <Text style={styles.barButton}>下一句</Text>
        </TouchableOpacity>
        <View style={styles.spacer} />
        <Text style={styles.barNote}>{activePara >= 0 ? `读到第 ${activePara + 1} 段` : '还没开始播'}</Text>
        <TouchableOpacity onPress={jumpToPlaying} hitSlop={6} disabled={activePara < 0}>
          <Text style={[styles.barButton, activePara < 0 && styles.barButtonOff]}>回到正在播</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, on && styles.chipActive]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.chipText, on && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#faf9f6',
    zIndex: 20
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecf0'
  },
  back: {
    fontSize: 14,
    color: '#2f80ed'
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#333'
  },
  count: {
    fontSize: 12,
    color: '#888'
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  spacer: {
    flex: 1
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#eef1f5'
  },
  chipActive: {
    backgroundColor: '#2f80ed'
  },
  chipText: {
    fontSize: 12,
    color: '#444'
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600'
  },
  list: {
    flex: 1
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 20
  },
  empty: {
    flex: 1,
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    paddingVertical: 60
  },
  para: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6
  },
  paraReading: {
    backgroundColor: '#fff'
  },
  /** 循环中的那段描一圈边。底色已经被「正在读」占了，再叠一层就分不清 */
  paraLooping: {
    borderWidth: 1,
    borderColor: '#2f80ed'
  },
  paraLoopOn: {
    color: '#b0483f',
    fontWeight: '600'
  },
  paraHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4
  },
  paraNo: {
    fontSize: 11,
    color: '#b9b2a4',
    fontWeight: '700'
  },
  paraTime: {
    fontSize: 11,
    color: '#2f80ed'
  },
  paraLines: {
    fontSize: 11,
    color: '#c0bab0'
  },
  paraPlay: {
    fontSize: 12,
    color: '#2f80ed'
  },
  line: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6
  },
  lineOn: {
    backgroundColor: '#ffe9a8'
  },
  en: {
    color: '#2b2b2b'
  },
  zh: {
    color: '#8a857c'
  },
  missing: {
    fontSize: 12,
    color: '#b9b3a8',
    fontStyle: 'italic'
  },
  /** 整段中文跟在整段英文底下，中间那条线是两者的分界 */
  flowZh: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e4dc'
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#eeeae2'
  },
  pageButton: {
    fontSize: 13,
    color: '#2f80ed'
  },
  pageButtonOff: {
    color: '#c8ccd2'
  },
  pageLabel: {
    fontSize: 12,
    color: '#777',
    minWidth: 92,
    textAlign: 'center'
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    // 手机上这一排放不下，不折行的话「下一句」和「回到正在播」直接被挤出屏幕
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e9ecf0'
  },
  strayed: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff6e0',
    borderTopWidth: 1,
    borderTopColor: '#f0e2c0'
  },
  strayedText: {
    fontSize: 12,
    color: '#8a6d2f',
    textAlign: 'center'
  },
  barButton: {
    fontSize: 13,
    color: '#2f80ed'
  },
  barButtonOff: {
    color: '#c8ccd2'
  },
  barNote: {
    fontSize: 12,
    color: '#999'
  },
  play: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#2f80ed'
  },
  playStop: {
    backgroundColor: '#b0483f'
  },
  playText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600'
  }
});
