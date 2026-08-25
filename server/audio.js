/**
 * 「听模式」用的音轨抽取。
 *
 * 光把画面藏起来一点带宽都省不了：容器里音视频是交织存放的，按 Range 取一段字节，
 * 画面的数据也在里面。真要省就得把音轨单独抽成一个文件另发一份。
 *
 * 一部 4.5GB / 2 小时的片子整体约 5Mbps，抽成 64kbps 单声道 AAC 大约 57MB，
 * 播放时约 8kB/s，差了将近八十倍。顺带还解决一件事：mkv 里的 DTS/TrueHD
 * 浏览器根本解不了，重编码成 AAC 之后反而放得出来。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { DATA_DIR } = require('./db');

const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const HLS_DIR = path.join(AUDIO_DIR, 'hls');

/** 64kbps 单声道 AAC：学口语够用，而且 iOS/Safari/安卓/浏览器全都放得了 */
const BITRATE = process.env.FASTENGLISH_AUDIO_BITRATE || '64k';
const CHANNELS = Number(process.env.FASTENGLISH_AUDIO_CHANNELS || 1);

/**
 * 整段 MP4 起播前必须先连续拿到文件头那张索引表——两小时的片子约 1.4 MB。
 * 外网只有几十 KB/s，中途抖一下就前功尽弃，撞上 AVPlayer 的 60 秒超时。
 *
 * 切成 HLS 之后起播只要「播放列表 + 一个分片」，十来万字节就能出声，
 * 断网也只毁掉一个分片，播放器自己会把它重取回来。
 */
const SEGMENT_SECONDS = Number(process.env.FASTENGLISH_AUDIO_SEGMENT || 10);

/**
 * 抽音是纯 CPU 活，同时跑几个只会互相拖慢，总时间还更长。
 * 排队一个个来，等待的人看到的进度也更可信。
 */
const jobs = new Map();
const queue = [];
let running = null;

function audioPath(movieId) {
  return path.join(AUDIO_DIR, `${movieId}.m4a`);
}

function partPath(movieId) {
  return path.join(AUDIO_DIR, `${movieId}.part.m4a`);
}

/** 一部片子的分片全放自己的目录里，删起来是一整个目录，不用挨个匹配文件名 */
function hlsDir(movieId) {
  return path.join(HLS_DIR, String(movieId));
}

function hlsPlaylist(movieId) {
  return path.join(hlsDir(movieId), 'index.m3u8');
}

/** 分片文件按名字取，得挡住 ../ 之类的路径穿越 */
function hlsSegment(movieId, name) {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) return null;
  return path.join(hlsDir(movieId), name);
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * 启动时清掉两种废文件：上次没跑完留下的半成品，以及按老编码参数抽的音轨。
 *
 * 半成品不清会一直占着盘，`.part` 后缀也让人猜不到能不能删。
 * 老参数的音轨更得清——一条就是几十 MB，而且再也不会被用到了。
 */
function sweepPartials() {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(AUDIO_DIR)) {
      if (!name.endsWith('.part.m4a')) continue;
      fs.rmSync(path.join(AUDIO_DIR, name), { force: true });
      removed += 1;
    }
  } catch {
    // 目录还不存在，没什么可清的
  }
  try {
    // 切到一半留下的分片目录，播放列表是残的，留着只会播到中间断掉
    for (const name of fs.readdirSync(HLS_DIR)) {
      if (!name.endsWith('.part')) continue;
      fs.rmSync(path.join(HLS_DIR, name), { recursive: true, force: true });
      removed += 1;
    }
  } catch {
    // 同上
  }
  return removed;
}

/** ffmpeg 打印的 00:12:34.56 换成秒 */
function parseClock(text) {
  const match = /(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(text);
  if (!match) return 0;
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(`0.${match[4] || 0}`)
  );
}

function statusOf(movieId) {
  const job = jobs.get(movieId);
  if (job && (job.state === 'building' || job.state === 'queued')) {
    return {
      state: job.state,
      progress: job.progress,
      totalSeconds: job.totalSeconds,
      doneSeconds: job.doneSeconds,
      size: 0,
      error: null
    };
  }

  const size = sizeOf(audioPath(movieId));
  // 听模式放的是 HLS，所以整段音轨在也不算数，得等分片也切好
  if (size > 0 && sizeOf(hlsPlaylist(movieId)) > 0) {
    return { state: 'ready', progress: 1, size, error: null };
  }

  // 失败信息留着，否则用户点了「开始准备」之后只会看到状态弹回「没准备」
  if (job?.state === 'error') {
    return { state: 'error', progress: 0, size: 0, error: job.error };
  }
  return { state: 'none', progress: 0, size: 0, error: null };
}

/**
 * 排一次队。已经在排或已经好了就直接返回当前状态，重复点不会起第二个进程。
 */
function build(movieId, sourcePath) {
  const extracted = sizeOf(audioPath(movieId)) > 0;
  if (extracted && sizeOf(hlsPlaylist(movieId)) > 0) return statusOf(movieId);

  const existing = jobs.get(movieId);
  if (existing && (existing.state === 'queued' || existing.state === 'building')) {
    return statusOf(movieId);
  }

  const job = {
    movieId,
    sourcePath,
    // 老片子早就抽好整段音轨了，只差切片，别再花几分钟重抽一遍
    skipExtract: extracted,
    state: 'queued',
    progress: 0,
    totalSeconds: 0,
    doneSeconds: 0,
    error: null
  };
  jobs.set(movieId, job);
  queue.push(job);
  pump();
  return statusOf(movieId);
}

/**
 * 把抽好的整段音轨切成 HLS。`-c copy` 只是重新封装，不重新编码，两小时的片子十几秒就好。
 *
 * 切完才算数：先写进 .part 目录，成了再整个换过去，
 * 否则中途挂掉会留下一份只有一半分片的播放列表，播到中间就断。
 */
function packageHls(movieId, done) {
  const finalDir = hlsDir(movieId);
  const stageDir = `${finalDir}.part`;

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const args = [
    '-nostdin',
    '-i',
    audioPath(movieId),
    '-c',
    'copy',
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    // 整片都在，不是直播，播放列表要一次给全，播放器才能随便拖
    '-hls_playlist_type',
    'vod',
    '-hls_list_size',
    '0',
    /**
     * 用 TS 不用 fMP4：ffmpeg-static 这个构建下 `-hls_segment_type fmp4` 只写分片、
     * 不写 init.mp4，缺了初始化分片整条流都没法解。TS 自带解码信息，不需要它。
     * 多出的约 4% 封装开销无所谓，起播快慢只看「播放列表 + 一个分片」。
     */
    '-hls_segment_type',
    'mpegts',
    '-hls_segment_filename',
    path.join(stageDir, 'seg%05d.ts'),
    '-y',
    path.join(stageDir, 'index.m3u8')
  ];

  const child = spawn(ffmpegPath, args, { windowsHide: true });
  let tail = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    tail = (tail + chunk).slice(-2000);
  });

  child.on('error', (error) => done(`起不来 ffmpeg：${error.message}`));
  child.on('close', (code) => {
    if (code !== 0 || sizeOf(path.join(stageDir, 'index.m3u8')) === 0) {
      fs.rmSync(stageDir, { recursive: true, force: true });
      const reason = tail.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ');
      done(reason || `切片失败，ffmpeg 退出码 ${code}`);
      return;
    }
    try {
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(stageDir, finalDir);
      done(null);
    } catch (error) {
      done(`切片写入失败：${error.message}`);
    }
  });

  return child;
}

function pump() {
  if (running || !queue.length) return;

  const job = queue.shift();
  running = job;
  job.state = 'building';

  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const target = partPath(job.movieId);

  /**
   * 抽音和切片共用的收尾。两步都成了才算 ready——
   * 听模式放的是分片，只有整段音轨在的话点下去照样没声。
   */
  const settle = (error) => {
    running = null;
    job.child = null;

    if (error) {
      job.state = 'error';
      job.error = error;
      console.error(`[fastenglish] 音轨准备失败 movie=${job.movieId}: ${error}`);
    } else {
      job.state = 'ready';
      job.progress = 1;
      console.log(
        `[fastenglish] 音轨就绪 movie=${job.movieId} ` +
          `${(sizeOf(audioPath(job.movieId)) / 1e6).toFixed(1)}MB，已切片`
      );
    }
    pump();
  };

  const slice = () => {
    // 切片没有逐帧进度可读，而且只占整个流程的零头，进度条就停在末尾等着
    job.progress = 0.99;
    // 存下来，删片子时 discard 要能掐断它
    job.child = packageHls(job.movieId, settle);
  };

  // 整段音轨早就有了，只差切片
  if (job.skipExtract && sizeOf(audioPath(job.movieId)) > 0) {
    slice();
    return;
  }

  fs.rmSync(target, { force: true });

  const args = [
    '-nostdin',
    '-i',
    job.sourcePath,
    // 只要音，画面、字幕、数据轨全部丢掉
    '-vn',
    '-sn',
    '-dn',
    // 多音轨的片子只取第一条。选轨以后再说，先把常见情况跑通
    '-map',
    '0:a:0',
    '-ac',
    String(CHANNELS),
    '-c:a',
    'aac',
    '-b:a',
    BITRATE,
    // moov 原子挪到文件头，否则播放器得把整个文件拉完才能拖进度条
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    '-y',
    target
  ];

  const child = spawn(ffmpegPath, args, { windowsHide: true });
  job.child = child;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      const match = /^out_time_us=(\d+)/.exec(line) || /^out_time_ms=(\d+)/.exec(line);
      if (!match) continue;
      // 名字叫 ms，值其实是微秒；两种键都按微秒算
      job.doneSeconds = Number(match[1]) / 1_000_000;
      if (job.totalSeconds > 0) {
        job.progress = Math.min(0.999, job.doneSeconds / job.totalSeconds);
      }
    }
  });

  // 总时长只有 stderr 开头那行 Duration 有。ffmpeg-static 不带 ffprobe，
  // 从这里顺手取，省得为了拿个时长再装一个包
  let tail = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (!job.totalSeconds) {
      const match = /Duration:\s*(\d+:\d{2}:\d{2}\.\d+)/.exec(chunk);
      if (match) job.totalSeconds = parseClock(match[1]);
    }
    tail = (tail + chunk).slice(-2000);
  });

  const finish = (error) => {
    if (error) {
      fs.rmSync(target, { force: true });
      settle(error);
      return;
    }
    try {
      fs.renameSync(target, audioPath(job.movieId));
    } catch (renameError) {
      settle(`写入失败：${renameError.message}`);
      return;
    }
    slice();
  };

  child.on('error', (error) => finish(`起不来 ffmpeg：${error.message}`));
  child.on('close', (code) => {
    if (job.cancelled) {
      finish('已取消');
      return;
    }
    if (code === 0 && sizeOf(target) > 0) {
      finish(null);
      return;
    }
    // ffmpeg 的报错都在最后几行，原样带出去比「退出码 1」有用
    const reason = tail.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ');
    finish(reason || `ffmpeg 退出码 ${code}`);
  });
}

/** 删片子时连音频缓存一起清掉，并掐断正在跑的任务 */
function discard(movieId) {
  const job = jobs.get(movieId);
  if (job?.child) {
    job.cancelled = true;
    job.child.kill();
  }
  jobs.delete(movieId);
  fs.rmSync(audioPath(movieId), { force: true });
  fs.rmSync(partPath(movieId), { force: true });
  fs.rmSync(hlsDir(movieId), { recursive: true, force: true });
  fs.rmSync(`${hlsDir(movieId)}.part`, { recursive: true, force: true });
}

module.exports = {
  AUDIO_DIR,
  audioPath,
  hlsPlaylist,
  hlsSegment,
  build,
  statusOf,
  discard,
  sweepPartials,
  sizeOf
};
