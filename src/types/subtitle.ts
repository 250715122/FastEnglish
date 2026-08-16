/**
 * 一句字幕。时间单位统一为秒，App 内所有字幕来源（srt/vtt/ass/离线管线产出的 JSON）
 * 最终都归一到这个结构。
 */
export type Segment = {
  id: number;
  start: number;
  end: number;
  en: string;
  zh?: string;
};

export type VideoSourceKind = 'remote' | 'local' | 'bundled';

/**
 * uri 除了播放，还用于 expo-video-thumbnails 生成缩略图；
 * bundled 来源额外保留 require() 的返回值交给播放器。
 */
export type VideoSourceSpec = {
  kind: VideoSourceKind;
  uri: string;
  label: string;
  module?: number;
};
