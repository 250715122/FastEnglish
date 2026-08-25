import { VideoView, type VideoPlayer } from 'expo-video';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AudioTrack } from '../hooks/useAudioTrack';
import { usePlayerProbe } from '../hooks/usePlayerProbe';
import { formatTime } from '../lib/formatTime';
import type { Segment } from '../types/subtitle';

type Props = {
  player: VideoPlayer;
  segment?: Segment;
  showChinese: boolean;
  audio: AudioTrack;
  /** 换个地址把音轨重挂一遍。播放器卡住时自动重挂有次数上限，用完了只能靠人点 */
  onReload: () => void;
  onExit: () => void;
};

/**
 * 听模式下画面收起来，这块地方只留当前台词，省下的高度全给下面的台词列表。
 *
 * 保持加自定义播放按钮之前的原始结构：只有一条 54px 的 VideoView，
 * 播放控件完全交给 nativeControls。先用相同代码在 5G 下做严格对照。
 */
export function ListenStage({
  player,
  segment,
  showChinese,
  audio,
  onReload,
  onExit
}: Props) {
  const preparing = audio.state === 'building' || audio.state === 'queued';
  const ready = audio.state === 'ready';
  const probe = usePlayerProbe(player);

  return (
    <View style={styles.stage}>
      <View style={styles.head}>
        <Text style={styles.badge}>听模式</Text>
        {ready ? (
          <Text style={styles.note}>只传声音，约 {(audio.size / 1e6).toFixed(0)} MB</Text>
        ) : null}
        <View style={styles.spacer} />
        {segment ? <Text style={styles.time}>{formatTime(segment.start)}</Text> : null}
        <TouchableOpacity onPress={onExit} hitSlop={8}>
          <Text style={styles.exit}>看模式</Text>
        </TouchableOpacity>
      </View>

      {preparing ? (
        <View style={styles.body}>
          <Text style={styles.prepTitle}>正在把音轨抽出来 {(audio.progress * 100).toFixed(0)}%</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(2, audio.progress * 100)}%` }]} />
          </View>
          {/* 以前这段时间会先放着原片，外网上那是在跟音轨抢带宽，现在什么都不放 */}
          <Text style={styles.prepNote}>抽完会自动切过去。这期间不放东西，把带宽全留给音轨。</Text>
        </View>
      ) : audio.state === 'error' ? (
        <View style={styles.body}>
          <Text style={styles.errorTitle}>音轨没抽出来</Text>
          <Text style={styles.errorText} numberOfLines={2}>
            {audio.error || '未知原因'}
          </Text>
          <TouchableOpacity style={styles.retry} onPress={audio.prepare} activeOpacity={0.8}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.body}>
          {segment?.en ? (
            <Text style={styles.english}>{segment.en}</Text>
          ) : (
            <Text style={styles.idle}>播到有台词的地方，这里会显示当前句。</Text>
          )}
          {showChinese && segment?.zh ? <Text style={styles.chinese}>{segment.zh}</Text> : null}
        </View>
      )}

      <VideoView player={player} style={styles.controls} nativeControls contentFit="contain" />

      {/*
        播放器自己的状态。原声放不出来时，这一行是唯一能区分
        「在放但没声」和「压根没在放」的东西，服务端日志区分不了。
      */}
      {ready ? (
        <View style={styles.probe}>
          <View style={styles.probeRow}>
            <Text style={styles.probeText} numberOfLines={1}>
              {probe.status}
              {probe.playing ? ' · 播放中' : ' · 已暂停'}
              {probe.playing && !probe.advancing ? ' · 进度没动' : ''}
              {/* 卡在 loading 时全靠这个数：在涨就是还在缓冲，别急着重连 */}
              {probe.status === 'loading' ? ` · 缓冲${probe.buffered.toFixed(0)}s` : ''}
              {probe.muted ? ' · 静音' : ''}
              {probe.volume < 1 ? ` · 音量${probe.volume.toFixed(1)}` : ''}
            </Text>
            <View style={styles.spacer} />
            <TouchableOpacity onPress={onReload} hitSlop={10}>
              <Text style={styles.probeAction}>重连</Text>
            </TouchableOpacity>
          </View>
          {probe.error ? (
            <Text style={styles.probeError} numberOfLines={2}>
              {probe.error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    backgroundColor: '#12151a',
    borderRadius: 10,
    overflow: 'hidden',
    paddingTop: 10
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8fd0a8',
    backgroundColor: '#1d3326',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden'
  },
  note: {
    fontSize: 11,
    color: '#7f8794'
  },
  spacer: {
    flex: 1
  },
  time: {
    fontSize: 12,
    color: '#6f9fe0'
  },
  exit: {
    fontSize: 12,
    color: '#8ab4f8'
  },
  body: {
    minHeight: 78,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 6
  },
  english: {
    fontSize: 19,
    lineHeight: 27,
    color: '#fff',
    fontWeight: '600'
  },
  chinese: {
    fontSize: 14,
    lineHeight: 21,
    color: '#a8b0bd'
  },
  idle: {
    fontSize: 13,
    color: '#6b727e'
  },
  prepTitle: {
    fontSize: 14,
    color: '#e6e9ee',
    fontWeight: '600'
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2a3038',
    overflow: 'hidden'
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4c9f6a'
  },
  prepNote: {
    fontSize: 11,
    color: '#7f8794',
    lineHeight: 17
  },
  errorTitle: {
    fontSize: 14,
    color: '#f0a59c',
    fontWeight: '600'
  },
  errorText: {
    fontSize: 12,
    color: '#8a929e',
    lineHeight: 18
  },
  retry: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#25303c'
  },
  retryText: {
    fontSize: 12,
    color: '#8ab4f8',
    fontWeight: '600'
  },
  controls: {
    width: '100%',
    height: 54,
    backgroundColor: '#000'
  },
  probe: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#0c0e12',
    gap: 2
  },
  probeRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  probeText: {
    fontSize: 10,
    color: '#6b727e',
    flexShrink: 1
  },
  probeAction: {
    fontSize: 11,
    color: '#8ab4f8',
    fontWeight: '600'
  },
  probeError: {
    fontSize: 10,
    color: '#f0a59c',
    lineHeight: 14
  }
});
