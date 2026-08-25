import React, { useEffect, useRef } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatTime } from '../lib/formatTime';
import type { Segment } from '../types/subtitle';

type Loop = { mode: 'sentence' | 'range'; start: number; end: number | null } | null;

type Props = {
  segments: Segment[];
  activeIndex: number;
  /** 单击选中、准备细看的那句；null 表示跟着播放走 */
  selectedIndex?: number | null;
  loop?: Loop;
  /** 单击：只把这句送到右侧讲解，不动画面 */
  onSelect: (segment: Segment, index: number) => void;
  /** 双击：跳过去播 */
  onActivate: (segment: Segment, index: number) => void;
  onSpeak: (segment: Segment) => void;
  onLoopFrom: (index: number) => void;
  onLoopTo: (index: number) => void;
  onLoopSingle: (index: number) => void;
  onClearLoop: () => void;
  isFavorite?: (index: number) => boolean;
  onToggleFavorite?: (segment: Segment, index: number) => void;
  noteAt?: (index: number) => string | null;
  onEditNote?: (segment: Segment, index: number) => void;
  emptyHint: string;
};

/**
 * 圈选循环段落的入口就放在台词行上：控制条在视频下方，隔着整块画面，
 * 一来一回要跑四趟才能圈出一段，看着台词顺手点两下才是它该有的样子。
 *
 * 段落循环分两步走：先点某句的「段首」，它后面的句子就都变成「段尾」等着收口。
 * 单句循环是另一码事，单独给一个按钮，不跟段落圈选混在一起。
 */
function rowLoopInfo(loop: Loop, index: number) {
  const idle = {
    inLoop: false,
    position: null as null | 'start' | 'middle' | 'end',
    badge: null as string | null,
    rangeLabel: '段首',
    rangeAction: 'start' as 'start' | 'end' | 'clear',
    singleActive: false
  };

  if (!loop) return idle;

  if (loop.mode === 'sentence') {
    if (index !== loop.start) return idle;
    return { ...idle, inLoop: true, badge: '单句循环', singleActive: true };
  }

  // 只点了段首，还等着收口
  if (loop.end == null) {
    if (index === loop.start) {
      return { ...idle, inLoop: true, position: 'start', badge: '段首 · 等待段尾', rangeLabel: '取消', rangeAction: 'clear' };
    }
    // 往回点等于改主意，把段首挪到这句
    if (index < loop.start) return idle;
    return { ...idle, rangeLabel: '段尾', rangeAction: 'end' };
  }

  if (index < loop.start || index > loop.end) return idle;

  const total = loop.end - loop.start + 1;
  const position = index === loop.start ? 'start' : index === loop.end ? 'end' : 'middle';
  const badge =
    position === 'start'
      ? `段首 · 共 ${total} 句`
      : position === 'end'
        ? '段尾'
        : `段中 · 第 ${index - loop.start + 1}/${total} 句`;

  return { ...idle, inLoop: true, position, badge, rangeLabel: '取消', rangeAction: 'clear' as const };
}

/**
 * 网页端的嵌套 Touchable 是靠 DOM 事件冒泡的，行里的按钮不拦一下，
 * 点「到这」会连带触发整行的跳转，视频就莫名其妙跑到别处去了。
 */
function stopRowPress(action: () => void) {
  return (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    action();
  };
}

/**
 * 独占一个滚动容器：跟随当前句的自动滚动只能滚动这个列表本身，
 * 否则播放时会把上方的画面一起滚出视野。
 */
export function SegmentList({
  segments,
  activeIndex,
  selectedIndex,
  loop,
  onSelect,
  onActivate,
  onSpeak,
  onLoopFrom,
  onLoopTo,
  onLoopSingle,
  onClearLoop,
  isFavorite,
  onToggleFavorite,
  noteAt,
  onEditNote,
  emptyHint
}: Props) {
  const listRef = useRef<FlatList<Segment>>(null);

  // 挑中一句在看时别再跟着播放自动滚，正读着的行被滚走比什么都烦
  useEffect(() => {
    if (activeIndex < 0 || selectedIndex != null) return;
    listRef.current?.scrollToIndex({ index: activeIndex, viewPosition: 0.5, animated: true });
  }, [activeIndex, selectedIndex]);

  /**
   * 平台没有现成的双击事件，只能自己按间隔判。第一下照常立即选中，
   * 第二下再补跳转——先选后跳没有副作用，比压着 300ms 等判定完再响应跟手。
   */
  const lastTapRef = useRef({ index: -1, at: 0 });
  const handleRowPress = (item: Segment, index: number) => {
    const now = Date.now();
    const previous = lastTapRef.current;
    if (previous.index === index && now - previous.at < 320) {
      lastTapRef.current = { index: -1, at: 0 };
      onActivate(item, index);
      return;
    }
    lastTapRef.current = { index, at: now };
    onSelect(item, index);
  };

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={styles.content}
      data={segments}
      keyExtractor={(item) => String(item.id)}
      ListEmptyComponent={emptyHint ? <Text style={styles.empty}>{emptyHint}</Text> : null}
      // 行高不固定，跳到远处尚未渲染的行会失败：先按均高粗定位，等这批行渲染出来再精确对齐
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        listRef.current?.scrollToOffset({ offset: index * (averageItemLength || 72), animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
        }, 80);
      }}
      renderItem={({ item, index }) => {
        const active = index === activeIndex;
        const selected = index === selectedIndex;
        const row = rowLoopInfo(loop ?? null, index);
        const favorited = isFavorite?.(index) ?? false;
        const note = noteAt?.(index) ?? null;
        const runRangeAction = () => {
          if (row.rangeAction === 'start') onLoopFrom(index);
          else if (row.rangeAction === 'end') onLoopTo(index);
          else onClearLoop();
        };
        return (
          <TouchableOpacity
            style={[
              styles.row,
              row.inLoop && styles.rowInLoop,
              row.position === 'start' && styles.rowRangeStart,
              row.position === 'end' && styles.rowRangeEnd,
              active && styles.rowActive,
              selected && styles.rowSelected
            ]}
            onPress={() => handleRowPress(item, index)}
            activeOpacity={0.7}
          >
            <View style={styles.rowHeader}>
              <View style={styles.rowHeaderLeft}>
                <Text style={[styles.time, active && styles.timeActive]}>{formatTime(item.start)}</Text>
                {selected ? <Text style={styles.selectedMark}>讲解中</Text> : null}
              </View>
              <View style={styles.rowHeaderRight}>
                {row.badge ? <Text style={styles.loopMark}>{row.badge}</Text> : null}
                {/* 行内按钮各管各的：点它们不该顺带把播放位置也拽过去 */}
                {onToggleFavorite ? (
                  <TouchableOpacity onPress={stopRowPress(() => onToggleFavorite(item, index))} hitSlop={8}>
                    <Text style={[styles.favorite, favorited && styles.favoriteOn]}>
                      {favorited ? '★ 已收藏' : '☆ 收藏'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {onEditNote ? (
                  <TouchableOpacity onPress={stopRowPress(() => onEditNote(item, index))} hitSlop={8}>
                    <Text style={[styles.note, note && styles.noteOn]}>✎ 注释</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={stopRowPress(() => onLoopSingle(index))} hitSlop={8}>
                  <Text style={[styles.rowAction, row.singleActive && styles.rowActionOn]}>
                    {row.singleActive ? '停止单句' : '单句循环'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={stopRowPress(runRangeAction)} hitSlop={8}>
                  <Text style={[styles.rowAction, row.rangeAction === 'clear' && styles.rowActionClear]}>
                    {row.rangeLabel}
                  </Text>
                </TouchableOpacity>
                {/* 一律是合成音念这一句。想听原片就在原声档下双击整行，从这句开始接着放 */}
                <TouchableOpacity onPress={stopRowPress(() => onSpeak(item))} hitSlop={8}>
                  <Text style={styles.repeat}>跟读</Text>
                </TouchableOpacity>
              </View>
            </View>
            {item.en ? <Text style={[styles.english, active && styles.englishActive]}>{item.en}</Text> : null}
            {item.zh ? <Text style={styles.chinese}>{item.zh}</Text> : null}
            {/* 无字幕时列表退化为等间隔片段，只给一个可点击的位置标签 */}
            {!item.en && !item.zh ? (
              <Text style={[styles.english, active && styles.englishActive]}>片段 {index + 1}</Text>
            ) : null}
            {/* 注释写下来就是给自己看的，得直接摊在句子下面 */}
            {note ? (
              <TouchableOpacity
                style={styles.noteBody}
                onPress={stopRowPress(() => onEditNote?.(item, index))}
                activeOpacity={0.7}
              >
                <Text style={styles.noteText}>{note}</Text>
              </TouchableOpacity>
            ) : null}
            {/* 点了却没跳，得当场说清楚怎么跳，不然只会以为点坏了 */}
            {selected ? <Text style={styles.playHint}>再点一下只放这一句 · 按播放键从这儿连着放</Text> : null}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1
  },
  content: {
    paddingBottom: 16
  },
  row: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  rowActive: {
    borderColor: '#2f80ed',
    backgroundColor: '#eef4ff'
  },
  rowSelected: {
    borderColor: '#2f80ed',
    borderWidth: 2,
    backgroundColor: '#f5f9ff'
  },
  rowInLoop: {
    backgroundColor: '#f1faf3',
    borderColor: '#cfe9d8',
    // 整段用左侧这根竖线连起来，一眼能看出圈到哪儿
    borderLeftWidth: 3,
    borderLeftColor: '#3f9d63'
  },
  rowRangeStart: {
    borderTopWidth: 1,
    borderTopColor: '#3f9d63'
  },
  rowRangeEnd: {
    borderBottomWidth: 1,
    borderBottomColor: '#3f9d63'
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8
  },
  rowHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  selectedMark: {
    fontSize: 11,
    color: '#2f80ed',
    fontWeight: '600'
  },
  playHint: {
    marginTop: 6,
    fontSize: 11,
    color: '#8aa9d8'
  },
  rowHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    // 窄屏放不下四个操作时让它们折行，而不是把台词挤没
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10
  },
  loopMark: {
    fontSize: 11,
    color: '#2f7a48',
    fontWeight: '600'
  },
  rowAction: {
    fontSize: 12,
    color: '#3f9d63'
  },
  rowActionOn: {
    color: '#1f6b3f',
    fontWeight: '700'
  },
  rowActionClear: {
    color: '#b0483f'
  },
  favorite: {
    fontSize: 12,
    color: '#9aa4b2'
  },
  favoriteOn: {
    color: '#e0a300',
    fontWeight: '600'
  },
  note: {
    fontSize: 12,
    color: '#9aa4b2'
  },
  noteOn: {
    color: '#7a5cd0',
    fontWeight: '600'
  },
  noteBody: {
    marginTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#c9bced'
  },
  noteText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#5b4a86'
  },
  time: {
    fontSize: 12,
    color: '#888'
  },
  timeActive: {
    color: '#2f80ed',
    fontWeight: '600'
  },
  repeat: {
    fontSize: 12,
    color: '#2f80ed'
  },
  english: {
    fontSize: 15,
    lineHeight: 21,
    color: '#222'
  },
  englishActive: {
    fontWeight: '600'
  },
  chinese: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#666'
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    paddingVertical: 24
  }
});
