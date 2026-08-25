/**
 * 把文件版时代的学习记录搬进数据库。
 *
 * 那时候没有用户概念，所有数据是一个人的，所以要指定归给谁：
 *   npm run migrate -- --user 我的用户名
 *
 * 跑第二遍不会重复插入（收藏和注释都有 UNIQUE 约束），可以放心重试。
 */
const fs = require('node:fs');
const path = require('node:path');
const { connect, transaction } = require('./db');

const VOCAB_DIR = path.join(__dirname, '..', 'vocab');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function findUser(username) {
  const row = connect().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) {
    const all = connect().prepare('SELECT username FROM users').all();
    const hint = all.length ? all.map((u) => u.username).join('、') : '（一个都还没有，先在网页上注册）';
    throw new Error(`找不到用户「${username}」。现有用户：${hint}`);
  }
  return row;
}

function migrateFor(userId) {
  const mastery = readJson(path.join(VOCAB_DIR, 'mastery.json'), { words: [] });
  const favorites = readJson(path.join(VOCAB_DIR, 'favorites.json'), { items: [] });
  const notes = readJson(path.join(VOCAB_DIR, 'notes.json'), { items: [] });

  return transaction((db) => {
    const now = Date.now();
    let counts = { mastery: 0, favorites: 0, notes: 0 };

    const addWord = db.prepare(
      'INSERT INTO mastery (user_id, word, mastered_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
    );
    for (const word of mastery.words || []) {
      const clean = String(word || '').trim().toLowerCase();
      if (!clean) continue;
      addWord.run(userId, clean, now);
      counts.mastery += 1;
    }

    const addFavorite = db.prepare(
      `INSERT INTO favorites (user_id, video_key, video_label, seg_index, start, end, en, zh, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    );
    for (const item of favorites.items || []) {
      if (!item?.videoKey || !Number.isInteger(item.index)) continue;
      addFavorite.run(
        userId,
        item.videoKey,
        item.videoLabel || item.videoKey,
        item.index,
        Number(item.start) || 0,
        Number(item.end) || 0,
        String(item.en || ''),
        String(item.zh || ''),
        Number(item.savedAt) || now
      );
      counts.favorites += 1;
    }

    const addNote = db.prepare(
      `INSERT INTO notes (user_id, video_key, video_label, seg_index, start, end, en, zh, text, saved_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    );
    for (const item of notes.items || []) {
      const text = String(item?.text || '').trim();
      if (!item?.videoKey || !Number.isInteger(item.index) || !text) continue;
      addNote.run(
        userId,
        item.videoKey,
        item.videoLabel || item.videoKey,
        item.index,
        Number(item.start) || 0,
        Number(item.end) || 0,
        String(item.en || ''),
        String(item.zh || ''),
        text,
        Number(item.savedAt) || now,
        Number(item.updatedAt) || Number(item.savedAt) || now
      );
      counts.notes += 1;
    }

    return counts;
  });
}

function main() {
  const index = process.argv.indexOf('--user');
  const username = index >= 0 ? process.argv[index + 1] : null;
  if (!username) {
    console.error('用法：npm run migrate -- --user <用户名>');
    process.exit(1);
  }

  connect();
  const user = findUser(username);
  const counts = migrateFor(user.id);

  console.log(`已导入到「${user.username}」：`);
  console.log(`  掌握的词 ${counts.mastery} 个`);
  console.log(`  收藏 ${counts.favorites} 条`);
  console.log(`  注释 ${counts.notes} 条`);
  console.log('原来的 vocab/*.json 没有动，确认无误后可以自行删除。');
}

if (require.main === module) main();

module.exports = { migrateFor };
