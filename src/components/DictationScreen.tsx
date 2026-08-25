import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime } from '../lib/formatTime';
import { gradeDictation, skeleton, splitWords, type Grade } from '../lib/dictation';
import type { Segment } from '../types/subtitle';

type Props = {
  segments: Segment[];
  title: string;
  /** 进来时落在哪一句：默认接着上次写到的地方，没写过就从当前播放位置开始 */
  startIndex: number;
  scores: Record<string, number>;
  onScore: (index: number, percent: number) => void;
  onVisit: (index: number) => void;
  /** 没片源时为 null，只能听合成音 */
  onPlayOriginal: ((index: number) => void) | null;
  onSpeak: (text: string) => void;
  onStop: () => void;
  onSwitchToCopy: () => void;
  onClose: () => void;
};

/** 提示是有代价的，一级一级给，别一上来就把答案摊开 */
const HINTS = ['无', '中文', '首字母', '答案'];

export function DictationScreen({
  segments,
  title,
  startIndex,
  scores,
  onScore,
  onVisit,
  onPlayOriginal,
  onSpeak,
  onStop,
  onSwitchToCopy,
  onClose
}: Props) {
  // 没有英文的句子没法默写，先把它们剔出去，后面一律按这张表的位置走
  const items = useMemo(
    () => segments.map((segment, index) => ({ segment, index })).filter((item) => !!item.segment.en),
    [segments]
  );

  const positionOf = useCallback(
    (index: number) => {
      const found = items.findIndex((item) => item.index >= index);
      return found < 0 ? 0 : found;
    },
    [items]
  );

  const [position, setPosition] = useState(() => positionOf(startIndex));
  const [typed, setTyped] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [hint, setHint] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const current = items[position];
  const sentence = current?.segment.en ?? '';

  const done = useMemo(() => Object.keys(scores).length, [scores]);
  const average = useMemo(() => {
    const values = Object.values(scores);
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [scores]);

  const play = useCallback(() => {
    if (!current) return;
    if (onPlayOriginal) onPlayOriginal(current.index);
    else if (sentence) onSpeak(sentence);
  }, [current, onPlayOriginal, onSpeak, sentence]);

  // 换了一句就自动放一遍：默写的节奏本来就是「听 → 写」，不该每句都先点一下播放
  useEffect(() => {
    if (!autoPlay || !current) return;
    play();
    // play 每次渲染都是新的，挂进依赖会变成每帧重放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, position]);

  useEffect(() => {
    if (current) onVisit(current.index);
  }, [current, onVisit]);

  useEffect(() => () => onStop(), [onStop]);

  const goTo = useCallback((next: number) => {
    setPosition(next);
    setTyped('');
    setGrade(null);
    setHint(0);
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(() => {
    if (!current) return;
    // 已经批过了，回车就是「下一句」——手不用离开键盘
    if (grade) {
      if (position < items.length - 1) goTo(position + 1);
      return;
    }
    const result = gradeDictation(sentence, typed);
    setGrade(result);
    // 看过答案再写就不算数了，否则统计里全是 100%
    if (hint < 3) onScore(current.index, result.percent);
  }, [current, goTo, grade, hint, items.length, onScore, position, sentence, typed]);

  /** 从这儿往后第一句还没写过的 */
  const jumpToUnwritten = useCallback(() => {
    const next = items.findIndex((item, i) => i > position && scores[item.index] == null);
    if (next >= 0) goTo(next);
    else {
      const first = items.findIndex((item) => scores[item.index] == null);
      if (first >= 0) goTo(first);
    }
  }, [goTo, items, position, scores]);

  if (!items.length) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.head}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.back}>← 返回</Text>
          </TouchableOpacity>
          <View style={styles.tabs}>
            <Chip label="听写" on onPress={() => undefined} />
            <Chip label="抄写" onPress={onSwitchToCopy} />
          </View>
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.empty}>还没有英文字幕，没有可以默写的句子。</Text>
      </View>
    );
  }

  const best = scores[current.index];

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.head}>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        {/* 听着写和照着抄练的是两回事，摆在一处随时换 */}
        <View style={styles.tabs}>
          <Chip label="听写" on onPress={() => undefined} />
          <Chip label="抄写" onPress={onSwitchToCopy} />
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.count}>
          已默写 {done} / {items.length}
          {done ? ` · 平均 ${average}%` : ''}
        </Text>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round((done / items.length) * 100)}%` }]} />
        </View>
        <TouchableOpacity onPress={jumpToUnwritten} hitSlop={6}>
          <Text style={styles.jump}>跳到没写过的</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.no}>
              第 {position + 1} / {items.length} 句
            </Text>
            <Text style={styles.time}>{formatTime(current.segment.start)}</Text>
            {best != null ? <Text style={styles.best}>最好 {best}%</Text> : null}
            <View style={styles.spacer} />
            <Text style={styles.words}>{splitWords(sentence).length} 个词</Text>
          </View>

          <View style={styles.playRow}>
            {onPlayOriginal ? (
              <TouchableOpacity style={styles.playButton} onPress={() => onPlayOriginal(current.index)} activeOpacity={0.8}>
                <Text style={styles.playText}>▶ 原声</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.ghostButton} onPress={() => onSpeak(sentence)} activeOpacity={0.8}>
              <Text style={styles.ghostText}>🔊 合成音</Text>
            </TouchableOpacity>
            <View style={styles.spacer} />
            <Chip label={autoPlay ? '自动放 开' : '自动放 关'} on={autoPlay} onPress={() => setAutoPlay((p) => !p)} />
          </View>

          {/* 提示分级：卡住了先看中文，还想不起来看首字母，实在不行才看答案 */}
          <View style={styles.hintRow}>
            <Text style={styles.hintLabel}>提示</Text>
            {HINTS.map((label, level) => (
              <Chip key={label} label={label} on={hint === level} onPress={() => setHint(level)} />
            ))}
            {hint === 3 ? <Text style={styles.hintWarn}>看过答案这句不计分</Text> : null}
          </View>

          {hint >= 1 && current.segment.zh ? <Text style={styles.zh}>{current.segment.zh}</Text> : null}
          {hint === 2 ? <Text style={styles.skeleton}>{skeleton(sentence)}</Text> : null}
          {hint === 3 ? <Text style={styles.answer}>{sentence}</Text> : null}

          <TextInput
            ref={inputRef}
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            placeholder="写下你听到的这句话"
            placeholderTextColor="#b6bcc4"
            onSubmitEditing={submit}
            blurOnSubmit={false}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            // 浏览器的拼写检查会把答案直接标出来，那这练习就白做了
            spellCheck={false}
            editable={!grade}
          />

          {grade ? (
            <View style={styles.result}>
              <View style={styles.scoreRow}>
                <Text style={[styles.score, grade.percent >= 90 && styles.scoreGood, grade.percent < 60 && styles.scoreBad]}>
                  {grade.percent}%
                </Text>
                <Text style={styles.scoreNote}>
                  对 {grade.correct} / {grade.total} 个词
                </Text>
              </View>
              <Text style={styles.diff}>
                {grade.tokens.map((token, i) => (
                  <Text key={i}>
                    <Text style={styles[token.kind]}>{token.text}</Text>
                    {token.expected ? <Text style={styles.fix}>({token.expected})</Text> : null}{' '}
                  </Text>
                ))}
              </Text>
              <Text style={styles.legend}>绿=对 · 红=拼错（括号里是正确的） · 灰=漏写 · 划掉=多写</Text>
              <Text style={styles.origin}>{sentence}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {grade ? (
              <>
                <TouchableOpacity style={styles.ghostButton} onPress={() => goTo(position)} activeOpacity={0.8}>
                  <Text style={styles.ghostText}>重写这句</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => position < items.length - 1 && goTo(position + 1)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryText}>下一句 →</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={() => position < items.length - 1 && goTo(position + 1)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.ghostText}>跳过</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={submit} activeOpacity={0.8}>
                  <Text style={styles.primaryText}>对答案</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: 10 + insets.bottom }]}>
        <TouchableOpacity onPress={() => position > 0 && goTo(position - 1)} hitSlop={6} disabled={position === 0}>
          <Text style={[styles.barButton, position === 0 && styles.barButtonOff]}>← 上一句</Text>
        </TouchableOpacity>
        <View style={styles.spacer} />
        <Text style={styles.barNote}>回车对答案，再回车下一句</Text>
        <View style={styles.spacer} />
        <TouchableOpacity
          onPress={() => position < items.length - 1 && goTo(position + 1)}
          hitSlop={6}
          disabled={position >= items.length - 1}
        >
          <Text style={[styles.barButton, position >= items.length - 1 && styles.barButtonOff]}>下一句 →</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    flexDirection: 'row',
    gap: 6
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
    gap: 12,
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
  jump: {
    fontSize: 12,
    color: '#2f80ed'
  },
  body: {
    padding: 16,
    alignSelf: 'center',
    maxWidth: 720,
    width: '100%'
  },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eceff3'
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  spacer: {
    flex: 1
  },
  no: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333'
  },
  time: {
    fontSize: 12,
    color: '#999'
  },
  best: {
    fontSize: 11,
    color: '#2f7a48',
    backgroundColor: '#eaf7ee',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden'
  },
  words: {
    fontSize: 12,
    color: '#999'
  },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8
  },
  hintLabel: {
    fontSize: 12,
    color: '#999'
  },
  hintWarn: {
    fontSize: 11,
    color: '#b0843f'
  },
  zh: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22
  },
  skeleton: {
    fontSize: 15,
    color: '#8a8f97',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined
  },
  answer: {
    fontSize: 15,
    color: '#b0483f',
    lineHeight: 24
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe0e6',
    backgroundColor: '#fbfcfd',
    fontSize: 16,
    color: '#1a1a1a'
  },
  result: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eceff3'
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10
  },
  score: {
    fontSize: 24,
    fontWeight: '700',
    color: '#b0843f'
  },
  scoreGood: {
    color: '#2f7a48'
  },
  scoreBad: {
    color: '#b0483f'
  },
  scoreNote: {
    fontSize: 12,
    color: '#888'
  },
  diff: {
    fontSize: 16,
    lineHeight: 26
  },
  ok: {
    color: '#2f7a48'
  },
  wrong: {
    color: '#b0483f',
    fontWeight: '700'
  },
  missing: {
    color: '#a8adb5',
    textDecorationLine: 'underline'
  },
  extra: {
    color: '#b0483f',
    textDecorationLine: 'line-through'
  },
  fix: {
    color: '#2f7a48',
    fontSize: 13
  },
  legend: {
    fontSize: 11,
    color: '#aaa'
  },
  origin: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  primaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#2f80ed'
  },
  primaryText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600'
  },
  ghostButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#eef1f5'
  },
  ghostText: {
    fontSize: 13,
    color: '#444'
  },
  playButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#e4edff'
  },
  playText: {
    fontSize: 13,
    color: '#2f80ed',
    fontWeight: '600'
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
  empty: {
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    paddingVertical: 40
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e9ecf0'
  },
  barButton: {
    fontSize: 13,
    color: '#2f80ed'
  },
  barButtonOff: {
    color: '#c8ccd2'
  },
  barNote: {
    fontSize: 11,
    color: '#aaa'
  }
});
