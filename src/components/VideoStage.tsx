import { VideoView, type VideoPlayer } from 'expo-video';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AudioTrack } from '../hooks/useAudioTrack';
import type { Segment } from '../types/subtitle';
import { ListenStage } from './ListenStage';
import { SubtitleOverlay } from './SubtitleOverlay';

type Props = {
  player: VideoPlayer;
  hasSource: boolean;
  currentSegment?: Segment;
  showChinese: boolean;
  /** 听模式下不放画面，这块地方缩成一条台词卡，高度让给下面的台词列表 */
  listenMode: boolean;
  audio: AudioTrack;
  /** 换个地址把音轨重挂一遍，只有听模式用得上，见 ListenStage */
  onReloadAudio: () => void;
  onExitListen: () => void;
};

/** 只负责画面和字幕层，播放控制在 PlaybackBar，这样画面能占满剩余空间。 */
export function VideoStage({
  player,
  hasSource,
  currentSegment,
  showChinese,
  listenMode,
  audio,
  onReloadAudio,
  onExitListen
}: Props) {
  if (listenMode) {
    return (
      <ListenStage
        player={player}
        segment={currentSegment}
        showChinese={showChinese}
        audio={audio}
        onReload={onReloadAudio}
        onExit={onExitListen}
      />
    );
  }

  return (
    <View style={styles.stage}>
      {hasSource ? (
        <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
      ) : (
        <View style={[styles.video, styles.placeholder]}>
          <Text style={styles.placeholderTitle}>还没有选择视频</Text>
          <Text style={styles.placeholderText}>点右上角「视频与字幕」，选一个本地视频或粘贴网址</Text>
        </View>
      )}
      <SubtitleOverlay segment={currentSegment} showChinese={showChinese} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    minHeight: 220,
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden'
  },
  video: {
    flex: 1,
    // video 元素有固有比例，不给 minHeight:0 它撑不回容器高度，画面和播放控件会被裁掉
    minHeight: 0,
    width: '100%',
    backgroundColor: '#000'
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  placeholderTitle: {
    color: '#eee',
    fontSize: 15,
    fontWeight: '600'
  },
  placeholderText: {
    color: '#888',
    fontSize: 13
  }
});
