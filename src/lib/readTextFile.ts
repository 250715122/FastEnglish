import { File as FsFile } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * 字幕文本可能来自三种 uri：http(s) 网址、web 端选择文件得到的 blob:、原生端的 file://。
 * 网页选择文件时 expo-document-picker 会额外给出 DOM File 对象，用它读最省事。
 */
export async function readTextFile(uri: string, webFile?: globalThis.File): Promise<string> {
  if (Platform.OS === 'web' && webFile) {
    return webFile.text();
  }
  if (/^(https?|blob|data):/i.test(uri)) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`读取失败：HTTP ${response.status}`);
    }
    return response.text();
  }
  return new FsFile(uri).text();
}
