/**
 * 清掉端到端测试留下的空账号。
 *
 * 判据是「这个账号名下什么都没有」：没有片子、没有收藏、没有注释、
 * 没有掌握记录、没有学习列表。有任何一样就留着，宁可漏删不能误删。
 *
 * 测试账号常常也留下了 study_items 和 mastery（脚本点开过片子），
 * 按「名下空空」是筛不掉的，那就反过来点名保哪几个。
 *
 *   node scripts/pruneUsers.mjs                            预演，看哪些算空账号
 *   node scripts/pruneUsers.mjs --keep guote,wangyuting    预演，只保这两个
 *   node scripts/pruneUsers.mjs --keep guote --keep 王雨婷  写几遍也行，会累加
 *   node scripts/pruneUsers.mjs --keep guote --yes         真删
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { connect } = require('../server/db.js');

const db = connect();
const apply = process.argv.includes('--yes');

/**
 * --keep 可以写多遍，也可以逗号分隔，两种都收。
 * 早先只认第一个 --keep，多写的被默默丢掉——而这个脚本是删数据的，
 * 少收一个名字就是删掉一个不该删的号，不能靠使用者记住语法。
 */
const keepFlags = process.argv.reduce((list, arg, index) => {
  if (arg !== '--keep') return list;
  const value = process.argv[index + 1];
  if (value && !value.startsWith('--')) list.push(value);
  return list;
}, []);
const asked = process.argv.includes('--keep');
const keep = asked
  ? new Set(keepFlags.flatMap((v) => v.split(',')).map((n) => n.trim().toLowerCase()).filter(Boolean))
  : null;
if (keep && !keep.size) {
  console.error('--keep 后面要跟用户名，可以逗号分隔，也可以写多个 --keep');
  process.exit(1);
}

/** 哪些表按 user_id 挂人，哪些按 owner_id */
const owned = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'")
  .all()
  .flatMap((table) => {
    if (table.name === 'users' || table.name === 'sessions') return [];
    const column = /\bowner_id\b/.test(table.sql)
      ? 'owner_id'
      : /\buser_id\b/.test(table.sql)
        ? 'user_id'
        : null;
    return column ? [{ table: table.name, column }] : [];
  });

console.log(`按这些表判断账号是否空的：${owned.map((o) => `${o.table}.${o.column}`).join('、')}`);

const users = db.prepare('SELECT id, username, created_at FROM users ORDER BY id').all();
const rowsOf = (user) =>
  owned.map((o) => ({
    ...o,
    count: db.prepare(`SELECT COUNT(*) AS c FROM ${o.table} WHERE ${o.column} = ?`).get(user.id).c
  }));

const empty = users.filter((user) =>
  keep ? !keep.has(user.username.toLowerCase()) : rowsOf(user).every((r) => r.count === 0)
);

console.log(`${users.length} 个账号，要删 ${empty.length} 个。`);
console.log(`留下：${users.filter((u) => !empty.includes(u)).map((u) => u.username).join('、') || '（无）'}`);

// 点名保留时，被删的那些名下可能是有东西的，得让人看见自己在删什么
const carrying = keep
  ? empty
      .map((user) => ({ user, rows: rowsOf(user).filter((r) => r.count > 0) }))
      .filter((entry) => entry.rows.length)
  : [];
if (carrying.length) {
  console.log(`\n其中 ${carrying.length} 个名下还有东西：`);
  for (const entry of carrying.slice(0, 10)) {
    console.log(`  ${entry.user.username}：${entry.rows.map((r) => `${r.table} ${r.count}`).join('、')}`);
  }
  if (carrying.length > 10) console.log(`  …另外 ${carrying.length - 10} 个`);
}

if (!empty.length) process.exit(0);
if (!apply) {
  console.log(`\n这是预演。确认没问题就加 --yes 真删。`);
  console.log(`要删的：${empty.map((u) => u.username).join('、')}`);
  process.exit(0);
}

// 名下有数据还要删，就得再明说一次。--keep 少打一个名字太容易了，
// 而这种误删是不可逆的（只能从 data/ 里的备份捞）。
if (carrying.length && !process.argv.includes('--force')) {
  console.error(`\n停下：上面 ${carrying.length} 个账号名下有数据，不是空号。`);
  console.error('是不是 --keep 漏了名字？确实要连数据一起删的话，再加一个 --force。');
  process.exit(1);
}

db.exec('BEGIN');
try {
  const dropUser = db.prepare('DELETE FROM users WHERE id = ?');
  for (const user of empty) {
    // 外键的级联删除未必开着，名下的东西自己动手清干净
    for (const o of owned) {
      db.prepare(`DELETE FROM ${o.table} WHERE ${o.column} = ?`).run(user.id);
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    dropUser.run(user.id);
  }
  db.exec('COMMIT');
  console.log(`删掉了 ${empty.length} 个空账号。`);
} catch (error) {
  db.exec('ROLLBACK');
  console.error('出错了，已回滚：', error.message);
  process.exit(1);
}
