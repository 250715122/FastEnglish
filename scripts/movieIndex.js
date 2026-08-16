/**
 * 按文件名反查视频在磁盘上的真实位置。
 *
 * 浏览器出于安全从不告诉网页文件在哪个目录，DocumentPicker 给到的只有文件名和
 * 一个 blob 地址。想把字幕存到视频旁边，只能由开发服务器在用户指定的电影库里
 * 按文件名找回真实路径。没配 MOVIE_ROOT 就当这个功能不存在。
 */
const fs = require('node:fs');
const path = require('node:path');

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.m4v',
  '.ts',
  '.webm',
  '.flv',
  '.wmv',
  '.mpg',
  '.mpeg',
  '.rmvb'
]);

/** 存在视频旁边的字幕用这个后缀，避开片源自带的文件和别的工具生成的东西 */
const SIDECAR_SUFFIX = '.fastenglish.json';

/** 扫盘不便宜，同一次会话里反复选片不该每次都走一遍文件系统 */
const CACHE_TTL_MS = 60_000;
const MAX_DEPTH = 8;
/** 万一 MOVIE_ROOT 被填成盘符根目录，也不至于把整块盘遍历完 */
const MAX_ENTRIES = 50_000;

let cache = { root: null, at: 0, videos: new Map(), sidecars: [] };

function movieRoot() {
  // 延迟到用调用时才读，避免早于 Expo 载入 .env
  const configured = (process.env.MOVIE_ROOT || '').trim();
  if (!configured) return null;
  try {
    return fs.statSync(configured).isDirectory() ? path.resolve(configured) : null;
  } catch {
    return null;
  }
}

/**
 * 一趟遍历同时收两样东西：视频文件的位置，以及已经躺在视频旁边的字幕。
 * 字幕搬到电影库之后项目目录里就没有它的记录了，只能靠这里扫出来，
 * 否则列表会平白少掉几条。
 */
function scan(root) {
  const videos = new Map();
  const sidecars = [];
  const queue = [{ dir: root, depth: 0 }];
  let seen = 0;

  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > MAX_DEPTH || seen > MAX_ENTRIES) break;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      seen += 1;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (entry.name.endsWith(SIDECAR_SUFFIX)) {
        sidecars.push(full);
        continue;
      }
      if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      // 同名文件散在多个目录时，先扫到的（层级更浅的）优先
      if (!videos.has(entry.name)) videos.set(entry.name, full);
    }
  }

  return { videos, sidecars };
}

function currentIndex() {
  const root = movieRoot();
  if (!root) {
    cache = { root: null, at: 0, videos: new Map(), sidecars: [] };
    return cache;
  }
  const fresh = cache.root === root && Date.now() - cache.at < CACHE_TTL_MS;
  if (!fresh) cache = { root, at: Date.now(), ...scan(root) };
  return cache;
}

/** 返回视频的完整路径；没配电影库或库里没有这个文件名时返回 null */
function findVideoPath(fileName) {
  if (!fileName) return null;
  const base = path.basename(fileName);
  return currentIndex().videos.get(base) || null;
}

/** 电影库里所有存在视频旁边的字幕文件的绝对路径 */
function listSidecarFiles() {
  return currentIndex().sidecars;
}

function isConfigured() {
  return Boolean(movieRoot());
}

/** 索引里的文件刚被增删时，等 60 秒 TTL 自然过期太慢，落盘后直接作废 */
function invalidate() {
  cache = { root: null, at: 0, videos: new Map(), sidecars: [] };
}

module.exports = {
  findVideoPath,
  listSidecarFiles,
  isConfigured,
  invalidate,
  movieRoot,
  SIDECAR_SUFFIX,
  VIDEO_EXTENSIONS
};
