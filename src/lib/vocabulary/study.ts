import type { DictEntry, Sense } from './dictionary';
import type { Occurrence, WordPos } from './extract';

export type DifficultyLevel = 'all' | 'normal' | 'hard';

export type StudyWord = {
  /** 词典里的原形，同一个词的不同变形合并到这里 */
  key: string;
  surface: string;
  entry: DictEntry;
  posInMovie: WordPos;
  /** 与片中词性一致的义项，也就是这句话里的意思 */
  sensesHere: Sense[];
  /** 其他词性下的意思，用来做"它还能当什么讲" */
  sensesElsewhere: Sense[];
  occurrences: Occurrence[];
};

/**
 * ECDICT 的 frq 是当代语料库词频排名（越小越常见），collins 是柯林斯星级（5 星最常用）。
 * 台词里绝大多数词是 the/you/go 这类，不筛掉的话面板会被它们淹没。
 */
export function isWorthLearning(entry: DictEntry, level: DifficultyLevel): boolean {
  if (level === 'all') return true;
  const veryCommon = entry.collins >= 4 || (entry.frq > 0 && entry.frq <= 1200);
  if (level === 'normal') return !veryCommon;
  const fairlyCommon = entry.collins >= 3 || (entry.frq > 0 && entry.frq <= 3500) || entry.oxford === 1;
  return !fairlyCommon;
}

function groupSenses(entry: DictEntry, posInMovie: WordPos) {
  const withPos = entry.senses.filter((sense) => sense.pos);
  if (!posInMovie) return { sensesHere: withPos.length ? withPos : entry.senses, sensesElsewhere: [] };

  const here = withPos.filter((sense) => sense.pos === posInMovie);
  // 词性判断偶尔会错，没对上就退回展示全部，别让面板空着
  if (!here.length) return { sensesHere: withPos.length ? withPos : entry.senses, sensesElsewhere: [] };
  return { sensesHere: here, sensesElsewhere: withPos.filter((sense) => sense.pos !== posInMovie) };
}

export function buildStudyWord(
  normal: string,
  entry: DictEntry,
  posInMovie: WordPos,
  occurrences: Occurrence[]
): StudyWord {
  return {
    key: (entry.lemma || entry.word || normal).toLowerCase(),
    surface: normal,
    entry,
    posInMovie,
    ...groupSenses(entry, posInMovie),
    occurrences
  };
}
