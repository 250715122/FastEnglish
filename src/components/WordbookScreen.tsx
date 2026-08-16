import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { isWorthLearning, type DifficultyLevel, type StudyWord } from '../lib/vocabulary/study';
import type { Segment } from '../types/subtitle';
import { WordCard } from './WordCard';

type Filter = 'all' | 'unmastered' | 'mastered';

type Props = {
  words: StudyWord[];
  segments: Segment[];
  title: string;
  level: DifficultyLevel;
  onLevelChange: (level: DifficultyLevel) => void;
  isMastered: (key: string) => boolean;
  onToggleMastered: (key: string) => void;
  onJump: (index: number) => void;
  onClose: () => void;
};

const LEVELS: Array<{ id: DifficultyLevel; label: string }> = [
  { id: 'all', label: '全部难度' },
  { id: 'normal', label: '适中' },
  { id: 'hard', label: '只看难词' }
];

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'unmastered', label: '未掌握' },
  { id: 'mastered', label: '已掌握' },
  { id: 'all', label: '全部' }
];

export function WordbookScreen({
  words,
  segments,
  title,
  level,
  onLevelChange,
  isMastered,
  onToggleMastered,
  onJump,
  onClose
}: Props) {
  const [filter, setFilter] = useState<Filter>('unmastered');
  const { width } = useWindowDimensions();
  const columns = Math.max(1, Math.min(4, Math.floor((width - 32) / 330)));

  const visible = useMemo(() => {
    return words
      .filter((word) => isWorthLearning(word.entry, level))
      .filter((word) => {
        if (filter === 'all') return true;
        const mastered = isMastered(word.key);
        return filter === 'mastered' ? mastered : !mastered;
      });
  }, [filter, isMastered, level, words]);

  const masteredCount = useMemo(() => words.filter((word) => isMastered(word.key)).length, [isMastered, words]);

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.count}>
          {visible.length} 个词 · 已掌握 {masteredCount}
        </Text>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.chip, filter === item.id && styles.chipActive]}
            onPress={() => setFilter(item.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, filter === item.id && styles.chipTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.spacer} />
        {LEVELS.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.chip, level === item.id && styles.chipActive]}
            onPress={() => onLevelChange(item.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, level === item.id && styles.chipTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        key={columns}
        data={visible}
        numColumns={columns}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        columnWrapperStyle={columns > 1 ? styles.column : undefined}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {words.length ? '这个筛选下没有单词，换个难度或筛选试试。' : '还没有单词。加载一份英文字幕后这里会列出整部片子的词。'}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.cell, columns > 1 && { flex: 1 / columns }]}>
            <WordCard
              word={item}
              segments={segments}
              currentIndex={-1}
              mastered={isMastered(item.key)}
              onToggleMastered={() => onToggleMastered(item.key)}
              onJump={(index) => {
                onJump(index);
                onClose();
              }}
            />
          </View>
        )}
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
  filters: {
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
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10
  },
  column: {
    gap: 10
  },
  cell: {
    minWidth: 0
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    paddingVertical: 40
  }
});
