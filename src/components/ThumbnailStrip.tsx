import * as VideoThumbnails from 'expo-video-thumbnails';
import React, { useCallback, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  videoUri: string;
  starts: number[];
  onSelect: (startSeconds: number) => void;
};

/**
 * 仅原生可用：expo-video-thumbnails 的 web 实现会直接抛错。
 * 缩略图按需生成，滚动到可视区才取帧。
 */
export function ThumbnailStrip({ videoUri, starts, onSelect }: Props) {
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  const ensureThumbnail = useCallback(
    async (startSeconds: number) => {
      if (!videoUri || thumbnails[startSeconds]) return;
      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: startSeconds * 1000 });
        setThumbnails((previous) => ({ ...previous, [startSeconds]: uri }));
      } catch {
        // 取帧失败（格式不支持、远端流不可随机读取）时保留占位块
      }
    },
    [thumbnails, videoUri]
  );

  return (
    <FlatList
      data={starts}
      keyExtractor={(item) => String(item)}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      onViewableItemsChanged={({ viewableItems }) => {
        viewableItems.forEach((entry) => ensureThumbnail(entry.item as number));
      }}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.item} onPress={() => onSelect(item)} activeOpacity={0.8}>
          {thumbnails[item] ? (
            <Image source={{ uri: thumbnails[item] }} style={styles.image} />
          ) : (
            <View style={[styles.image, styles.placeholder]} />
          )}
          <Text style={styles.label}>{Math.round(item)}s</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    paddingVertical: 4
  },
  item: {
    width: 120,
    gap: 6
  },
  image: {
    width: 120,
    height: 68,
    borderRadius: 6,
    backgroundColor: '#ddd'
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  label: {
    fontSize: 12,
    color: '#333',
    textAlign: 'center'
  }
});
