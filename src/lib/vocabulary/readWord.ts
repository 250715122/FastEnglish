import type { StudyWord } from './study';

/**
 * 全片单词页「看到什么」和「念什么」是同一个开关。
 *
 * 分开两个开关的话，看得到单词却念的是释义这种组合谁也用不上；
 * 合成一个之后三档各自成了一种复习法：只看单词回想意思、只看释义回想单词、全都摊开对答案。
 */
export type ShowMode = 'word' | 'sense' | 'both';

export type SpeechPart = { text: string; lang: 'en-US' | 'zh-CN' };

export const SHOW_MODES: Array<{ id: ShowMode; label: string }> = [
  { id: 'word', label: '单词' },
  { id: 'sense', label: '释义' },
  { id: 'both', label: '全部' }
];

/** 一个词的释义常有七八条，连播时全念完就没法往下听了 */
const MAX_SENSES = 2;

export function headwordOf(word: StudyWord): string {
  // 读原形而不是片中的变形：音标和释义标的都是原形
  return word.entry.lemma || word.entry.word || word.surface;
}

/** 片中这个意思优先，片里没认出词性才退回其他义项 */
export function senseSummary(word: StudyWord): string {
  return (word.sensesHere.length ? word.sensesHere : word.sensesElsewhere)
    .slice(0, MAX_SENSES)
    .map((sense) => (sense.posLabel ? `${sense.posLabel} ${sense.text}` : sense.text))
    .join('；')
    .trim();
}

/**
 * 把一个词拆成几段语音。
 *
 * 中英必须分段：TTS 是按 language 选发音人的，中英混在一段里交给同一个发音人，
 * 两边都不像话——英文发音人念中文是一串乱码，中文发音人念英文一股机翻腔。
 */
export function buildWordSpeech(word: StudyWord, mode: ShowMode): SpeechPart[] {
  const parts: SpeechPart[] = [];
  if (mode !== 'sense') parts.push({ text: headwordOf(word), lang: 'en-US' });
  if (mode !== 'word') {
    const meaning = senseSummary(word);
    if (meaning) parts.push({ text: meaning, lang: 'zh-CN' });
  }
  // 词典里没给中文的词在「只念释义」档下会一声不吭，连播就成了一串静音
  return parts.length ? parts : [{ text: headwordOf(word), lang: 'en-US' }];
}
