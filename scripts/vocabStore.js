/**
 * 单词掌握状态是跨电影共享的：一个词学会了，换部片子也不该再当生词。
 * 和字幕一样存成项目里的文件，换浏览器、换端口都还在。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROUTE_PREFIX = '/api/vocab';
const STORE_DIR = path.join(__dirname, '..', 'vocab');
const MASTERY_PATH = path.join(STORE_DIR, 'mastery.json');
const FAVORITES_PATH = path.join(STORE_DIR, 'favorites.json');
const NOTES_PATH = path.join(STORE_DIR, 'notes.json');

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

function readMastery() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MASTERY_PATH, 'utf8'));
    return Array.isArray(parsed.words) ? parsed.words : [];
  } catch {
    return [];
  }
}

function writeMastery(words) {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
  const unique = [...new Set(words.map((word) => String(word).toLowerCase()).filter(Boolean))].sort();
  fs.writeFileSync(MASTERY_PATH, JSON.stringify({ updatedAt: Date.now(), words: unique }, null, 2), 'utf8');
  return unique;
}

function readRecords(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

/**
 * 收藏和注释都要能带用户回到当时那一句，所以句子原文和它在哪部片、第几句都得一起存：
 * 换个版本的字幕后下标可能对不上，留着时间点和原文才有得对照。
 * 两者都按时间倒序存盘，读出来就是列表要的顺序。
 */
function writeRecords(file, items, extra) {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });

  const seen = new Set();
  const clean = [];
  for (const item of items) {
    const videoKey = String(item?.videoKey || '').trim();
    const index = Number(item?.index);
    if (!videoKey || !Number.isInteger(index) || index < 0) continue;
    const id = `${videoKey}#${index}`;
    if (seen.has(id)) continue;

    const base = {
      id,
      videoKey,
      videoLabel: String(item.videoLabel || videoKey),
      index,
      start: Number(item.start) || 0,
      end: Number(item.end) || 0,
      en: String(item.en || ''),
      zh: String(item.zh || ''),
      savedAt: Number(item.savedAt) || Date.now()
    };

    const record = extra ? extra(base, item) : base;
    if (!record) continue;
    seen.add(id);
    clean.push(record);
  }

  clean.sort((a, b) => b.savedAt - a.savedAt);
  fs.writeFileSync(file, JSON.stringify({ updatedAt: Date.now(), items: clean }, null, 2), 'utf8');
  return clean;
}

/** 注释的正文是它存在的理由，清空正文等于删掉这条 */
function withNoteText(base, item) {
  const text = String(item.text || '').trim().slice(0, 2000);
  if (!text) return null;
  return { ...base, text, updatedAt: Number(item.updatedAt) || base.savedAt };
}

function createVocabStoreMiddleware() {
  return async function vocabStoreMiddleware(request, response, next) {
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

    try {
      if (url.pathname === `${ROUTE_PREFIX}/mastery` && request.method === 'GET') {
        sendJson(response, 200, { words: readMastery() });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/mastery` && request.method === 'POST') {
        const payload = JSON.parse((await readBody(request)) || '{}');
        if (!Array.isArray(payload.words)) {
          sendJson(response, 400, { error: '缺少 words' });
          return;
        }
        sendJson(response, 200, { words: writeMastery(payload.words) });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/favorites` && request.method === 'GET') {
        sendJson(response, 200, { items: readRecords(FAVORITES_PATH) });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/favorites` && request.method === 'POST') {
        const payload = JSON.parse((await readBody(request)) || '{}');
        if (!Array.isArray(payload.items)) {
          sendJson(response, 400, { error: '缺少 items' });
          return;
        }
        sendJson(response, 200, { items: writeRecords(FAVORITES_PATH, payload.items) });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/notes` && request.method === 'GET') {
        sendJson(response, 200, { items: readRecords(NOTES_PATH) });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/notes` && request.method === 'POST') {
        const payload = JSON.parse((await readBody(request)) || '{}');
        if (!Array.isArray(payload.items)) {
          sendJson(response, 400, { error: '缺少 items' });
          return;
        }
        sendJson(response, 200, { items: writeRecords(NOTES_PATH, payload.items, withNoteText) });
        return;
      }

      sendJson(response, 404, { error: `未知的生词本路径 ${url.pathname}` });
    } catch (error) {
      sendJson(response, 500, { error: `生词本操作失败：${error.message}` });
    }
  };
}

module.exports = { createVocabStoreMiddleware, ROUTE_PREFIX, STORE_DIR };
