import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { User } from '../hooks/useAuth';

export type AccountStats = {
  studying: number;
  favorites: number;
  notes: number;
  mastered: number;
};

type Props = {
  user: User;
  /** 这个账号还有几台设备登着，为 1 时「退出其它设备」没意义 */
  sessions: number;
  stats: AccountStats;
  onChangePassword: (current: string, next: string) => Promise<number>;
  onLogoutOthers: () => Promise<number>;
  onLogout: () => void;
  onClose: () => void;
};

function joinedText(at?: number) {
  if (!at) return '';
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 注册`;
}

/**
 * 危险操作不用系统弹窗：react-native-web 上的 Alert 行为和原生对不齐，
 * 按钮就地变成「确定要…？」反而两边一致，也不会挡住后面的内容。
 */
function useConfirm() {
  const [armed, setArmed] = useState<string | null>(null);
  return {
    armed,
    arm: (key: string) => setArmed(key),
    reset: () => setArmed(null)
  };
}

export function AccountScreen({
  user,
  sessions,
  stats,
  onChangePassword,
  onLogoutOthers,
  onLogout,
  onClose
}: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const confirm = useConfirm();
  const insets = useSafeAreaInsets();

  const say = (text: string, isError: boolean) => {
    setMessage(text);
    setFailed(isError);
  };

  const submitPassword = async () => {
    if (busy) return;
    // 两次不一致就地拦下，没必要为这个跑一趟服务端
    if (next !== repeat) {
      say('两次输入的新密码不一样', true);
      return;
    }

    setBusy(true);
    try {
      const revoked = await onChangePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      say(revoked > 0 ? `密码改好了，另外 ${revoked} 台设备已被退出登录` : '密码改好了', false);
    } catch (error) {
      say((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const kickOthers = async () => {
    confirm.reset();
    setBusy(true);
    try {
      const revoked = await onLogoutOthers();
      say(revoked > 0 ? `已退出另外 ${revoked} 台设备` : '本来就只有这一台登着', false);
    } catch (error) {
      say((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      // iOS 键盘是盖上来的，得把整块内容顶上去；安卓系统自己会缩窗口
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.head}>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>账号</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: 60 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.sub}>
            {user.username}
            {user.createdAt ? ` · ${joinedText(user.createdAt)}` : ''}
          </Text>

          <View style={styles.stats}>
            <Stat label="在学" value={stats.studying} unit="部" />
            <Stat label="收藏" value={stats.favorites} unit="句" />
            <Stat label="注释" value={stats.notes} unit="条" />
            <Stat label="已掌握" value={stats.mastered} unit="词" />
          </View>
          {/* 学习记录跟着账号走，不在这台设备上，换机器登上来就还在 */}
          <Text style={styles.statsNote}>这些记录存在服务端，换台设备登上来还是这些。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>修改密码</Text>
          <TextInput
            style={styles.input}
            value={current}
            onChangeText={setCurrent}
            placeholder="当前密码"
            placeholderTextColor="#aab0b8"
            secureTextEntry
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={next}
            onChangeText={setNext}
            placeholder="新密码，至少 6 位"
            placeholderTextColor="#aab0b8"
            secureTextEntry
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={repeat}
            onChangeText={setRepeat}
            placeholder="再输一次新密码"
            placeholderTextColor="#aab0b8"
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={submitPassword}
          />
          <TouchableOpacity
            style={[styles.primary, (busy || !current || !next) && styles.primaryOff]}
            onPress={submitPassword}
            disabled={busy || !current || !next}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryText}>{busy ? '处理中…' : '保存新密码'}</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            改完密码，其它设备上的登录会一并失效，这台不受影响。
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>登录设备</Text>
          <Text style={styles.hint}>
            {sessions > 1
              ? `当前有 ${sessions} 台设备登着这个账号（含这一台）。`
              : '目前只有这一台设备登着。'}
          </Text>
          {confirm.armed === 'others' ? (
            <View style={styles.confirmRow}>
              <TouchableOpacity style={styles.danger} onPress={kickOthers} activeOpacity={0.8}>
                <Text style={styles.dangerText}>确定退出其它设备</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghost} onPress={confirm.reset} activeOpacity={0.7}>
                <Text style={styles.ghostText}>算了</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.outline, sessions <= 1 && styles.outlineOff]}
              onPress={() => confirm.arm('others')}
              disabled={busy || sessions <= 1}
              activeOpacity={0.7}
            >
              <Text style={[styles.outlineText, sessions <= 1 && styles.outlineTextOff]}>
                退出其它设备
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {message ? (
          <Text style={[styles.message, failed && styles.messageError]}>{message}</Text>
        ) : null}

        <View style={styles.card}>
          {confirm.armed === 'self' ? (
            <View style={styles.confirmRow}>
              <TouchableOpacity style={styles.danger} onPress={onLogout} activeOpacity={0.8}>
                <Text style={styles.dangerText}>确定退出登录</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghost} onPress={confirm.reset} activeOpacity={0.7}>
                <Text style={styles.ghostText}>算了</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.outline}
              onPress={() => confirm.arm('self')}
              activeOpacity={0.7}
            >
              <Text style={styles.outlineText}>退出登录</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.hint}>
            退出只是清掉这台设备上的登录，学习记录都在服务端，登回来一条不少。
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>
        {value}
        <Text style={styles.statUnit}> {unit}</Text>
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f5f6f8',
    zIndex: 30
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecf0'
  },
  back: {
    fontSize: 14,
    color: '#2f80ed'
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  body: {
    padding: 16,
    gap: 12,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e9ecf0',
    gap: 10
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  sub: {
    marginTop: -6,
    fontSize: 12,
    color: '#80868b'
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4
  },
  stat: {
    flexGrow: 1,
    minWidth: 74,
    backgroundColor: '#f7f8fa',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  statValue: {
    fontSize: 19,
    fontWeight: '700',
    color: '#2f80ed'
  },
  statUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9aa0a6'
  },
  statLabel: {
    marginTop: 2,
    fontSize: 12,
    color: '#80868b'
  },
  statsNote: {
    fontSize: 12,
    color: '#9aa0a6',
    lineHeight: 18
  },
  section: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3c4043'
  },
  input: {
    borderWidth: 1,
    borderColor: '#dfe3e8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1a1a1a',
    backgroundColor: '#fff'
  },
  primary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#1a73e8'
  },
  primaryOff: {
    backgroundColor: '#b9c6d8'
  },
  primaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff'
  },
  outline: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0c4c1',
    backgroundColor: '#fdf4f3'
  },
  outlineOff: {
    borderColor: '#e4e6eb',
    backgroundColor: '#f4f5f7'
  },
  outlineText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b0483f'
  },
  outlineTextOff: {
    color: '#aab0b8'
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  danger: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#b0483f'
  },
  dangerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff'
  },
  ghost: {
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  ghostText: {
    fontSize: 13,
    color: '#80868b'
  },
  hint: {
    fontSize: 12,
    color: '#9aa0a6',
    lineHeight: 18
  },
  message: {
    fontSize: 13,
    color: '#188038',
    paddingHorizontal: 4,
    lineHeight: 19
  },
  messageError: {
    color: '#b0483f'
  }
});
