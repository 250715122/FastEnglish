import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * 字幕的搜索转发和文件存取都由 Expo 开发服务器上的中间件提供，
 * 网页端同源直接用相对路径，原生端要显式指向开发机。
 */
export function devServerUrl(path: string): string {
  if (Platform.OS === 'web') return path;
  // hostUri 形如 192.168.1.5:8081
  const hostUri = Constants.expoConfig?.hostUri;
  return hostUri ? `http://${hostUri}${path}` : path;
}
