import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSentenceQueue } from '../hooks/useSentenceQueue';
import {
  buildWordSpeech,
  headwordOf,
  senseSummary,
  SHOW_MODES,
  type ShowMode,
  type SpeechPart
} from '../lib/vocabulary/readWord';
import { isWorthLearning, type DifficultyLevel, type StudyWord } from '../lib/vocabulary/study';
import type { Segment } from '../types/subtitle';
import { WordCard } from './WordCard';

type Filter = 'unmastered' | 'mastered' | 'all';
type Sort = 'count' | 'first' | 'alpha';

/** 队列要一个稳定的 id，单词的原形正好就是 */
type Row = { id: string; word: StudyWord };

type Props = {
  words: StudyWord[];
  segments: Segment[];
  title: string;
  /** 一个词都没有时说明原因：还在查、词典没下、查失败，还是这份字幕根本没英文 */
  emptyHint?: string;
  level: DifficultyLevel;
  onLevelChange: (level: DifficultyLevel) => void;
  isMastered: (key: string) => boolean;
  onToggleMastered: (key: string) => void;
  /**
   * 跳到片中的某一句。第二个参数是当时正翻着的那个词，
   * 外面拿它挂一条「回到这个词」的退路——跳走了找不回原处是最恼人的。
   */
  onJump: (index: number, fromWord: string) => void;
  onSpeakText: (text: string) => void;
  /** 有片源才谈得上原声，只挂了字幕时词条里就不给这个按钮 */
  onPlayOriginal?: (index: number) => void;
  /** 挨段念完，Promise 在整个词念完时兑现，连播靠它接龙 */
  onReadParts: (parts: SpeechPart[]) => Promise<void>;
  onStopReading: () => void;
  onClose: () => void;
  /**
   * 收起来但不卸载。翻到第几页、展开的哪个词、筛选排序全在组件自己身上，
   * 卸载一次就全没了；跳去看某句台词再回来，得还是刚才那一屏。
   */
  hidden?: boolean;
};

const LEVELS: Array<{ id: DifficultyLevel; label: string }> = [
  { id: 'all', label: '全部难度' },
  { id: 'normal', label: '适中' },
  { id: 'hard', label: '只看难词' }
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'count', label: '出现最多' },
  { id: 'first', label: '片中先后' },
  { id: 'alpha', label: '字母序' }
];

/** 一格放得下「单词 + 一行释义」的最小宽度，再窄释义就只剩两个字 */
const CELL_MIN_WIDTH = 178;
/** 只看单词或只看释义时一格就一行，矮下来一页能多装一半的词 */
const CELL_HEIGHT = { word: 44, sense: 44, both: 60 } satisfies Record<ShowMode, number>;

/**
 * 网页端的嵌套 Touchable 靠 DOM 冒泡，格子里的小按钮不拦一下，
 * 点「念」和「掌握」会连带把词条浮层也翻出来。
 */
function stopCellPress(action: () => void) {
  return (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    action();
  };
}

function next<T extends { id: string }>(list: T[], current: string): T {
  return list[(list.findIndex((item) => item.id === current) + 1) % list.length];
}

export function WordbookScreen({
  words,
  segments,
  title,
  emptyHint,
  level,
  onLevelChange,
  isMastered,
  onToggleMastered,
  onJump,
  onSpeakText,
  onPlayOriginal,
  onReadParts,
  onStopReading,
  onClose,
  hidden
}: Props) {
  const [filter, setFilter] = useState<Filter>('unmastered');
  const [sort, setSort] = useState<Sort>('count');
  const [showMode, setShowMode] = useState<ShowMode>('both');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  /** 格子铺几行几列得看实际量到的尺寸，量到之前先不铺 */
  const [box, setBox] = useState({ width: 0, height: 0 });
  const insets = useSafeAreaInsets();

  /**
   * 统计只在当前难度这个池子里做。分母跟着难度走才读得通——
   * 「只看难词」下你关心的就是这些难词掌握了多少，跟全片几百个词没关系。
   */
  const pool = useMemo(() => words.filter((word) => isWorthLearning(word.entry, level)), [level, words]);
  const masteredCount = useMemo(() => pool.filter((word) => isMastered(word.key)).length, [isMastered, pool]);
  const counts = {
    unmastered: pool.length - masteredCount,
    mastered: masteredCount,
    all: pool.length
  };
  const percent = pool.length ? Math.round((masteredCount / pool.length) * 100) : 0;

  const rows = useMemo(() => {
    const picked = pool.filter((word) => {
      if (filter === 'all') return true;
      return filter === 'mastered' ? isMastered(word.key) : !isMastered(word.key);
    });

    // words 进来时已经按出现次数排好了，'count' 档不用再动
    const ordered =
      sort === 'first'
        ? [...picked].sort((a, b) => (a.occurrences[0]?.index ?? 0) - (b.occurrences[0]?.index ?? 0))
        : sort === 'alpha'
          ? [...picked].sort((a, b) => a.key.localeCompare(b.key))
          : picked;

    return ordered.map((word) => ({ id: word.key, word }));
  }, [filter, isMastered, pool, sort]);

  /**
   * 量到实际尺寸之前先按窗口估一版。
   *
   * 这一屏是挂着不卸载、靠 display:none 收起来的，收起来时拿不到尺寸。
   * 从前只认 onLayout，万一它在重新显示时没补一发（原生端就有这种时候），
   * 每页装 0 个词，打开就是一片空白，什么都点不出来。
   * 估得不准无所谓，onLayout 一到就以量到的为准。
   */
  const window = useWindowDimensions();
  const gridWidth = box.width || Math.max(240, window.width - 32);
  const gridHeight = box.height || Math.max(200, window.height - 300);

  const cellHeight = CELL_HEIGHT[showMode];
  const columns = Math.max(1, Math.floor(gridWidth / CELL_MIN_WIDTH));
  const perColumn = Math.max(1, Math.floor(gridHeight / cellHeight));
  const pageSize = columns * perColumn;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageStart = page * pageSize;
  const pageRows = rows.slice(pageStart, pageStart + pageSize);

  const readOne = useCallback(
    (row: Row) => onReadParts(buildWordSpeech(row.word, showMode)),
    [onReadParts, showMode]
  );

  const queue = useSentenceQueue<Row>({ play: readOne, stop: onStopReading });

  // 换了筛选、排序或念法，正念着的这一串就对不上了；格子高度一变每页装的也不是原来那些，页码得从头来
  const listKey = `${filter}-${sort}-${level}-${showMode}`;
  const { stop: stopQueue } = queue;
  useEffect(() => {
    stopQueue();
    setPage(0);
  }, [listKey, stopQueue]);

  // 勾掉几个词、窗口变小，末页可能就没了
  useEffect(() => {
    setPage((previous) => Math.min(previous, pageCount - 1));
  }, [pageCount]);

  // 收起来了还在念，声音就成了不知从哪儿冒出来的
  useEffect(() => {
    if (hidden) stopQueue();
  }, [hidden, stopQueue]);

  /**
   * 连播翻到下一页的词时，页面自己跟过去。
   * 不跟的话一串念下来屏幕上还停在第一页，听着的词根本不知道是哪个。
   */
  const { activeId } = queue;
  useEffect(() => {
    if (!activeId) return;
    const index = rows.findIndex((row) => row.id === activeId);
    if (index < 0) return;
    setPage(Math.floor(index / pageSize));
  }, [activeId, pageSize, rows]);

  const detail = detailId ? rows.find((row) => row.id === detailId) : undefined;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }, hidden && styles.screenHidden]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.count}>
          已掌握 {masteredCount} / {pool.length}
        </Text>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
        <Text style={styles.percent}>{percent}%</Text>
      </View>

      <View style={styles.filters}>
        <Chip label={`未掌握 ${counts.unmastered}`} on={filter === 'unmastered'} onPress={() => setFilter('unmastered')} />
        <Chip label={`已掌握 ${counts.mastered}`} on={filter === 'mastered'} onPress={() => setFilter('mastered')} />
        <Chip label={`全部 ${counts.all}`} on={filter === 'all'} onPress={() => setFilter('all')} />
        <View style={styles.spacer} />
        {LEVELS.map((item) => (
          <Chip key={item.id} label={item.label} on={level === item.id} onPress={() => onLevelChange(item.id)} />
        ))}
      </View>

      <View style={styles.filters}>
        {/* 排序三档轮转就够了，摊开三个按钮会把这一栏挤满 */}
        <Chip label={`排序 ${SORTS.find((item) => item.id === sort)!.label}`} onPress={() => setSort(next(SORTS, sort).id)} />
        {/* 这一组管的是格子里露出什么、连播时念什么，两件事一个开关 */}
        <Text style={styles.groupLabel}>看和念</Text>
        {SHOW_MODES.map((item) => (
          <Chip key={item.id} label={item.label} on={showMode === item.id} onPress={() => setShowMode(item.id)} />
        ))}
        <View style={styles.spacer} />
        {rows.length ? (
          <TouchableOpacity
            style={[styles.play, queue.playingAll && styles.playOn]}
            onPress={queue.playingAll ? queue.stop : () => queue.playAll(rows)}
            activeOpacity={0.8}
          >
            <Text style={[styles.playText, queue.playingAll && styles.playTextOn]}>
              {queue.playingAll ? '■ 停止' : `▶ 连着念 ${rows.length} 个`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={styles.grid}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          /**
           * 收起来的时候会来一发 0×0。照单全收的话每页装 0 个词、总页数变 1，
           * 页码当场被夹回第一页——再打开时你翻到的那一页就没了。
           */
          if (!width || !height) return;
          setBox((previous) =>
            Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
              ? previous
              : { width, height }
          );
        }}
      >
        {!rows.length ? (
          <Text style={styles.empty}>
            {words.length
              ? '这个筛选下没有单词，换个难度或筛选试试。'
              : (emptyHint ?? '还没有单词。加载一份英文字幕后这里会列出整部片子的词。')}
          </Text>
        ) : (
          pageRows.map((item, position) => {
            const { word } = item;
            const mastered = isMastered(word.key);
            const speaking = queue.activeId === item.id;
            const sense = senseSummary(word);
            // 只看释义那档就把单词藏起来，看着中文回想英文——藏着的那个才是要复习的
            const primary = showMode === 'sense' ? sense || headwordOf(word) : headwordOf(word);
            const index = pageStart + position;

            return (
              <View key={item.id} style={[styles.cell, { width: `${100 / columns}%`, height: cellHeight }]}>
                <View
                  style={[
                    styles.cellInner,
                    speaking && styles.cellSpeaking,
                    mastered && !speaking && styles.cellMastered
                  ]}
                >
                  <View style={styles.cellHead}>
                    {/* 从这个词开始往后念，复习到一半停下，回来能接着这儿走 */}
                    <TouchableOpacity onPress={stopCellPress(() => queue.playAll(rows.slice(index)))} hitSlop={8}>
                      <Text style={[styles.cellPlay, speaking && styles.cellPlayOn]}>▶</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cellWordHit} onPress={() => setDetailId(item.id)} activeOpacity={0.6}>
                      <Text
                        style={[styles.cellWord, showMode === 'sense' && styles.cellWordZh]}
                        numberOfLines={1}
                      >
                        {primary}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.cellTimes}>{word.occurrences.length}</Text>
                    <TouchableOpacity onPress={stopCellPress(() => onToggleMastered(word.key))} hitSlop={8}>
                      <Text style={[styles.cellMark, mastered && styles.cellMarkOn]}>{mastered ? '✓' : '○'}</Text>
                    </TouchableOpacity>
                  </View>
                  {showMode === 'both' ? (
                    <TouchableOpacity onPress={() => setDetailId(item.id)} activeOpacity={0.6}>
                      <Text style={styles.cellSense} numberOfLines={1}>
                        {sense || ' '}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </View>

      {rows.length ? (
        <View style={[styles.pager, { paddingBottom: 10 + insets.bottom }]}>
          <TouchableOpacity
            onPress={() => setPage((previous) => Math.max(0, previous - 1))}
            disabled={page === 0}
            hitSlop={8}
          >
            <Text style={[styles.pagerButton, page === 0 && styles.pagerButtonOff]}>‹ 上一页</Text>
          </TouchableOpacity>
          <Text style={styles.pagerText}>
            第 {page + 1} / {pageCount} 页 · 每页 {columns} × {perColumn}
          </Text>
          <TouchableOpacity
            onPress={() => setPage((previous) => Math.min(pageCount - 1, previous + 1))}
            disabled={page >= pageCount - 1}
            hitSlop={8}
          >
            <Text style={[styles.pagerButton, page >= pageCount - 1 && styles.pagerButtonOff]}>下一页 ›</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 词条摊在浮层里而不是插进格子中间：插进去整页的行列会当场重排，正在看的词就跑了 */}
      {detail ? (
        <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{detail.word.entry.lemma || detail.word.entry.word}</Text>
            <View style={styles.spacer} />
            <TouchableOpacity onPress={() => queue.playOne(detail)} hitSlop={8}>
              <Text style={styles.sheetAction}>▶ 念这个</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDetailId(null)} hitSlop={8}>
              <Text style={styles.sheetClose}>关闭</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.sheetBody}>
            <WordCard
              word={detail.word}
              segments={segments}
              currentIndex={-1}
              mastered={isMastered(detail.word.key)}
              onToggleMastered={() => onToggleMastered(detail.word.key)}
              onJump={(target) => onJump(target, headwordOf(detail.word))}
              onSpeak={onSpeakText}
              onPlayOriginal={onPlayOriginal}
            />
          </ScrollView>
        </View>
      ) : null}
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
    backgroundColor: '#f7f8fa',
    zIndex: 20
  },
  screenHidden: {
    display: 'none'
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
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10
  },
  track: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#e4e8ee',
    overflow: 'hidden'
  },
  fill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#3f9d63'
  },
  percent: {
    fontSize: 12,
    color: '#2f7a48',
    fontWeight: '600',
    minWidth: 34,
    textAlign: 'right'
  },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10
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
  groupLabel: {
    fontSize: 12,
    color: '#999',
    marginLeft: 6
  },
  play: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 15,
    backgroundColor: '#e4edff'
  },
  playOn: {
    backgroundColor: '#b0483f'
  },
  playText: {
    fontSize: 13,
    color: '#2f80ed',
    fontWeight: '600'
  },
  playTextOn: {
    color: '#fff'
  },
  /**
   * 整页刚好铺满，不滚动——一屏一页，翻页才有意义。
   * overflow: hidden 是最后一道保险：量到的尺寸和实际排版差一两像素时，
   * 宁可裁掉半格也不要冒出一根滚动条，那会让「一页」变得说不清。
   */
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    overflow: 'hidden',
    paddingHorizontal: 13,
    paddingTop: 10
  },
  empty: {
    width: '100%',
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    paddingVertical: 40
  },
  cell: {
    paddingHorizontal: 3,
    paddingBottom: 6
  },
  cellInner: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eceff3'
  },
  // 念到哪个词哪一格就亮起来，一串念下来才知道进行到哪儿了
  cellSpeaking: {
    borderColor: '#2f80ed',
    backgroundColor: '#f5f9ff'
  },
  cellMastered: {
    opacity: 0.55
  },
  cellHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6
  },
  cellPlay: {
    fontSize: 11,
    color: '#9aa4b2'
  },
  cellPlayOn: {
    color: '#2f80ed',
    fontWeight: '700'
  },
  cellWordHit: {
    flex: 1,
    minWidth: 0
  },
  cellWord: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  // 中文当主角时字重压下来，一格里全是粗体反而看不清
  cellWordZh: {
    fontSize: 12,
    fontWeight: '500',
    color: '#333'
  },
  cellTimes: {
    fontSize: 10,
    color: '#b6bcc4'
  },
  cellMark: {
    fontSize: 12,
    color: '#c2c8d0'
  },
  cellMarkOn: {
    color: '#3f9d63',
    fontWeight: '700'
  },
  cellSense: {
    fontSize: 11,
    lineHeight: 16,
    color: '#6b7280'
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 8,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e9ecf0'
  },
  pagerButton: {
    fontSize: 13,
    color: '#2f80ed',
    fontWeight: '600'
  },
  pagerButtonOff: {
    color: '#c8ccd2'
  },
  pagerText: {
    fontSize: 12,
    color: '#888',
    minWidth: 150,
    textAlign: 'center'
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '55%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderTopColor: '#e4e8ee',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -3 }
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f5'
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  sheetAction: {
    fontSize: 13,
    color: '#2f80ed'
  },
  sheetClose: {
    fontSize: 13,
    color: '#888'
  },
  sheetBody: {
    paddingHorizontal: 12,
    paddingVertical: 8
  }
});
