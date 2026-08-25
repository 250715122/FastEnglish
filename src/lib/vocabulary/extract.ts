import nlp from 'compromise';
import type { Segment } from '../../types/subtitle';

export type WordPos = 'Noun' | 'Verb' | 'Adjective' | 'Adverb' | null;

export type Occurrence = {
  /** 在 segments 数组中的下标，用来取例句和跳转 */
  index: number;
  /** 台词里的原样写法，可能是 ran / running */
  surface: string;
  pos: WordPos;
};

/** 这些词满屏都是，学它们没有意义，先在分词阶段就排掉 */
const SKIP_TAGS = [
  'Pronoun',
  'Determiner',
  'Preposition',
  'Conjunction',
  'Auxiliary',
  'Copula',
  'Modal',
  'QuestionWord',
  'Value',
  'Money',
  'Fraction',
  'Ordinal',
  'Cardinal',
  'Date',
  'Month',
  'WeekDay',
  'Time',
  'Acronym',
  'Abbreviation',
  'Expression',
  'Negative',
  'Conditional'
];

const POS_PRIORITY: NonNullable<WordPos>[] = ['Verb', 'Noun', 'Adjective', 'Adverb'];

function pickPos(tags: string[]): WordPos {
  for (const pos of POS_PRIORITY) {
    if (tags.includes(pos)) return pos;
  }
  return null;
}

/** 台词里的缩写和标点很多，规整成能拿去查词典的形式 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z'-]/g, '')
    .replace(/^[-']+|[-']+$/g, '');
}

export type TaggedWord = { surface: string; normal: string; pos: WordPos };

/** 单句的实词，右侧面板按这个顺序展示 */
export function tagSentence(text: string): TaggedWord[] {
  if (!text) return [];
  const terms = nlp(text).terms().json({ terms: { tags: true } }) as Array<{
    terms?: Array<{ text: string; tags?: string[] }>;
  }>;

  const result: TaggedWord[] = [];
  const seen = new Set<string>();

  for (const chunk of terms) {
    for (const term of chunk.terms ?? []) {
      const tags = term.tags ?? [];
      if (SKIP_TAGS.some((tag) => tags.includes(tag))) continue;
      // 人名地名对学英语没帮助，而且经常被误判成普通名词以外的东西
      if (tags.includes('ProperNoun') || tags.includes('Person') || tags.includes('Place')) continue;

      const normal = normalize(term.text);
      if (normal.length < 2 || seen.has(normal)) continue;
      seen.add(normal);
      result.push({ surface: term.text.replace(/^\W+|\W+$/g, ''), normal, pos: pickPos(tags) });
    }
  }

  return result;
}

/** 全片索引：单词 -> 它出现过的每一句，既用来做例句，也用来做全片单词表 */
export function buildWordIndex(segments: Segment[]): Map<string, Occurrence[]> {
  const index = new Map<string, Occurrence[]>();

  segments.forEach((segment, position) => {
    if (!segment.en) return;
    for (const word of tagSentence(segment.en)) {
      const list = index.get(word.normal);
      const occurrence: Occurrence = { index: position, surface: word.surface, pos: word.pos };
      if (list) list.push(occurrence);
      else index.set(word.normal, [occurrence]);
    }
  });

  return index;
}
