import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictDir = path.join(projectRoot, 'dict');

const files = [
  {
    name: 'ecdict.csv',
    // 中文释义、音标、词性、柯林斯星级、考试标签、BNC/当代词频
    urls: [
      'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
      'https://ghproxy.net/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
    ],
    minBytes: 40 * 1024 * 1024
  },
  {
    name: 'lemma.en.txt',
    // 词形还原表，gave -> give、children -> child
    urls: [
      'https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt',
      'https://cdn.jsdelivr.net/gh/skywind3000/ECDICT@master/lemma.en.txt'
    ],
    minBytes: 1024 * 1024
  }
];

const force = process.argv.includes('--force');
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

fs.mkdirSync(dictDir, { recursive: true });

for (const file of files) {
  const target = path.join(dictDir, file.name);

  if (!force && fs.existsSync(target)) {
    const size = fs.statSync(target).size;
    if (size >= file.minBytes) {
      console.log(`跳过 ${file.name}（已存在 ${mb(size)}，加 --force 可重新下载）`);
      continue;
    }
    console.log(`${file.name} 只有 ${mb(size)}，看起来没下完，重新下载`);
  }

  let downloaded = false;
  for (const url of file.urls) {
    const host = new URL(url).host;
    process.stdout.write(`下载 ${file.name} ← ${host} `);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const total = Number(response.headers.get('content-length')) || 0;
      let received = 0;
      let lastTick = Date.now();
      const temp = `${target}.part`;

      await pipeline(
        async function* () {
          for await (const chunk of response.body) {
            received += chunk.length;
            if (Date.now() - lastTick > 700) {
              lastTick = Date.now();
              process.stdout.write(total ? `\r下载 ${file.name} ← ${host} ${mb(received)} / ${mb(total)}   ` : `\r下载 ${file.name} ← ${host} ${mb(received)}   `);
            }
            yield chunk;
          }
        },
        fs.createWriteStream(temp)
      );

      const size = fs.statSync(temp).size;
      if (size < file.minBytes) {
        fs.unlinkSync(temp);
        throw new Error(`只拿到 ${mb(size)}，不完整`);
      }
      fs.renameSync(temp, target);
      console.log(`\r下载 ${file.name} ← ${host} 完成 ${mb(size)}                    `);
      downloaded = true;
      break;
    } catch (error) {
      console.log(`\r下载 ${file.name} ← ${host} 失败：${error.message}          `);
    }
  }

  if (!downloaded) {
    console.error(`\n${file.name} 所有来源都失败了。可以手动下载后放到 ${target}`);
    console.error(`来源：${files.find((f) => f.name === file.name).urls[0]}`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log('\n词典就位，重启 expo start 后即可在右侧看到生词。');
  console.log('数据来自 ECDICT (MIT)：https://github.com/skywind3000/ECDICT');
}
