import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Segment } from '../types/subtitle';

type Props = {
  segment?: Segment;
  showChinese: boolean;
};

export function SubtitleOverlay({ segment, showChinese }: Props) {
  if (!segment) return null;

  return (
    <View style={styles.container}>
      {segment.en ? <Text style={styles.english}>{segment.en}</Text> : null}
      {showChinese && segment.zh ? <Text style={styles.chinese}>{segment.zh}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    // 浏览器原生控制条连同进度条大约占 48px，再留一截余量才不会压住时间轴
    bottom: 76,
    paddingHorizontal: 12,
    alignItems: 'center',
    // 字幕不拦截点击，播放器控件仍可正常操作
    pointerEvents: 'none'
  },
  english: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4
  },
  chinese: {
    marginTop: 4,
    color: '#f1f1f1',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4
  }
});
