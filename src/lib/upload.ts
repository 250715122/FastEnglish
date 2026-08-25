import { Platform } from 'react-native';
import { API_BASE, currentToken } from './api';

/**
 * 上传片源。
 *
 * 后端收的是裸字节流而不是 multipart，两端都得按这个来：
 * 网页端把 DOM File 交给 XMLHttpRequest（fetch 拿不到上传进度，几个 GB 的文件
 * 没有进度条等于卡死）；原生端用 expo-file-system 的 BINARY_CONTENT，
 * 它从磁盘边读边发，不会把整个文件读进内存。
 */
export type UploadHandle = {
  promise: Promise<void>;
  cancel: () => void;
};

function endpoint() {
  return `${API_BASE}/api/movies/upload`;
}

function headers(fileName: string): Record<string, string> {
  const token = currentToken();
  return {
    'Content-Type': 'application/octet-stream',
    // 文件名可能带中文和空格，进请求头必须先编码
    'X-File-Name': encodeURIComponent(fileName),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function uploadWeb(file: Blob, fileName: string, onProgress: (ratio: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('POST', endpoint());
    for (const [key, value] of Object.entries(headers(fileName))) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `上传失败（${xhr.status}）`;
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        /* 后端没返回 JSON 就用默认文案 */
      }
      reject(new Error(message));
    };

    xhr.onerror = () => reject(new Error('上传失败：连不上后端'));
    xhr.onabort = () => reject(new Error('已取消上传'));
    xhr.send(file);
  });

  return { promise, cancel: () => xhr.abort() };
}

function uploadNative(uri: string, fileName: string): UploadHandle {
  const promise = (async () => {
    // 新版 expo-file-system 的 File 只有 bytes()，会把整个文件读进内存；
    // 几 GB 的片子必须走 legacy 这条流式上传
    const legacy = await import('expo-file-system/legacy');
    const result = await legacy.uploadAsync(endpoint(), uri, {
      httpMethod: 'POST',
      uploadType: legacy.FileSystemUploadType.BINARY_CONTENT,
      headers: headers(fileName)
    });

    if (result.status >= 200 && result.status < 300) return;
    let message = `上传失败（${result.status}）`;
    try {
      message = JSON.parse(result.body).error || message;
    } catch {
      /* 同上 */
    }
    throw new Error(message);
  })();

  // 原生端这条路暂时不支持中途取消，取消按钮在原生上不会出现
  return { promise, cancel: () => undefined };
}

export function uploadVideo(
  source: { uri: string; file?: Blob },
  fileName: string,
  onProgress: (ratio: number) => void
): UploadHandle {
  if (Platform.OS === 'web' && source.file) {
    return uploadWeb(source.file, fileName, onProgress);
  }
  return uploadNative(source.uri, fileName);
}
