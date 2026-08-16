import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  videoLabel: string;
  subtitleLabel: string;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  favoriteCount: number;
  noteCount: number;
  onOpenFavorites: () => void;
  onOpenNotes: () => void;
};

export function TopBar({
  videoLabel,
  subtitleLabel,
  settingsOpen,
  onToggleSettings,
  favoriteCount,
  noteCount,
  onOpenFavorites,
  onOpenNotes
}: Props) {
  return (
    <View style={styles.bar}>
      <Text style={styles.brand}>FastEnglish</Text>

      <View style={styles.meta}>
        <Text style={styles.metaText} numberOfLines={1}>
          {videoLabel}
        </Text>
        <Text style={styles.metaDivider}>·</Text>
        <Text style={styles.metaText} numberOfLines={1}>
          字幕 {subtitleLabel}
        </Text>
      </View>

      <TouchableOpacity style={styles.action} onPress={onOpenFavorites} activeOpacity={0.7}>
        <Text style={styles.actionText}>★ 收藏{favoriteCount ? ` ${favoriteCount}` : ''}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.action} onPress={onOpenNotes} activeOpacity={0.7}>
        <Text style={styles.actionText}>✎ 注释{noteCount ? ` ${noteCount}` : ''}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.action, settingsOpen && styles.actionActive]}
        onPress={onToggleSettings}
        activeOpacity={0.7}
      >
        <Text style={[styles.actionText, settingsOpen && styles.actionTextActive]}>视频与字幕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecf0'
  },
  brand: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222'
  },
  meta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0
  },
  metaText: {
    fontSize: 12,
    color: '#888',
    flexShrink: 1
  },
  metaDivider: {
    fontSize: 12,
    color: '#ccc'
  },
  action: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#eef1f5'
  },
  actionActive: {
    backgroundColor: '#2f80ed'
  },
  actionText: {
    fontSize: 13,
    color: '#333'
  },
  actionTextActive: {
    color: '#fff',
    fontWeight: '600'
  }
});
