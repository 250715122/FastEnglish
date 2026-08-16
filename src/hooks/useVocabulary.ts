import { useEffect, useMemo, useState } from 'react';
import { lookupWords, type DictEntry, type PhraseHit, type PhraseMap } from '../lib/vocabulary/dictionary';
import { buildWordIndex, tagSentence, type Occurrence } from '../lib/vocabulary/extract';
import { buildStudyWord, isWorthLearning, type DifficultyLevel, type StudyWord } from '../lib/vocabulary/study';
import type { Segment } from '../types/subtitle';

export type VocabularyStatus = 'idle' | 'no-english' | 'loading' | 'ready' | 'missing' | 'error';

/**
 * 词性标注对单句有约一成误判。全片词表里一个词往往出现好多次，
 * 取出现最多的那个词性，比拿它第一次露面时的判断稳得多。
 */
function dominantPos(occurrences: Occurrence[]) {
  const tally = new Map<string, number>();
  for (const occurrence of occurrences) {
    if (occurrence.pos) tally.set(occurrence.pos, (tally.get(occurrence.pos) ?? 0) + 1);
  }
  let best: Occurrence['pos'] = null;
  let bestCount = 0;
  for (const [pos, count] of tally) {
    if (count > bestCount) {
      best = pos as Occurrence['pos'];
      bestCount = count;
    }
  }
  return best;
}

export function useVocabulary(segments: Segment[], level: DifficultyLevel) {
  const [entries, setEntries] = useState<Record<string, DictEntry>>({});
  const [phrases, setPhrases] = useState<PhraseMap>({});
  const [status, setStatus] = useState<VocabularyStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const wordIndex = useMemo(() => buildWordIndex(segments), [segments]);

  // 整部电影的词一次查完，之后切句只是查内存里的表
  useEffect(() => {
    if (!segments.length) {
      setStatus('idle');
      setEntries({});
      setPhrases({});
      return;
    }
    if (!wordIndex.size) {
      setStatus('no-english');
      setEntries({});
      setPhrases({});
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    lookupWords(
      [...wordIndex.keys()],
      segments.map((segment) => segment.en || '')
    )
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setPhrases(result.phrases);
        setStatus('ready');
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setEntries({});
        setPhrases({});
        setStatus(reason.message.includes('fetch-dict') ? 'missing' : 'error');
        setError(reason.message);
      });

    return () => {
      cancelled = true;
    };
  }, [segments, segments.length, wordIndex]);

  /**
   * ran 和 run 在台词里是两条不同的写法，但学的是同一个词，
   * 出现位置必须按原形合并，否则"片中其他出处"会漏掉大半。
   */
  const occurrencesByKey = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const [normal, occurrences] of wordIndex) {
      const entry = entries[normal];
      if (!entry) continue;
      const key = (entry.lemma || entry.word || normal).toLowerCase();
      const list = map.get(key);
      if (list) list.push(...occurrences);
      else map.set(key, [...occurrences]);
    }
    for (const list of map.values()) list.sort((a, b) => a.index - b.index);
    return map;
  }, [entries, wordIndex]);

  const wordsOf = useMemo(() => {
    return (segment?: Segment): StudyWord[] => {
      if (!segment?.en || status !== 'ready') return [];
      const seen = new Set<string>();
      const result: StudyWord[] = [];

      for (const tagged of tagSentence(segment.en)) {
        const entry = entries[tagged.normal];
        if (!entry) continue;
        const key = (entry.lemma || entry.word || tagged.normal).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!isWorthLearning(entry, level)) continue;
        result.push(buildStudyWord(tagged.normal, entry, tagged.pos, occurrencesByKey.get(key) ?? []));
      }

      return result;
    };
  }, [entries, level, occurrencesByKey, status]);

  /** 全片词表：合并变形后按出现次数排序，供整片单词页使用 */
  const allWords = useMemo(() => {
    if (status !== 'ready') return [];
    const merged = new Map<string, StudyWord>();

    for (const [normal, occurrences] of wordIndex) {
      const entry = entries[normal];
      if (!entry) continue;
      const key = (entry.lemma || entry.word || normal).toLowerCase();
      if (merged.has(key)) continue;
      const all = occurrencesByKey.get(key) ?? occurrences;
      merged.set(key, buildStudyWord(normal, entry, dominantPos(all), all));
    }

    return [...merged.values()].sort((a, b) => b.occurrences.length - a.occurrences.length);
  }, [entries, occurrencesByKey, status, wordIndex]);

  const phrasesOf = useMemo(() => (index: number): PhraseHit[] => phrases[index] ?? [], [phrases]);

  /** 全片短语表：同一个短语可能反复出现，合并后记下都在哪几句 */
  const allPhrases = useMemo(() => {
    const merged = new Map<string, { hit: PhraseHit; occurrences: number[] }>();
    for (const [position, list] of Object.entries(phrases)) {
      for (const hit of list) {
        const found = merged.get(hit.phrase);
        if (found) found.occurrences.push(Number(position));
        else merged.set(hit.phrase, { hit, occurrences: [Number(position)] });
      }
    }
    return [...merged.values()].sort((a, b) => b.occurrences.length - a.occurrences.length);
  }, [phrases]);

  return {
    status,
    error,
    wordsOf,
    allWords,
    phrasesOf,
    allPhrases,
    entryCount: Object.keys(entries).length
  };
}
