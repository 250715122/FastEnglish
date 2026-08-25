import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime } from '../lib/formatTime';
import { buildParagraphs } from '../lib/paragraphs';
import {
  accuracyOf,
  countNewErrors,
  formatDuration,
  formatWhen,
  speedOf,
  toRuns,
  type CopyRecord
} from '../lib/copywork';
import type { Segment } from '../types/subtitle';

type Props = {
  segments: Segment[];
  title: string;
  /** 接着上次抄到的地方 */
  startIndex: number;
  records: CopyRecord[];
  onFinishRound: (record: CopyRecord) => void;
  onVisit: (index: number) => void;
  onClearRecords: () => void;
  /** 没片源时为 null，只能听合成音 */
  onPlayOriginal: ((from: number, to: number) => void) | null;
  onPlaySynth: (from: number, to: number) => void;
  onStop: () => void;
  onSwitchToDictation: () => void;
  onClose: () => void;
};

/** 一段最多几句。这是一次要敲多少字的总闸，长了劝退，短了又不成段 */
const CHUNKS = [3, 5, 8, 12];

/** 停顿多久算换一段。跟读模式用同一个默认档，抄的和读的分段感觉一致 */
const GAP = 5;

/** 原文和输入框共用一套字形，上下两块的同一列才对得上 */
const MONO = {
  fontSize: 17,
  lineHeight: 29,
  letterSpacing: 0.4,
  fontFamily: Platform.OS === 'web' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined
} as const;

/**
 * 估一屏能摆几段要用到的几个数，改样式时这里得跟着改。
 * 估歪一点不要紧：多了就多滚两下，少了就空一块，段数本身不会错。
 */
/** 等宽字的字宽约为字号的 0.6 */
const CHAR_RATIO = 0.6;
/** 一张卡除正文以外吃掉的高度：卡间距 10 + 边框 2 + 内边距 20 + 段头 20 + 输入框那点余量 10 */
const CARD_FIXED = 62;
/** 有译文的话底下多一行 */
const ZH_HEIGHT = 22;
/** 正文左右让出去的空白：列表 16 + 卡片 12 + 输入框 12，各两份 */
const TEXT_INSET = 80;
/** 输入框比原文高出来的那点：上下内边距加边框 */
const INPUT_EXTRA = 10;

type Chunk = {
  start: number;
  /** 段末那一句在字幕里的下标，用来按位置找回段号 */
  to: number;
  /** 这一段里有英文的句子，按字幕下标排 */
  indexes: number[];
  text: string;
  zh: string;
};

type Session = {
  startAt: number;
  /** 这一屏从字幕的哪一句起头 */
  from: number;
  typed: number;
  errors: number;
};

export function CopyworkScreen({
  segments,
  title,
  startIndex,
  records,
  onFinishRound,
  onVisit,
  onClearRecords,
  onPlayOriginal,
  onPlaySynth,
  onStop,
  onSwitchToDictation,
  onClose
}: Props) {
  const [chunkLines, setChunkLines] = useState(5);

  /**
   * 按段抄，不按句抄。
   *
   * 一句一句地喂，敲完一句就翻篇，练的是打字；成段地摆在眼前，
   * 一段话里的搭配和语序才跟着手一起过一遍。分段沿用读模式那套停顿判据，
   * 再加一道句数闸——一段几十句的连珠炮敲下来只会让人放弃。
   * 没有英文的句子抄不了，先从段里剔出去，整段都没有的段落直接不出现。
   */
  const chunks = useMemo<Chunk[]>(() => {
    if (!segments.length) return [];
    return buildParagraphs(segments, GAP, chunkLines)
      .map((para) => {
        const indexes: number[] = [];
        for (let i = para.from; i <= para.to; i += 1) if (segments[i].en) indexes.push(i);
        return {
          start: para.start,
          to: para.to,
          indexes,
          text: indexes.map((i) => (segments[i].en || '').trim()).join(' '),
          zh: indexes
            .map((i) => segments[i].zh)
            .filter(Boolean)
            .join(' ')
        };
      })
      .filter((chunk) => chunk.indexes.length > 0);
  }, [chunkLines, segments]);

  const positionOf = useCallback(
    (index: number) => {
      const found = chunks.findIndex((chunk) => chunk.to >= index);
      return found < 0 ? 0 : found;
    },
    [chunks]
  );

  const [from, setFrom] = useState(() => positionOf(startIndex));
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [typed, setTyped] = useState<Record<number, string>>({});
  /** 每段原文实际排了多高，输入框照它长，两块才严丝合缝地对上 */
  const [textHeight, setTextHeight] = useState<Record<number, number>>({});
  const [done, setDone] = useState<number[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<CopyRecord | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [, setTick] = useState(0);
  const insets = useSafeAreaInsets();
  const inputs = useRef<Record<number, TextInput | null>>({});
  /** 抄到哪一句了。换段长时段的编号全变了，靠它找回原来的位置 */
  const anchor = useRef(startIndex);

  /**
   * 一屏摆几段，按屏幕高度算。
   *
   * 一次只给一段的话，大半个屏是空的；写死"每屏 N 段"又没法同时照顾手机和宽屏。
   * 所以按每段实际有多少字估出它要占几行，从当前这段开始往下装，装不下为止。
   */
  const heightOf = useCallback(
    (chunk: Chunk) => {
      const perLine = Math.max(20, Math.floor((box.width - TEXT_INSET) / (MONO.fontSize * CHAR_RATIO)));
      const lines = Math.max(1, Math.ceil(chunk.text.length / perLine));
      // 输入框和原文一样高，敲到第几行原文就在正上方第几行
      return CARD_FIXED + (chunk.zh ? ZH_HEIGHT : 0) + lines * MONO.lineHeight * 2;
    },
    [box.width]
  );

  /** 摆在屏上的那几段，存的是段号 */
  const batch = useMemo(() => {
    if (!chunks[from]) return [];
    // 还没量到滚动区多大，先摆一段撑着，量到了这一帧就补齐
    if (!box.width || !box.height) return [from];
    const picked: number[] = [];
    let total = 0;
    for (let i = from; i < chunks.length; i += 1) {
      const height = heightOf(chunks[i]);
      // 一段本身就超过一屏也得摆出来，否则一段也放不下
      if (picked.length && total + height > box.height) break;
      picked.push(i);
      total += height;
    }
    return picked;
  }, [box.height, box.width, chunks, from, heightOf]);

  /** 往前翻：从上一段倒着往回装，装满一屏为止 */
  const backFrom = useCallback(
    (end: number) => {
      if (end < 0) return 0;
      if (!box.height) return Math.max(0, end);
      let total = 0;
      let start = end;
      while (start >= 0) {
        const height = heightOf(chunks[start]);
        if (start < end && total + height > box.height) return start + 1;
        total += height;
        start -= 1;
      }
      return 0;
    },
    [box.height, chunks, heightOf]
  );

  const doneLines = useCallback(
    () => done.reduce((sum, index) => sum + (chunks[index]?.indexes.length ?? 0), 0),
    [chunks, done]
  );

  // 计时要每秒走一下字，靠这个逼一次重绘
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setTick((previous) => previous + 1), 500);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    const head = chunks[from];
    if (!head) return;
    anchor.current = head.indexes[0];
    onVisit(head.indexes[0]);
  }, [chunks, from, onVisit]);

  // 换了段长，原来那个段号指的已经不是同一段，按抄到的那一句重新落位
  useEffect(() => {
    setFrom(positionOf(anchor.current));
    setTyped({});
    setDone([]);
    // 段号换了指的就不是同一段，量过的高度也一起作废
    setTextHeight({});
  }, [positionOf]);

  useEffect(() => () => onStop(), [onStop]);

  const elapsed = session ? (Date.now() - session.startAt) / 1000 : 0;
  const live = session
    ? {
        chars: session.typed - session.errors,
        accuracy: accuracyOf({ chars: session.typed - session.errors, typed: session.typed }),
        speed: speedOf({ chars: session.typed - session.errors, seconds: elapsed })
      }
    : null;

  /**
   * 这一屏的账结掉。翻屏是悄悄记一笔，抄满一屏才弹成绩单——
   * 每翻一下都糊一张成绩单在脸上，翻着看两眼都嫌烦。
   */
  const flush = useCallback(
    (show: boolean) => {
      const lines = doneLines();
      if (session && lines > 0) {
        const record: CopyRecord = {
          at: Date.now(),
          from: session.from,
          count: lines,
          chars: session.typed - session.errors,
          typed: session.typed,
          seconds: (Date.now() - session.startAt) / 1000
        };
        onFinishRound(record);
        if (show) setResult(record);
      }
      setSession(null);
      setDone([]);
      setTyped({});
    },
    [doneLines, onFinishRound, session]
  );

  /**
   * 半路退出去别把这一屏白扔了。
   * 引用挂在 ref 上：卸载时组件的那份 state 已经是旧的，读不到最后几段的账。
   */
  const bail = useRef<() => void>(() => undefined);
  bail.current = () => flush(false);
  useEffect(() => () => bail.current(), []);

  // 一屏都抄完了就出成绩单
  useEffect(() => {
    if (!batch.length || done.length < batch.length) return;
    flush(true);
  }, [batch.length, done.length, flush]);

  const turnTo = useCallback(
    (next: number) => {
      flush(false);
      setFrom(Math.min(Math.max(next, 0), chunks.length - 1));
    },
    [chunks.length, flush]
  );

  /** 这一段算过了：记上账，把光标挪到下一段还没抄的那个框 */
  const settle = useCallback(
    (index: number) => {
      setDone((previous) => (previous.includes(index) ? previous : [...previous, index]));
      const next = batch.find((i) => i > index && !done.includes(i));
      if (next != null) inputs.current[next]?.focus();
    },
    [batch, done]
  );

  const onType = useCallback(
    (index: number, raw: string) => {
      const chunk = chunks[index];
      if (!chunk) return;
      /**
       * 多行输入框里回车本来是换行，可原文里没有换行，敲进去只会算成错字。
       * 拿它当交卷键：这一段到此为止，光标挪到下一段。
       */
      const submit = raw.includes('\n');
      const next = submit ? raw.replace(/\n/g, '') : raw;
      const before = typed[index] ?? '';

      // 第一个字母落下才开表，别让"准备一下"的时间也算进成绩
      const active: Session = session ?? {
        startAt: Date.now(),
        from: chunks[batch[0]]?.indexes[0] ?? chunk.indexes[0],
        typed: 0,
        errors: 0
      };
      const delta = countNewErrors(chunk.text, before, next);
      setSession({ ...active, typed: active.typed + delta.typed, errors: active.errors + delta.errors });
      setTyped((previous) => ({ ...previous, [index]: next }));

      // 一字不差地敲完就自动跳下一段，手不用离开键盘。
      // 敲错了不自动走——留着让人退回去改，改完照样算刚才那笔错账
      if (submit || next === chunk.text) settle(index);
    },
    [batch, chunks, session, settle, typed]
  );

  if (!chunks.length) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Head title={title} onClose={onClose} onSwitchToDictation={onSwitchToDictation} />
        <Text style={styles.empty}>还没有英文字幕，没有可以抄的句子。</Text>
      </View>
    );
  }

  const last = batch.length ? batch[batch.length - 1] : from;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Head
        title={title}
        onClose={onClose}
        onSwitchToDictation={onSwitchToDictation}
        right={
          <TouchableOpacity onPress={() => setHistoryOpen(true)} hitSlop={8}>
            <Text style={styles.link}>抄写记录 {records.length ? `(${records.length})` : ''}</Text>
          </TouchableOpacity>
        }
      />

      {/* 计时和正确率一直摆在眼前，敲的时候才有个准头 */}
      <View style={styles.stats}>
        <Stat label="用时" value={session ? formatDuration(elapsed) : '未开始'} />
        <Stat label="正确率" value={live ? `${live.accuracy}%` : '—'} warn={!!live && live.accuracy < 90} />
        {/* 刚敲下头两个字就外推速度，会报出几千字每分的荒唐数字，等表走几秒再说 */}
        <Stat label="速度" value={live && elapsed >= 3 ? `${live.speed} 字/分` : '—'} />
        <Stat label="本屏" value={`${done.length} / ${batch.length} 段`} />
        <View style={styles.spacer} />
        <Chip
          label={`每段 ${chunkLines} 句`}
          onPress={() => setChunkLines(CHUNKS[(CHUNKS.indexOf(chunkLines) + 1) % CHUNKS.length])}
        />
        {session ? (
          <TouchableOpacity onPress={() => flush(true)} hitSlop={6}>
            <Text style={styles.link}>结束本屏</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (!width || !height) return;
          setBox((previous) =>
            Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
              ? previous
              : { width, height }
          );
        }}
      >
        {batch.map((index) => {
          const chunk = chunks[index];
          const value = typed[index] ?? '';
          const runs = toRuns(chunk.text, value);
          const head = chunk.indexes[0];
          const tail = chunk.indexes[chunk.indexes.length - 1];
          const finished = done.includes(index);

          return (
            <View key={index} style={[styles.card, finished && styles.cardDone]}>
              <View style={styles.cardHead}>
                <Text style={styles.no}>第 {index + 1} 段</Text>
                <Text style={styles.time}>{formatTime(chunk.start)}</Text>
                <Text style={styles.chars}>
                  {chunk.indexes.length} 句 · {chunk.text.length} 字符
                </Text>
                <View style={styles.spacer} />
                {finished ? <Text style={styles.doneMark}>✓ 抄完</Text> : null}
                {/* 抄写不藏原文，但听一遍更容易连着音一起记住 */}
                {onPlayOriginal ? (
                  <TouchableOpacity onPress={() => onPlayOriginal(head, tail)} hitSlop={6}>
                    <Text style={styles.play}>▶ 原声</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => onPlaySynth(head, tail)} hitSlop={6}>
                  <Text style={styles.play}>跟读</Text>
                </TouchableOpacity>
              </View>

              {/*
               * 原文和输入框上下贴着，字号、字间距、左内边距全一样：
               * 敲到第几个字，眼睛往上一抬就是原文的同一列。
               * 敲到哪就绿到哪，敲错的当场标红——这是抄写最要紧的那点反馈。
               */}
              <Text
                style={styles.target}
                onLayout={(event) => {
                  const height = Math.round(event.nativeEvent.layout.height);
                  if (!height) return;
                  setTextHeight((previous) =>
                    previous[index] === height ? previous : { ...previous, [index]: height }
                  );
                }}
              >
                {runs.map((run, i) => (
                  <Text key={i} style={styles[run.state]}>
                    {run.text}
                  </Text>
                ))}
              </Text>

              <TextInput
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                style={[styles.input, { height: (textHeight[index] ?? MONO.lineHeight) + INPUT_EXTRA }]}
                value={value}
                onChangeText={(text) => onType(index, text)}
                placeholder="照着上面敲一遍"
                placeholderTextColor="#c3c8ce"
                multiline
                autoFocus={index === batch[0]}
                autoCorrect={false}
                autoCapitalize="none"
                // 浏览器的拼写红波浪线会替你把错处指出来，那就练不到眼力了
                spellCheck={false}
              />

              {chunk.zh ? (
                <Text style={styles.zh} numberOfLines={2}>
                  {chunk.zh}
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.pager, { paddingBottom: 10 + insets.bottom }]}>
        <TouchableOpacity onPress={() => turnTo(backFrom(from - 1))} hitSlop={6} disabled={from === 0}>
          <Text style={[styles.pageButton, from === 0 && styles.pageButtonOff]}>‹ 上一屏</Text>
        </TouchableOpacity>
        <Text style={styles.pageLabel}>
          第 {from + 1} - {last + 1} / {chunks.length} 段
        </Text>
        <TouchableOpacity
          onPress={() => turnTo(last + 1)}
          hitSlop={6}
          disabled={last >= chunks.length - 1}
        >
          <Text style={[styles.pageButton, last >= chunks.length - 1 && styles.pageButtonOff]}>下一屏 ›</Text>
        </TouchableOpacity>
        <View style={styles.spacer} />
        <Text style={styles.tip}>一字不差敲完自动跳下一段；没敲完想略过就按回车</Text>
      </View>

      {result ? (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>这一屏抄完了</Text>
            <View style={styles.resultRow}>
              <Big label="正确率" value={`${accuracyOf(result)}%`} />
              <Big label="速度" value={`${speedOf(result)}`} unit="字/分" />
              <Big label="用时" value={formatDuration(result.seconds)} />
            </View>
            <Text style={styles.resultNote}>
              抄了 {result.count} 句 · 敲对 {result.chars} / {result.typed} 个字符
            </Text>
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.ghostButton} onPress={() => setHistoryOpen(true)} activeOpacity={0.8}>
                <Text style={styles.ghostText}>看记录</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostButton} onPress={() => setResult(null)} activeOpacity={0.8}>
                <Text style={styles.ghostText}>再抄一遍</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => {
                  setResult(null);
                  turnTo(last + 1);
                }}
                activeOpacity={0.8}
                disabled={last >= chunks.length - 1}
              >
                <Text style={styles.primaryText}>下一屏 →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {historyOpen ? (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>抄写记录</Text>
              <View style={styles.spacer} />
              {records.length ? (
                <TouchableOpacity onPress={onClearRecords} hitSlop={6}>
                  <Text style={styles.clear}>清空</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => setHistoryOpen(false)} hitSlop={8}>
                <Text style={styles.link}>关闭</Text>
              </TouchableOpacity>
            </View>

            {records.length ? (
              <ScrollView style={styles.historyList}>
                {records.map((entry) => (
                  <View key={entry.at} style={styles.historyRow}>
                    <Text style={styles.historyWhen}>{formatWhen(entry.at)}</Text>
                    <Text style={styles.historyCount}>{entry.count} 句</Text>
                    <View style={styles.spacer} />
                    <Text style={[styles.historyAccuracy, accuracyOf(entry) < 90 && styles.historyAccuracyLow]}>
                      {accuracyOf(entry)}%
                    </Text>
                    <Text style={styles.historyMeta}>{speedOf(entry)} 字/分</Text>
                    <Text style={styles.historyMeta}>{formatDuration(entry.seconds)}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.empty}>还没抄过。抄完一屏，成绩会记在这儿，只留最近 30 条。</Text>
            )}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Head({
  title,
  onClose,
  onSwitchToDictation,
  right
}: {
  title: string;
  onClose: () => void;
  onSwitchToDictation: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.head}>
      <TouchableOpacity onPress={onClose} hitSlop={8}>
        <Text style={styles.back}>← 返回</Text>
      </TouchableOpacity>
      <View style={styles.tabs}>
        <Chip label="听写" onPress={onSwitchToDictation} />
        <Chip label="抄写" on onPress={() => undefined} />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, warn && styles.statWarn]}>{value}</Text>
    </View>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.big}>
      <Text style={styles.bigValue}>{value}</Text>
      <Text style={styles.bigLabel}>
        {label}
        {unit ? ` (${unit})` : ''}
      </Text>
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
  link: {
    fontSize: 13,
    color: '#2f80ed'
  },
  clear: {
    fontSize: 13,
    color: '#b0483f'
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f5'
  },
  stat: {
    minWidth: 62
  },
  statLabel: {
    fontSize: 11,
    color: '#9aa0a8'
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2b2b2b'
  },
  statWarn: {
    color: '#b0483f'
  },
  spacer: {
    flex: 1
  },
  list: {
    flex: 1
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  card: {
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eceff3'
  },
  cardDone: {
    borderColor: '#cfe4d6',
    backgroundColor: '#fbfefc'
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4
  },
  no: {
    fontSize: 12,
    fontWeight: '700',
    color: '#444'
  },
  time: {
    fontSize: 12,
    color: '#a0a5ac'
  },
  chars: {
    fontSize: 12,
    color: '#a0a5ac'
  },
  doneMark: {
    fontSize: 12,
    color: '#2f7a48',
    fontWeight: '600'
  },
  play: {
    fontSize: 12,
    color: '#2f80ed'
  },
  target: {
    ...MONO,
    paddingHorizontal: 13,
    color: '#9aa0a8'
  },
  ok: {
    color: '#2f7a48'
  },
  bad: {
    color: '#b0483f',
    backgroundColor: '#fdeceb'
  },
  todo: {
    color: '#9aa0a8'
  },
  zh: {
    marginTop: 4,
    fontSize: 12,
    color: '#a8adb4',
    lineHeight: 18
  },
  input: {
    ...MONO,
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dbe0e6',
    backgroundColor: '#fbfcfd',
    color: '#1a1a1a',
    textAlignVertical: 'top'
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e9ecf0'
  },
  pageButton: {
    fontSize: 13,
    color: '#2f80ed'
  },
  pageButtonOff: {
    color: '#c6cbd2'
  },
  pageLabel: {
    fontSize: 12,
    color: '#666'
  },
  tip: {
    fontSize: 11,
    color: '#aaa'
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,24,30,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '80%',
    gap: 14,
    padding: 20,
    borderRadius: 14,
    backgroundColor: '#fff'
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2b2b2b'
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  resultRow: {
    flexDirection: 'row',
    gap: 24
  },
  big: {
    alignItems: 'flex-start'
  },
  bigValue: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2f80ed'
  },
  bigLabel: {
    fontSize: 12,
    color: '#8a8f97'
  },
  resultNote: {
    fontSize: 13,
    color: '#666'
  },
  historyList: {
    maxHeight: 360
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f5'
  },
  historyWhen: {
    fontSize: 12,
    color: '#666',
    minWidth: 76
  },
  historyCount: {
    fontSize: 12,
    color: '#999'
  },
  historyAccuracy: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2f7a48',
    minWidth: 46,
    textAlign: 'right'
  },
  historyAccuracyLow: {
    color: '#b0843f'
  },
  historyMeta: {
    fontSize: 12,
    color: '#999',
    minWidth: 62,
    textAlign: 'right'
  }
});
