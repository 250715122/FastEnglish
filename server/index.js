/**
 * 独立的后端服务。以前这些接口寄生在 Expo 的 Metro 开发服务器上，
 * 只有 `expo start` 开着才活着；拆出来之后前端可以打包发布，服务端自己跑。
 *
 * 跑在存放电影的那台机器上：片库靠扫 MOVIE_ROOT 得到，视频按 Range 原样发出去。
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const express = require('express');

/**
 * Metro 会自动读 .env，独立进程不会，得自己来。
 *
 * 没有用 process.loadEnvFile：它会拿 .env 里的空值覆盖掉真实的环境变量，
 * 而模板里 `MOVIE_ROOT=` 正是空的——部署时在环境里配好的路径会被这一行抹掉。
 * 这里按惯例反过来：真实环境变量优先，.env 里留空等于没配。
 */
function loadEnv(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!value || process.env[key]) continue;
    process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));

const { connect } = require('./db');
const { pruneSessions, requireAuth } = require('./auth');
const { sweepPartials } = require('./audio');
const authRoutes = require('./routes/auth');
const vocabRoutes = require('./routes/vocab');
const { router: movieRoutes, syncLibrary } = require('./routes/movies');

const { createDictStoreMiddleware } = require('../scripts/dictStore');
const { createOpenSubtitlesMiddleware } = require('../scripts/openSubtitlesProxy');
const { createSubtitleStoreMiddleware } = require('../scripts/subtitleStore');

const PORT = Number(process.env.FASTENGLISH_PORT || 4000);
const app = express();

app.disable('x-powered-by');

/**
 * 前端在开发时跑在 8081，和这里不同源。用的是 Bearer 令牌而不是 Cookie，
 * 所以放开 * 不会带来 CSRF 面——浏览器不会自动附上令牌。
 */
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin || '*');
  // 回显浏览器点名要用的头，而不是维护一份白名单——
  // 之前写死 Content-Type + Authorization，上传用的 X-File-Name 没在里面，
  // 预检直接被拒，前端只能看到一个语焉不详的网络错误
  response.setHeader(
    'Access-Control-Allow-Headers',
    request.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-File-Name'
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  // 让浏览器读得到 Range 相关的响应头，否则拖进度条会拿不到总长度
  response.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});

/**
 * 串流的访问日志。
 *
 * 手机放不出原声时，之前这边一片空白：分不清是请求压根没到、令牌过期被 401 挡了，
 * 还是连上了但传得太慢被播放器放弃。这三种情况在手机上看到的都是「没声音」。
 *
 * 只记 /stream 和 /audio 这两条，外加所有出错的响应。别的接口太碎，记了反而淹掉重点。
 */
const STREAMING = /^\/api\/movies\/\d+\/(stream|audio|audio\.m3u8|audio\/seg\/[\w.-]+)$/;
app.use((request, response, next) => {
  // 路径得当场记下来：请求进到挂载的 router 之后 req.url 会被改写，
  // 等到 finish 再读就只剩 /1/stream 这半截，看不出是哪个接口
  const at = request.path;
  const streaming = STREAMING.test(at);
  if (!streaming && request.method === 'OPTIONS') {
    next();
    return;
  }

  const started = Date.now();

  /**
   * 自己数发出去了多少字节。
   *
   * Content-Length 只是「打算发多少」，播放器中途掐断时它和实际发出的量差得很远，
   * 而「连上了但一个字节都没拿到」正是要找的那种坏法。
   */
  let sent = 0;
  const write = response.write.bind(response);
  const end = response.end.bind(response);
  response.write = (chunk, ...rest) => {
    if (chunk) sent += Buffer.byteLength(chunk);
    return write(chunk, ...rest);
  };
  response.end = (chunk, ...rest) => {
    if (chunk && typeof chunk !== 'function') sent += Buffer.byteLength(chunk);
    return end(chunk, ...rest);
  };

  const line = (tag) => {
    const spent = Date.now() - started;
    const rate = sent && spent ? ` ${((sent / 1024 / spent) * 1000).toFixed(0)}KB/s` : '';
    console.log(
      `[fastenglish] ${tag} ${request.method} ${at}` +
        `${request.headers.range ? ` range=${request.headers.range}` : ''}` +
        ` sent=${(sent / 1024).toFixed(0)}KB ${spent}ms${rate}`
    );
  };

  response.on('finish', () => {
    if (streaming || response.statusCode >= 400) line(String(response.statusCode));
  });

  /**
   * 播放器拖进度条、换缓冲位置时会主动掐断连接，这时候 finish 不会来。
   * 掐断本身正常，所以那种一个字节没要就立刻走人的探路请求不记——
   * 它们太多，会把真正有用的那几行冲没。
   */
  if (streaming) {
    request.on('aborted', () => {
      if (sent === 0 && Date.now() - started < 200) return;
      line('断开');
    });
  }
  next();
});

/**
 * 给 JSON 响应加 gzip。
 *
 * 全片词典查询一次要发 400 KB，而 Funnel 实测下行只有 27 KB/s——手机上光等这一个
 * 响应就超过 60 秒的超时，界面报的却是「确认后端还在跑」，完全指错方向。
 * 压完只剩 86 KB。
 *
 * 只包 res.json，不做通用压缩：视频和音轨是 res.write/pipe 出去的，
 * 带 Range 又本来就压不动，套上通用压缩中间件反而容易把 Content-Length
 * 和断点续传弄坏。
 */
app.use((request, response, next) => {
  if (!/\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
    next();
    return;
  }
  const sendJson = response.json.bind(response);
  response.json = (body) => {
    const raw = Buffer.from(JSON.stringify(body));
    // 小响应压了省不下什么，白搭一次 CPU
    if (raw.length < 4096) return sendJson(body);
    zlib.gzip(raw, (error, zipped) => {
      if (error) {
        sendJson(body);
        return;
      }
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Content-Encoding', 'gzip');
      response.setHeader('Vary', 'Accept-Encoding');
      response.setHeader('Content-Length', zipped.length);
      response.end(zipped);
    });
    return response;
  };
  next();
});

/**
 * 这三组接口曾经不套登录，理由是「不含个人数据」。挂到公网（Tailscale Funnel）
 * 之后这个理由不成立了：/api/subtitles/list 会列出存过哪些片子的字幕，等于泄露片单；
 * /api/opensubtitles/search 花的是账号额度，免费号一天只有 5 次下载；
 * /api/dict/examples 更是能驱使这台机器替陌生人去外网抓数据。
 * 一律要登录，反正前端本来就得先登录才能进学习页。
 *
 * requireAuth 只读请求头、不碰 body，放在下面几个中间件前面不影响它们读原始流。
 * OPTIONS 在上面的 CORS 环节就返回了，预检不会撞上 401。
 */
app.use(['/api/opensubtitles', '/api/subtitles', '/api/dict'], requireAuth);

/**
 * 词典查询、字幕存取、OpenSubtitles 转发原样复用。
 * 它们本来就是标准的 (req, res, next) 中间件，搬过来一行没改。
 *
 * 必须挂在 express.json() 前面。它们各自用 request.on('data') 读原始流，
 * 而 express.json() 会先把流读干净——轮到它们时流已经结束，
 * 等的 data 事件永远不会来，请求就那么挂着，既不响应也不报错。
 * 三个前缀（/api/dict、/api/subtitles、/api/opensubtitles）和下面的路由不重叠，
 * 不匹配时它们会直接 next()，放在前面不影响别的接口。
 */
app.use(createOpenSubtitlesMiddleware());
app.use(createSubtitleStoreMiddleware());
app.use(createDictStoreMiddleware());

app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (request, response) => {
  response.json({ ok: true, service: 'fastenglish', time: Date.now() });
});

app.use('/api/auth', authRoutes);
app.use('/api/vocab', vocabRoutes);
app.use('/api/movies', movieRoutes);

app.use((request, response) => {
  response.status(404).json({ error: `没有这个接口：${request.method} ${request.path}` });
});

app.use((error, request, response, next) => {
  console.error('[fastenglish] 未捕获的错误', error);
  if (response.headersSent) {
    next(error);
    return;
  }
  response.status(500).json({ error: error.message || '服务器内部错误' });
});

function start() {
  connect();
  pruneSessions();
  // 上次抽音抽到一半就退出的话，盘上会留下半截的 .part.m4a
  const swept = sweepPartials();
  if (swept) console.log(`[fastenglish] 清掉 ${swept} 个没抽完的音轨临时文件`);

  const { synced, root } = syncLibrary();
  const server = app.listen(PORT, () => {
    console.log(`[fastenglish] 服务已启动  http://localhost:${PORT}`);
    console.log(
      root ? `[fastenglish] 片库 ${root}，扫到 ${synced} 部` : '[fastenglish] 未配置 MOVIE_ROOT，片库为空'
    );
  });

  /**
   * Node 默认 5 分钟就掐断一个请求，而传一部几 GB 的片子轻易就超。
   * 超时发生在传输途中，前端只会收到一个没头没尾的网络错误，极难排查，所以关掉。
   * 慢速连接攻击对局域网自建服务不构成威胁。
   */
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  // 过期会话不清会一直堆着，一天扫一次足够
  setInterval(pruneSessions, 24 * 60 * 60 * 1000).unref();
}

if (require.main === module) start();

module.exports = { app, start };
