const express = require('express');
const {
  changePassword,
  createUser,
  login,
  logout,
  logoutAll,
  requireAuth,
  sessionCount,
  tokenFrom
} = require('../auth');
const { connect } = require('../db');

const router = express.Router();

/** 空字符串等于没配，别让 .env 里留了个空值就当成一串真的邀请码 */
const inviteCode = String(process.env.FASTENGLISH_INVITE_CODE || '').trim();

function userCount() {
  return connect().prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

/**
 * 谁能注册。
 *
 * 一台机器都没往公网上放的时候，敞开注册最省事；可一旦挂上隧道，
 * 任何人扫到地址就能开号、翻你共享的片子、往你硬盘上传东西。
 * 所以：第一个账号随便建（总得有人开张），之后必须凭邀请码。
 * 没配邀请码就等于关闭注册——宁可让你多配一行，也不能默认敞着。
 */
function registerBlockedBy(invite) {
  if (userCount() === 0) return null;
  if (!inviteCode) return '注册已关闭。要放开的话，在后端的 .env 里配 FASTENGLISH_INVITE_CODE 再重启。';
  if (String(invite || '').trim() !== inviteCode) return '邀请码不对';
  return null;
}

router.post('/register', (request, response) => {
  const { username, password, displayName, invite } = request.body || {};
  const blocked = registerBlockedBy(invite);
  if (blocked) {
    response.status(403).json({ error: blocked });
    return;
  }
  try {
    const user = createUser(username, password, displayName);
    const session = login(username, password);
    response.status(201).json({ user, token: session.token });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

router.post('/login', (request, response) => {
  const { username, password } = request.body || {};
  const session = login(username, password);
  if (!session) {
    response.status(401).json({ error: '用户名或密码不对' });
    return;
  }
  response.json(session);
});

router.post('/logout', (request, response) => {
  logout(tokenFrom(request));
  response.json({ ok: true });
});

/** 前端启动时拿它验证本地存的令牌还有没有效 */
router.get('/me', requireAuth, (request, response) => {
  response.json({ user: request.user, sessions: sessionCount(request.user.id) });
});

router.post('/password', requireAuth, (request, response) => {
  const { currentPassword, newPassword } = request.body || {};
  try {
    // 自己这台不踢，否则改完密码当场被弹回登录页，白输一遍
    const result = changePassword(request.user.id, currentPassword, newPassword, tokenFrom(request));
    response.json({ ok: true, ...result });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

/** 在别人机器上登过又忘了退，只能从自己这台一次性撤干净 */
router.post('/logout-all', requireAuth, (request, response) => {
  const revoked = logoutAll(request.user.id, tokenFrom(request));
  response.json({ ok: true, revoked });
});

/** 登录页拿它决定默认展示登录还是注册、要不要多问一个邀请码 */
router.get('/status', (request, response) => {
  const count = userCount();
  response.json({
    hasUsers: count > 0,
    userCount: count,
    // 有人了就得凭码进；没配码就是彻底关闭，页面上直接把注册收起来
    needsInvite: count > 0 && !!inviteCode,
    canRegister: count === 0 || !!inviteCode
  });
});

module.exports = router;
