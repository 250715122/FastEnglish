export type TokenKind = 'ok' | 'wrong' | 'missing' | 'extra';

export type GradedToken = {
  kind: TokenKind;
  /** 屏幕上显示的那个词：写错时显示你写的，漏写时显示原文 */
  text: string;
  /** 写错时的正确答案 */
  expected?: string;
};

export type Grade = {
  tokens: GradedToken[];
  correct: number;
  total: number;
  percent: number;
};

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * 判分只认字母和撇号。默写练的是听没听清、拼没拼对，
 * 逗号句号大小写全算错的话，满屏红字里根本找不出真正没听出来的那个词。
 */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
}

/** 最长公共子序列的配对下标，逐词比对就靠它把两串对齐 */
function align(left: string[], right: string[]): Array<[number, number]> {
  const n = left.length;
  const m = right.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * 逐词批改。
 *
 * 关键是先对齐再比对：漏了一个词之后，如果按位置一个一个比，后面全都会错位成红的，
 * 一句话只错一个词却看着满盘皆输，人会以为自己听力糟透了。
 */
export function gradeDictation(expected: string, typed: string): Grade {
  const expectedWords = splitWords(expected);
  const typedWords = splitWords(typed);
  const expectedKeys = expectedWords.map(normalizeWord);
  const typedKeys = typedWords.map(normalizeWord);

  const tokens: GradedToken[] = [];
  let correct = 0;

  const flush = (missed: string[], extra: string[]) => {
    /**
     * 一处少一个、同一处多一个，那多半就是同一个词拼错了，
     * 配成一条「你写的 → 正确的」比拆成「漏了」加「多了」有用得多。
     */
    const paired = Math.min(missed.length, extra.length);
    for (let i = 0; i < paired; i += 1) tokens.push({ kind: 'wrong', text: extra[i], expected: missed[i] });
    for (let i = paired; i < missed.length; i += 1) tokens.push({ kind: 'missing', text: missed[i] });
    for (let i = paired; i < extra.length; i += 1) tokens.push({ kind: 'extra', text: extra[i] });
  };

  let ei = 0;
  let ti = 0;
  for (const [pe, pt] of align(expectedKeys, typedKeys)) {
    flush(expectedWords.slice(ei, pe), typedWords.slice(ti, pt));
    tokens.push({ kind: 'ok', text: expectedWords[pe] });
    correct += 1;
    ei = pe + 1;
    ti = pt + 1;
  }
  flush(expectedWords.slice(ei), typedWords.slice(ti));

  const total = expectedWords.length;
  return { tokens, correct, total, percent: total ? Math.round((correct / total) * 100) : 0 };
}

/** 首字母骨架：`I could never` → `I c____ n____`，卡壳时给一把不至于直接给答案 */
export function skeleton(text: string): string {
  return splitWords(text)
    .map((word) => {
      const letters = word.replace(/[^A-Za-z']/g, '');
      if (letters.length < 2) return word;
      return letters[0] + '_'.repeat(letters.length - 1);
    })
    .join(' ');
}
