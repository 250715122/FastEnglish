import { Platform } from 'react-native';

/**
 * iOS 侧边那个静音拨片，默认会把 AVPlayer 一起哑掉。
 *
 * 对听模式这是致命的：画面本来就藏起来了，声音再没了，用户只会以为音轨没抽出来，
 * 而不会想到去拨机身侧面的开关。看电影属于「用户明确要出声」的场景，
 * 就该像播客和视频 App 一样无视静音键。
 *
 * doNotMix 是让别的应用在我们播的时候让位——精听时后台飘来一段音乐就白听了。
 *
 * shouldPlayInBackground 是给听模式的锁屏播放用的，但光有它不够：
 * Info.plist 里还得有 UIBackgroundModes=audio，那个由 app.json 里
 * expo-video 插件的 supportsBackgroundPlayback 写入，且只在真正出包时生效。
 * Expo Go 用的是它自己的 Info.plist，改不动，所以锁屏听在 Expo Go 里试不出来。
 */
export async function configureAudioSession(): Promise<void> {
  // 浏览器没有音频会话这一说，调了只会白抛一个错
  if (Platform.OS === 'web') return;

  try {
    const { setAudioModeAsync } = await import('expo-audio');
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix'
    });
  } catch {
    // 设不上顶多是静音键仍然生效，不该拦住整个应用启动
  }
}

/**
 * 把音频会话要回来。开机配一次是不够的，会话是全系统共享的，会被别人拿走。
 *
 * 实测过的坑：朗读用的 AVSpeechSynthesizer 念完会把会话释放掉，而我们用的是
 * doNotMix（非混音），释放之后播放器就变成「在播但没声」——服务端日志里分片照拉、
 * 全是 200，手机上一点动静都没有，很容易误判成网络问题。锁屏、来电、切后台同理。
 *
 * 所以在三个地方补调：朗读结束、App 回到前台、真正开始放原声之前。
 * 这个调用很轻，重复调没有副作用，宁可多调也别漏。
 */
export function reclaimAudioSession(): void {
  if (Platform.OS === 'web') return;
  void configureAudioSession();
}
