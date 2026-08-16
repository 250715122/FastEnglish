/**
 * 字幕的落盘位置有两处：
 * 1. 配了 MOVIE_ROOT 且能在电影库里找到同名视频时，写到视频文件旁边，
 *    顺带生成一份通用双语 srt，别的播放器也能用；
 * 2. 其余情况（没配电影库、网址来源的视频）写到项目的 subtitles/ 目录。
 * 读取和列举时两处合并，所以换不换配置都不会丢东西。
 * 浏览器没法直接写磁盘，所以由开发服务器代劳，网页端和原生端共用这组端点。
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  findVideoPath,
  listSidecarFiles,
  isConfigured,
  invalidate,
  SIDECAR_SUFFIX
} = require('./movieIndex');
const { segmentsToSrt } = require('./srt');

const ROUTE_PREFIX = '/api/subtitles';
const STORE_DIR = path.join(__dirname, '..', 'subtitles');
/** 双语 srt 单独取名，免得盖掉片源自带的 xxx.srt */
const SIDECAR_SRT_SUFFIX = '.zh-en.srt';

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** key 是视频文件名，可能带路径分隔符或 Windows 非法字符，必须清干净再当文件名 */
function fileNameFor(key) {
  const safe = path
    .basename(key)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return `${safe || 'subtitle'}.json`;
}

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function readRecord(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed?.key || !Array.isArray(parsed.segments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 视频旁边那两个文件的路径，videoPath 为空表示这部片不在电影库里 */
function sidecarPaths(videoPath) {
  if (!videoPath) return null;
  const dir = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath));
  return {
    json: path.join(dir, `${stem}${SIDECAR_SUFFIX}`),
    srt: path.join(dir, `${stem}${SIDECAR_SRT_SUFFIX}`)
  };
}

function projectEntries() {
  ensureDir();
  return fs
    .readdirSync(STORE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(STORE_DIR, name);
      const record = readRecord(filePath);
      if (!record) return null;
      return {
        key: record.key,
        label: record.label || record.key,
        count: record.segments.length,
        savedAt: record.savedAt || 0,
        location: 'project',
        file: filePath
      };
    })
    .filter(Boolean);
}

/** 电影库里已经躺在视频旁边的那些字幕 */
function movieEntries() {
  return listSidecarFiles()
    .map((filePath) => {
      const record = readRecord(filePath);
      if (!record) return null;
      return {
        key: record.key,
        label: record.label || record.key,
        count: record.segments.length,
        savedAt: record.savedAt || 0,
        location: 'movie',
        file: filePath
      };
    })
    .filter(Boolean);
}

/**
 * 项目目录里的字幕，如果它对应的视频就在电影库里，说明它本该待在视频旁边。
 * 进程起来后惰性搬一次，用户不用手动做迁移。
 */
let migrated = false;
function migrateOnce() {
  if (migrated || !isConfigured()) return;
  migrated = true;

  for (const entry of projectEntries()) {
    const videoPath = findVideoPath(entry.key);
    const paths = sidecarPaths(videoPath);
    if (!paths || fs.existsSync(paths.json)) continue;

    const record = readRecord(entry.file);
    if (!record) continue;
    try {
      writeSidecar(paths, record);
      fs.rmSync(entry.file, { force: true });
      console.log(`[subtitles] 已把「${entry.key}」的字幕搬到视频旁边：${paths.json}`);
    } catch (error) {
      console.warn(`[subtitles] 搬运「${entry.key}」失败，先留在项目目录：${error.message}`);
    }
  }
}

function writeSidecar(paths, record) {
  fs.writeFileSync(paths.json, JSON.stringify(record), 'utf8');
  const srt = segmentsToSrt(record.segments);
  if (srt.trim()) fs.writeFileSync(paths.srt, srt, 'utf8');
  // 刚多出来两个文件，索引里的目录内容已经旧了
  invalidate();
}

function listEntries() {
  migrateOnce();

  const merged = new Map();
  for (const entry of projectEntries()) merged.set(entry.key, entry);
  // 同一个 key 两边都有时，以视频旁边那份为准
  for (const entry of movieEntries()) merged.set(entry.key, entry);

  return [...merged.values()].sort((a, b) => b.savedAt - a.savedAt);
}

/** 文件名清理后可能撞名，用文件里存的原始 key 复核 */
function findByKey(key) {
  const paths = sidecarPaths(findVideoPath(key));
  if (paths) {
    const record = readRecord(paths.json);
    if (record?.key === key) return record;
  }
  for (const entry of movieEntries()) {
    if (entry.key === key) return readRecord(entry.file);
  }

  const direct = readRecord(path.join(STORE_DIR, fileNameFor(key)));
  if (direct?.key === key) return direct;

  for (const entry of projectEntries()) {
    if (entry.key === key) return readRecord(entry.file);
  }
  return null;
}

function saveRecord(record) {
  const paths = sidecarPaths(findVideoPath(record.key));
  if (paths) {
    writeSidecar(paths, record);
    // 之前可能存在项目目录，搬过来了就别留两份
    const legacy = path.join(STORE_DIR, fileNameFor(record.key));
    if (fs.existsSync(legacy) && readRecord(legacy)?.key === record.key) {
      fs.rmSync(legacy, { force: true });
    }
    return { location: 'movie', path: paths.json };
  }

  ensureDir();
  const filePath = path.join(STORE_DIR, fileNameFor(record.key));
  fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');
  return { location: 'project', path: filePath };
}

function removeByKey(key) {
  // 只删这个 key 自己的那份，别误伤同目录下别的片子
  for (const entry of movieEntries()) {
    if (entry.key !== key) continue;
    const stem = entry.file.slice(0, -SIDECAR_SUFFIX.length);
    fs.rmSync(entry.file, { force: true });
    fs.rmSync(`${stem}${SIDECAR_SRT_SUFFIX}`, { force: true });
    invalidate();
  }
  for (const entry of projectEntries()) {
    if (entry.key === key) fs.rmSync(entry.file, { force: true });
  }
}

/** file 是服务端的绝对路径，没必要也不该发给客户端 */
function publicEntries() {
  return listEntries().map(({ file, ...meta }) => meta);
}

function createSubtitleStoreMiddleware() {
  return async function subtitleStoreMiddleware(request, response, next) {
    if (!request.url || !request.url.startsWith(ROUTE_PREFIX)) {
      next();
      return;
    }

    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
      });
      response.end();
      return;
    }

    try {
      if (url.pathname === `${ROUTE_PREFIX}/list` && request.method === 'GET') {
        sendJson(response, 200, { entries: publicEntries() });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/item` && request.method === 'GET') {
        const key = url.searchParams.get('key') || '';
        const entry = findByKey(key);
        if (!entry) {
          sendJson(response, 404, { error: '没有找到这条字幕' });
          return;
        }
        sendJson(response, 200, { label: entry.label, segments: entry.segments });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/item` && request.method === 'POST') {
        const payload = JSON.parse((await readBody(request)) || '{}');
        if (!payload.key || !Array.isArray(payload.segments) || !payload.segments.length) {
          sendJson(response, 400, { error: '缺少 key 或 segments' });
          return;
        }
        const saved = saveRecord({
          key: payload.key,
          label: payload.label || payload.key,
          savedAt: Date.now(),
          segments: payload.segments
        });
        console.log(`[subtitles] 已保存「${payload.key}」到 ${saved.path}`);
        sendJson(response, 200, { entries: publicEntries(), location: saved.location });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/item` && request.method === 'DELETE') {
        removeByKey(url.searchParams.get('key') || '');
        sendJson(response, 200, { entries: publicEntries() });
        return;
      }

      sendJson(response, 404, { error: `未知的字幕存储路径 ${url.pathname}` });
    } catch (error) {
      sendJson(response, 500, { error: `字幕存储操作失败：${error.message}` });
    }
  };
}

module.exports = { createSubtitleStoreMiddleware, ROUTE_PREFIX, STORE_DIR };
