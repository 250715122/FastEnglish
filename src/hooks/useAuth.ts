import { useCallback, useEffect, useState } from 'react';
import { api, loadToken, saveToken } from '../lib/api';

export type User = {
  id: number;
  username: string;
  displayName: string;
  createdAt?: number;
};

type Status = 'loading' | 'anonymous' | 'authenticated';

/**
 * 令牌存在设备上，重开应用不用再登一次。
 * 启动时拿它问一次 /me：服务端换了库或者会话被清掉时，本地这份就该作废。
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hasUsers, setHasUsers] = useState(true);
  /** 挂到公网后注册要凭邀请码，甚至可能整个关掉，登录页得照着这个变 */
  const [gate, setGate] = useState({ canRegister: true, needsInvite: false });
  /** 这个账号当前有多少台设备还登着，改密码那一栏拿它说话 */
  const [sessions, setSessions] = useState(1);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 一个用户都没有时默认展示注册，省得第一次用的人还要找入口
      try {
        const info = await api<{ hasUsers: boolean; canRegister?: boolean; needsInvite?: boolean }>(
          '/api/auth/status',
          { anonymous: true }
        );
        if (cancelled) return;
        setHasUsers(info.hasUsers);
        // 老版本后端不返回这两个字段，那就按原来的敞开处理
        setGate({ canRegister: info.canRegister ?? true, needsInvite: info.needsInvite ?? false });
      } catch {
        // 服务端没起来，下面的 /me 会走到同一个失败分支
      }

      const token = await loadToken();
      if (!token) {
        if (!cancelled) setStatus('anonymous');
        return;
      }

      try {
        const payload = await api<{ user: User; sessions: number }>('/api/auth/me');
        if (cancelled) return;
        setUser(payload.user);
        setSessions(payload.sessions ?? 1);
        setStatus('authenticated');
      } catch {
        await saveToken(null);
        if (!cancelled) setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enter = useCallback(async (path: string, body: Record<string, string>) => {
    setError(null);
    try {
      const payload = await api<{ user: User; token: string }>(path, {
        method: 'POST',
        body,
        anonymous: true
      });
      await saveToken(payload.token);
      setUser(payload.user);
      setStatus('authenticated');
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      return false;
    }
  }, []);

  const login = useCallback(
    (username: string, password: string) => enter('/api/auth/login', { username, password }),
    [enter]
  );

  const register = useCallback(
    (username: string, password: string, displayName: string, invite = '') =>
      enter('/api/auth/register', { username, password, displayName, invite }),
    [enter]
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // 服务端已经不认这个令牌了也无所谓，本地清掉就是登出
    }
    await saveToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    // 服务端不踢发起改密码的这台，本地令牌照旧能用，不用重新登
    const payload = await api<{ revoked: number }>('/api/auth/password', {
      method: 'POST',
      body: { currentPassword, newPassword }
    });
    setSessions(1);
    return payload.revoked;
  }, []);

  const logoutOthers = useCallback(async () => {
    const payload = await api<{ revoked: number }>('/api/auth/logout-all', { method: 'POST' });
    setSessions(1);
    return payload.revoked;
  }, []);

  return {
    user,
    status,
    error,
    hasUsers,
    canRegister: gate.canRegister,
    needsInvite: gate.needsInvite,
    sessions,
    login,
    register,
    logout,
    changePassword,
    logoutOthers
  };
}
