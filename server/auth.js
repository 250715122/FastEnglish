/**
 * 密码用 Node 内置的 scrypt，不引第三方库：scrypt 本身就是为抗暴力破解设计的，
 * 参数一起存进哈希串，将来调高成本也不用让老用户重设密码。
 *
 * 会话用随机令牌存表，而不是 JWT——自建服务最需要的是「立刻踢下线」，
 * JWT signed 之后在过期前撤不掉。
 */
const crypto = require('node:crypto');
const { connect } = require('./db');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 6;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;

    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
    // 逐字节比较会因为提前返回而泄漏信息，必须用定时安全比较
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createUser(username, password, displayName) {
  const name = String(username || '').trim();
  if (name.length < 2) throw new Error('用户名至少两个字符');
  if (String(password || '').length < MIN_PASSWORD) {
    throw new Error(`密码至少 ${MIN_PASSWORD} 位`);
  }

  const db = connect();
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  if (exists) throw new Error('这个用户名已经被用了');

  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(name, hashPassword(password), String(displayName || name).trim() || name, Date.now());

  return { id: Number(info.lastInsertRowid), username: name, displayName: String(displayName || name) };
}

function login(username, password) {
  const db = connect();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());

  // 用户不存在时也走一遍哈希，免得响应快慢暴露了哪些用户名是真的
  const stored = row ? row.password_hash : hashPassword('placeholder');
  if (!verifyPassword(password, stored) || !row) return null;

  return { user: publicUser(row), token: issueToken(row.id) };
}

function issueToken(userId) {
  const db = connect();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now,
    now + SESSION_TTL
  );
  return token;
}

function resolveToken(token) {
  if (!token) return null;
  const db = connect();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, Date.now());
  return row ? publicUser(row) : null;
}

function logout(token) {
  if (!token) return;
  connect().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/**
 * 把这个人的会话全撤掉。keepToken 留给「改完密码但自己别被踢」的情况。
 * 会话存在表里而不是签名令牌，就是为了能做到这件事。
 */
function logoutAll(userId, keepToken) {
  const db = connect();
  if (keepToken) {
    return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken)
      .changes;
  }
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

function sessionCount(userId) {
  const row = connect()
    .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND expires_at > ?')
    .get(userId, Date.now());
  return row.count;
}

/**
 * 改密码要验旧密码——令牌可能是别人从没锁屏的机器上顺走的，
 * 光凭令牌就能改密码等于把账号送出去。
 *
 * 改完顺手把其它会话踢掉：会想改密码，多半就是怀疑密码泄露了。
 */
function changePassword(userId, currentPassword, newPassword, keepToken) {
  const db = connect();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) throw new Error('账号不存在');
  if (!verifyPassword(currentPassword, row.password_hash)) throw new Error('当前密码不对');
  if (String(newPassword || '').length < MIN_PASSWORD) {
    throw new Error(`新密码至少 ${MIN_PASSWORD} 位`);
  }
  if (verifyPassword(newPassword, row.password_hash)) throw new Error('新密码和旧的一样');

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  return { revoked: logoutAll(userId, keepToken) };
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

function tokenFrom(request) {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** 挂在需要登录的路由前面，成功后 request.user 就有了 */
function requireAuth(request, response, next) {
  const user = resolveToken(tokenFrom(request));
  if (!user) {
    response.status(401).json({ error: '请先登录' });
    return;
  }
  request.user = user;
  next();
}

/** 定期清掉过期会话，不然 sessions 表只涨不缩 */
function pruneSessions() {
  connect().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

module.exports = {
  createUser,
  login,
  logout,
  logoutAll,
  sessionCount,
  changePassword,
  requireAuth,
  resolveToken,
  tokenFrom,
  pruneSessions,
  publicUser
};
