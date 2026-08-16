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

/** 精听时手停在键盘上比来回找按钮快得多；输入框获得焦点时不拦截。 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }

      const actions: Record<string, (() => void) | undefined> = {
        Space: ref.current.onTogglePlay,
        ArrowLeft: ref.current.onPrevious,
        ArrowRight: ref.current.onNext,
        KeyR: ref.current.onRepeat,
        KeyL: ref.current.onToggleLoop,
        KeyC: ref.current.onToggleChinese,
        BracketLeft: ref.current.onMarkLoopStart,
        BracketRight: ref.current.onMarkLoopEnd,
        Escape: ref.current.onClearLoop
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
