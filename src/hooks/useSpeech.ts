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
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;

      const release = () => {
        // 打断时 onStopped 和 onDone 都可能来，别把同一段结算两遍
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);

        const latest = tokenRef.current === token;
        if (latest) setIsSpeaking(false);
        resolve();

        /**
         * 音频会话要等一拍再抢，而且只在没有下一句接上时才抢。
         *
         * 抢会话（setAudioModeAsync）是异步的，原先在 resolve 之前就发出去了。
         * 串着念的时候，resolve 会让 readAloudFrom 那个 await 立刻接着跑下一句，
         * 于是新的 utterance 刚起头，上一句遗留的会话重配才落地，正好把它掐死——
         * 而且掐掉之后一个回调都不来，那串 await 就永远等在那儿。
         * 表现就是「只念当前句，不往下走」，且只在手机上出现：
         * 网页端 reclaimAudioSession 是空操作，压根没有这一跳。
         *
         * 放进 setTimeout 之后，下一句的 speak 会先跑（Promise 续体是微任务，
         * 排在宏任务前面），tokenRef 随之递增，这里就认得出「后面还有」而跳过。
         * 真的念完收工时没人递增 token，会话照旧抢得回来。
         */
        if (!latest) return;
        setTimeout(() => {
          if (tokenRef.current === token) reclaimAudioSession();
        }, 0);
      };

      /**
       * 回调丢了也得能收场。iOS 上 utterance 被外部打断时偶尔什么回调都不发，
       * 而连续朗读整个卡在这一句上，除了按停止没有别的出路。
       * 所以给一个宽到不可能误伤的时限：还在念就接着等，真不念了才结算。
       */
      const budget = Math.max(5000, value.length * 250);
      const arm = () => {
        watchdog = setTimeout(async () => {
          // 已经被后来的请求顶掉了，那 isSpeaking 问的是别人，别拿它续命
          if (tokenRef.current !== token) {
            release();
            return;
          }
          try {
            if (await Speech.isSpeakingAsync()) {
              arm();
              return;
            }
          } catch {
            // 问不出来就按没在念处理，总好过一直挂着
          }
          release();
        }, budget);
      };
      arm();

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
