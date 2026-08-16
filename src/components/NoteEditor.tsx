import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatTime } from '../lib/formatTime';
import type { Segment } from '../types/subtitle';

type Props = {
  segment: Segment;
  index: number;
  initialText: string;
  onSave: (text: string) => void;
  onClose: () => void;
};

export function NoteEditor({ segment, index, initialText, onSave, onClose }: Props) {
  const [text, setText] = useState(initialText);

  // 换一句再打开时要装上那一句的内容，不能留着上一句的
  useEffect(() => setText(initialText), [initialText, index]);

  const submit = () => {
    onSave(text);
    onClose();
  };

  return (
    <View style={styles.backdrop}>
      {/* 点周围空白关掉，手机上比找按钮快 */}
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />

      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.title}>写注释</Text>
          <Text style={styles.time}>
            第 {index + 1} 句 · {formatTime(segment.start)}
          </Text>
        </View>

        {segment.en ? <Text style={styles.english}>{segment.en}</Text> : null}
        {segment.zh ? <Text style={styles.chinese}>{segment.zh}</Text> : null}

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="记下你自己的理解，比如这里的语气、指代的是谁、为什么这么说"
          placeholderTextColor="#aab"
          multiline
          autoFocus
          // 回车换行，Ctrl/Cmd+Enter 提交，免得写多行时误交
          onKeyPress={({ nativeEvent }) => {
            const event = nativeEvent as unknown as { key: string; metaKey?: boolean; ctrlKey?: boolean };
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          }}
        />

        <View style={styles.actions}>
          <Text style={styles.hint}>清空内容再保存就是删除这条注释</Text>
          <View style={styles.spacer} />
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.cancel}>取消</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveButton} onPress={submit} activeOpacity={0.8}>
            <Text style={styles.saveText}>保存</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,24,32,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 40
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 10
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#222'
  },
  time: {
    fontSize: 12,
    color: '#999'
  },
  english: {
    fontSize: 14,
    lineHeight: 20,
    color: '#333'
  },
  chinese: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 18,
    color: '#777'
  },
  input: {
    marginTop: 12,
    minHeight: 96,
    borderWidth: 1,
    borderColor: '#dde2e8',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    lineHeight: 20,
    color: '#222',
    textAlignVertical: 'top'
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12
  },
  hint: {
    fontSize: 11,
    color: '#aaa',
    flexShrink: 1
  },
  spacer: {
    flex: 1
  },
  cancel: {
    fontSize: 13,
    color: '#888'
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#2f80ed'
  },
  saveText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff'
  }
});
