import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { WordExamples } from '../hooks/useExamples';
import { formatTime } from '../lib/formatTime';
import type { StudyWord } from '../lib/vocabulary/study';
import type { Segment } from '../types/subtitle';

type Props = {
  word: StudyWord;
  segments: Segment[];
  currentIndex: number;
  mastered: boolean;
  examples?: WordExamples;
  onToggleMastered: () => void;
  onJump: (index: number) => void;
  onSpeak: (text: string) => void;
  /** 用片子原声放这一句。没片源可放时不传，按钮跟着不出现 */
  onPlayOriginal?: (index: number) => void;
};

/**
 * 网页端的嵌套 Touchable 靠 DOM 冒泡：例句整块是「跳过去」，
 * 里面的原声和跟读不拦一下，点它们会连带把页面也跳走。
 */
function stopCardPress(action: () => void) {
  return (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    action();
  };
}

const POS_LABEL: Record<string, string> = {
  Noun: '名词',
  Verb: '动词',
  Adjective: '形容词',
  Adverb: '副词',
  Preposition: '介词',
  Conjunction: '连词',
  Pronoun: '代词',
  Interjection: '感叹词',
  Numeral: '数词',
  Determiner: '限定词'
};

export function WordCard({
  word,
  segments,
  currentIndex,
  mastered,
  examples: dictExamples,
  onToggleMastered,
  onJump,
  onSpeak,
  onPlayOriginal
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const { entry, sensesHere, sensesElsewhere, posInMovie } = word;
  // 读原形而不是片中的变形：音标标的是原形，两者对不上会误导
  const headword = entry.lemma || entry.word;
  // 片中其他地方的用法就是最贴合语境的例句，不用去词典里找
  const elsewhere = word.occurrences.filter((occurrence) => occurrence.index !== currentIndex);
  const examples = expanded ? elsewhere.slice(0, 5) : elsewhere.slice(0, 1);
  const otherSenses = expanded ? sensesElsewhere : sensesElsewhere.slice(0, 2);
  const hidden = Math.min(elsewhere.length, 5) - examples.length + (sensesElsewhere.length - otherSenses.length);

  // 片中只出现一次的词没有第二处用法，这时词典例句就是唯一的补充
  const translated = dictExamples?.translated;
  const otherPosExample = otherSenses
    .map((sense) => (sense.pos ? dictExamples?.byPos?.[sense.pos]?.[0] : undefined))
    .find(Boolean);

  return (
    <View style={[styles.card, mastered && styles.cardMastered]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => onSpeak(headword)} hitSlop={6} activeOpacity={0.6}>
          <Text style={styles.word}>{headword}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onSpeak(headword)} hitSlop={8} activeOpacity={0.6}>
          <Text style={styles.speak}>🔊</Text>
        </TouchableOpacity>
        {entry.phonetic ? <Text style={styles.phonetic}>[{entry.phonetic}]</Text> : null}
        {posInMovie ? <Text style={styles.posBadge}>{POS_LABEL[posInMovie] ?? posInMovie}</Text> : null}
        <View style={styles.headSpacer} />
        <TouchableOpacity onPress={onToggleMastered} hitSlop={8}>
          <Text style={[styles.master, mastered && styles.masterOn]}>{mastered ? '已掌握' : '标记掌握'}</Text>
        </TouchableOpacity>
      </View>

      {word.surface !== (entry.lemma || entry.word) ? (
        <Text style={styles.surface}>片中写作 {word.surface}</Text>
      ) : null}

      {sensesHere.map((sense, position) => (
        <Text key={`here-${position}`} style={styles.sense}>
          {sense.posLabel ? <Text style={styles.sensePos}>{sense.posLabel} </Text> : null}
          {sense.text}
        </Text>
      ))}

      {/* 词典例句在片子里没有对应的画面可跳，不给个喇叭就永远听不到 */}
      {translated ? (
        <TouchableOpacity style={styles.exampleBox} onPress={() => onSpeak(translated.text)} activeOpacity={0.7}>
          <Text style={styles.exampleText}>
            {translated.text} <Text style={styles.speakInline}>🔊</Text>
          </Text>
          {translated.trans ? <Text style={styles.exampleZh}>{translated.trans}</Text> : null}
        </TouchableOpacity>
      ) : null}

      {otherSenses.length ? (
        <View style={styles.otherBlock}>
          <Text style={styles.blockTitle}>它还能这样用</Text>
          {otherSenses.map((sense, position) => (
            <Text key={`other-${position}`} style={styles.otherSense}>
              {sense.posLabel ? <Text style={styles.sensePos}>{sense.posLabel} </Text> : null}
              {sense.text}
            </Text>
          ))}
          {otherPosExample ? (
            <TouchableOpacity style={styles.exampleBox} onPress={() => onSpeak(otherPosExample.text)} activeOpacity={0.7}>
              <Text style={styles.exampleText}>
                {otherPosExample.text} <Text style={styles.speakInline}>🔊</Text>
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {examples.length ? (
        <View style={styles.otherBlock}>
          <Text style={styles.blockTitle}>片中其他出处</Text>
          {examples.map((occurrence) => {
            const segment = segments[occurrence.index];
            if (!segment) return null;
            return (
              // 点例句本身就跳过去，这是最顺手的那一下
              <TouchableOpacity key={occurrence.index} onPress={() => onJump(occurrence.index)} activeOpacity={0.7}>
                {/* 只想听一句的时候不该被拽走，所以另给两个就地播的按钮 */}
                <View style={styles.exampleHead}>
                  <Text style={styles.exampleTime}>{formatTime(segment.start)}</Text>
                  <View style={styles.headSpacer} />
                  {onPlayOriginal ? (
                    <TouchableOpacity onPress={stopCardPress(() => onPlayOriginal(occurrence.index))} hitSlop={6}>
                      <Text style={styles.exampleAction}>▶ 原声</Text>
                    </TouchableOpacity>
                  ) : null}
                  {segment.en ? (
                    <TouchableOpacity onPress={stopCardPress(() => onSpeak(segment.en))} hitSlop={6}>
                      <Text style={styles.exampleAction}>跟读</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.exampleText}>{segment.en}</Text>
                {segment.zh ? <Text style={styles.exampleZh}>{segment.zh}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {hidden > 0 || expanded ? (
        <TouchableOpacity onPress={() => setExpanded((previous) => !previous)} hitSlop={6}>
          <Text style={styles.more}>{expanded ? '收起' : `展开（还有 ${hidden} 条）`}</Text>
        </TouchableOpacity>
      ) : null}

      {entry.tag ? <Text style={styles.tag}>{entry.tag.split(' ').join(' · ')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fbfcfd',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eceff3',
    padding: 12,
    gap: 4
  },
  cardMastered: {
    opacity: 0.55
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6
  },
  headSpacer: {
    flex: 1
  },
  word: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  speak: {
    fontSize: 13,
    color: '#2f80ed'
  },
  speakInline: {
    fontSize: 11,
    color: '#2f80ed'
  },
  phonetic: {
    fontSize: 12,
    color: '#999'
  },
  posBadge: {
    fontSize: 11,
    color: '#2f80ed',
    backgroundColor: '#eaf1fe',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden'
  },
  master: {
    fontSize: 12,
    color: '#9aa4b2'
  },
  masterOn: {
    color: '#2f7a48',
    fontWeight: '600'
  },
  surface: {
    fontSize: 11,
    color: '#aaa'
  },
  sense: {
    fontSize: 13,
    lineHeight: 20,
    color: '#333'
  },
  sensePos: {
    color: '#2f80ed',
    fontSize: 12
  },
  otherBlock: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#eceff3',
    gap: 3
  },
  blockTitle: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2
  },
  otherSense: {
    fontSize: 12,
    lineHeight: 19,
    color: '#666'
  },
  exampleBox: {
    marginTop: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#e3e8ef'
  },
  exampleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6
  },
  exampleTime: {
    fontSize: 11,
    color: '#999'
  },
  exampleAction: {
    fontSize: 11,
    color: '#2f80ed'
  },
  exampleText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#444'
  },
  exampleZh: {
    fontSize: 11,
    lineHeight: 17,
    color: '#999'
  },
  more: {
    fontSize: 12,
    color: '#2f80ed',
    marginTop: 6
  },
  tag: {
    fontSize: 10,
    color: '#bbb',
    marginTop: 4
  }
});
