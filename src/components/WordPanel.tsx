import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useExamples } from '../hooks/useExamples';
import { formatTime } from '../lib/formatTime';
import type { PhraseHit } from '../lib/vocabulary/dictionary';
import type { DifficultyLevel, StudyWord } from '../lib/vocabulary/study';
import type { VocabularyStatus } from '../hooks/useVocabulary';
import type { Segment } from '../types/subtitle';
import { WordCard } from './WordCard';

type Props = {
  segment?: Segment;
  segments: Segment[];
  currentIndex: number;
  words: StudyWord[];
  status: VocabularyStatus;
  /** 查询失败时的具体原因，比干巴巴一句「失败了」有用 */
  error?: string | null;
  level: DifficultyLevel;
  onLevelChange: (level: DifficultyLevel) => void;
  showMastered: boolean;
  onToggleShowMastered: () => void;
  isMastered: (key: string) => boolean;
  onToggleMastered: (key: string) => void;
  onSpeak: (segment: Segment) => void;
  /** 单词、短语、词典例句都没有对应的画面可跳，只能靠合成语音念出来 */
  onSpeakText: (text: string) => void;
  onJump: (index: number) => void;
  /** 用片子原声放某一句。没片源可放时不传，词条里跟着不出现这个按钮 */
  onPlayOriginal?: (index: number) => void;
  onOpenWordbook: () => void;
  phrases: PhraseHit[];
  stacked?: boolean;
};

const LEVELS: Array<{ id: DifficultyLevel; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'normal', label: '适中' },
  { id: 'hard', label: '只看难词' }
];

const STATUS_HINT: Record<VocabularyStatus, string | null> = {
  idle: '加载字幕后，这里会列出当前句里值得学的单词。',
  'no-english': '这份字幕只有中文，没有英文原文就没法拆出单词。再加载一份英文字幕试试。',
  loading: '正在查词典…',
  ready: null,
  missing: '词典还没下载。在项目目录运行 npm run fetch-dict，然后重启后端。',
  error: '词典查询失败了。'
};

export function WordPanel({
  segment,
  segments,
  currentIndex,
  words,
  status,
  error,
  level,
  onLevelChange,
  showMastered,
  onToggleShowMastered,
  isMastered,
  onToggleMastered,
  onSpeak,
  onSpeakText,
  onJump,
  onPlayOriginal,
  onOpenWordbook,
  phrases,
  stacked
}: Props) {
  const visible = showMastered ? words : words.filter((word) => !isMastered(word.key));
  const hiddenCount = words.length - visible.length;
  const hint = STATUS_HINT[status];
  const examples = useExamples(visible.map((word) => word.key));

  return (
    <View style={[styles.panel, stacked && styles.panelStacked]}>
      <View style={styles.head}>
        <Text style={styles.headTitle}>当前句</Text>
        <View style={styles.headSpacer} />
        {segment ? <Text style={styles.headTime}>{formatTime(segment.start)}</Text> : null}
        <TouchableOpacity onPress={onOpenWordbook} hitSlop={6}>
          <Text style={styles.headLink}>全片单词</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {segment ? (
          <>
            {segment.en ? <Text style={styles.english}>{segment.en}</Text> : null}
            {segment.zh ? <Text style={styles.chinese}>{segment.zh}</Text> : null}
            {segment.en ? (
              <TouchableOpacity style={styles.speakButton} onPress={() => onSpeak(segment)} activeOpacity={0.7}>
                <Text style={styles.speakText}>朗读这句</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <Text style={styles.placeholder}>播放到有台词的地方，这里会显示当前句。</Text>
        )}

        {phrases.length ? (
          <>
            <View style={styles.divider} />
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>短语 {phrases.length}</Text>
              <Text style={styles.sectionNote}>整体意思和字面不一样</Text>
            </View>
            {phrases.map((item) => (
              <View key={`${item.phrase}-${item.start}`} style={styles.phraseCard}>
                <View style={styles.phraseHead}>
                  <TouchableOpacity onPress={() => onSpeakText(item.phrase)} hitSlop={6} activeOpacity={0.6}>
                    <Text style={styles.phraseText}>{item.phrase}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onSpeakText(item.phrase)} hitSlop={8} activeOpacity={0.6}>
                    <Text style={styles.phraseSpeak}>🔊</Text>
                  </TouchableOpacity>
                  {item.phonetic ? <Text style={styles.phrasePhonetic}>/{item.phonetic}/</Text> : null}
                </View>
                {/* 词典里多个义项是用字面的 \n 分隔的 */}
                <Text style={styles.phraseTranslation}>
                  {item.translation.split(/\\n|\n/).map((line) => line.trim()).filter(Boolean).join('；')}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <View style={styles.divider} />

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>生词{visible.length ? ` ${visible.length}` : ''}</Text>
          <View style={styles.levels}>
            {LEVELS.map((item) => (
              <TouchableOpacity key={item.id} onPress={() => onLevelChange(item.id)} hitSlop={4}>
                <Text style={[styles.levelText, level === item.id && styles.levelActive]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {hint ? <Text style={styles.placeholder}>{hint}</Text> : null}
        {status === 'error' && error ? <Text style={styles.placeholder}>{error}</Text> : null}

        {status === 'ready' && !words.length && segment?.en ? (
          <Text style={styles.placeholder}>这句里没有需要特别学的词，换个难度试试。</Text>
        ) : null}

        {visible.map((word) => (
          <WordCard
            key={word.key}
            word={word}
            segments={segments}
            currentIndex={currentIndex}
            mastered={isMastered(word.key)}
            examples={examples[word.key]}
            onToggleMastered={() => onToggleMastered(word.key)}
            onJump={onJump}
            onSpeak={onSpeakText}
            onPlayOriginal={onPlayOriginal}
          />
        ))}

        {hiddenCount > 0 ? (
          <TouchableOpacity onPress={onToggleShowMastered} hitSlop={6}>
            <Text style={styles.showMastered}>已隐藏 {hiddenCount} 个掌握过的词，点这里显示</Text>
          </TouchableOpacity>
        ) : null}

        {showMastered && words.some((word) => isMastered(word.key)) ? (
          <TouchableOpacity onPress={onToggleShowMastered} hitSlop={6}>
            <Text style={styles.showMastered}>隐藏已掌握的词</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 340,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden'
  },
  panelStacked: {
    width: '100%',
    // 窄屏下它独占一个标签页，撑满剩余高度而不是固定一小块
    flex: 1,
    minHeight: 0
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef0f3'
  },
  headTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333'
  },
  headSpacer: {
    flex: 1
  },
  headTime: {
    fontSize: 12,
    color: '#2f80ed'
  },
  headLink: {
    fontSize: 12,
    color: '#2f80ed'
  },
  body: {
    padding: 16,
    gap: 10
  },
  english: {
    fontSize: 18,
    lineHeight: 27,
    color: '#1a1a1a',
    fontWeight: '600'
  },
  chinese: {
    fontSize: 14,
    lineHeight: 22,
    color: '#666'
  },
  speakButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#e4edff'
  },
  speakText: {
    fontSize: 13,
    color: '#2f80ed',
    fontWeight: '600'
  },
  placeholder: {
    fontSize: 13,
    lineHeight: 20,
    color: '#999'
  },
  divider: {
    height: 1,
    backgroundColor: '#eef0f3',
    marginVertical: 2
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333'
  },
  sectionNote: {
    fontSize: 11,
    color: '#999'
  },
  phraseCard: {
    backgroundColor: '#fff8ec',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f0dfc0',
    padding: 10,
    marginBottom: 8
  },
  phraseHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 8
  },
  phraseText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8a5a12'
  },
  phraseSpeak: {
    fontSize: 12,
    color: '#8a5a12'
  },
  phrasePhonetic: {
    fontSize: 11,
    color: '#b09468'
  },
  phraseTranslation: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#5c4520'
  },
  levels: {
    flexDirection: 'row',
    gap: 10
  },
  levelText: {
    fontSize: 12,
    color: '#aaa'
  },
  levelActive: {
    color: '#2f80ed',
    fontWeight: '600'
  },
  showMastered: {
    fontSize: 12,
    color: '#2f80ed',
    paddingVertical: 4
  }
});
