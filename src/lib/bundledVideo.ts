/**
 * 打包进 App 的视频。
 *
 * Metro 会静态解析 require 的路径，一旦文件不存在，整个 bundle 都打不出来
 * （报 Unable to resolve module），连无关页面也会白屏。所以默认关闭。
 * 需要用内置视频时，把文件放进 video/ 目录，然后改成：
 *
 *   export const bundledVideo: number | null = require('../../video/your-video.mp4');
 *
 * 注意大文件会显著拖慢打包与安装，长视频建议走本地文件选择或网络地址。
 */
export const bundledVideo: number | null = null;

export const bundledVideoLabel = '内置视频';
