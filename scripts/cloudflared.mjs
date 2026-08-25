import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * cloudflared 默认会读 ~/.cloudflared/config.yml。那里要是躺着别的项目留下的
 * ingress 规则，它的优先级压过命令行的 --url：请求进得来，却匹配不上任何一条
 * hostname，最后掉进兜底的 http_status:404。
 *
 * 现象极具误导性——cloudflared 日志里白纸黑字「Registered tunnel connection」，
 * 域名也打出来了，可你怎么访问都是 404，而且是从 Cloudflare 边缘返回的，
 * 看不出跟本机配置有关。所以这里塞一个空配置把它和全局那份隔开。
 */
function isolatedConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'fe-cf-'));
  const file = join(dir, 'config.yml');
  writeFileSync(file, '# 故意留空：本项目的隧道只按命令行的 --url 走\n');
  return file;
}

/**
 * 起一条 Cloudflare 快速隧道，把本机某个端口挂到一个临时的 https 域名上。
 *
 * 用「快速隧道」而不是具名隧道：不用账号、不用自己的域名，跑起来就给一个
 * *.trycloudflare.com。代价是每次重启域名都会变，而且 Cloudflare 对它不作
 * 可用性承诺。想要固定域名，见 README 里「换成固定域名」那一节。
 */
export function startTunnel(port, label) {
  const child = spawn(
    'cloudflared',
    ['tunnel', '--config', isolatedConfig(), '--url', `http://localhost:${port}`],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: false }
  );

  // 出问题时把日志尾巴带上，不然只剩一句「没给出地址」，无从查起
  const tail = [];
  const url = new Promise((resolve, reject) => {
    let settled = false;
    const scan = (chunk) => {
      const text = String(chunk);
      tail.push(text);
      if (tail.length > 20) tail.shift();
      const found = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (found && !settled) {
        settled = true;
        resolve(found[0]);
      }
    };
    child.stderr.on('data', scan);
    child.stdout.on('data', scan);
    child.on('error', (error) => {
      if (!settled) reject(new Error(`${label} 隧道起不来：${error.message}（cloudflared 装了吗？）`));
    });
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`${label} 隧道退出了（${code}）\n${tail.join('')}`));
    });
    setTimeout(() => {
      if (!settled) reject(new Error(`${label} 隧道 30 秒没给出地址\n${tail.join('')}`));
    }, 30000);
  });

  return { child, url };
}
