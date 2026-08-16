import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { CachedSubtitleMeta } from '../lib/subtitleCache';

type Props = {
  entries: CachedSubtitleMeta[];
  activeKey?: string;
  onLoad: (entry: CachedSubtitleMeta) => void;
  onRemove: (entry: CachedSubtitleMeta) => void;
};

function describeTime(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(timestamp).toLocaleDateString();
}

export function RecentSubtitles({ entries, activeKey, onLoad, onRemove }: Props) {
  if (!entries.length) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>已下载的字幕</Text>
      <Text style={styles.hint}>按视频文件名保存在本机，选到同一个视频会自动套用，不必重新搜索。</Text>

      {entries.map((entry) => {
        const active = entry.key === activeKey;
        return (
          <View key={entry.key} style={[styles.row, active && styles.rowActive]}>
            <TouchableOpacity style={styles.rowMain} onPress={() => onLoad(entry)} activeOpacity={0.7}>
              <Text style={[styles.name, active && styles.nameActive]} numberOfLines={1}>
                {entry.key}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {entry.count} 句 · {describeTime(entry.savedAt)}
                {entry.location === 'movie' ? ' · 存在视频旁边' : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRemove(entry)} hitSlop={8}>
              <Text style={styles.remove}>删除</Text>
            </TouchableOpacity>
          </View>
        );
      })}
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
    marginBottom: 6
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
    marginBottom: 10
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: '#eef1f5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    backgroundColor: '#fbfcfd'
  },
  rowActive: {
    borderColor: '#2f80ed',
    backgroundColor: '#eef4ff'
  },
  rowMain: {
    flex: 1
  },
  name: {
    fontSize: 13,
    color: '#222'
  },
  nameActive: {
    fontWeight: '600'
  },
  meta: {
    marginTop: 3,
    fontSize: 11,
    color: '#888'
  },
  remove: {
    fontSize: 12,
    color: '#c0392b'
  }
});
