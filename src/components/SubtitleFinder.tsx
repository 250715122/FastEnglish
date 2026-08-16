import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { SubtitleCandidate } from '../lib/subtitleSearch/openSubtitles';

export type FinderState = {
  status: 'idle' | 'searching' | 'ready' | 'empty' | 'error';
  /** 从视频文件名猜出来的片名，猜错了用户可以当场改 */
  title: string;
  english: SubtitleCandidate[];
  chinese: SubtitleCandidate[];
  canonicalTitle: string | null;
  message?: string;
};

type Props = {
  state: FinderState;
  busy: boolean;
  onRetry: (title: string) => void;
  onDownload: (english: SubtitleCandidate | null, chinese: SubtitleCandidate | null) => void;
};

function describe(candidate: SubtitleCandidate): string {
  const parts = [candidate.title];
  if (candidate.year) parts.push(`（${candidate.year}）`);
  return parts.join('');
}

/**
 * 选完视频就该有字幕可用，而不是把一堆不相干的历史记录摆出来让人猜。
 * 片名本来就写在文件名里，这里自动拿它去搜，搜到什么直接摆出来一键用。
 */
export function SubtitleFinder({ state, busy, onRetry, onDownload }: Props) {
  const [draft, setDraft] = useState(state.title);
  const [editing, setEditing] = useState(false);

  // 换了视频要跟着换片名，但用户正在改的时候别打断他
  useEffect(() => {
    if (!editing) setDraft(state.title);
  }, [editing, state.title]);

  const best = { english: state.english[0] ?? null, chinese: state.chinese[0] ?? null };
  const usable = Boolean(best.english || best.chinese);

  const renameRow = (
    <View style={styles.renameRow}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        placeholder="片名，英文原名命中率更高"
        placeholderTextColor="#999"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={() => onRetry(draft.trim())}
      />
      <TouchableOpacity
        style={[styles.ghostButton, !draft.trim() && styles.buttonDisabled]}
        onPress={() => onRetry(draft.trim())}
        disabled={!draft.trim() || state.status === 'searching'}
        activeOpacity={0.7}
      >
        <Text style={styles.ghostText}>换片名重搜</Text>
      </TouchableOpacity>
    </View>
  );

  if (state.status === 'searching') {
    return (
      <View style={styles.card}>
        <View style={styles.headRow}>
          <ActivityIndicator size="small" color="#2f80ed" />
          <Text style={styles.headText}>正在为《{state.title}》找字幕…</Text>
        </View>
      </View>
    );
  }

  if (state.status === 'idle') {
    return (
      <View style={styles.card}>
        <Text style={styles.headText}>这个视频还没有字幕</Text>
        <Text style={styles.hint}>从网址加载的视频猜不出片名，填一个搜搜看。</Text>
        {renameRow}
      </View>
    );
  }

  if (!usable) {
    return (
      <View style={styles.card}>
        <Text style={styles.headText}>没找到《{state.title}》的字幕</Text>
        <Text style={styles.hint}>
          {state.message || '换个写法试试，用英文原名命中率最高，例如「Van Helsing」。'}
        </Text>
        {renameRow}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.headText}>
        为《{state.canonicalTitle || state.title}》找到了字幕
      </Text>

      <View style={styles.foundRow}>
        {best.english ? (
          <Text style={styles.foundLine} numberOfLines={1}>
            英文 · {describe(best.english)} · {best.english.release}
          </Text>
        ) : (
          <Text style={styles.missingLine}>没有找到英文字幕</Text>
        )}
        {best.chinese ? (
          <Text style={styles.foundLine} numberOfLines={1}>
            中文 · {describe(best.chinese)} · {best.chinese.release}
          </Text>
        ) : (
          <Text style={styles.missingLine}>没有找到中文字幕</Text>
        )}
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, busy && styles.buttonDisabled]}
        onPress={() => onDownload(best.english, best.chinese)}
        disabled={busy}
        activeOpacity={0.8}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.primaryText}>
            {best.english && best.chinese ? '下载并用这份双语字幕' : '下载并使用'}
          </Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>
        不是这部片？改片名重搜，或点右上角「视频与字幕」自己挑一份。
      </Text>
      {renameRow}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    gap: 8
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  headText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333'
  },
  hint: {
    fontSize: 12,
    color: '#999',
    lineHeight: 18
  },
  foundRow: {
    gap: 4,
    paddingVertical: 2
  },
  foundLine: {
    fontSize: 12,
    color: '#555'
  },
  missingLine: {
    fontSize: 12,
    color: '#b0483f'
  },
  primaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#2f80ed',
    minWidth: 160,
    alignItems: 'center'
  },
  primaryText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600'
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111',
    backgroundColor: '#fafafa'
  },
  ghostButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: '#eef1f5'
  },
  ghostText: {
    fontSize: 13,
    color: '#333'
  },
  buttonDisabled: {
    opacity: 0.5
  }
});
