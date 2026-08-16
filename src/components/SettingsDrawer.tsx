import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

/** 浮在学习区上层，收起后不占据任何高度，避免一次性设置常年挤占首屏。 */
export function SettingsDrawer({ open, onClose, title, children }: Props) {
  if (!open) return null;
  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.drawer}>
        {/* 关掉浮层的入口就放在浮层自己身上，不用回头去顶栏找 */}
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity style={styles.close} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>收起</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 20, 30, 0.35)'
  },
  drawer: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 860,
    maxHeight: '86%',
    marginTop: 8,
    backgroundColor: '#f7f8fa',
    borderRadius: 14,
    overflow: 'hidden'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecf0'
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#222'
  },
  close: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#eef1f5'
  },
  closeText: {
    fontSize: 13,
    color: '#333'
  },
  content: {
    padding: 16
  }
});
