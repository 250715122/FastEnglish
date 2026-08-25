/**
 * 词典查询端点。ECDICT 是 63MB 的 CSV，常驻内存太重，
 * 所以一次请求把整部电影的词一起送来，流式扫一遍就够（实测一秒上下）。
 *
 * 注意结果并没有落盘：每打开一部片子都会重扫一遍 CSV。本机上无所谓，
 * 但响应有 400 KB，走外网时它才是瓶颈——所以 sendJson 那边做了压缩。
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const { sendJson } = require('./sendJson');

const ROUTE_PREFIX = '/api/dict';
const DICT_DIR = path.join(__dirname, '..', 'dict');
const CSV_PATH = path.join(DICT_DIR, 'ecdict.csv');
const LEMMA_PATH = path.join(DICT_DIR, 'lemma.en.txt');
const EXAMPLE_DIR = path.join(__dirname, '..', 'vocab', 'examples');

/** Free Dictionary 的词性名 -> 和中文释义里同一套标签，才能按词性配对例句 */
const API_POS = {
  noun: 'Noun',
  verb: 'Verb',
  adjective: 'Adjective',
  adverb: 'Adverb',
  preposition: 'Preposition',
  conjunction: 'Conjunction',
  pronoun: 'Pronoun',
  interjection: 'Interjection',
  exclamation: 'Interjection',
  numeral: 'Numeral'
};

/** 中文释义里的词性缩写 -> compromise 的标签，用来判断片中用法属于哪一条 */
const POS_MAP = {
  n: 'Noun',
  vt: 'Verb',
  vi: 'Verb',
  v: 'Verb',
  aux: 'Verb',
  modal: 'Verb',
  a: 'Adjective',
  adj: 'Adjective',
  ad: 'Adverb',
  adv: 'Adverb',
  prep: 'Preposition',
  conj: 'Conjunction',
  pron: 'Pronoun',
  int: 'Interjection',
  num: 'Numeral',
  art: 'Determiner',
  abbr: 'Abbreviation',
  suf: 'Suffix',
  pref: 'Prefix'
};

/**
 * 纯虚词拼起来的组合是语法，不是短语：out of / up with / with this 这种
 * 查出来也只会让人分心。短语至少要含一个实词才有学的价值。
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'their', 'our', 'one', 'ones',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'into', 'onto', 'upon', 'about', 'over',
  'under', 'up', 'down', 'off', 'out', 'away', 'back', 'through', 'across', 'along', 'around',
  'and', 'or', 'but', 'so', 'as', 'if', 'than', 'then', 'no', 'not', 'nor', 'too', 'very',
  'be', 'is', 'am', 'are', 'was', 'were', 'been', 'being', 'do', 'does', 'did', 'will', 'would',
  'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'there', 'here', 'what', 'when', 'where'
]);

/**
 * 这些是语法结构，不是要学的短语。它们在一部片里能出现几十次，
 * 留着会把真正的习语淹掉。
 */
const GRAMMAR_GLUE = new Set([
  'have to', 'has to', 'had to', 'going to', 'want to', 'used to', 'need to', 'able to', 'ought to',
  'try to', 'like to', 'seem to', 'happen to', 'get to', 'come to', 'start to', 'begin to',
  'a lot', 'a lot of', 'a little', 'a few', 'a bit', 'a while', 'for a while', 'a long time',
  'kind of', 'sort of', 'a couple of', 'plenty of', 'lots of', 'most of', 'all of', 'some of',
  'one of', 'none of', 'each other', 'one another', 'at all', 'at least', 'at most', 'at last',
  'as well', 'as well as', 'as if', 'as though', 'so that', 'such as', 'more than', 'less than',
  'rather than', 'other than', 'no one', 'no more', 'any more', 'of course', 'in fact', 'by the way',
  'right now', 'right here', 'right there', 'over there', 'over here', 'up there', 'down there',
  'this one', 'that one', 'the same', 'the other', 'the most', 'the best', 'the first', 'the last',
  'you know', 'i mean', 'i think', 'i guess', 'i know', 'let me', 'let us', 'come on', 'go on',
  'in the', 'on the', 'to the', 'of the', 'for the', 'with the', 'at the', 'from the', 'into the',
  'this is', 'that is', 'there is', 'there are', 'it is', 'what is', 'how to', 'what to', 'where to',
  'next week', 'last week', 'next year', 'last year', 'next month', 'last month', 'next day',
  'last night', 'next time', 'last time', 'this time', 'every time', 'every day', 'all day',
  'all right', 'all night', 'this morning', 'this way', 'that way', 'my god', 'oh my god'
]);

/** 分离式动词短语的填充词：turned him down 里的 him，把它跨过去才认得出 turn down */
const SEPARABLE_FILLERS = new Set([
  'it', 'him', 'her', 'them', 'me', 'us', 'you', 'this', 'that',
  'myself', 'yourself', 'himself', 'herself', 'themselves', 'ourselves'
]);

const ARTICLES = new Set(['a', 'an', 'the']);

let lemmaMap = null;

/** lemma.en.txt 每行形如 `be/4109826 -> is,was,are,were`，建反向索引 */
function loadLemma() {
  if (lemmaMap) return lemmaMap;
  lemmaMap = new Map();
  if (!fs.existsSync(LEMMA_PATH)) return lemmaMap;

  for (const line of fs.readFileSync(LEMMA_PATH, 'utf8').split('\n')) {
    if (!line || line.startsWith(';')) continue;
    const [head, tail] = line.split('->');
    if (!tail) continue;
    const stem = head.split('/')[0].trim().toLowerCase();
    if (!stem) continue;
    for (const form of tail.split(',')) {
      const key = form.trim().toLowerCase();
      if (key && !lemmaMap.has(key)) lemmaMap.set(key, stem);
    }
  }
  return lemmaMap;
}

/** ECDICT 每条记录占一行（多义项用字面的 \n 分隔），只需处理行内的引号 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** "n. 罩；风帽\nv. 覆盖" -> [{pos:'Noun', text:'罩；风帽'}, {pos:'Verb', text:'覆盖'}] */
function parseSenses(translation) {
  if (!translation) return [];
  return translation
    .split(/\\n|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-z]+)\.\s*(.+)$/i);
      if (match && POS_MAP[match[1].toLowerCase()]) {
        return { pos: POS_MAP[match[1].toLowerCase()], posLabel: `${match[1].toLowerCase()}.`, text: match[2].trim() };
      }
      return { pos: null, posLabel: '', text: line };
    })
    .filter((sense) => sense.text);
}

/**
 * CSV 里的 definition（英文释义）、pos（词性占比）、exchange（词形变化表）都不往外发。
 * 界面上一处都没用到，但它们占了全片响应的四成——一部片子 1000 个词就是 260 KB，
 * 在外网那点带宽下白等好几秒。要用的时候再加回来。
 */
function toEntry(fields) {
  const [word, phonetic, , translation, , collins, oxford, tag, bnc, frq] = fields;
  return {
    word,
    phonetic: phonetic || '',
    translation: translation || '',
    senses: parseSenses(translation),
    collins: Number(collins) || 0,
    oxford: Number(oxford) || 0,
    tag: tag || '',
    bnc: Number(bnc) || 0,
    frq: Number(frq) || 0
  };
}

const MAX_PHRASE_WORDS = 6;

function tokenizeForPhrase(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** 词典里能查到不等于值得看，语法结构和纯虚词组合一律不要 */
function worthAsPhrase(phrase) {
  if (GRAMMAR_GLUE.has(phrase)) return false;
  const words = phrase.split(' ');
  if (words.length < 2) return false;
  // "a shot"、"the money" 就是冠词加名词，查出来的是那个名词，不是短语
  if (words.length === 2 && ARTICLES.has(words[0])) return false;
  return !words.every((word) => FUNCTION_WORDS.has(word));
}

/**
 * 把每句话切成 2~6 个词的候选，等下一次扫描时看词典里有没有。
 * 台词里的动词是变位的（showed up / called it a day），首词再按原形登记一份，
 * 否则 show up、call it a day 这些最该认出来的短语反而查不到。
 */
function collectPhraseCandidates(sentences, lemma) {
  const candidates = new Map();

  const remember = (key, position, start, len) => {
    if (!worthAsPhrase(key)) return;
    const spots = candidates.get(key);
    const spot = { position, start, len };
    if (spots) spots.push(spot);
    else candidates.set(key, [spot]);
  };

  sentences.forEach((text, position) => {
    if (!text) return;
    const tokens = tokenizeForPhrase(text);

    for (let i = 0; i < tokens.length; i += 1) {
      const head = tokens[i];
      const headLemma = lemma.get(head);

      for (let n = 2; n <= MAX_PHRASE_WORDS && i + n <= tokens.length; n += 1) {
        const slice = tokens.slice(i, i + n);
        remember(slice.join(' '), position, i, n);
        if (headLemma && headLemma !== head) {
          remember([headLemma, ...slice.slice(1)].join(' '), position, i, n);
        }
      }

      // turned him down 这种把宾语塞在中间的写法，跨过它才认得出 turn down
      if (!SEPARABLE_FILLERS.has(tokens[i + 1])) continue;
      for (let n = 2; n < MAX_PHRASE_WORDS && i + 1 + n <= tokens.length; n += 1) {
        const slice = [head, ...tokens.slice(i + 2, i + 1 + n)];
        // 跨度含被跳过的那个词，否则它会被更短的碎片抢走
        remember(slice.join(' '), position, i, n + 1);
        if (headLemma && headLemma !== head) {
          remember([headLemma, ...slice.slice(1)].join(' '), position, i, n + 1);
        }
      }
    }
  });

  return candidates;
}

/**
 * 一句话里的命中会互相重叠：put up with this 同时命中 put up、up with、put up with、with this。
 * 按长度从长到短抢占词的位置，长的先占住，剩下的碎片自然被挤掉。
 */
function resolvePhrases(candidates, matched) {
  const bySentence = new Map();

  for (const [key, spots] of candidates) {
    const entry = matched.get(key);
    if (!entry) continue;
    for (const spot of spots) {
      const list = bySentence.get(spot.position);
      const hit = { ...spot, key, entry };
      if (list) list.push(hit);
      else bySentence.set(spot.position, [hit]);
    }
  }

  const phrases = {};
  for (const [position, list] of bySentence) {
    list.sort((a, b) => b.len - a.len || a.start - b.start);

    const picked = [];
    for (const hit of list) {
      const overlaps = picked.some(
        (taken) => hit.start < taken.start + taken.len && taken.start < hit.start + hit.len
      );
      if (!overlaps) picked.push(hit);
    }

    picked.sort((a, b) => a.start - b.start);
    phrases[position] = picked.map((hit) => ({
      phrase: hit.entry.word,
      translation: hit.entry.translation,
      phonetic: hit.entry.phonetic,
      start: hit.start,
      len: hit.len
    }));
  }

  return phrases;
}

/**
 * 一次扫描把所有要查的词捞出来。
 * 同时按原形和词形还原后的形式登记，命中哪个都能对应回请求里的原词。
 * 短语也在这一趟里顺带查掉：词典有 63MB，不值得为它再扫一遍。
 */
async function lookupWords(words, sentences = []) {
  if (!fs.existsSync(CSV_PATH)) {
    const error = new Error('词典还没下载，先运行 npm run fetch-dict');
    error.code = 'DICT_MISSING';
    throw error;
  }

  const lemma = loadLemma();
  /** 小写形式 -> 请求里用到它的原词集合 */
  const wanted = new Map();
  const lemmaOf = new Map();

  for (const raw of words) {
    const word = String(raw || '').trim().toLowerCase();
    if (!word) continue;
    if (!wanted.has(word)) wanted.set(word, new Set());
    wanted.get(word).add(raw);

    const stem = lemma.get(word);
    if (stem && stem !== word) {
      lemmaOf.set(raw, stem);
      if (!wanted.has(stem)) wanted.set(stem, new Set());
      wanted.get(stem).add(raw);
    }
  }

  const candidates = collectPhraseCandidates(sentences, lemma);
  const phraseHits = new Map();

  const hits = new Map();
  const stream = readline.createInterface({
    input: fs.createReadStream(CSV_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  let first = true;
  for await (const line of stream) {
    if (first) {
      first = false;
      continue;
    }
    if (!line) continue;
    // 先按纯前缀粗筛，避免对 77 万行都做完整 CSV 解析
    const comma = line.indexOf(',');
    if (comma <= 0) continue;
    const head = line.slice(0, comma).replace(/^"|"$/g, '').toLowerCase();

    // 多词条目占了词典近一半，靠空格就能先分流
    if (head.includes(' ')) {
      if (!candidates.has(head)) continue;
      const entry = toEntry(parseCsvLine(line));
      // 没中文释义的条目留着也解释不了什么
      if (entry.translation) phraseHits.set(head, entry);
      continue;
    }

    if (!wanted.has(head)) continue;
    const entry = toEntry(parseCsvLine(line));
    if (entry.word) hits.set(entry.word.toLowerCase(), entry);
  }

  const entries = {};
  for (const raw of new Set(words)) {
    const word = String(raw || '').trim().toLowerCase();
    if (!word) continue;
    const self = hits.get(word);
    const stem = lemmaOf.get(raw);
    const base = stem ? hits.get(stem) : null;

    // ran / leaves 这类变形在 ECDICT 里也有词条，但内容只是"run的过去式"，
    // 没有任何带词性的义项，落到原形上才有东西可学
    const useBase = base && (!self || !self.senses.some((sense) => sense.pos));
    const main = useBase ? base : self;
    if (!main) continue;

    entries[raw] = {
      ...main,
      ...(useBase ? { lemma: base.word } : {}),
      ...(useBase && self ? { alt: { word: self.word, translation: self.translation } } : {})
    };
  }

  return { entries, phrases: resolvePhrases(candidates, phraseHits) };
}

/**
 * ECDICT 没有例句。例句从两处取：
 * 百词斩那份数据带中文翻译但只覆盖常用词，Free Dictionary 覆盖广、按词性分组但全是英文。
 * 两边都拿，客户端优先展示带翻译的那条。每个词只查一次，结果落盘。
 */
async function fetchExamples(word) {
  const safe = word.replace(/[^a-z'-]/gi, '_').slice(0, 60);
  const cachePath = path.join(EXAMPLE_DIR, `${safe}.json`);

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    /* 没缓存就去网上取 */
  }

  const result = { word, translated: null, byPos: {} };

  try {
    const response = await fetch(
      `https://cdn.jsdelivr.net/gh/lyc8503/baicizhan-word-meaning-API/data/words/${encodeURIComponent(word)}.json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.sentence) {
        result.translated = { text: data.sentence, trans: data.sentence_trans || '' };
      }
    }
  } catch {
    /* 常用词表里没有就算了 */
  }

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const data = await response.json();
      for (const entry of Array.isArray(data) ? data : []) {
        for (const meaning of entry.meanings ?? []) {
          const pos = API_POS[String(meaning.partOfSpeech || '').toLowerCase()];
          if (!pos) continue;
          for (const definition of meaning.definitions ?? []) {
            if (!definition.example) continue;
            const bucket = (result.byPos[pos] ??= []);
            if (bucket.length < 3) bucket.push({ text: definition.example, sense: definition.definition || '' });
          }
        }
      }
    }
  } catch {
    /* 查不到就只剩片中出处 */
  }

  try {
    fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result), 'utf8');
  } catch {
    /* 写缓存失败不影响返回 */
  }

  return result;
}

/** 逐个查会很慢，全并发又容易被限流 */
async function fetchExamplesBatch(words, concurrency = 4) {
  const queue = [...new Set(words.map((word) => String(word || '').trim().toLowerCase()).filter(Boolean))];
  const results = {};

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const word = queue.shift();
        if (!word) break;
        try {
          results[word] = await fetchExamples(word);
        } catch {
          results[word] = { word, translated: null, byPos: {} };
        }
      }
    })
  );

  return results;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function createDictStoreMiddleware() {
  return async function dictStoreMiddleware(request, response, next) {
    if (!request.url || !request.url.startsWith(ROUTE_PREFIX)) {
      next();
      return;
    }

    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      });
      response.end();
      return;
    }

    try {
      if (url.pathname === `${ROUTE_PREFIX}/status` && request.method === 'GET') {
        sendJson(response, 200, {
          ready: fs.existsSync(CSV_PATH),
          hasLemma: fs.existsSync(LEMMA_PATH)
        });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/lookup` && request.method === 'POST') {
        const payload = JSON.parse((await readBody(request)) || '{}');
        if (!Array.isArray(payload.words) || !payload.words.length) {
          sendJson(response, 400, { error: '缺少 words' });
          return;
        }
        const started = Date.now();
        const sentences = Array.isArray(payload.sentences) ? payload.sentences.slice(0, 5000) : [];
        const { entries, phrases } = await lookupWords(payload.words.slice(0, 20000), sentences);
        sendJson(response, 200, {
          entries,
          phrases,
          found: Object.keys(entries).length,
          phraseCount: Object.values(phrases).reduce((sum, list) => sum + list.length, 0),
          elapsedMs: Date.now() - started
        });
        return;
      }

      if (url.pathname === `${ROUTE_PREFIX}/examples` && request.method === 'POST') {
        const payload = JSON.parse((await readBody(request)) || '{}');
        if (!Array.isArray(payload.words) || !payload.words.length) {
          sendJson(response, 400, { error: '缺少 words' });
          return;
        }
        sendJson(response, 200, { examples: await fetchExamplesBatch(payload.words.slice(0, 40)) });
        return;
      }

      sendJson(response, 404, { error: `未知的词典路径 ${url.pathname}` });
    } catch (error) {
      sendJson(response, error.code === 'DICT_MISSING' ? 503 : 500, { error: error.message });
    }
  };
}

module.exports = { createDictStoreMiddleware, ROUTE_PREFIX, DICT_DIR };
