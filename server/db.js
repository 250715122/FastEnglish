/**
 * 用户数据库。词典是只读的几十 MB 数据，和这里的读写完全无关，单独一个库，
 * 备份这个文件就等于备份了所有人的学习记录。
 *
 * 用 Node 24 内置的 node:sqlite，省掉原生模块编译——Windows 上装 better-sqlite3
 * 经常卡在构建工具上。
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.FASTENGLISH_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fastenglish.db');

/** 每次加表加字段就往后追加一条，已经跑过的不会重复执行 */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  -- 片库是服务器扫 MOVIE_ROOT 得到的，全体用户共用一份；
  -- 谁在学哪部片是 study_items 的事
  CREATE TABLE movies (
    id       INTEGER PRIMARY KEY,
    path     TEXT NOT NULL UNIQUE,
    name     TEXT NOT NULL,
    title    TEXT NOT NULL,
    size     INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    seen_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_movies_name ON movies(name);

  CREATE TABLE study_items (
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id       INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    added_at       INTEGER NOT NULL,
    last_opened_at INTEGER,
    last_position  REAL NOT NULL DEFAULT 0,
    subtitle_label TEXT,
    PRIMARY KEY (user_id, movie_id)
  );

  -- video_key 用的是片名而不是 movie_id：临时选的本地文件不在片库里也要能收藏，
  -- 而且换一版字幕后下标可能对不上，留着时间点和原文才有得对照
  CREATE TABLE favorites (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_key   TEXT NOT NULL,
    video_label TEXT NOT NULL,
    seg_index   INTEGER NOT NULL,
    start       REAL NOT NULL DEFAULT 0,
    end         REAL NOT NULL DEFAULT 0,
    en          TEXT NOT NULL DEFAULT '',
    zh          TEXT NOT NULL DEFAULT '',
    saved_at    INTEGER NOT NULL,
    UNIQUE (user_id, video_key, seg_index)
  );
  CREATE INDEX idx_favorites_user_time ON favorites(user_id, saved_at DESC);

  CREATE TABLE notes (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_key   TEXT NOT NULL,
    video_label TEXT NOT NULL,
    seg_index   INTEGER NOT NULL,
    start       REAL NOT NULL DEFAULT 0,
    end         REAL NOT NULL DEFAULT 0,
    en          TEXT NOT NULL DEFAULT '',
    zh          TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL,
    saved_at    INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE (user_id, video_key, seg_index)
  );
  CREATE INDEX idx_notes_user_time ON notes(user_id, saved_at DESC);

  -- 一个词学会了，换部片子也不该再当生词，所以只按用户存，不挂到电影上
  CREATE TABLE mastery (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    word        TEXT NOT NULL,
    mastered_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, word)
  );
  `,

  /**
   * 片子有了归属。原先扫 MOVIE_ROOT 得到的那些是服务器上本来就有的文件，
   * 不属于任何人，默认值正好把它们留成「无主 + 公开」。
   * 用户自己传上来的归自己，默认私有，愿意分享时再改成公开。
   */
  `
  ALTER TABLE movies ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE movies ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
  ALTER TABLE movies ADD COLUMN source TEXT NOT NULL DEFAULT 'scan';
  CREATE INDEX idx_movies_owner ON movies(owner_id);
  `
];

let db = null;

function connect() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);

  // WAL 让读写不互相阻塞：一个人在写注释时，别人还能正常查列表
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  migrate();
  return db;
}

function migrate() {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      // user_version 不接受参数绑定，只能拼进语句；version 是循环下标，不是外部输入
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`数据库迁移第 ${version + 1} 步失败：${error.message}`);
    }
  }
}

/** 写多条时包一层事务，中途失败不会留下半截数据 */
function transaction(work) {
  const handle = connect();
  handle.exec('BEGIN');
  try {
    const result = work(handle);
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { connect, transaction, DB_PATH, DATA_DIR };
