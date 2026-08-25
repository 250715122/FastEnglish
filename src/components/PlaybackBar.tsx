import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Select } from './Select';

type Props = {
  onPrevious: () => void;
  onNext: () => void;
  onRepeat: () => void;
  /** 念一句台词时用片子自己的声音还是合成音 */
  voice: 'original' | 'synth';
  onSelectVoice: (voice: 'original' | 'synth') => void;
  /** 没选片源时原声无从谈起，开关照常能点，但要说明为什么听到的是合成音 */
  voiceAvailable: boolean;
  /** 合成音的语速，原片的播放速度不受它影响 */
  synthRate: number;
  onCycleSynthRate: () => void;
  /** 合成音档下按播放键会逐句念下去，念着的时候要给一条看得见的退路 */
  reading: boolean;
  onStopReading: () => void;
  loopMode: 'sentence' | 'range' | null;
  /** 圈定后的段首段尾，点一下能跳过去确认范围；只设了段首时 end 为 null */
  loopRange: { startLabel: string; endLabel: string | null; count: number } | null;
  onToggleLoop: () => void;
  onClearLoop: () => void;
  onReplayLoop: () => void;
  onJumpToLoopStart: () => void;
  onJumpToLoopEnd: () => void;
  showChinese: boolean;
  onToggleChinese: () => void;
  offset: number;
  onOffsetChange: (delta: number) => void;
  hasSegments: boolean;
  hasCurrent: boolean;
  listenMode: boolean;
  /** 后端在局域网外面：默认就落在听模式，下拉里要说清楚为什么 */
  remote: boolean;
  /** null 表示这个片源抽不了音轨（本机选的文件、粘的网址），听模式要禁用 */
  onSelectListen: ((listen: boolean) => void) | null;
  onOpenReader: () => void;
  onOpenDictation: () => void;
};

function Button({
  label,
  hint,
  onPress,
  disabled,
  active,
  primary
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        primary && styles.buttonPrimary,
        active && styles.buttonActive,
        disabled && styles.buttonDisabled
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.buttonText,
          primary && styles.buttonTextPrimary,
          active && styles.buttonTextActive,
          disabled && styles.buttonTextDisabled
        ]}
      >
        {label}
      </Text>
      {hint && Platform.OS === 'web' ? <Text style={[styles.hint, disabled && styles.hintDisabled]}>{hint}</Text> : null}
    </TouchableOpacity>
  );
}

export function PlaybackBar({
  onPrevious,
  onNext,
  onRepeat,
  voice,
  onSelectVoice,
  voiceAvailable,
  synthRate,
  onCycleSynthRate,
  reading,
  onStopReading,
  loopMode,
  loopRange,
  onToggleLoop,
  onClearLoop,
  onReplayLoop,
  onJumpToLoopStart,
  onJumpToLoopEnd,
  showChinese,
  onToggleChinese,
  offset,
  onOffsetChange,
  hasSegments,
  hasCurrent,
  listenMode,
  remote,
  onSelectListen,
  onOpenReader,
  onOpenDictation
}: Props) {
  // 原声要有片源，没有的时候开关还是原声档，但实际发出来的是合成音，得挑明
  const fallenBack = voice === 'original' && !voiceAvailable;

  return (
    <View style={styles.wrapper}>
      <View style={styles.bar}>
      <View style={styles.group}>
        <Button label="上一句" hint="←" onPress={onPrevious} disabled={!hasSegments} />
        {/* 一律是合成音念给你听。原声重听没丢：原声档下双击那一行就从这句开始放原片 */}
        <Button label="跟读" hint="R" onPress={onRepeat} disabled={!hasCurrent} primary />
        <Button label="下一句" hint="→" onPress={onNext} disabled={!hasSegments} />
      </View>

      {/* 管的是双击台词、上/下一句和收藏连播用谁的声音：片子里的真人语调，还是能压慢、吐字清楚的合成音 */}
      <View style={styles.group}>
        <Text style={styles.offsetLabel}>发音</Text>
        <Select
          value={voice}
          onChange={onSelectVoice}
          options={[
            { value: 'original', label: '原声', hint: voiceAvailable ? '片中真人语调' : '未选片源' },
            { value: 'synth', label: '合成音', hint: '吐字清楚，能压慢' }
          ]}
        />
        {/* 原片是几倍速就几倍速，能调的只有合成音，所以原声档下没这个按钮 */}
        {voice === 'synth' ? <Button label={`语速 ${synthRate}x`} onPress={onCycleSynthRate} /> : null}
        {reading ? (
          <Button label="■ 停止朗读" onPress={onStopReading} active />
        ) : voice === 'synth' && hasSegments ? (
          <Text style={styles.voiceNote}>按播放键从选中处逐句念</Text>
        ) : null}
        {fallenBack ? <Text style={styles.voiceNote}>未选片源，暂用合成音</Text> : null}
      </View>

      <View style={styles.group}>
        <Button
          label="单句循环"
          hint="L"
          onPress={onToggleLoop}
          active={loopMode === 'sentence'}
          disabled={!hasSegments}
        />
        {/* 段首段尾只留在台词行上：圈一段总要先找到那两句，在行上点比来回跑到这儿快得多 */}
        <Button label={showChinese ? '中文 开' : '中文 关'} hint="C" onPress={onToggleChinese} active={showChinese} />
      </View>

      {/*
        四种用法收在一个下拉里：看和听是原地换个放法，读和写会盖上来占满整屏。
        虽然行为不一样，但对着用户脑子里的那句「我现在想干什么」，它们是同一组选择。
      */}
      <View style={styles.group}>
        <Text style={styles.offsetLabel}>模式</Text>
        <Select
          value={listenMode ? 'listen' : 'watch'}
          onChange={(next) => {
            if (next === 'watch') onSelectListen?.(false);
            else if (next === 'listen') onSelectListen?.(true);
            else if (next === 'read') onOpenReader();
            else onOpenDictation();
          }}
          options={[
            {
              value: 'watch',
              label: '看模式',
              // 在外网点这个是要真金白银的流量，先把代价摆出来
              hint: remote ? '画面 + 台词，一小时 2 GB' : '画面 + 台词'
            },
            {
              value: 'listen',
              label: '听模式',
              hint: !onSelectListen ? '需片库里的片子' : remote ? '只放音轨，一小时 29 MB' : '只放音轨',
              disabled: !onSelectListen
            },
            { value: 'read', label: '读模式', hint: hasSegments ? '台词排成文章' : '需要字幕', disabled: !hasSegments },
            { value: 'write', label: '写模式', hint: hasSegments ? '逐句默写' : '需要字幕', disabled: !hasSegments }
          ]}
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.offsetLabel}>字幕快慢</Text>
        {/* 不同压制版本的片头长度能差出好几秒，只有 0.25s 一档要点几十次 */}
        <Button label="-1s" onPress={() => onOffsetChange(-1)} disabled={!hasSegments} />
        <Button label="-0.25s" onPress={() => onOffsetChange(-0.25)} disabled={!hasSegments} />
        <Text style={styles.offsetValue}>{offset > 0 ? `+${offset.toFixed(2)}` : offset.toFixed(2)}s</Text>
        <Button label="+0.25s" onPress={() => onOffsetChange(0.25)} disabled={!hasSegments} />
        <Button label="+1s" onPress={() => onOffsetChange(1)} disabled={!hasSegments} />
      </View>
      </View>

      {/* 循环状态单独占一行，不跟按钮挤在一起，圈了哪一段一眼能看见 */}
      {loopRange ? (
        <View style={styles.loopChip}>
          {loopMode === 'sentence' ? (
            <Text style={styles.loopText}>单句循环 · {loopRange.startLabel}</Text>
          ) : (
            <View style={styles.loopRangeRow}>
              <Text style={styles.loopText}>循环</Text>
              <TouchableOpacity onPress={onJumpToLoopStart} hitSlop={6}>
                <Text style={styles.loopTime}>{loopRange.startLabel}</Text>
              </TouchableOpacity>
              {loopRange.endLabel ? (
                <>
                  <Text style={styles.loopText}>→</Text>
                  <TouchableOpacity onPress={onJumpToLoopEnd} hitSlop={6}>
                    <Text style={styles.loopTime}>{loopRange.endLabel}</Text>
                  </TouchableOpacity>
                  <Text style={styles.loopText}>共 {loopRange.count} 句</Text>
                </>
              ) : (
                <Text style={styles.loopHint}>在结尾那句上点「段尾」圈定</Text>
              )}
            </View>
          )}
          <View style={styles.loopActions}>
            {loopRange.endLabel || loopMode === 'sentence' ? (
              <TouchableOpacity onPress={onReplayLoop} hitSlop={6}>
                <Text style={styles.loopAction}>重播</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClearLoop} hitSlop={6}>
              <Text style={styles.loopClear}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
    paddingVertical: 10
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  button: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#eef1f5'
  },
  buttonPrimary: {
    backgroundColor: '#e4edff'
  },
  buttonActive: {
    backgroundColor: '#2f80ed'
  },
  buttonDisabled: {
    backgroundColor: '#f2f3f5'
  },
  buttonText: {
    fontSize: 13,
    color: '#333'
  },
  buttonTextPrimary: {
    color: '#2f80ed',
    fontWeight: '600'
  },
  buttonTextActive: {
    color: '#fff',
    fontWeight: '600'
  },
  buttonTextDisabled: {
    color: '#bbb'
  },
  hint: {
    fontSize: 10,
    color: '#9aa4b2'
  },
  hintDisabled: {
    color: '#d5d8dd'
  },
  loopChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#eaf7ee',
    borderLeftWidth: 3,
    borderLeftColor: '#3f9d63'
  },
  loopRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8
  },
  loopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  loopText: {
    fontSize: 12,
    color: '#2f7a48',
    fontWeight: '600'
  },
  loopTime: {
    fontSize: 12,
    color: '#1f6b3f',
    fontWeight: '700',
    textDecorationLine: 'underline'
  },
  loopHint: {
    fontSize: 12,
    color: '#6b8f78'
  },
  loopAction: {
    fontSize: 12,
    color: '#2f80ed'
  },
  loopClear: {
    fontSize: 12,
    color: '#b0483f'
  },
  offsetLabel: {
    fontSize: 12,
    color: '#888',
    marginRight: 2
  },
  offsetValue: {
    fontSize: 12,
    color: '#555',
    minWidth: 46,
    textAlign: 'center'
  },
  voiceNote: {
    fontSize: 11,
    color: '#b0843f'
  }
});
