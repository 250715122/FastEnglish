import type { Segment } from '../types/subtitle';
import { apiUrl, authHeaders } from './api';

/**
 * 字幕由开发服务器落盘（见 scripts/subtitleStore.js）：配了电影库就存到视频文件
 * 旁边，否则存进项目的 subtitles/ 目录。下载一次就能一直复用，不再消耗每天有限
 * 的下载额度。浏览器写不了磁盘，所以读写都经开发服务器，网页端和原生端共用端点。
 */
const ROUTE_PREFIX = '/api/subtitles';

export type CachedSubtitleMeta = {
  /** 视频文件名，用它把字幕和片源对上 */
  key: string;
  label: string;
  count: number;
  savedAt: number;
  /** 存在视频旁边还是项目目录里 */
  location?: 'movie' | 'project';
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(apiUrl(`${ROUTE_PREFIX}${path}`), {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), ...(await authHeaders()) }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

export async function listCachedSubtitles(): Promise<CachedSubtitleMeta[]> {
  try {
    const payload = await request('/list');
    return Array.isArray(payload?.entries) ? payload.entries : [];
  } catch {
    return [];
  }
}

export async function loadCachedSubtitle(
  key: string
): Promise<{ label: string; segments: Segment[] } | null> {
  try {
    const payload = await request(`/item?key=${encodeURIComponent(key)}`);
    if (!Array.isArray(payload?.segments) || !payload.segments.length) return null;
    return { label: payload.label, segments: payload.segments };
  } catch {
    return null;
  }
}

export async function saveCachedSubtitle(
  key: string,
  label: string,
  segments: Segment[]
): Promise<CachedSubtitleMeta[]> {
  if (!key || !segments.length) return listCachedSubtitles();
  const payload = await request('/item', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, label, segments })
  });
  return Array.isArray(payload?.entries) ? payload.entries : [];
}

/**
 * 片源命名千奇百怪，同一部片可能叫 Inception.2010.1080p.BluRay.x264.mp4，
 * 也可能叫 盗梦空间.mkv。剥掉扩展名、画质编码这些发布组标记后再比，
 * 换一个版本的片源也能认出之前存过的字幕。
 */
const NOISE = /\b(1080p|2160p|720p|480p|4k|uhd|hdr|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|avc|10bit|8bit|aac|ac3|dts|ddp?5[._]?1|truehd|atmos|repack|proper|extended|remastered|unrated|internal|multi|chs|cht|eng)\b/g;

function normalizeName(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .toLowerCase()
    .replace(/[._\-\[\]()]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 在已保存的字幕里找和这个视频最可能是同一部片的那条。
 * 只在归一化后完全相同、或一方包含另一方且长度足够时才认，
 * 宁可不认也不能张冠李戴——套错字幕比没字幕更难受。
 */
export function findSimilarCached(
  key: string,
  entries: CachedSubtitleMeta[]
): CachedSubtitleMeta | null {
  const target = normalizeName(key);
  if (target.length < 2) return null;

  const matches = entries.filter((entry) => {
    if (entry.key === key) return false;
    const candidate = normalizeName(entry.key);
    if (!candidate) return false;
    if (candidate === target) return true;
    const [shorter, longer] = candidate.length < target.length ? [candidate, target] : [target, candidate];
    return shorter.length >= 4 && longer.includes(shorter);
  });

  // 有歧义时不猜，交给用户自己点
  return matches.length === 1 ? matches[0] : null;
}

export async function removeCachedSubtitle(key: string): Promise<CachedSubtitleMeta[]> {
  const payload = await request(`/item?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  return Array.isArray(payload?.entries) ? payload.entries : [];
}
