/**
 * 字幕、词典、OpenSubtitles 三个中间件共用的 JSON 响应。
 *
 * 它们是从 Metro 中间件时代搬过来的，各自用 writeHead + end 手写响应，
 * 不走 Express 的 res.json——所以挂在 Express 层的压缩中间件对它们无效，
 * 得在这里压。
 *
 * 为什么值得压：全片词典查询一次 400 KB，字幕一部片 113 KB，而 Tailscale
 * Funnel 实测下行只有 13~28 KB/s 且会波动。不压的话光等这一个响应就能超过
 * 前端 60 秒的超时，界面还会甩出「确认后端还在跑」这种指错方向的提示。
 * 词典那份压完只剩 86 KB。
 *
 * Accept-Encoding 从 response.req 上读，这样调用点的签名一个都不用改。
 */
const zlib = require('node:zlib');

/** 小响应压了省不下什么，白搭一次 CPU */
const MIN_GZIP_BYTES = 4096;

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store'
};

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));

  const plain = () => {
    response.writeHead(status, { ...BASE_HEADERS, 'Content-Length': body.length });
    response.end(body);
  };

  const accepted = response.req?.headers['accept-encoding'] || '';
  if (body.length < MIN_GZIP_BYTES || !/\bgzip\b/.test(accepted)) {
    plain();
    return;
  }

  zlib.gzip(body, (error, zipped) => {
    if (error) {
      plain();
      return;
    }
    response.writeHead(status, {
      ...BASE_HEADERS,
      'Content-Encoding': 'gzip',
      // 中间有缓存时，别把压过的版本发给不支持 gzip 的客户端
      Vary: 'Accept-Encoding',
      'Content-Length': zipped.length
    });
    response.end(zipped);
  });
}

module.exports = { sendJson };
