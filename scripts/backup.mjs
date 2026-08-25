/**
 * 备份用户数据库。
 *
 * 不能直接拷 data/fastenglish.db 了事：库开着 WAL，最近的写入还躺在
 * fastenglish.db-wal 里没并回主文件（实测能有好几 MB）。只拷主文件
 * 就是把最近一段时间的收藏、注释、掌握记录全丢掉，而且丢得无声无息——
 * 拷出来的文件能正常打开，只是内容旧了。
 *
 * VACUUM INTO 会生成一个已经合并完、自带完整 schema 的单文件副本，
 * 服务开着跑也安全，不用停机。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.FASTENGLISH_DATA_DIR || path.join(import.meta.dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fastenglish.db');

if (!existsSync(DB_PATH)) {
  console.error(`找不到数据库：${DB_PATH}`);
  console.error('后端还一次都没跑起来过？先 npm run server 建库。');
  process.exit(1);
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, '')
  .replace('T', '-');

const outDir = process.argv[2] || path.join(DATA_DIR, 'backups');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `fastenglish-${stamp}.db`);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();

// 立刻打开验一遍，免得留下一个坏备份还以为万事大吉
const copy = new DatabaseSync(out, { readOnly: true });
const counts = ['users', 'movies', 'favorites', 'notes', 'mastery']
  .map((table) => `${table} ${copy.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c}`)
  .join('  ');
copy.close();

console.log(`已备份到 ${out}`);
console.log(`大小 ${(statSync(out).size / 1024).toFixed(0)} KB`);
console.log(`内容 ${counts}`);
console.log('这一个文件就是全部用户数据，换机器时拷它，改名成 fastenglish.db 放进新机器的 data/ 即可。');
