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
  onBackToLibrary: () => void;
  onOpenAccount: () => void;
  userName: string;
  /** 窄屏。六样东西挤一行会把最右边的账号顶出屏幕，得换个排法 */
  compact?: boolean;
};

export function TopBar({
  videoLabel,
  subtitleLabel,
  settingsOpen,
  onToggleSettings,
  favoriteCount,
  noteCount,
  onOpenFavorites,
  onOpenNotes,
  onBackToLibrary,
  onOpenAccount,
  userName,
  compact
}: Props) {
  /**
   * 片名和字幕名单独占一行。
   *
   * 字幕文件名动辄「Source.Code.2011.720p.BRRip.x264.AAC-ViSiON.srt + ...」这么长，
   * 和按钮挤在一行里，要么把按钮顶出屏幕，要么被压成两个字，两头都不讨好。
   */
  const meta = (
    <View style={[styles.meta, compact && styles.metaOwnLine]}>
      <Text style={styles.metaText} numberOfLines={1}>
        {videoLabel}
      </Text>
      <Text style={styles.metaDivider}>·</Text>
      <Text style={styles.metaText} numberOfLines={1}>
        字幕 {subtitleLabel}
      </Text>
    </View>
  );

  return (
    <View style={[styles.bar, compact && styles.barCompact]}>
      <TouchableOpacity style={styles.back} onPress={onBackToLibrary} activeOpacity={0.7}>
        <Text style={styles.backText}>{compact ? '‹ 列表' : '‹ 学习列表'}</Text>
      </TouchableOpacity>

      {compact ? null : meta}

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
        <Text style={[styles.actionText, settingsOpen && styles.actionTextActive]}>
          {compact ? '字幕' : '视频与字幕'}
        </Text>
      </TouchableOpacity>

      {/* 用户名以前只是块文字，退出登录得先退回学习列表才找得到 */}
      <TouchableOpacity style={styles.action} onPress={onOpenAccount} activeOpacity={0.7}>
        <Text style={styles.user} numberOfLines={1}>
          {userName}
        </Text>
      </TouchableOpacity>

      {compact ? meta : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecf0'
  },
  barCompact: {
    columnGap: 8,
    paddingHorizontal: 10
  },
  back: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#eef1f5'
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2f80ed'
  },
  user: {
    fontSize: 13,
    color: '#333',
    maxWidth: 120
  },
  meta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0
  },
  metaOwnLine: {
    // 占满一行把自己挤到下一排去，按钮那排就不会被这串长文件名撑破
    flexBasis: '100%'
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
