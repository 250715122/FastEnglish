import { devServerUrl } from '../devServerUrl';
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
  definition: string;
  translation: string;
  senses: Sense[];
  collins: number;
  oxford: number;
  tag: string;
  bnc: number;
  frq: number;
  exchange: string;
  /** 查询词是变形时，这里是还原后的原形 */
  lemma?: string;
  /** 变形本身另有释义时保留，例如 leaves 既是 leave 的变形也有"树叶"的义项 */
  alt?: { word: string; translation: string };
};

export async function fetchDictStatus(): Promise<{ ready: boolean }> {
  try {
    const response = await fetch(devServerUrl('/api/dict/status'));
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
export async function lookupWords(
  words: string[],
  sentences: string[] = []
): Promise<{ entries: Record<string, DictEntry>; phrases: PhraseMap }> {
  if (!words.length) return { entries: {}, phrases: {} };
  const response = await fetch(devServerUrl('/api/dict/lookup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words, sentences })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `词典查询失败（${response.status}）`);
  return {
    entries: payload.entries as Record<string, DictEntry>,
    phrases: (payload.phrases ?? {}) as PhraseMap
  };
}
