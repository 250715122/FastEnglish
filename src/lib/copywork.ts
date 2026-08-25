/**
 * 抄写：照着英文原文一个字一个字敲下来，像打字通那样边敲边对。
 *
 * 和听写的区别在于目标不同——听写练的是"听出来"，答案要藏着；
 * 抄写练的是手熟和拼写，原文一直摆在眼前，量的是敲得准不准、快不快。
 */

export type CharState =
  /** 敲对了 */
  | 'ok'
  /** 敲错了 */
  | 'bad'
  /** 还没敲到 */
  | 'todo';

/**
 * 把原文切成一段段带状态的文字，用来给原文上色。
 *
 * 按状态合并成连续的段而不是逐字返回：一句话上百个字符，
 * 每敲一下就重建上百个节点，手感会拖。
 * 敲过头的部分原文里没有对应位置，单独缀在末尾标红。
 */
export function toRuns(target: string, typed: string): Array<{ text: string; state: CharState }> {
  const runs: Array<{ text: string; state: CharState }> = [];
  const push = (char: string, state: CharState) => {
    const last = runs[runs.length - 1];
    if (last && last.state === state) last.text += char;
    else runs.push({ text: char, state });
  };

  for (let i = 0; i < target.length; i += 1) {
    if (i >= typed.length) push(target[i], 'todo');
    else push(target[i], typed[i] === target[i] ? 'ok' : 'bad');
  }
  if (typed.length > target.length) runs.push({ text: typed.slice(target.length), state: 'bad' });
  return runs;
}

/**
 * 新敲进去的那几个字里有几个是错的。
 *
 * 只看新增的部分：退格改对不该抹掉刚才敲错的事实，否则一路退格重来
 * 就能刷出 100%，正确率也就没意义了。
 */
export function countNewErrors(target: string, before: string, after: string): { typed: number; errors: number } {
  if (after.length <= before.length) return { typed: 0, errors: 0 };
  let errors = 0;
  for (let i = before.length; i < after.length; i += 1) {
    if (after[i] !== target[i]) errors += 1;
  }
  return { typed: after.length - before.length, errors };
}

export type CopyRecord = {
  /** 这一轮结束的时刻 */
  at: number;
  /** 从字幕的第几句开始抄的 */
  from: number;
  /** 抄了几句 */
  count: number;
  /** 敲对的字符数 */
  chars: number;
  /** 敲进去的字符总数，含敲错的 */
  typed: number;
  seconds: number;
};

export function accuracyOf(record: { chars: number; typed: number }): number {
  if (!record.typed) return 0;
  return Math.round((record.chars / record.typed) * 100);
}

/** 字/分。用敲对的字数算，敲得快但错一片没有意义 */
export function speedOf(record: { chars: number; seconds: number }): number {
  if (record.seconds <= 0) return 0;
  return Math.round((record.chars / record.seconds) * 60);
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes ? `${minutes}分${String(whole % 60).padStart(2, '0')}秒` : `${whole}秒`;
}

export function formatWhen(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return sameDay ? `今天 ${clock}` : `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}
