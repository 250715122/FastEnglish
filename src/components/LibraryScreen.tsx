import React, { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatTime } from '../lib/formatTime';
import type { Movie, UploadState } from '../hooks/useLibrary';

type Tab = 'study' | 'library';

type Props = {
  studyList: Movie[];
  library: Movie[];
  configured: boolean;
  root: string | null;
  loading: boolean;
  upload: UploadState;
  userName: string;
  onOpen: (movie: Movie) => void;
  onAdd: (movieId: number) => void;
  onRemove: (movieId: number) => void;
  onRescan: () => void;
  onOpenAccount: () => void;
  onUpload: () => void;
  onSetPublic: (movieId: number, isPublic: boolean) => void;
  onDelete: (movieId: number) => void;
  onDismissUpload: () => void;
};

function sizeText(bytes: number) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

function whenText(at: number | null) {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function LibraryScreen({
  studyList,
  library,
  configured,
  root,
  loading,
  upload,
  userName,
  onOpen,
  onAdd,
  onRemove,
  onRescan,
  onOpenAccount,
  onUpload,
  onSetPublic,
  onDelete,
  onDismissUpload
}: Props) {
  const [tab, setTab] = useState<Tab>('study');
  const data = tab === 'study' ? studyList : library;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>学习列表</Text>
          {root ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              片库 {root}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity style={styles.headerPrimary} onPress={onUpload} activeOpacity={0.8}>
          <Text style={styles.headerPrimaryText}>+ 上传视频</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerAction} onPress={onRescan} activeOpacity={0.7}>
          <Text style={styles.headerActionText}>扫描新片</Text>
        </TouchableOpacity>
        {/* 退出、改密码这些都收进账号面板，标题栏留一个入口就够 */}
        <TouchableOpacity style={styles.headerAction} onPress={onOpenAccount} activeOpacity={0.7}>
          <Text style={styles.headerActionText} numberOfLines={1}>
            {userName}
          </Text>
        </TouchableOpacity>
      </View>

      {upload ? (
        <View style={[styles.uploadBar, upload.error && styles.uploadBarError]}>
          <Text style={styles.uploadName} numberOfLines={1}>
            {upload.error ? `${upload.fileName}：${upload.error}` : `正在上传 ${upload.fileName}`}
          </Text>
          {upload.error ? (
            <TouchableOpacity onPress={onDismissUpload} hitSlop={8}>
              <Text style={styles.uploadClose}>×</Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(upload.ratio * 100)}%` }]} />
              </View>
              <Text style={styles.uploadPercent}>{Math.round(upload.ratio * 100)}%</Text>
            </>
          )}
        </View>
      ) : null}

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'study' && styles.tabActive]}
          onPress={() => setTab('study')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, tab === 'study' && styles.tabTextActive]}>
            我在学 {studyList.length}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'library' && styles.tabActive]}
          onPress={() => setTab('library')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, tab === 'library' && styles.tabTextActive]}>
            片库 {library.length}
          </Text>
        </TouchableOpacity>
        {loading ? <ActivityIndicator style={styles.spinner} size="small" color="#1a73e8" /> : null}
      </View>

      {/* 用文件管理器往片库目录里拷了片子，应用是不会知道的，得手动让它去看一眼 */}
      {tab === 'library' && library.length ? (
        <Text style={styles.tabHint}>
          在应用外往 {root || '片库目录'} 里拷了新片子，点右上角「扫描新片」让它出现在这里。
        </Text>
      ) : null}

      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {tab === 'study' ? '还没有在学的片子' : '片库是空的'}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === 'study'
                ? '切到「片库」挑一部，或者直接点右上角上传。'
                : '有两种放片子的办法：'}
            </Text>
            {tab === 'library' ? (
              <>
                <Text style={styles.emptyStep}>
                  1. 点右上角「上传视频」，传上来的片子归你，默认只有你看得见
                </Text>
                <Text style={styles.emptyStep}>
                  2. 把视频文件直接拷进 {root || '片库目录'}，再点右上角「扫描新片」
                </Text>
                {!configured ? (
                  <Text style={styles.emptyNote}>
                    想用已有的电影收藏，在 .env 里把 MOVIE_ROOT 指过去再重启后端。
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onOpen(item)} activeOpacity={0.75}>
            <View style={styles.rowMain}>
              <View style={styles.rowTitleLine}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.isMine && item.visibility === 'public' ? (
                  <Text style={styles.badgeShared}>已共享</Text>
                ) : null}
                {item.isMine && item.visibility === 'private' ? (
                  <Text style={styles.badgePrivate}>私有</Text>
                ) : null}
              </View>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {[
                  sizeText(item.size),
                  !item.isMine && item.ownerName ? `${item.ownerName} 共享` : null,
                  item.subtitleLabel || null,
                  item.lastPosition > 0 ? `看到 ${formatTime(item.lastPosition)}` : null,
                  whenText(item.lastOpenedAt)
                ]
                  .filter(Boolean)
                  .join(' · ') || item.name}
              </Text>
            </View>

            {item.isMine ? (
              <TouchableOpacity
                style={styles.rowAction}
                onPress={() => onSetPublic(item.id, item.visibility !== 'public')}
                hitSlop={8}
                activeOpacity={0.6}
              >
                <Text style={styles.rowActionText}>
                  {item.visibility === 'public' ? '取消共享' : '共享'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {item.inStudyList ? (
              <TouchableOpacity
                style={styles.rowAction}
                onPress={() => onRemove(item.id)}
                hitSlop={8}
                activeOpacity={0.6}
              >
                <Text style={styles.rowActionText}>移出</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.rowAction, styles.rowActionPrimary]}
                onPress={() => onAdd(item.id)}
                hitSlop={8}
                activeOpacity={0.6}
              >
                <Text style={[styles.rowActionText, styles.rowActionTextPrimary]}>加入学习</Text>
              </TouchableOpacity>
            )}

            {item.isMine && item.source === 'upload' ? (
              <TouchableOpacity
                style={styles.rowAction}
                onPress={() => onDelete(item.id)}
                hitSlop={8}
                activeOpacity={0.6}
              >
                <Text style={styles.rowActionDanger}>删除</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f5f6f8'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e4e6eb'
  },
  headerLeft: {
    flex: 1,
    minWidth: 0
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  subtitle: {
    marginTop: 3,
    fontSize: 12,
    color: '#80868b'
  },
  headerPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 7,
    backgroundColor: '#1a73e8'
  },
  headerPrimaryText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '700'
  },
  headerAction: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: '#f1f2f4'
  },
  headerActionText: {
    fontSize: 13,
    color: '#3c4043',
    fontWeight: '600'
  },
  uploadBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e8f0fe'
  },
  uploadBarError: {
    backgroundColor: '#fce8e6'
  },
  uploadName: {
    flex: 1,
    fontSize: 13,
    color: '#3c4043',
    minWidth: 0
  },
  progressTrack: {
    width: 140,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#c6dafc',
    overflow: 'hidden'
  },
  progressFill: {
    height: 6,
    backgroundColor: '#1a73e8'
  },
  uploadPercent: {
    fontSize: 12,
    color: '#1a73e8',
    fontWeight: '700',
    width: 40,
    textAlign: 'right'
  },
  uploadClose: {
    fontSize: 20,
    color: '#d93025',
    paddingHorizontal: 4
  },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#e8eaed'
  },
  tabActive: {
    backgroundColor: '#1a73e8'
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5f6368'
  },
  tabTextActive: {
    color: '#fff'
  },
  spinner: {
    marginLeft: 4
  },
  tabHint: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    fontSize: 12,
    color: '#9aa0a6',
    lineHeight: 18
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 8
  },
  empty: {
    marginTop: 40,
    paddingHorizontal: 12
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3c4043',
    textAlign: 'center'
  },
  emptyBody: {
    marginTop: 10,
    fontSize: 13,
    color: '#80868b',
    textAlign: 'center',
    lineHeight: 21
  },
  emptyStep: {
    marginTop: 10,
    fontSize: 13,
    color: '#5f6368',
    lineHeight: 21
  },
  emptyNote: {
    marginTop: 16,
    fontSize: 12,
    color: '#9aa0a6',
    lineHeight: 19
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e4e6eb'
  },
  rowMain: {
    flex: 1,
    minWidth: 0
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    flexShrink: 1
  },
  badgeShared: {
    fontSize: 11,
    color: '#188038',
    backgroundColor: '#e6f4ea',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden'
  },
  badgePrivate: {
    fontSize: 11,
    color: '#80868b',
    backgroundColor: '#f1f2f4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden'
  },
  rowMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#80868b'
  },
  rowAction: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: '#f1f2f4'
  },
  rowActionPrimary: {
    backgroundColor: '#e8f0fe'
  },
  rowActionText: {
    fontSize: 12,
    color: '#5f6368',
    fontWeight: '600'
  },
  rowActionTextPrimary: {
    color: '#1a73e8'
  },
  rowActionDanger: {
    fontSize: 12,
    color: '#d93025',
    fontWeight: '600'
  },
  chevron: {
    fontSize: 22,
    color: '#c6cdd6',
    marginLeft: 2
  }
});
