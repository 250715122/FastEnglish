/**
 * OpenSubtitles 的网关按 User-Agent 拦截浏览器（返回 kong-user-agent-block），
 * 而浏览器又禁止 JS 修改 User-Agent，所以网页端只能由开发服务器代为转发。
 * 顺带好处：API key 只存在于服务端进程，不会被打进客户端 bundle。
 */
const { sendJson } = require('./sendJson');

const API_BASE = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'FastEnglish v1.0';
const ROUTE_PREFIX = '/api/opensubtitles';

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function upstreamHeaders(apiKey) {
  return { 'Api-Key': apiKey, 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

async function handleSearch(url, apiKey, response) {
  const params = new URLSearchParams();
  for (const name of ['query', 'languages', 'year']) {
    const value = url.searchParams.get(name);
    if (value) params.set(name, value);
  }

  const upstream = await fetch(`${API_BASE}/subtitles?${params}`, { headers: upstreamHeaders(apiKey) });
  const text = await upstream.text();
  if (!upstream.ok) {
    sendJson(response, upstream.status, { error: `OpenSubtitles 返回 ${upstream.status}: ${text.slice(0, 200)}` });
    return;
  }
  sendJson(response, 200, JSON.parse(text));
}

async function handleDownload(request, apiKey, response) {
  const payload = JSON.parse((await readBody(request)) || '{}');
  if (!payload.file_id) {
    sendJson(response, 400, { error: '缺少 file_id' });
    return;
  }

  const linkResponse = await fetch(`${API_BASE}/download`, {
    method: 'POST',
    headers: { ...upstreamHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: payload.file_id })
  });
  const linkText = await linkResponse.text();
  if (!linkResponse.ok) {
    sendJson(response, linkResponse.status, {
      error: `OpenSubtitles 返回 ${linkResponse.status}: ${linkText.slice(0, 200)}`
    });
    return;
  }

  const info = JSON.parse(linkText);
  if (!info.link) {
    sendJson(response, 502, { error: '接口没有返回下载链接' });
    return;
  }

  // 下载域同样会看 User-Agent，这一跳也留在服务端做
  const fileResponse = await fetch(info.link, { headers: { 'User-Agent': USER_AGENT } });
  if (!fileResponse.ok) {
    sendJson(response, fileResponse.status, { error: `字幕文件下载失败（HTTP ${fileResponse.status}）` });
    return;
  }

  sendJson(response, 200, {
    text: await fileResponse.text(),
    fileName: info.file_name || 'subtitle.srt',
    remaining: typeof info.remaining === 'number' ? info.remaining : -1
  });
}

function createOpenSubtitlesMiddleware() {
  return async function openSubtitlesMiddleware(request, response, next) {
    if (!request.url || !request.url.startsWith(ROUTE_PREFIX)) {
      next();
      return;
    }

    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      });
      response.end();
      return;
    }

    // 延迟到请求时才读，避免早于 Expo 载入 .env
    const apiKey = (process.env.OPENSUBTITLES_API_KEY || '').trim();
    if (!apiKey) {
      sendJson(response, 500, {
        error: '开发服务器没读到 OPENSUBTITLES_API_KEY，请在 .env 里配置后重启 expo start'
      });
      return;
    }

    try {
      if (url.pathname === `${ROUTE_PREFIX}/search`) {
        await handleSearch(url, apiKey, response);
        return;
      }
      if (url.pathname === `${ROUTE_PREFIX}/download` && request.method === 'POST') {
        await handleDownload(request, apiKey, response);
        return;
      }
      sendJson(response, 404, { error: `未知的代理路径 ${url.pathname}` });
    } catch (error) {
      sendJson(response, 500, { error: `代理请求失败：${error.message}` });
    }
  };
}

module.exports = { createOpenSubtitlesMiddleware, ROUTE_PREFIX };
