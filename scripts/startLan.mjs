/**
 * 起开发服务器，并把「手机该连哪个地址」这件事钉死。
 *
 * 装了 Hyper-V、VirtualBox、WSL 的机器上会多出好几块虚拟网卡，
 * Expo 挑网卡时挑中它们的话，二维码里给的是 172.x 或 192.168.56.x，
 * 手机压根路由不过去；更麻烦的是前端猜后端地址也跟着这个走，
 * 于是扫码能进 App，一登录就连不上。
 *
 * 这里让内核自己说了算：往外网地址开一个 UDP 套接字（不发包），
 * 内核按默认路由选出的源地址就是手机该连的那个。
 *
 *   npm run phone            起原生开发服务器，扫码用（同一个局域网）
 *   npm run phone -- --web   顺带开网页
 *   npm run phone -- --public 走 Cloudflare 快速隧道，人在外面也能连（地址每次都变）
 *   npm run phone -- --funnel 走 Tailscale Funnel，地址固定，不用每次重输
 *   npm run phone -- --fast  只用不改：包小一半多，开得快，但没有热更新
 *   npm run phone:funnel:fast 上面两个的常用组合：外网 + 只用不改
 */
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { startTunnel } from './cloudflared.mjs';
import { expoGoUrl, printQr } from './qr.mjs';
import { ensureFunnel, funnelHost, funnelUrls } from './tailscaleFunnel.mjs';

const API_PORT = Number(process.env.FASTENGLISH_PORT || 4000);
const METRO_PORT = Number(process.env.RCT_METRO_PORT || 8081);

const args = process.argv.slice(2);
const publicMode = args.includes('--public');
const funnelMode = args.includes('--funnel');
const fastMode = args.includes('--fast');
const OWN_FLAGS = new Set(['--public', '--funnel', '--fast']);
const passthrough = args.filter((arg) => !OWN_FLAGS.has(arg));

/**
 * Expo Go 每次打开都要把整个 bundle 重新拉一遍——Metro 发的是
 * Cache-Control: no-store，手机上留不下来；而且响应没有 Content-Length
 * （分块传输），不支持 Range，所以中断只能从 0 重来。这两条都改不动。
 *
 * 实测过网体积（gzip 后，不是解压后的那个数）：开发包 1.21 MB，生产包 0.51 MB，
 * 省 58%。Funnel 约 1 Mbps 下大概是 18 秒变 8 秒。
 * 回局域网（npm run phone）的话一秒之内就拉完，比什么都快。
 * 生产档另外的好处是跑起来更快：没有开发模式的各种检查和告警。
 *
 * 代价是没有热更新，报错也压成了一行。改代码的时候别用这个档。
 */
if (fastMode) passthrough.push('--no-dev', '--minify');

function outboundAddress() {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    socket.on('error', () => {
      socket.close();
      resolve(null);
    });
    // connect 只是让内核选路由，不会真发出数据
    socket.connect(53, '8.8.8.8', () => {
      const { address } = socket.address();
      socket.close();
      resolve(address && address !== '0.0.0.0' ? address : null);
    });
  });
}

/** 出网路由问不出来时的退路：挑一个像样的私网地址 */
function guessAddress() {
  const skip = /vEthernet|VirtualBox|Loopback|WSL|Hyper-V|蓝牙|本地连接/i;
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      return entry.address;
    }
  }
  return null;
}

/** .env 里显式填了就听他的，别拿探测出来的盖掉 */
function configuredBase() {
  if (process.env.EXPO_PUBLIC_API_BASE) return process.env.EXPO_PUBLIC_API_BASE;
  if (!existsSync('.env')) return null;
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((row) => row.startsWith('EXPO_PUBLIC_API_BASE='));
  const value = line?.slice('EXPO_PUBLIC_API_BASE='.length).trim();
  return value || null;
}

async function backendAlive(base) {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 外网模式：两条隧道，一条给后端接口，一条给 Metro。
 *
 * Metro 那条不能只把域名塞进 REACT_NATIVE_PACKAGER_HOSTNAME —— 那样拼出来的
 * bundle 地址是 http://，而快速隧道只认 https，手机取包会被卡在重定向上。
 * EXPO_PACKAGER_PROXY_URL 才是给「Metro 蹲在 https 反代后面」准备的那个开关，
 * 它会把清单里的 bundleUrl 整个换成隧道地址。
 */
async function goPublic() {
  console.log('[phone] 起 Cloudflare 隧道…（临时域名，每次重启都会变）');
  const api = startTunnel(API_PORT, '后端');
  const metro = startTunnel(METRO_PORT, 'Metro');
  const stop = () => {
    api.child.kill();
    metro.child.kill();
  };
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });

  try {
    return { apiBase: await api.url, metroBase: await metro.url, stop };
  } catch (error) {
    stop();
    console.error(`[phone] ${error.message}`);
    process.exit(1);
  }
}

/**
 * Funnel 模式：配置本来就留在 tailscaled 里，这里只是确认一下，
 * 所以没有要收拾的子进程，stop 是空的。
 */
function goFunnel() {
  const host = funnelHost();
  const applied = ensureFunnel(METRO_PORT, API_PORT);
  if (applied.length) console.log(`[phone] 挂上 Funnel：${applied.join('、')}`);
  else console.log('[phone] Funnel 早就配好了，直接用。');
  return { ...funnelUrls(host), stop: () => undefined, fixed: true };
}

const host = (await outboundAddress()) ?? guessAddress();
if (!host && !publicMode && !funnelMode) {
  console.error('[phone] 找不到局域网地址，这台机器可能没连网。');
  process.exit(1);
}

let tunnel = null;
if (funnelMode) {
  try {
    tunnel = goFunnel();
  } catch (error) {
    console.error(`[phone] ${error.message}`);
    process.exit(1);
  }
} else if (publicMode) {
  tunnel = await goPublic();
}
const configured = configuredBase();
// 外网模式下 .env 里那个局域网地址必然是错的，隧道地址优先
const apiBase = tunnel?.apiBase ?? configured ?? `http://${host}:${API_PORT}`;

console.log('');
if (tunnel) {
  // 新版 Expo Go 首页没有手动输入网址那一栏了，扫码是唯一顺手的入口
  const deepLink = expoGoUrl(tunnel.metroBase);
  printQr(deepLink);
  console.log('');
  console.log(`[phone] 用手机系统相机扫上面的码（不是 Expo Go 里扫）：${deepLink}`);
  console.log(`[phone] 网页版直接开：${tunnel.metroBase}`);
  console.log(`[phone] 后端接口：${apiBase}`);
  if (tunnel.fixed) {
    console.log('[phone] 这两个地址是固定的，存进 Expo Go 就不用再输了。');
    console.log('[phone] 公网可达，别外传；要收回去用 tailscale funnel reset。');
    console.log('[phone] Funnel 限速约 1 Mbps：听/读/写没问题，看模式会卡。');
    console.log('[phone] 想看画面就手机也装上 Tailscale（同样的地址，改走直连），或者换 npm run phone:public。');
  } else {
    console.log('[phone] 这两个域名公网可达，别外传；关掉这个终端隧道就断。');
  }
} else {
  const deepLink = `exp://${host}:${METRO_PORT}`;
  printQr(deepLink);
  console.log('');
  console.log(`[phone] 用手机系统相机扫上面的码：${deepLink}`);
  console.log(`[phone] 后端接口：${apiBase}${configured ? '（来自 .env）' : '（自动探测）'}`);
  console.log('[phone] 手机要和这台机器在同一个网段。');
}
if (fastMode) {
  console.log('[phone] 只用不改档：生产包 0.51 MB（开发包 1.21 MB），下载少一半多，跑得也更快；但改代码不会自动刷新。');
}
if (!(await backendAlive(`http://localhost:${API_PORT}`))) {
  console.log('[phone] ⚠ 后端没应答。另开一个终端跑 npm run server，否则登录会失败。');
}
console.log('');

const child = spawn('npx', ['expo', 'start', ...passthrough], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    // Expo 用它决定二维码和 hostUri 指向哪块网卡
    REACT_NATIVE_PACKAGER_HOSTNAME: tunnel ? new URL(tunnel.metroBase).host : host,
    ...(tunnel ? { EXPO_PACKAGER_PROXY_URL: tunnel.metroBase } : {}),
    EXPO_PUBLIC_API_BASE: apiBase
  }
});
child.on('exit', (code) => {
  tunnel?.stop();
  process.exit(code ?? 0);
});
