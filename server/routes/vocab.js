/**
 * 收藏、注释、掌握度。全部按用户隔离。
 *
 * 和早先文件版最大的区别：早先是「把整份列表发上来覆盖」，多用户下两个人
 * 同时操作会互相抹掉对方的数据，连同一个人开两个页面都会。这里改成按记录增删改。
 */
const express = require('express');
const { connect } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const MAX_NOTE = 2000;

/** 收藏和注释存的是同一组定位信息，校验也就共用一份 */
function readAnchor(body) {
  const videoKey = String(body?.videoKey || '').trim();
  const index = Number(body?.index);
  if (!videoKey) throw new Error('缺少 videoKey');
  if (!Number.isInteger(index) || index < 0) throw new Error('index 必须是非负整数');

  return {
    videoKey,
    videoLabel: String(body.videoLabel || videoKey),
    index,
    start: Number(body.start) || 0,
    end: Number(body.end) || 0,
    en: String(body.en || ''),
    zh: String(body.zh || '')
  };
}

function rowToRecord(row) {
  return {
    id: `${row.video_key}#${row.seg_index}`,
    videoKey: row.video_key,
    videoLabel: row.video_label,
    index: row.seg_index,
    start: row.start,
    end: row.end,
    en: row.en,
    zh: row.zh,
    savedAt: row.saved_at,
    ...(row.text != null ? { text: row.text, updatedAt: row.updated_at } : {})
  };
}

function anchorFromQuery(query) {
  const videoKey = String(query.videoKey || '').trim();
  const index = Number(query.index);
  if (!videoKey || !Number.isInteger(index)) throw new Error('缺少 videoKey 或 index');
  return { videoKey, index };
}

// ---------------------------------------------------------------- 收藏

router.get('/favorites', (request, response) => {
  const rows = connect()
    .prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY saved_at DESC')
    .all(request.user.id);
  response.json({ items: rows.map(rowToRecord) });
});

router.put('/favorites', (request, response) => {
  try {
    const anchor = readAnchor(request.body);
    const db = connect();
    // 重复收藏同一句时保留最早的时间，列表顺序才不会因为误点而跳动
    db.prepare(
      `INSERT INTO favorites (user_id, video_key, video_label, seg_index, start, end, en, zh, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, video_key, seg_index) DO UPDATE SET
         video_label = excluded.video_label,
         start = excluded.start, end = excluded.end,
         en = excluded.en, zh = excluded.zh`
    ).run(
      request.user.id,
      anchor.videoKey,
      anchor.videoLabel,
      anchor.index,
      anchor.start,
      anchor.end,
      anchor.en,
      anchor.zh,
      Date.now()
    );

    const row = db
      .prepare('SELECT * FROM favorites WHERE user_id = ? AND video_key = ? AND seg_index = ?')
      .get(request.user.id, anchor.videoKey, anchor.index);
    response.json({ item: rowToRecord(row) });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete('/favorites', (request, response) => {
  try {
    const { videoKey, index } = anchorFromQuery(request.query);
    connect()
      .prepare('DELETE FROM favorites WHERE user_id = ? AND video_key = ? AND seg_index = ?')
      .run(request.user.id, videoKey, index);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------- 注释

router.get('/notes', (request, response) => {
  const rows = connect()
    .prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY saved_at DESC')
    .all(request.user.id);
  response.json({ items: rows.map(rowToRecord) });
});

router.put('/notes', (request, response) => {
  try {
    const anchor = readAnchor(request.body);
    const text = String(request.body?.text || '').trim().slice(0, MAX_NOTE);
    // 注释的正文就是它存在的理由，清空等于删掉这条
    if (!text) {
      connect()
        .prepare('DELETE FROM notes WHERE user_id = ? AND video_key = ? AND seg_index = ?')
        .run(request.user.id, anchor.videoKey, anchor.index);
      response.json({ item: null });
      return;
    }

    const now = Date.now();
    const db = connect();
    db.prepare(
      `INSERT INTO notes (user_id, video_key, video_label, seg_index, start, end, en, zh, text, saved_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, video_key, seg_index) DO UPDATE SET
         video_label = excluded.video_label,
         start = excluded.start, end = excluded.end,
         en = excluded.en, zh = excluded.zh,
         text = excluded.text, updated_at = excluded.updated_at`
    ).run(
      request.user.id,
      anchor.videoKey,
      anchor.videoLabel,
      anchor.index,
      anchor.start,
      anchor.end,
      anchor.en,
      anchor.zh,
      text,
      now,
      now
    );

    const row = db
      .prepare('SELECT * FROM notes WHERE user_id = ? AND video_key = ? AND seg_index = ?')
      .get(request.user.id, anchor.videoKey, anchor.index);
    response.json({ item: rowToRecord(row) });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.delete('/notes', (request, response) => {
  try {
    const { videoKey, index } = anchorFromQuery(request.query);
    connect()
      .prepare('DELETE FROM notes WHERE user_id = ? AND video_key = ? AND seg_index = ?')
      .run(request.user.id, videoKey, index);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------- 掌握的词

router.get('/mastery', (request, response) => {
  const rows = connect()
    .prepare('SELECT word FROM mastery WHERE user_id = ? ORDER BY word')
    .all(request.user.id);
  response.json({ words: rows.map((row) => row.word) });
});

router.put('/mastery', (request, response) => {
  const word = String(request.body?.word || '').trim().toLowerCase();
  if (!word) {
    response.status(400).json({ error: '缺少 word' });
    return;
  }

  const db = connect();
  if (request.body?.mastered === false) {
    db.prepare('DELETE FROM mastery WHERE user_id = ? AND word = ?').run(request.user.id, word);
  } else {
    db.prepare(
      'INSERT INTO mastery (user_id, word, mastered_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
    ).run(request.user.id, word, Date.now());
  }
  response.json({ word, mastered: request.body?.mastered !== false });
});

module.exports = router;
