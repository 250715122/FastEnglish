import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Tailscale Funnel：拿一个固定的 https 域名把本机端口挂到公网上。
 *
 * 和 Cloudflare 快速隧道比，最大的区别是**配置是留在 tailscaled 里的**，
 * 不需要有个进程一直开着，机器重启也还在。所以这里干的事只是
 * 「确认配置对不对」，而不是「起一条隧道」。
 *
 * Funnel 只让用 443、8443、10000 三个端口，正好够我们分两个服务：
 * 443 给 Metro（Expo Go 要输的就是这个），8443 给后端接口。
 * 不走路径分流是因为 --set-path 会把前缀吃掉，后端收到的路径就对不上了。
 *
 * 带宽要有心理准备：官方只说「受不可配置的带宽限制」，实测公网路径
 * 只有 0.7～1.4 Mbps（Cloudflare 快速隧道同一台机器能到 14.5）。
 * 听、读、写三个模式绰绰有余，看模式（要 5 Mbps）跑不动。
 * 手机装上 Tailscale 的话走的是直连而不是 Funnel 中继，同样的域名会快得多。
 */
const EXE = ['C:\\Program Files\\Tailscale\\tailscale.exe', '/usr/bin/tailscale', '/usr/local/bin/tailscale'].find(
  (path) => existsSync(path)
) ?? 'tailscale';

export const FUNNEL_METRO_PORT = 443;
export const FUNNEL_API_PORT = 8443;

function run(args) {
  return execFileSync(EXE, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function status() {
  let raw;
  try {
    raw = run(['status', '--json']);
  } catch (error) {
    throw new Error(`tailscale 跑不起来：${error.message.split('\n')[0]}。装了吗？`);
  }
  // Windows 上这类输出常常带个 BOM，JSON.parse 见了直接抛
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

const TRAY = 'C:\\Program Files\\Tailscale\\tailscale-ipn.exe';

/**
 * Windows 上 tailscaled 服务把用户档案交给托盘程序管，托盘没起来的话
 * 服务显示 Running 但后端一直卡在 NoState，funnel 命令会报
 * 「unexpected state: NoState」。服务状态完全看不出问题在哪，
 * 所以这里自己把托盘拉起来，别让人去猜。
 */
function wakeBackend() {
  if (process.platform !== 'win32' || !existsSync(TRAY)) return false;
  spawn(TRAY, [], { detached: true, stdio: 'ignore' }).unref();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if (status().BackendState === 'Running') return true;
    } catch {
      // 起来之前查不到是正常的
    }
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},1500)']);
  }
  return false;
}

/** 没装、没登录、没开 MagicDNS 的话，早点说清楚是哪一样 */
export function funnelHost() {
  let current = status();
  if (current.BackendState !== 'Running') {
    console.log(`[funnel] 后端还是 ${current.BackendState}，把 Tailscale 托盘拉起来……`);
    if (wakeBackend()) current = status();
  }
  if (current.BackendState !== 'Running') {
    throw new Error(
      `tailscale 还没连上（当前状态 ${current.BackendState}）。` +
        '登录过没有？没有就跑一次 tailscale up；登录过的话手动开一下 Tailscale 托盘程序。'
    );
  }

  const dns = String(current.Self?.DNSName ?? '').replace(/\.$/, '');
  if (!dns) throw new Error('拿不到 MagicDNS 名字，去 Tailscale 后台确认 MagicDNS 是开着的。');
  return dns;
}

/**
 * `tailscale funnel status` 长这样，解析出「公网端口 -> 本地端口」：
 *
 *   https://host (Funnel on)
 *   |-- / proxy http://127.0.0.1:8081
 *
 *   https://host:8443 (Funnel on)
 *   |-- / proxy http://127.0.0.1:4000
 *
 * 注意 443 那条不带端口后缀——照着 `:443` 去找是找不到的。
 */
function currentMapping() {
  let text = '';
  try {
    text = run(['funnel', 'status']);
  } catch {
    return new Map(); // 一条都没配过时这命令会报错
  }

  const mapping = new Map();
  let publicPort = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const header = line.match(/^https:\/\/[^\s:]+(?::(\d+))?\s+\(Funnel on\)/);
    if (header) {
      publicPort = Number(header[1] ?? 443);
      continue;
    }
    const proxy = line.match(/proxy\s+http:\/\/127\.0\.0\.1:(\d+)/);
    if (proxy && publicPort !== null) mapping.set(publicPort, Number(proxy[1]));
  }
  return mapping;
}

/**
 * 把两个端口挂上去。已经挂好了就什么都不做——
 * Funnel 的配置是持久的，重复设置只会白白触发一次证书检查。
 */
export function ensureFunnel(metroPort, apiPort) {
  const want = [
    { publicPort: FUNNEL_METRO_PORT, local: metroPort, label: 'Metro' },
    { publicPort: FUNNEL_API_PORT, local: apiPort, label: '后端' }
  ];

  const current = currentMapping();
  const applied = [];
  for (const entry of want) {
    if (current.get(entry.publicPort) === entry.local) continue;
    try {
      run(['funnel', '--bg', `--https=${entry.publicPort}`, String(entry.local)]);
      applied.push(entry.label);
    } catch (error) {
      const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message;
      throw new Error(`${entry.label} 挂 Funnel 失败：\n${detail}`);
    }
  }
  return applied;
}

export function funnelUrls(host) {
  return {
    metroBase: `https://${host}`,
    apiBase: `https://${host}:${FUNNEL_API_PORT}`
  };
}
