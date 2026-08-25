/**
 * 停掉本地跑着的服务。
 *
 * 平时 Ctrl+C 就够了，这个脚本是给「终端已经关了但进程还在」的情况准备的——
 * 那时候端口被占着，再启动只会报 EADDRINUSE，得先找出是谁占的。
 *
 *   npm run stop            停后端(4000) + Metro(8081)，顺带收拾残留的 cloudflared
 *   npm run stop -- --funnel 再把 Tailscale Funnel 也撤掉（公网地址立刻失效）
 *
 * Funnel 要单独一步：它的配置存在 tailscaled 里，不属于任何一个进程，
 * 关终端、重启电脑都还在，只有 tailscale funnel reset 能收回。
 */
import { execFileSync } from 'node:child_process';

const API_PORT = Number(process.env.FASTENGLISH_PORT || 4000);
const METRO_PORT = Number(process.env.RCT_METRO_PORT || 8081);
const win = process.platform === 'win32';

function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** 找出监听某个端口的进程号 */
function listeners(port) {
  if (win) {
    // netstat 的输出列宽不固定，按空白切再取末列最稳
    return [
      ...new Set(
        run('netstat', ['-ano', '-p', 'TCP'])
          .split(/\r?\n/)
          .filter((line) => line.includes('LISTENING') && new RegExp(`[:.]${port}\\s`).test(line))
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && pid !== '0')
      )
    ];
  }
  return [...new Set(run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).split(/\s+/).filter(Boolean))];
}

function kill(pid) {
  // Windows 上要 /T：npm run server 之下还挂着真正监听的 node
  if (win) run('taskkill', ['/PID', pid, '/T', '/F']);
  else run('kill', ['-9', pid]);
}

let stopped = 0;
for (const [name, port] of [
  ['后端', API_PORT],
  ['Metro', METRO_PORT]
]) {
  const pids = listeners(port);
  if (!pids.length) {
    console.log(`${name}(${port})  本来就没跑`);
    continue;
  }
  for (const pid of pids) kill(pid);
  stopped += pids.length;
  console.log(`${name}(${port})  已停 PID ${pids.join('、')}`);
}

// public 模式的隧道是子进程，终端被强杀时会变成孤儿留在后台
const orphans = win
  ? [
      ...new Set(
        run('tasklist', ['/FI', 'IMAGENAME eq cloudflared.exe', '/FO', 'CSV', '/NH'])
          .split(/\r?\n/)
          .map((line) => line.split('","')[1])
          .filter(Boolean)
      )
    ]
  : run('pgrep', ['-f', 'cloudflared']).split(/\s+/).filter(Boolean);
if (orphans.length) {
  for (const pid of orphans) kill(pid);
  console.log(`cloudflared  收拾掉 ${orphans.length} 个残留进程`);
}

if (process.argv.includes('--funnel')) {
  const tailscale = win ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
  run(tailscale, ['funnel', 'reset']);
  console.log('Tailscale Funnel  已撤销，公网地址立刻失效（下次 npm run phone:funnel 会自动配回来）');
}

console.log(stopped ? '\n都停了。' : '\n没有在跑的服务。');
