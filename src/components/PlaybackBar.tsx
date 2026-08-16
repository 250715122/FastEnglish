import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  onPrevious: () => void;
  onNext: () => void;
  onRepeat: () => void;
  loopMode: 'sentence' | 'range' | null;
  /** 圈定后的段首段尾，点一下能跳过去确认范围；只设了段首时 end 为 null */
  loopRange: { startLabel: string; endLabel: string | null; count: number } | null;
  onToggleLoop: () => void;
  onMarkLoopStart: () => void;
  onMarkLoopEnd: () => void;
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
  loopMode,
  loopRange,
  onToggleLoop,
  onMarkLoopStart,
  onMarkLoopEnd,
  onClearLoop,
  onReplayLoop,
  onJumpToLoopStart,
  onJumpToLoopEnd,
  showChinese,
  onToggleChinese,
  offset,
  onOffsetChange,
  hasSegments,
  hasCurrent
}: Props) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.bar}>
      <View style={styles.group}>
        <Button label="上一句" hint="←" onPress={onPrevious} disabled={!hasSegments} />
        <Button label="跟读" hint="R" onPress={onRepeat} disabled={!hasCurrent} primary />
        <Button label="下一句" hint="→" onPress={onNext} disabled={!hasSegments} />
      </View>

      <View style={styles.group}>
        <Button
          label="单句循环"
          hint="L"
          onPress={onToggleLoop}
          active={loopMode === 'sentence'}
          disabled={!hasSegments}
        />
        <Button label="段首" hint="[" onPress={onMarkLoopStart} active={loopMode === 'range'} disabled={!hasSegments} />
        <Button label="段尾" hint="]" onPress={onMarkLoopEnd} active={loopMode === 'range'} disabled={!hasSegments} />
        <Button label={showChinese ? '中文 开' : '中文 关'} hint="C" onPress={onToggleChinese} active={showChinese} />
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
                <Text style={styles.loopHint}>播到结尾处按 ] 圈定</Text>
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
  }
});
