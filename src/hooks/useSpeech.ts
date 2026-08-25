import * as Speech from 'expo-speech';
import { useCallback, useRef, useState } from 'react';
import { reclaimAudioSession } from '../lib/audioSession';

/**
 * 一次只念一段，新的请求直接盖掉旧的——挨个点单词听发音时，
 * 要是等前一个念完才受理，后面几下就跟没按一样。
 *
 * 打断会让旧那段回调 onStopped，它的 release 必须认得出自己已经过期，
 * 否则会把刚开始的这段的 isSpeaking 提前清掉。tokenRef 就是这张身份牌。
 */
export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const tokenRef = useRef(0);

  /**
   * 返回的 Promise 在念完、被打断或出错时兑现，串着念一列句子时需要它。
   * 「被打断」和「念完」都兑现是有意的：调用方要区分这两者，得自己拿别的东西记，
   * 光靠回调种类区分不出来——各平台在打断时到底回调 onDone 还是 onStopped 并不一致。
   */
  const speak = useCallback((value: string, options?: Speech.SpeechOptions) => {
    if (!value) return Promise.resolve();
    const token = (tokenRef.current += 1);
    setIsSpeaking(true);

    return new Promise<void>((resolve) => {
      const release = () => {
        if (tokenRef.current === token) setIsSpeaking(false);
        // 念完得把音频会话要回来，理由见 reclaimAudioSession
        reclaimAudioSession();
        resolve();
      };

      try {
        Speech.stop();
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
    });
  }, []);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    Speech.stop();
    setIsSpeaking(false);
    reclaimAudioSession();
  }, []);

  return { isSpeaking, speak, stop };
}
