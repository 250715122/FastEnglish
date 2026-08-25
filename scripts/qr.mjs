/**
 * 把连接地址画成二维码。
 *
 * 新版 Expo Go 的首页去掉了「手动输入网址」那一栏，只剩「Recently opened」
 * 和登录账号后自动出现的列表。所以第一次连一台新手机，实际可行的办法是
 * 用系统相机扫二维码——iOS 认得 exp:// 这个 scheme，会提示用 Expo Go 打开。
 *
 * 隧道后面的服务只有 https，深链必须用 exps:// —— Expo Go 把 exp:// 一律
 * 换成 http://，只有 exps:// 才换成 https://。用 exp://主机:443 等于拿明文
 * 去敲 TLS 端口，Expo Go 里报的是「The network connection was lost」，
 * 看不出跟 scheme 有关系。
 *
 * 也别加 :443。一来 https 默认就是它，二来万一碰上的 Expo Go 版本不认
 * exps、退回 http，没端口时是 http://主机 → 80 → Tailscale 的 302 跳到
 * https，还能救回来；写死 :443 就成了明文打 TLS，直接死。
 *
 * 顺带一提，Expo CLI 自己在 TTY 下画的那个二维码在这种场景是错的：
 * UrlCreator 见到 https 代理只把端口补成 443，scheme 仍然是 exp，
 * 拼出来正好是那个连不上的形式。所以这里自己画。
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode');
const ErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

/** metroBase 形如 http(s)://host[:port]，转成 Expo Go 认的深链 */
export function expoGoUrl(metroBase) {
  const url = new URL(metroBase);
  if (url.protocol === 'https:') {
    // 默认端口就别写了，理由见文件头
    return url.port && url.port !== '443' ? `exps://${url.hostname}:${url.port}` : `exps://${url.hostname}`;
  }
  return url.port ? `exp://${url.hostname}:${url.port}` : `exp://${url.hostname}`;
}

function matrix(text) {
  const qr = new QRCode(-1, ErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return { count, isDark: (row, col) => qr.isDark(row, col) };
}

/** 终端里用半格字符画，一个字符高两行，这样方形的码不会被拉长 */
export function printQr(text) {
  const { count, isDark } = matrix(text);
  const quiet = 2;
  const size = count + quiet * 2;
  const dark = (row, col) => {
    const r = row - quiet;
    const c = col - quiet;
    return r >= 0 && c >= 0 && r < count && c < count && isDark(r, c);
  };

  const lines = [];
  for (let row = 0; row < size; row += 2) {
    let line = '';
    for (let col = 0; col < size; col += 1) {
      const top = dark(row, col);
      const bottom = row + 1 < size ? dark(row + 1, col) : false;
      // 反过来的：终端底色当白、字符当黑会更清楚，所以 dark 用空白
      if (top && bottom) line += ' ';
      else if (top) line += '\u2584';
      else if (bottom) line += '\u2580';
      else line += '\u2588';
    }
    lines.push(line);
  }
  console.log(lines.join('\n'));
}

/**
 * 存成 PNG，方便贴到别处或用另一台设备扫。
 * PNG 的最小可用形式就是 IHDR + zlib 压过的 IDAT + IEND，不值得为此再装个包。
 */
export function writeQrPng(text, out, scale = 12) {
  const { count, isDark } = matrix(text);
  const quiet = 4; // 规范要求四格静区，少了扫不出来
  const size = (count + quiet * 2) * scale;

  // 8 位灰度，每行开头一个字节的 filter 类型（0 = 不过滤）
  const raw = Buffer.alloc((size + 1) * size, 0xff);
  for (let y = 0; y < size; y += 1) raw[y * (size + 1)] = 0;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!isDark(row, col)) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        const y = (row + quiet) * scale + dy;
        const start = y * (size + 1) + 1 + (col + quiet) * scale;
        raw.fill(0x00, start, start + scale);
      }
    }
  }

  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const payload = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(payload));
    return Buffer.concat([length, payload, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 0; // 灰度
  writeFileSync(
    out,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0))
    ])
  );
  return { size };
}

// 直接跑：node scripts/qr.mjs <地址> [输出的png]
if (process.argv[1]?.endsWith('qr.mjs')) {
  const input = process.argv[2];
  if (!input) {
    console.error('用法：node scripts/qr.mjs <https://主机 或 exps://主机> [输出.png]');
    process.exit(1);
  }
  const text = /^exps?:\/\//.test(input) ? input : expoGoUrl(input);
  printQr(text);
  console.log(`\n${text}`);
  const out = process.argv[3];
  if (out) {
    const { size } = writeQrPng(text, out);
    console.log(`已存 ${out}（${size}x${size}）`);
  }
}
