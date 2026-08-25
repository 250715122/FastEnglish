import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Favorite } from '../hooks/useFavorites';
import type { Note } from '../hooks/useNotes';
import type { SentenceRecord } from '../hooks/useSentenceRecords';
import { useSentenceQueue } from '../hooks/useSentenceQueue';
import { formatTime } from '../lib/formatTime';

export type MarksTab = 'favorites' | 'notes';

type Props = {
  tab: MarksTab;
  onTabChange: (tab: MarksTab) => void;
  favorites: Favorite[];
  notes: Note[];
  /** 当前正在看的视频，用来判断哪些记录能直接跳回去 */
  currentVideoKey: string | null;
  onJump: (record: SentenceRecord) => void;
  onRemoveFavorite: (id: string) => void;
  onRemoveNote: (id: string) => void;
  onEditNote: (note: Note) => void;
  voice: 'original' | 'synth';
  onSelectVoice: (voice: 'original' | 'synth') => void;
  /** 合成音的语速，跟台词列表共用一份设置 */
  synthRate: number;
  onCycleSynthRate: () => void;
  /** 原声得有片源，所以只有当前这部片的记录放得出来，其余的只能退回合成音 */
  canPlayOriginal: (record: SentenceRecord) => boolean;
  /** 放一句，返回的 Promise 在这句放完时兑现，串着放要靠它接龙 */
  onPlay: (record: SentenceRecord) => Promise<void>;
  onStopPlay: () => void;
  onClose: () => void;
};

/**
 * 网页端的嵌套 Touchable 靠 DOM 事件冒泡，卡片里的按钮不拦一下，
 * 点「朗读」会连带触发整张卡片的跳转，直接退出这个界面跑回视频去。
 */
function stopCardPress(action: () => void) {
  return (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    action();
  };
}

function describeTime(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function exactTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function MarksScreen({
  tab,
  onTabChange,
  favorites,
  notes,
  currentVideoKey,
  onJump,
  onRemoveFavorite,
  onRemoveNote,
  onEditNote,
  voice,
  onSelectVoice,
  synthRate,
  onCycleSynthRate,
  canPlayOriginal,
  onPlay,
  onStopPlay,
  onClose
}: Props) {
  const [onlyThisVideo, setOnlyThisVideo] = useState(false);
  const isNotes = tab === 'notes';
  const queue = useSentenceQueue<SentenceRecord>({ play: onPlay, stop: onStopPlay });
  const insets = useSafeAreaInsets();

  const visible = useMemo(() => {
    const source: SentenceRecord[] = isNotes ? notes : favorites;
    const list = onlyThisVideo ? source.filter((item) => item.videoKey === currentVideoKey) : source;
    // 服务端已经排过，这里再排一次是因为刚标记的还没落盘
    return [...list].sort((a, b) => b.savedAt - a.savedAt);
  }, [currentVideoKey, favorites, isNotes, notes, onlyThisVideo]);

  const videoCount = useMemo(() => new Set(visible.map((item) => item.videoKey)).size, [visible]);
  const speakable = useMemo(() => visible.filter((item) => item.en), [visible]);

  // 切标签、改筛选之后队列就对不上了，正放着的得先停下来
  const listKey = `${tab}-${onlyThisVideo}-${voice}`;
  const { stop: stopQueue } = queue;
  useEffect(() => {
    stopQueue();
  }, [listKey, stopQueue]);

  // 原声档下跨片的那些放不出原声，说清楚免得以为坏了
  const wantsOriginal = voice === 'original';
  const fallbackCount = wantsOriginal ? speakable.filter((item) => !canPlayOriginal(item)).length : 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, !isNotes && styles.tabActive]}
            onPress={() => onTabChange('favorites')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, !isNotes && styles.tabTextActive]}>★ 收藏 {favorites.length}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, isNotes && styles.tabActive]}
            onPress={() => onTabChange('notes')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, isNotes && styles.tabTextActive]}>✎ 注释 {notes.length}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.count}>
          {visible.length} 句 · {videoCount} 部片
        </Text>
      </View>

      <View style={styles.filters}>
        {currentVideoKey ? (
          <>
            <TouchableOpacity
              style={[styles.chip, !onlyThisVideo && styles.chipActive]}
              onPress={() => setOnlyThisVideo(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, !onlyThisVideo && styles.chipTextActive]}>全部</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, onlyThisVideo && styles.chipActive]}
              onPress={() => setOnlyThisVideo(true)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, onlyThisVideo && styles.chipTextActive]}>只看当前这部</Text>
            </TouchableOpacity>
          </>
        ) : null}

        <View style={styles.spacer} />

        {/* 复习时听谁的：片子里的真人语调，还是不挑片源、跨片也能连着放的合成音 */}
        <View style={styles.voice}>
          <TouchableOpacity
            style={[styles.voiceOption, wantsOriginal && styles.voiceOptionOn]}
            onPress={() => onSelectVoice('original')}
            activeOpacity={0.7}
          >
            <Text style={[styles.voiceText, wantsOriginal && styles.voiceTextOn]}>原声</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.voiceOption, !wantsOriginal && styles.voiceOptionOn]}
            onPress={() => onSelectVoice('synth')}
            activeOpacity={0.7}
          >
            <Text style={[styles.voiceText, !wantsOriginal && styles.voiceTextOn]}>合成音</Text>
          </TouchableOpacity>
        </View>

        {wantsOriginal ? null : (
          <TouchableOpacity style={styles.chip} onPress={onCycleSynthRate} activeOpacity={0.7}>
            <Text style={styles.chipText}>语速 {synthRate}x</Text>
          </TouchableOpacity>
        )}

        {speakable.length ? (
          <TouchableOpacity
            style={[styles.play, queue.playingAll && styles.playOn]}
            onPress={queue.playingAll ? queue.stop : () => queue.playAll(speakable)}
            activeOpacity={0.8}
          >
            <Text style={[styles.playText, queue.playingAll && styles.playTextOn]}>
              {queue.playingAll ? '■ 停止' : `▶ 连着放 ${speakable.length} 句`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {fallbackCount ? (
        <Text style={styles.voiceNote}>
          其中 {fallbackCount} 句属于别的片子，这里放不出原声，会用合成音念
        </Text>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + insets.bottom }]}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isNotes
              ? '还没有注释。在台词列表里点某句右侧的「✎ 注释」，写下你自己的理解。'
              : '还没有收藏。在台词列表里点某句右侧的「☆ 收藏」就会出现在这里。'}
          </Text>
        }
        renderItem={({ item }) => {
          // 换片之后原来的视频地址已经失效，只能提示回到那部片再看
          const sameVideo = item.videoKey === currentVideoKey;
          const note = isNotes ? (item as Note) : null;
          const speaking = queue.activeId === item.id;
          const original = wantsOriginal && canPlayOriginal(item);
          return (
            <TouchableOpacity
              style={[styles.card, speaking && styles.cardSpeaking]}
              onPress={() => onJump(item)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHead}>
                <Text style={[styles.savedAt, isNotes && styles.savedAtNote]}>
                  {isNotes ? '记于 ' : '收藏于 '}
                  {describeTime(item.savedAt)}
                </Text>
                <Text style={styles.savedExact}>{exactTime(item.savedAt)}</Text>
                <View style={styles.spacer} />
                {/* 卡片里的按钮各管各的：点它们不该顺带把人带回视频去 */}
                {item.en ? (
                  <TouchableOpacity onPress={stopCardPress(() => queue.playOne(item))} hitSlop={8}>
                    <Text style={[styles.speak, speaking && styles.speakOn]}>
                      {speaking ? '▶ 播放中' : original ? '▶ 原声' : '🔊 朗读'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {note ? (
                  <TouchableOpacity onPress={stopCardPress(() => onEditNote(note))} hitSlop={8}>
                    <Text style={styles.edit}>编辑</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={stopCardPress(() => (isNotes ? onRemoveNote(item.id) : onRemoveFavorite(item.id)))}
                  hitSlop={8}
                >
                  <Text style={styles.remove}>{isNotes ? '删除' : '取消收藏'}</Text>
                </TouchableOpacity>
              </View>

              {note ? <Text style={styles.noteText}>{note.text}</Text> : null}

              {item.en ? <Text style={[styles.english, isNotes && styles.englishQuoted]}>{item.en}</Text> : null}
              {item.zh ? <Text style={styles.chinese}>{item.zh}</Text> : null}

              <View style={styles.cardFoot}>
                <Text style={styles.source} numberOfLines={1}>
                  {item.videoKey} · {formatTime(item.start)}
                </Text>
                <Text style={sameVideo ? styles.jump : styles.jumpOther}>
                  {sameVideo ? '点这里回到这一句' : '属于另一部片，点了会先切字幕'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f7f8fa',
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
  tabs: {
    flex: 1,
    flexDirection: 'row',
    gap: 8
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f2f4f7'
  },
  tabActive: {
    backgroundColor: '#e8effc'
  },
  tabText: {
    fontSize: 13,
    color: '#666'
  },
  tabTextActive: {
    color: '#2f80ed',
    fontWeight: '700'
  },
  count: {
    fontSize: 12,
    color: '#888'
  },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
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
  // 两个选项贴在一起做成一个二选一的滑块，比两枚独立按钮更像开关
  voice: {
    flexDirection: 'row',
    borderRadius: 14,
    backgroundColor: '#eef1f5',
    padding: 2
  },
  voiceOption: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  voiceOptionOn: {
    backgroundColor: '#fff'
  },
  voiceText: {
    fontSize: 12,
    color: '#888'
  },
  voiceTextOn: {
    color: '#2f80ed',
    fontWeight: '700'
  },
  voiceNote: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 11,
    color: '#b0843f'
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    paddingVertical: 40,
    paddingHorizontal: 24,
    lineHeight: 20
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#eef1f5'
  },
  // 念到哪句就把哪张卡片点亮，一串念下来才知道进行到哪儿了
  cardSpeaking: {
    borderColor: '#2f80ed',
    backgroundColor: '#f5f9ff'
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8
  },
  speak: {
    fontSize: 12,
    color: '#2f80ed'
  },
  speakOn: {
    fontWeight: '700'
  },
  savedAt: {
    fontSize: 12,
    color: '#e0a300',
    fontWeight: '600'
  },
  savedAtNote: {
    color: '#7a5cd0'
  },
  savedExact: {
    fontSize: 11,
    color: '#aaa'
  },
  spacer: {
    flex: 1
  },
  edit: {
    fontSize: 12,
    color: '#2f80ed'
  },
  remove: {
    fontSize: 12,
    color: '#b0483f'
  },
  noteText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#3b2f5c',
    marginBottom: 8
  },
  english: {
    fontSize: 15,
    lineHeight: 21,
    color: '#222'
  },
  // 有注释时台词退成引文，注释才是主角
  englishQuoted: {
    fontSize: 13,
    lineHeight: 19,
    color: '#666'
  },
  chinese: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#666'
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10
  },
  source: {
    flex: 1,
    fontSize: 11,
    color: '#999'
  },
  jump: {
    fontSize: 12,
    color: '#2f80ed'
  },
  jumpOther: {
    fontSize: 11,
    color: '#b0843f'
  }
});
