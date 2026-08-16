import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Props = {
  initialVideoUrl: string;
  videoLabel: string;
  subtitleLabel: string;
  status: string | null;
  canUseBundled: boolean;
  onLoadVideoUrl: (url: string) => void;
  onPickVideo: () => void;
  onUseBundled: () => void;
  onLoadSubtitleUrl: (url: string) => void;
  onPickSubtitle: () => void;
  onLoadSample: () => void;
  onClearSubtitle: () => void;
};

function ActionButton({ label, onPress, tone }: { label: string; onPress: () => void; tone?: 'primary' }) {
  return (
    <TouchableOpacity
      style={[styles.button, tone === 'primary' && styles.buttonPrimary]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.buttonText, tone === 'primary' && styles.buttonTextPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SourcePanel({
  initialVideoUrl,
  videoLabel,
  subtitleLabel,
  status,
  canUseBundled,
  onLoadVideoUrl,
  onPickVideo,
  onUseBundled,
  onLoadSubtitleUrl,
  onPickSubtitle,
  onLoadSample,
  onClearSubtitle
}: Props) {
  const [videoUrl, setVideoUrl] = useState(initialVideoUrl);
  const [subtitleUrl, setSubtitleUrl] = useState('');

  // 手动填地址是少数情况，默认折起来，先让人看见「选片」这一步
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>第一步：选一个视频</Text>
      <View style={styles.buttonRow}>
        <ActionButton label="选择本地视频" onPress={onPickVideo} tone="primary" />
        <ActionButton label="示例视频与字幕" onPress={onLoadSample} />
        {canUseBundled ? <ActionButton label="使用内置视频" onPress={onUseBundled} /> : null}
      </View>
      <Text style={styles.meta}>
        当前视频：{videoLabel} · 字幕：{subtitleLabel}
      </Text>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <View style={styles.divider} />

      <TouchableOpacity style={styles.foldHead} onPress={() => setAdvancedOpen((open) => !open)} activeOpacity={0.7}>
        <Text style={styles.foldTitle}>手动填地址 / 字幕文件</Text>
        <Text style={styles.foldMark}>{advancedOpen ? '收起' : '展开'}</Text>
      </TouchableOpacity>

      {advancedOpen ? (
        <View style={styles.foldBody}>
          <Text style={styles.fieldLabel}>视频地址</Text>
          <TextInput
            style={styles.input}
            value={videoUrl}
            onChangeText={setVideoUrl}
            placeholder="粘贴视频地址（http/https）"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.buttonRow}>
            <ActionButton label="加载网址" onPress={() => onLoadVideoUrl(videoUrl.trim())} />
          </View>

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>字幕</Text>
          <TextInput
            style={styles.input}
            value={subtitleUrl}
            onChangeText={setSubtitleUrl}
            placeholder="字幕地址（srt / vtt / ass）"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.buttonRow}>
            <ActionButton label="加载字幕网址" onPress={() => onLoadSubtitleUrl(subtitleUrl.trim())} />
            <ActionButton label="选择字幕文件" onPress={onPickSubtitle} />
            <ActionButton label="清除字幕" onPress={onClearSubtitle} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#fafafa'
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#eef1f5'
  },
  buttonPrimary: {
    backgroundColor: '#2f80ed'
  },
  buttonText: {
    fontSize: 13,
    color: '#333'
  },
  buttonTextPrimary: {
    color: '#fff',
    fontWeight: '600'
  },
  meta: {
    marginTop: 8,
    fontSize: 12,
    color: '#888'
  },
  divider: {
    height: 1,
    backgroundColor: '#eef1f5',
    marginVertical: 16
  },
  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  foldTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555'
  },
  foldMark: {
    fontSize: 12,
    color: '#2f80ed'
  },
  foldBody: {
    marginTop: 12
  },
  fieldLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6
  },
  fieldLabelSpaced: {
    marginTop: 16
  },
  status: {
    marginTop: 10,
    fontSize: 12,
    color: '#c0392b'
  }
});
