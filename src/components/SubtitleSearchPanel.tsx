import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { searchBilingualSubtitles, type SubtitleCandidate } from '../lib/subtitleSearch/openSubtitles';

type Props = {
  initialQuery: string;
  busy: boolean;
  quotaRemaining: number | null;
  onDownloadPair: (english: SubtitleCandidate | null, chinese: SubtitleCandidate | null) => void;
};

const MAX_ROWS = 6;

function CandidateRow({
  candidate,
  selected,
  onPress
}: {
  candidate: SubtitleCandidate;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.row, selected && styles.rowSelected]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.release, selected && styles.releaseSelected]} numberOfLines={2}>
        {candidate.release}
      </Text>
      <Text style={styles.meta}>
        {candidate.title}
        {candidate.year ? `（${candidate.year}）` : ''} · 下载 {candidate.downloadCount.toLocaleString()}
        {candidate.hearingImpaired ? ' · 含音效描述' : ''}
      </Text>
      {/* 片名跟搜索词对不上的，下了多半是别的电影，得说明白 */}
      {candidate.offTopic ? <Text style={styles.offTopic}>片名对不上，可能不是这部片</Text> : null}
    </TouchableOpacity>
  );
}

export function SubtitleSearchPanel({ initialQuery, busy, quotaRemaining, onDownloadPair }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [year, setYear] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [english, setEnglish] = useState<SubtitleCandidate[]>([]);
  const [chinese, setChinese] = useState<SubtitleCandidate[]>([]);
  const [pickedEnglish, setPickedEnglish] = useState<SubtitleCandidate | null>(null);
  const [pickedChinese, setPickedChinese] = useState<SubtitleCandidate | null>(null);
  const [searched, setSearched] = useState(false);
  const [canonicalTitle, setCanonicalTitle] = useState<string | null>(null);

  const runSearch = async () => {
    const keyword = query.trim();
    if (!keyword) {
      setError('请先填写片名');
      return;
    }

    setSearching(true);
    setError(null);
    setPickedEnglish(null);
    setPickedChinese(null);
    try {
      // 搜索不消耗下载额度
      const result = await searchBilingualSubtitles({ query: keyword, year: year.trim() || undefined });
      const en = result.english.slice(0, MAX_ROWS);
      const zh = result.chinese.slice(0, MAX_ROWS);
      setEnglish(en);
      setChinese(zh);
      // 片名对不上的一律不预选：默认选中它等于诱导用户下错片，还白费一次额度
      setPickedEnglish(en[0] && !en[0].offTopic ? en[0] : null);
      setPickedChinese(zh[0] && !zh[0].offTopic ? zh[0] : null);
      setCanonicalTitle(result.canonicalTitle);
      setSearched(true);
      if (!en.length && !zh.length) {
        setError('没有搜到字幕，换个片名试试，英文原名命中率更高');
      } else if ((!en.length || en[0].offTopic) && (!zh.length || zh[0].offTopic)) {
        setError(`没找到片名叫「${keyword}」的电影，下面这些都是别的片子。建议改用英文原名再搜一次。`);
      }
    } catch (searchError) {
      setError((searchError as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const canDownload = Boolean(pickedEnglish || pickedChinese) && !busy;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>在线搜索字幕</Text>
      <Text style={styles.hint}>
        中文名和英文原名都能搜，例如「源代码」或「Source Code」。搜索不消耗额度，只有下载才消耗。
      </Text>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, styles.inputGrow]}
          value={query}
          onChangeText={setQuery}
          placeholder="片名"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={runSearch}
        />
        <TextInput
          style={[styles.input, styles.inputYear]}
          value={year}
          onChangeText={setYear}
          placeholder="年份"
          placeholderTextColor="#999"
          keyboardType="number-pad"
          maxLength={4}
        />
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary, searching && styles.buttonDisabled]}
          onPress={runSearch}
          disabled={searching}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonTextPrimary}>{searching ? '搜索中…' : '搜索'}</Text>
        </TouchableOpacity>
        {quotaRemaining !== null ? <Text style={styles.quota}>今日剩余下载 {quotaRemaining} 次</Text> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {searched ? (
        <View style={styles.results}>
          {canonicalTitle ? (
            <Text style={styles.canonical}>已按英文原名《{canonicalTitle}》搜索英文字幕</Text>
          ) : null}
          <Text style={styles.groupTitle}>英文字幕 {english.length ? `（${english.length}）` : '（无结果）'}</Text>
          {english.map((item) => (
            <CandidateRow
              key={item.fileId}
              candidate={item}
              selected={pickedEnglish?.fileId === item.fileId}
              onPress={() => setPickedEnglish(pickedEnglish?.fileId === item.fileId ? null : item)}
            />
          ))}

          <Text style={[styles.groupTitle, styles.groupTitleSpacing]}>
            中文字幕 {chinese.length ? `（${chinese.length}）` : '（无结果）'}
          </Text>
          {chinese.map((item) => (
            <CandidateRow
              key={item.fileId}
              candidate={item}
              selected={pickedChinese?.fileId === item.fileId}
              onPress={() => setPickedChinese(pickedChinese?.fileId === item.fileId ? null : item)}
            />
          ))}

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, styles.downloadButton, !canDownload && styles.buttonDisabled]}
            onPress={() => onDownloadPair(pickedEnglish, pickedChinese)}
            disabled={!canDownload}
            activeOpacity={0.7}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.buttonTextPrimary}>
                {pickedEnglish && pickedChinese
                  ? '下载中英两份并合并为双语'
                  : pickedEnglish
                    ? '只下载英文字幕'
                    : pickedChinese
                      ? '只下载中文字幕'
                      : '请先选择字幕'}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>选中一条中文和一条英文会各消耗 1 次额度，按时间轴自动配对成双语。</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
    marginBottom: 10
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#fafafa'
  },
  inputGrow: {
    flex: 1
  },
  inputYear: {
    width: 76
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonPrimary: {
    backgroundColor: '#2f80ed'
  },
  buttonDisabled: {
    backgroundColor: '#c7d3e3'
  },
  buttonTextPrimary: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600'
  },
  quota: {
    fontSize: 12,
    color: '#888'
  },
  error: {
    marginTop: 10,
    fontSize: 12,
    color: '#c0392b',
    lineHeight: 18
  },
  results: {
    marginTop: 12
  },
  canonical: {
    fontSize: 12,
    color: '#2f80ed',
    marginBottom: 10
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8
  },
  groupTitleSpacing: {
    marginTop: 16
  },
  row: {
    borderWidth: 1,
    borderColor: '#eef1f5',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#fbfcfd'
  },
  rowSelected: {
    borderColor: '#2f80ed',
    backgroundColor: '#eef4ff'
  },
  release: {
    fontSize: 13,
    color: '#222',
    lineHeight: 18
  },
  releaseSelected: {
    fontWeight: '600'
  },
  meta: {
    marginTop: 4,
    fontSize: 11,
    color: '#888'
  },
  offTopic: {
    marginTop: 4,
    fontSize: 11,
    color: '#b0483f'
  },
  downloadButton: {
    marginTop: 16,
    paddingVertical: 12
  }
});
