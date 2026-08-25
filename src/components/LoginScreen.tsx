import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { API_BASE } from '../lib/api';

type Props = {
  error: string | null;
  /** 一个用户都还没有时先展示注册 */
  hasUsers: boolean;
  /** 挂到公网后注册可能整个关掉，那就别摆一个按了必然失败的入口 */
  canRegister: boolean;
  /** 已经有人了、又配了邀请码：注册要多填一栏 */
  needsInvite: boolean;
  onLogin: (username: string, password: string) => Promise<boolean>;
  onRegister: (
    username: string,
    password: string,
    displayName: string,
    invite: string
  ) => Promise<boolean>;
};

export function LoginScreen({
  error,
  hasUsers,
  canRegister,
  needsInvite,
  onLogin,
  onRegister
}: Props) {
  const [mode, setMode] = useState<'login' | 'register'>(hasUsers ? 'login' : 'register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);

  const registering = mode === 'register' && canRegister;
  const canSubmit =
    username.trim().length >= 2 &&
    password.length >= 6 &&
    (!registering || !needsInvite || invite.trim().length > 0) &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    if (registering) {
      await onRegister(username.trim(), password, displayName.trim() || username.trim(), invite.trim());
    } else {
      await onLogin(username.trim(), password);
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>FastEnglish</Text>
        <Text style={styles.tagline}>看电影学英语，每个人有自己的片单和笔记</Text>

        {/* 注册关着的时候连标签都不摆，省得点了才知道此路不通 */}
        {canRegister ? (
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, !registering && styles.tabActive]}
              onPress={() => setMode('login')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, !registering && styles.tabTextActive]}>登录</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, registering && styles.tabActive]}
              onPress={() => setMode('register')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, registering && styles.tabTextActive]}>注册</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.closed}>这台服务器没开放注册，用已有的账号登录。</Text>
        )}

        <Text style={styles.label}>用户名</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="至少两个字符"
          placeholderTextColor="#9aa0a6"
          onSubmitEditing={submit}
        />

        {registering ? (
          <>
            <Text style={styles.label}>显示名称</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="留空就用用户名"
              placeholderTextColor="#9aa0a6"
              onSubmitEditing={submit}
            />
            {needsInvite ? (
              <>
                <Text style={styles.label}>邀请码</Text>
                <TextInput
                  style={styles.input}
                  value={invite}
                  onChangeText={setInvite}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="找服务器的主人要"
                  placeholderTextColor="#9aa0a6"
                  onSubmitEditing={submit}
                />
              </>
            ) : null}
          </>
        ) : null}

        <Text style={styles.label}>密码</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="至少 6 位"
          placeholderTextColor="#9aa0a6"
          onSubmitEditing={submit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.submit, !canSubmit && styles.submitOff]}
          onPress={submit}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>{registering ? '注册并进入' : '登录'}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>后端：{API_BASE}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f6f8',
    padding: 24
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 28,
    borderWidth: 1,
    borderColor: '#e4e6eb'
  },
  brand: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a'
  },
  tagline: {
    marginTop: 6,
    fontSize: 13,
    color: '#6b7280'
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 22,
    marginBottom: 6
  },
  tab: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f1f2f4'
  },
  tabActive: {
    backgroundColor: '#1a73e8'
  },
  tabText: {
    fontSize: 14,
    color: '#5f6368',
    fontWeight: '600'
  },
  tabTextActive: {
    color: '#fff'
  },
  label: {
    marginTop: 16,
    marginBottom: 6,
    fontSize: 13,
    color: '#5f6368',
    fontWeight: '600'
  },
  input: {
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1a1a1a',
    backgroundColor: '#fff'
  },
  error: {
    marginTop: 14,
    fontSize: 13,
    color: '#d93025'
  },
  closed: {
    marginTop: 20,
    marginBottom: 2,
    fontSize: 12,
    color: '#9aa0a6'
  },
  submit: {
    marginTop: 22,
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center'
  },
  submitOff: {
    backgroundColor: '#c6cdd6'
  },
  submitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700'
  },
  hint: {
    marginTop: 18,
    fontSize: 11,
    color: '#9aa0a6',
    textAlign: 'center'
  }
});
