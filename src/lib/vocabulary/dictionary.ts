import { apiUrl, authHeaders, REMOTE, withTimeout } from '../api';
import type { WordPos } from './extract';

export type Sense = {
  /** 中文释义前面的词性缩写映射来的标签，没有词性标记时为 null */
  pos: WordPos | 'Preposition' | 'Conjunction' | 'Pronoun' | 'Interjection' | 'Numeral' | 'Determiner' | null;
  posLabel: string;
  text: string;
};

export type DictEntry = {
  word: string;
  phonetic: string;
  translation: string;
  senses: Sense[];
  collins: number;
  oxford: number;
  tag: string;
  bnc: number;
  frq: number;
  /** 查询词是变形时，这里是还原后的原形 */
  lemma?: string;
  /** 变形本身另有释义时保留，例如 leaves 既是 leave 的变形也有"树叶"的义项 */
  alt?: { word: string; translation: string };
};

export async function fetchDictStatus(): Promise<{ ready: boolean }> {
  try {
    const response = await fetch(apiUrl('/api/dict/status'), { headers: await authHeaders() });
    if (!response.ok) return { ready: false };
    return (await response.json()) as { ready: boolean };
  } catch {
    return { ready: false };
  }
}

export type PhraseHit = {
  /** 词典里的原形，如 call it a day */
  phrase: string;
  translation: string;
  phonetic: string;
  /** 在这句话里从第几个词开始、占几个词 */
  start: number;
  len: number;
};

/** 句子下标 -> 这句里认出来的短语 */
export type PhraseMap = Record<number, PhraseHit[]>;

/**
 * 一部电影的词一次性查完，服务端扫一遍词典就返回，别逐词请求。
 * 短语搭同一趟车：词典 63MB，不值得为它再扫一遍。
 */
/**
 * 整部电影扫一遍 63MB 的词典要几秒，给足时间；
 * 但必须有个上限——没有超时的话，后端一旦不响应，界面就永远停在
 * 「正在查询词典…」上，既不出错也不重试，看不出发生了什么。
 */
const LOOKUP_TIMEOUT_MS = 60_000;

export async function lookupWords(
  words: string[],
  sentences: string[] = []
): Promise<{ entries: Record<string, DictEntry>; phrases: PhraseMap }> {
  if (!words.length) return { entries: {}, phrases: {} };

  const timeout = withTimeout(LOOKUP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/dict/lookup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ words, sentences }),
      signal: timeout.signal
    });
  } catch (reason) {
    // 超时的锅八成在链路而不在后端：全片查询要搬几百 KB，外网慢起来就到点了。
    // 以前这里一律让人去查「后端还在跑吗」，方向就指错了
    throw new Error(
      timeout.expired()
        ? REMOTE
          ? `词典查询超过 ${LOOKUP_TIMEOUT_MS / 1000} 秒没完成。全片单词要传几百 KB，外网慢的时候容易卡在这儿——换个网络再试，或者先用听/读/写模式。`
          : `词典查询超过 ${LOOKUP_TIMEOUT_MS / 1000} 秒没有响应，确认后端（npm run server）还在跑`
        : `连不上词典服务：${(reason as Error).message}`
    );
  } finally {
    timeout.clear();
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `词典查询失败（${response.status}）`);
  return {
    entries: payload.entries as Record<string, DictEntry>,
    phrases: (payload.phrases ?? {}) as PhraseMap
  };
}
