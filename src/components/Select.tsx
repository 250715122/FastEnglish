import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** 灰字补一句这一档是干嘛的，或者为什么现在不能选 */
  hint?: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  minWidth?: number;
};

const ROW_HEIGHT = 38;

/**
 * 一个下拉选择。
 *
 * 菜单走 Modal 而不是就地绝对定位：控制条那一行外面套了好几层，
 * 就地摆的话既要跟兄弟节点抢层级，点空白处也收不起来。
 * Modal 天生盖在最上面，还自带一块能接住点击的背板。
 */
export function Select<T extends string>({ value, options, onChange, disabled, minWidth = 96 }: Props<T>) {
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();

  const current = options.find((option) => option.value === value);
  const menuHeight = options.length * ROW_HEIGHT + 10;

  const open = () => {
    if (disabled) return;
    trigger.current?.measureInWindow((x, y, width, height) => {
      // 底下摆不下就翻到上面去，不然菜单一半掉到屏幕外
      const below = y + height + 4;
      const top = below + menuHeight > windowHeight ? Math.max(8, y - menuHeight - 4) : below;
      const boxWidth = Math.max(width, minWidth);
      setAnchor({ top, left: Math.min(x, Math.max(8, windowWidth - boxWidth - 8)), width: boxWidth });
    });
  };

  return (
    <>
      <View ref={trigger} collapsable={false}>
        <TouchableOpacity
          style={[styles.trigger, disabled && styles.triggerOff, { minWidth }]}
          onPress={open}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Text style={[styles.triggerText, disabled && styles.triggerTextOff]} numberOfLines={1}>
            {current?.label ?? ''}
          </Text>
          <Text style={[styles.caret, disabled && styles.triggerTextOff]}>▾</Text>
        </TouchableOpacity>
      </View>

      <Modal transparent visible={!!anchor} animationType="none" onRequestClose={() => setAnchor(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAnchor(null)}>
          {anchor ? (
            <View style={[styles.menu, { top: anchor.top, left: anchor.left, minWidth: anchor.width }]}>
              {options.map((option) => {
                const on = option.value === value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.row, on && styles.rowOn]}
                    disabled={option.disabled}
                    activeOpacity={0.7}
                    onPress={() => {
                      setAnchor(null);
                      onChange(option.value);
                    }}
                  >
                    <Text style={[styles.check, !on && styles.checkOff]}>✓</Text>
                    <Text style={[styles.label, option.disabled && styles.labelOff, on && styles.labelOn]}>
                      {option.label}
                    </Text>
                    {option.hint ? <Text style={styles.hint}>{option.hint}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#eef1f5'
  },
  triggerOff: {
    backgroundColor: '#f2f3f5'
  },
  triggerText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600'
  },
  triggerTextOff: {
    color: '#bbb'
  },
  caret: {
    fontSize: 10,
    color: '#8a94a2'
  },
  menu: {
    position: 'absolute',
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e6e9ee',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: ROW_HEIGHT,
    paddingHorizontal: 12
  },
  rowOn: {
    backgroundColor: '#f2f7ff'
  },
  check: {
    fontSize: 12,
    color: '#2f80ed',
    width: 12
  },
  checkOff: {
    // 留着位置不显示，选中项才不会比其他项宽出一截
    opacity: 0
  },
  label: {
    fontSize: 13,
    color: '#333'
  },
  labelOn: {
    color: '#2f80ed',
    fontWeight: '600'
  },
  labelOff: {
    color: '#bbb'
  },
  hint: {
    flex: 1,
    fontSize: 11,
    color: '#a3a9b3',
    textAlign: 'right'
  }
});
