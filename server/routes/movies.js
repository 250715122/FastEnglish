/**
 * 片库、学习列表和视频串流。
 *
 * 片库是服务器扫 MOVIE_ROOT 得来的，所有人看到同一份；学习列表是每人自己的一份，
 * 里面记着看到第几秒。视频不上传、不转码，原样按 Range 发出去——服务器跑在存片子的
 * 那台机器上，本机访问就是读盘，手机则走局域网。
 */
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const express = require('express');
const { connect, DATA_DIR } = require('../db');
const { requireAuth, resolveToken, tokenFrom } = require('../auth');
const audio = require('../audio');
const {
  listVideoFiles,
  isConfigured,
  movieRoot,
  invalidate,
  VIDEO_EXTENSIONS
} = require('../../scripts/movieIndex');

const router = express.Router();

/**
 * 用户传上来的片子放这儿，一人一个目录，不和扫描来的公共片库混在一起——
 * 混在一起的话扫描会把它们当成无主文件，归属就丢了。
 */
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function uploadDirFor(userId) {
  const dir = path.join(UPLOAD_DIR, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.rmvb': 'application/vnd.rn-realmedia-vbr'
};

/** 把磁盘上扫到的片子同步进库；seen_at 用来认出已经被删掉的文件 */
function syncLibrary() {
  if (!isConfigured()) return { synced: 0, root: null };

  const now = Date.now();
  const db = connect();
  const upsert = db.prepare(
    `INSERT INTO movies (path, name, title, size, added_at, seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET name = excluded.name, size = excluded.size, seen_at = excluded.seen_at`
  );

  let synced = 0;
  for (const file of listVideoFiles()) {
    let size = 0;
    try {
      size = fs.statSync(file.path).size;
    } catch {
      continue;
    }
    upsert.run(file.path, file.name, titleOf(file.name), size, now, now);
    synced += 1;
  }

  /**
   * 从磁盘上删掉的片子也要从库里消失，否则列表里会留下一个点开就报错的空条目。
   *
   * 只在这次扫到了东西的时候才清：外接硬盘没挂上、路径填错时扫描结果是空的，
   * 那时候清等于把整个片库连同大家的学习进度一起抹掉。
   * 也只清扫描来的——上传的片子根本不在 MOVIE_ROOT 里，永远「扫不到」。
   */
  if (synced > 0) {
    const gone = db.prepare("SELECT id FROM movies WHERE source = 'scan' AND seen_at < ?").all(now);
    for (const row of gone) audio.discard(row.id);
    db.prepare("DELETE FROM movies WHERE source = 'scan' AND seen_at < ?").run(now);
  }

  return { synced, root: movieRoot() };
}

/** 文件名里的扩展名和常见发布组后缀对学习没意义，列表里显示干净的片名 */
function titleOf(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[._]/g, ' ')
    .replace(/\b(1080p|720p|2160p|4k|bluray|web-?dl|hdtv|x264|x265|h264|h265|aac|dts)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || fileName;
}

function movieToJson(row, study, viewerId) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    size: row.size,
    inStudyList: Boolean(study),
    addedAt: study?.added_at ?? null,
    lastOpenedAt: study?.last_opened_at ?? null,
    lastPosition: study?.last_position ?? 0,
    subtitleLabel: study?.subtitle_label ?? null,
    streamUrl: `/api/movies/${row.id}/stream`,
    source: row.source ?? 'scan',
    visibility: row.visibility ?? 'public',
    // 无主的是扫描来的公共片库，谁都不能改它的可见性，也删不掉
    isMine: row.owner_id != null && row.owner_id === viewerId,
    ownerName: row.owner_name ?? null
  };
}

// ---------------------------------------------------------------- 片库

/** 能看到的片子：公开的，加上自己传的那些私有片 */
router.get('/', requireAuth, (request, response) => {
  if (request.query.refresh === '1') invalidate();
  const result = syncLibrary();

  const db = connect();
  const movies = db
    .prepare(
      `SELECT m.*, u.display_name AS owner_name
       FROM movies m LEFT JOIN users u ON u.id = m.owner_id
       WHERE m.visibility = 'public' OR m.owner_id = ?
       ORDER BY m.title COLLATE NOCASE`
    )
    .all(request.user.id);

  const study = new Map(
    db
      .prepare('SELECT * FROM study_items WHERE user_id = ?')
      .all(request.user.id)
      .map((row) => [row.movie_id, row])
  );

  response.json({
    configured: isConfigured(),
    root: result.root,
    items: movies.map((row) => movieToJson(row, study.get(row.id), request.user.id))
  });
});

// ---------------------------------------------------------------- 学习列表

/**
 * 我的学习列表，最近看过的排前面。
 * 别人把已经加进来的片子改回私有时，这里也要跟着看不见。
 */
router.get('/study', requireAuth, (request, response) => {
  const rows = connect()
    .prepare(
      `SELECT m.*, u.display_name AS owner_name,
              s.added_at, s.last_opened_at, s.last_position, s.subtitle_label
       FROM study_items s
       JOIN movies m ON m.id = s.movie_id
       LEFT JOIN users u ON u.id = m.owner_id
       WHERE s.user_id = ? AND (m.visibility = 'public' OR m.owner_id = ?)
       ORDER BY COALESCE(s.last_opened_at, s.added_at) DESC`
    )
    .all(request.user.id, request.user.id);

  response.json({
    items: rows.map((row) =>
      movieToJson(
        row,
        {
          added_at: row.added_at,
          last_opened_at: row.last_opened_at,
          last_position: row.last_position,
          subtitle_label: row.subtitle_label
        },
        request.user.id
      )
    )
  });
});

router.post('/study', requireAuth, (request, response) => {
  const movieId = Number(request.body?.movieId);
  if (!Number.isInteger(movieId)) {
    response.status(400).json({ error: '缺少 movieId' });
    return;
  }

  const db = connect();
  if (!db.prepare('SELECT id FROM movies WHERE id = ?').get(movieId)) {
    response.status(404).json({ error: '片库里没有这部片子' });
    return;
  }

  db.prepare(
    'INSERT INTO study_items (user_id, movie_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
  ).run(request.user.id, movieId, Date.now());
  response.json({ ok: true });
});

router.delete('/study', requireAuth, (request, response) => {
  const movieId = Number(request.query.movieId);
  if (!Number.isInteger(movieId)) {
    response.status(400).json({ error: '缺少 movieId' });
    return;
  }
  connect()
    .prepare('DELETE FROM study_items WHERE user_id = ? AND movie_id = ?')
    .run(request.user.id, movieId);
  response.json({ ok: true });
});

/** 记住看到第几秒，下次点开直接续上 */
router.put('/study/progress', requireAuth, (request, response) => {
  const movieId = Number(request.body?.movieId);
  if (!Number.isInteger(movieId)) {
    response.status(400).json({ error: '缺少 movieId' });
    return;
  }

  const position = Math.max(0, Number(request.body?.position) || 0);
  const label = request.body?.subtitleLabel ? String(request.body.subtitleLabel) : null;

  connect()
    .prepare(
      `INSERT INTO study_items (user_id, movie_id, added_at, last_opened_at, last_position, subtitle_label)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, movie_id) DO UPDATE SET
         last_opened_at = excluded.last_opened_at,
         last_position = excluded.last_position,
         subtitle_label = COALESCE(excluded.subtitle_label, study_items.subtitle_label)`
    )
    .run(request.user.id, movieId, Date.now(), Date.now(), position, label);

  response.json({ ok: true });
});

// ---------------------------------------------------------------- 上传与共享

/** 文件名直接来自客户端，必须挡住路径穿越和 Windows 不接受的字符 */
function safeFileName(raw) {
  const base = path.basename(String(raw || '').trim());
  const clean = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180);
  return clean || `upload-${Date.now()}.mp4`;
}

/** 同名不覆盖：自己传了两版同一部片，两版都该留着 */
function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

/**
 * 裸字节流上传，没有走 multipart：片子动辄几个 GB，multipart 要么引依赖，
 * 要么自己解析边界，而这里一次就传一个文件，直接管道写盘更省事也更快。
 * 网页端把 File 对象当请求体，原生端用 expo-file-system 的 BINARY_CONTENT，两边一致。
 */
router.post('/upload', requireAuth, (request, response) => {
  const fileName = safeFileName(request.headers['x-file-name']
    ? decodeURIComponent(String(request.headers['x-file-name']))
    : '');

  if (!VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
    response.status(400).json({ error: `不支持的视频格式：${path.extname(fileName) || '（没有扩展名）'}` });
    return;
  }

  const destination = uniquePath(uploadDirFor(request.user.id), fileName);
  const sink = fs.createWriteStream(destination);
  let failed = false;

  const abort = (status, message) => {
    if (failed) return;
    failed = true;
    sink.destroy();
    // 半截文件留在盘上只会占地方，还会被当成一部能播的片子
    fs.rm(destination, { force: true }, () => undefined);
    if (!response.headersSent) response.status(status).json({ error: message });
  };

  request.on('aborted', () => abort(499, '上传被中断'));
  request.on('error', (error) => abort(400, `上传出错：${error.message}`));
  sink.on('error', (error) => abort(500, `写入失败：${error.message}`));

  sink.on('finish', () => {
    if (failed) return;

    let size = 0;
    try {
      size = fs.statSync(destination).size;
    } catch {
      abort(500, '写入后找不到文件');
      return;
    }
    if (size === 0) {
      abort(400, '传上来的是空文件');
      return;
    }

    const now = Date.now();
    const info = connect()
      .prepare(
        `INSERT INTO movies (path, name, title, size, added_at, seen_at, owner_id, visibility, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'private', 'upload')`
      )
      .run(destination, path.basename(destination), titleOf(destination), size, now, now, request.user.id);

    const row = connect().prepare('SELECT * FROM movies WHERE id = ?').get(Number(info.lastInsertRowid));
    // 自己传的片子直接进学习列表，省得再点一次「加入学习」
    connect()
      .prepare('INSERT INTO study_items (user_id, movie_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(request.user.id, row.id, now);

    response.status(201).json({ movie: movieToJson(row, { added_at: now }, request.user.id) });
  });

  request.pipe(sink);
});

/** 把自己的片子设为公开或收回。扫描来的公共片库没有主人，不能改 */
router.put('/:id/visibility', requireAuth, (request, response) => {
  const db = connect();
  const row = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(request.params.id));
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }
  if (row.owner_id !== request.user.id) {
    response.status(403).json({ error: '只能改自己上传的片子' });
    return;
  }

  const visibility = request.body?.public === false ? 'private' : 'public';
  db.prepare('UPDATE movies SET visibility = ? WHERE id = ?').run(visibility, row.id);

  const updated = db.prepare('SELECT * FROM movies WHERE id = ?').get(row.id);
  response.json({ movie: movieToJson(updated, null, request.user.id) });
});

/** 删掉自己上传的片子，文件一并清掉 */
router.delete('/:id', requireAuth, (request, response) => {
  const db = connect();
  const row = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(request.params.id));
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }
  if (row.owner_id !== request.user.id || row.source !== 'upload') {
    response.status(403).json({ error: '只能删自己上传的片子' });
    return;
  }

  fs.rm(row.path, { force: true }, () => undefined);
  // 抽出来的音轨是这部片的派生物，留着只会占盘，而且 id 会被后来的片子复用
  audio.discard(row.id);
  // study_items 有外键级联，别人加过这部片的记录会一起消失
  db.prepare('DELETE FROM movies WHERE id = ?').run(row.id);
  response.json({ ok: true });
});

// ---------------------------------------------------------------- 串流

/**
 * video 标签没法带 Authorization 头，所以这条路由额外接受 ?token=。
 * 令牌进 URL 会落到访问日志里，因此只在这一条上开口子，别的接口一律走请求头。
 */
function authorizeStream(request, response, next) {
  const token = tokenFrom(request) || String(request.query.token || '');
  const user = resolveToken(token);
  if (!user) {
    response.status(401).json({ error: '请先登录' });
    return;
  }
  request.user = user;
  // HLS 播放列表要把它逐行缀到每个分片地址上，见 /:id/audio.m3u8
  request.streamToken = token;
  next();
}

/**
 * 按 Range 发片段是拖进度条的前提。这个应用几乎每个操作都在 seek——
 * 单句循环、段落循环、点句跳转——不支持 Range 的话每次跳转都要从头下载。
 *
 * 原片和抽出来的音轨走的是同一套逻辑，所以放在这里共用。
 */
function sendFileRange(request, response, filePath, type) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    response.status(410).json({ error: '文件已经不在原来的位置了' });
    return;
  }

  const total = stat.size;
  const range = request.headers.range;

  if (!range) {
    response.writeHead(200, {
      'Content-Length': total,
      'Content-Type': type,
      'Accept-Ranges': 'bytes'
    });
    const whole = fs.createReadStream(filePath);
    response.on('close', () => whole.destroy());
    whole.pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    response.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
    return;
  }

  // bytes=-500 表示最后 500 字节，和 bytes=500- 的含义完全不同
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    response.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
    return;
  }

  response.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': type
  });

  const stream = fs.createReadStream(filePath, { start, end });
  // 用户拖进度条会立刻放弃这次请求，不销毁的话文件句柄会一直攒着
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

/**
 * 可见性必须每次都查：光凭 id 取片子的话，任何登录用户换个数字
 * 就能播到别人的私有上传。查不到时用 404 而不是 403，免得暴露这个 id 存不存在。
 */
function visibleMovie(id, viewerId) {
  return connect()
    .prepare("SELECT * FROM movies WHERE id = ? AND (visibility = 'public' OR owner_id = ?)")
    .get(Number(id), viewerId);
}

router.get('/:id/stream', authorizeStream, (request, response) => {
  const row = visibleMovie(request.params.id, request.user.id);
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }
  sendFileRange(request, response, row.path, MIME[path.extname(row.path).toLowerCase()] || 'application/octet-stream');
});

// ---------------------------------------------------------------- 听模式音轨

router.get('/:id/audio/status', requireAuth, (request, response) => {
  const row = visibleMovie(request.params.id, request.user.id);
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }
  response.json(audio.statusOf(row.id));
});

/** 触发抽取。幂等：已经在跑或已经好了都只是把当前状态回给你 */
router.post('/:id/audio', requireAuth, (request, response) => {
  const row = visibleMovie(request.params.id, request.user.id);
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }
  if (!fs.existsSync(row.path)) {
    response.status(410).json({ error: '片源文件已经不在原来的位置了' });
    return;
  }
  response.status(202).json(audio.build(row.id, row.path));
});

/**
 * 听模式真正在放的是这个：HLS 播放列表。
 *
 * 播放器取分片时**不会**把播放列表地址上的查询串带过去，所以令牌得逐行缀到
 * 每个分片的地址后面。列表是纯文本，几十 KB，现拼开销可以忽略。
 */
router.get('/:id/audio.m3u8', authorizeStream, (request, response) => {
  const row = visibleMovie(request.params.id, request.user.id);
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }

  const playlist = audio.hlsPlaylist(row.id);
  if (audio.sizeOf(playlist) === 0) {
    response.status(409).json({ error: '音轨还没切好' });
    return;
  }

  const token = request.streamToken;
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  /**
   * ffmpeg 写进列表的是裸文件名。播放器按播放列表的地址去解相对路径，
   * 基准是 /api/movies/<id>/，直接用裸名会解成 /api/movies/<id>/seg00000.m4s，
   * 落不到分片接口上，所以这里补成 audio/seg/<name>。
   */
  const locate = (name) => `audio/seg/${name}${suffix}`;
  const body = fs
    .readFileSync(playlist, 'utf8')
    .split('\n')
    .map((line) => {
      const at = line.trim();
      // 注释和空行原样留着，只有分片文件名那几行要改
      if (!at || at.startsWith('#')) return line;
      return locate(at);
    })
    .join('\n');

  response.type('application/vnd.apple.mpegurl');
  // 列表里逐行缀着令牌，会话换了就得重新取，绝不能留在手机上
  response.setHeader('Cache-Control', 'no-store');

  /**
   * 列表本身就在起播的关键路径上，而且极其好压：790 行里每行都缀着同一个令牌，
   * 70 KB 压完只剩几 KB。全局那个 gzip 中间件只包了 res.json，这里得自己来。
   */
  const raw = Buffer.from(body);
  if (!/\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
    response.send(raw);
    return;
  }
  zlib.gzip(raw, (error, zipped) => {
    if (error) {
      response.send(raw);
      return;
    }
    response.setHeader('Content-Encoding', 'gzip');
    response.setHeader('Vary', 'Accept-Encoding');
    response.setHeader('Content-Length', zipped.length);
    response.end(zipped);
  });
});

/** 单个分片。名字是播放列表里给的，仍要挡住路径穿越，见 audio.hlsSegment */
router.get('/:id/audio/seg/:name', authorizeStream, (request, response) => {
  const row = visibleMovie(request.params.id, request.user.id);
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }

  const file = audio.hlsSegment(row.id, request.params.name);
  if (!file || audio.sizeOf(file) === 0) {
    response.status(404).json({ error: '没有这个分片' });
    return;
  }

  /**
   * 分片内容永不变化（片子 id 加序号就唯一确定它），放心让手机长期留着。
   *
   * 不设的话反复重下：日志里同一个分片出现过六次，因为每次跳回同一句
   * 都要重新拉。private 是因为地址上带着令牌，不能进共享缓存。
   */
  response.setHeader('Cache-Control', 'private, max-age=604800, immutable');
  sendFileRange(request, response, file, 'video/mp2t');
});

/** 整段音轨。听模式已经改走 HLS，这条留着当退路，也给浏览器直接下载用 */
router.get('/:id/audio', authorizeStream, (request, response) => {
  const row = visibleMovie(request.params.id, request.user.id);
  if (!row) {
    response.status(404).json({ error: '没有这部片子' });
    return;
  }

  const file = audio.audioPath(row.id);
  if (audio.sizeOf(file) === 0) {
    response.status(409).json({ error: '音轨还没准备好' });
    return;
  }
  sendFileRange(request, response, file, 'audio/mp4');
});

module.exports = { router, syncLibrary };
