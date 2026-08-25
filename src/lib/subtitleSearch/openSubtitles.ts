import { apiUrl, authHeaders } from '../api';

/**
 * 请求一律走开发服务器上的代理（见 scripts/openSubtitlesProxy.js）：
 * OpenSubtitles 会按 User-Agent 拦截浏览器，网页端没法直连。
 */
const ROUTE_PREFIX = '/api/opensubtitles';

export type SubtitleCandidate = {
  fileId: number;
  language: string;
  release: string;
  fileName?: string;
  downloadCount: number;
  hearingImpaired: boolean;
  title: string;
  year?: number;
  /** 接口返回时的原始位次，接口自己的相关性排序比下载量可信得多 */
  apiRank: number;
  /** 片名跟搜索词对不上，多半不是这部片，界面要标出来且不能默认选中 */
  offTopic?: boolean;
};

export type DownloadedSubtitle = {
  text: string;
  fileName: string;
  /** 当天剩余的下载次数，由接口返回；-1 表示未知 */
  remaining: number;
};

/**
 * 关键词搜索会带回同名的其它片子（搜 source code 会混进 The Source），
 * 先按片名是否对得上分档，再按下载量排，避免默认选中错误的电影。
 */
function relevance(candidate: SubtitleCandidate, query: string): number {
  const title = candidate.title.trim().toLowerCase();
  const keyword = query.trim().toLowerCase();
  if (!title || !keyword) return 0;
  if (title === keyword) return 2;
  if (title.includes(keyword)) return 1;
  return 0;
}

/**
 * 用中文片名搜出来的结果，片名字段全是英文，谁都匹配不上，分数会齐刷刷是 0。
 * 这时候再按下载量排，等于把接口本来排好的相关性彻底打乱：
 * 搜「范海辛」会让下载量一万六的《鸣梁海战》盖过正确的 Van Helsing。
 * 所以只有当分数真能区分开时才用它，否则一律信接口给的原始次序。
 */
function sortByRelevance(candidates: SubtitleCandidate[], query: string): SubtitleCandidate[] {
  const scored = candidates.map((candidate) => ({ candidate, score: relevance(candidate, query) }));
  const discriminating = scored.some((item) => item.score > 0);

  return scored
    .sort((a, b) => {
      if (!discriminating) return a.candidate.apiRank - b.candidate.apiRank;
      if (b.score !== a.score) return b.score - a.score;
      // 片名已经确定对得上，同档里再挑版本：
      // 听障字幕夹着 [door slams] 这类音效描述，拿来学英语是干扰，往后放
      if (a.candidate.hearingImpaired !== b.candidate.hearingImpaired) {
        return a.candidate.hearingImpaired ? 1 : -1;
      }
      return b.candidate.downloadCount - a.candidate.downloadCount;
    })
    .map((item) => ({
      ...item.candidate,
      // 有匹配得上的结果时，剩下那些对不上的就是噪音，得标出来
      offTopic: discriminating && item.score === 0
    }));
}

function proxyUrl(path: string): string {
  return apiUrl(`${ROUTE_PREFIX}${path}`);
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

export async function searchSubtitles(options: {
  query: string;
  language: string;
  year?: string;
}): Promise<SubtitleCandidate[]> {
  const params = new URLSearchParams({ query: options.query, languages: options.language });
  if (options.year) params.set('year', options.year);

  const payload = await readJson(
    await fetch(proxyUrl(`/search?${params}`), { headers: await authHeaders() })
  );
  const candidates = ((payload?.data as any[]) || [])
    .map((item, index): SubtitleCandidate | null => {
      const attributes = item?.attributes;
      const file = attributes?.files?.[0];
      if (!attributes || !file?.file_id) return null;
      return {
        fileId: file.file_id,
        language: attributes.language,
        release: attributes.release || file.file_name || '未命名',
        fileName: file.file_name,
        downloadCount: attributes.download_count || 0,
        hearingImpaired: Boolean(attributes.hearing_impaired),
        title: attributes.feature_details?.title || '',
        year: attributes.feature_details?.year,
        apiRank: index
      };
    })
    .filter((item): item is SubtitleCandidate => item !== null);

  return sortByRelevance(candidates, options.query);
}

const CJK_PATTERN = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * 取靠前结果里出现最多的片名，作为这次搜索对应的规范英文原名。
 *
 * 必须在接口原始次序上按位次加权投票，光数票数会翻车：搜「源代码」时
 * 正确的 Source Code 排在前三但只有 3 份字幕，后面跟着 7 份 Code 46，
 * 纯计票会选中 Code 46。用 1/(位次+1) 衰减后前排的话语权压倒性，
 * 正好对应"接口认为最相关、且确实有多份字幕"这个特征。
 */
function pickCanonicalTitle(candidates: SubtitleCandidate[]): string | null {
  const weights = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.apiRank >= 12) continue;
    const title = candidate.title.trim();
    if (title) weights.set(title, (weights.get(title) ?? 0) + 1 / (candidate.apiRank + 1));
  }

  let best: string | null = null;
  let bestWeight = 0;
  for (const [title, weight] of weights) {
    if (weight > bestWeight) {
      best = title;
      bestWeight = weight;
    }
  }
  return best;
}

/**
 * 用中文片名搜英文字幕只会搜回一堆噪音，但中文结果里带着该片的英文原名，
 * 拿它重搜一次英文字幕即可，顺便用它把同名影片排到后面。
 */
export async function searchBilingualSubtitles(options: { query: string; year?: string }): Promise<{
  english: SubtitleCandidate[];
  chinese: SubtitleCandidate[];
  canonicalTitle: string | null;
}> {
  const [english, chinese] = await Promise.all([
    searchSubtitles({ query: options.query, language: 'en', year: options.year }),
    searchSubtitles({ query: options.query, language: 'zh-CN', year: options.year })
  ]);

  let canonicalTitle: string | null = null;
  let englishResults = english;
  if (CJK_PATTERN.test(options.query)) {
    canonicalTitle = pickCanonicalTitle(chinese);
    if (canonicalTitle) {
      englishResults = await searchSubtitles({
        query: canonicalTitle,
        language: 'en',
        year: options.year
      });
    }
  }

  const sortKey = canonicalTitle ?? options.query;
  return {
    english: sortByRelevance(englishResults, sortKey),
    chinese: sortByRelevance(chinese, sortKey),
    canonicalTitle
  };
}

export async function downloadSubtitle(options: { fileId: number }): Promise<DownloadedSubtitle> {
  const payload = await readJson(
    await fetch(proxyUrl('/download'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ file_id: options.fileId })
    })
  );
  return {
    text: payload.text,
    fileName: payload.fileName,
    remaining: payload.remaining ?? -1
  };
}
