import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * 后端从 Metro 中间件里拆出来独立跑了，所以地址不再等于开发服务器。
 *
 * 优先用 EXPO_PUBLIC_API_BASE；没配就猜：网页端同机换端口，
 * 原生端把 Expo 报的开发机 IP 拿来换端口——手机连的是局域网，localhost 指向手机自己。
 */
const DEFAULT_PORT = 4000;

function guessBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE;
  if (configured) return configured.replace(/\/+$/, '');

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location) {
      return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_PORT}`;
    }
    return `http://localhost:${DEFAULT_PORT}`;
  }

  // hostUri 形如 192.168.1.5:8081
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri ? hostUri.split(':')[0] : 'localhost';
  return `http://${host}:${DEFAULT_PORT}`;
}

export const API_BASE = guessBase();

/**
 * 后端是不是在局域网外面。
 *
 * 判据只看地址，不去实测：私网地址（含 localhost 和 *.local）算内网，
 * 其余一律算外网——公网域名、隧道给的 trycloudflare 域名、Tailscale 的
 * 100.64/10 都落在这一边。它们的共同点是流量要出这台机器的家门，
 * 上行带宽和往返延迟都不再是局域网的量级。
 *
 * 界面拿它决定默认走听模式还是看模式：在外面听模式一小时只要 29 MB，
 * 看模式动辄 2 GB，默认反了的话用户是要付流量费的。
 */
function looksRemote(base: string): boolean {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (host === 'localhost' || host.endsWith('.local') || host === '::1') return false;

  const parts = host.split('.');
  const octets = parts.length === 4 ? parts.map(Number) : null;
  if (!octets || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // 不是 IPv4 就是域名，自建服务的域名一定是往外走的
    return true;
  }

  const [a, b] = octets;
  if (a === 127) return false;
  if (a === 10) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 169 && b === 254) return false;
  // 100.64/10 是运营商级 NAT 段，Tailscale 用的就是它：不在同一个局域网里
  return true;
}

export const REMOTE = looksRemote(API_BASE);

const TOKEN_KEY = 'fastenglish.token';

/** 内存里留一份，省得每个请求都去读一次存储 */
let cachedToken: string | null = null;

export async function loadToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export async function saveToken(token: string | null): Promise<void> {
  cachedToken = token;
  try {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // 存不进去也不致命，本次会话仍然可用
  }
}

export function currentToken(): string | null {
  return cachedToken;
}

/**
 * 给一次 fetch 加上超时。
 *
 * 别用 `AbortSignal.timeout()`——iOS 上的 JS 引擎至今没有这个静态方法，
 * 调用当场抛「AbortSignal.timeout is not a function」，请求还没发出去就断了。
 * 浏览器里跑得好好的，上了手机整个功能就是哑的，非常难猜。
 * 老老实实用 AbortController 加一个定时器，哪儿都认。
 */
export function withTimeout(ms: number): {
  signal: AbortSignal | undefined;
  /** 请求收尾时撤掉定时器，别让它到点了去 abort 一个已经结束的请求 */
  clear: () => void;
  /** 这次失败是不是因为等超了 */
  expired: () => boolean;
} {
  if (typeof AbortController === 'undefined') {
    return { signal: undefined, clear: () => undefined, expired: () => false };
  }
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
    expired: () => expired
  };
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** 登录、注册这类请求本来就没有令牌，不该被拦下来 */
  anonymous?: boolean;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body, anonymous } = options;
  const token = anonymous ? null : await loadToken();

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error || `请求失败（${response.status}）`);
  }
  return payload as T;
}

/**
 * 视频地址要交给播放器，播放器发的请求带不上 Authorization 头，
 * 所以这一条把令牌放进查询串。仅限串流，别的接口一律走请求头。
 */
export function streamUrl(movieId: number): string {
  const token = currentToken();
  return `${API_BASE}/api/movies/${movieId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/**
 * 听模式放的是服务端切好的 HLS 播放列表，同样交给播放器，同样只能把令牌放进查询串。
 *
 * 不用整段 MP4：那种格式起播前必须先连续拿到文件头的索引表，两小时的片子约 1.4 MB，
 * 外网几十 KB/s 抖一下就前功尽弃。HLS 起播只要列表加一个几十 KB 的分片，
 * 断了也只重取那一个分片。
 *
 * attempt 用来重试。iOS 的 AVPlayer 一旦因为连接中断把某个 asset 判成失败，
 * 同一个地址就会一直复用那个坏状态——切回好网络也救不回来。地址变了才会重新建一个，
 * 所以重试时把序号缀上去。服务端只认 token，多出来的参数会被忽略。
 */
export function audioUrl(movieId: number, attempt = 0): string {
  const token = currentToken();
  const query = new URLSearchParams();
  if (token) query.set('token', token);
  if (attempt > 0) query.set('r', String(attempt));
  const suffix = query.toString();
  return `${API_BASE}/api/movies/${movieId}/audio.m3u8${suffix ? `?${suffix}` : ''}`;
}

/** 字幕、词典这些老接口现在也在后端上，路径没变，只是换了主机 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * 给自己拼 fetch 的地方补上令牌。
 *
 * 字幕和词典那几个接口需要对超时、AbortSignal 做细致控制，用不了上面的 api()，
 * 只能裸调 fetch；但它们现在同样要登录（见 server/index.js 里的 requireAuth），
 * 漏了这个头就是 401。
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await loadToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
