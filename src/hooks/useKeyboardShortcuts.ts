import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export type ShortcutHandlers = {
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRepeat: () => void;
  onToggleLoop: () => void;
  onToggleChinese: () => void;
  onMarkLoopStart: () => void;
  onMarkLoopEnd: () => void;
  onClearLoop: () => void;
};

/**
 * 精听时手停在键盘上比来回找按钮快得多；输入框获得焦点时不拦截。
 * 整页都在等你敲字的地方（比如默写）传 enabled=false 一次让干净。
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true) {
  const ref = useRef({ handlers, enabled });
  ref.current = { handlers, enabled };

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!ref.current.enabled) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }

      const { handlers: current } = ref.current;
      const actions: Record<string, (() => void) | undefined> = {
        Space: current.onTogglePlay,
        ArrowLeft: current.onPrevious,
        ArrowRight: current.onNext,
        KeyR: current.onRepeat,
        KeyL: current.onToggleLoop,
        KeyC: current.onToggleChinese,
        BracketLeft: current.onMarkLoopStart,
        BracketRight: current.onMarkLoopEnd,
        Escape: current.onClearLoop
      };

      const action = actions[event.code];
      if (!action) return;
      // 空格会滚动页面，方向键会移动原生播放器的进度
      event.preventDefault();
      action();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
