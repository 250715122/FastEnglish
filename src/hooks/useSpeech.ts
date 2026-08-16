import * as Speech from 'expo-speech';
import { useCallback, useRef, useState } from 'react';

/**
 * lockRef 与 isSpeaking 各管一件事：前者防止回调之间的竞态导致重复触发，
 * 后者驱动界面禁用状态。两者都要在 done/stopped/error 三种结局里复位。
 */
export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lockRef = useRef(false);

  const speak = useCallback((value: string, options?: Speech.SpeechOptions) => {
    if (!value || lockRef.current) return;
    lockRef.current = true;
    setIsSpeaking(true);

    const release = () => {
      lockRef.current = false;
      setIsSpeaking(false);
    };

    try {
      Speech.speak(value, {
        language: 'en-US',
        pitch: 1.0,
        rate: 0.9,
        ...options,
        onDone: release,
        onStopped: release,
        onError: release
      });
    } catch {
      release();
    }
  }, []);

  const stop = useCallback(() => {
    Speech.stop();
    lockRef.current = false;
    setIsSpeaking(false);
  }, []);

  return { isSpeaking, speak, stop };
}
