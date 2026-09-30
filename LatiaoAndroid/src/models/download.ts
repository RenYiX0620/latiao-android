import RNFS from 'react-native-fs';
import { hfDownloadUrl, type ModelEntry } from './catalog';

/**
 * Hugging Face 下载：默认走国内镜像 hf-mirror.com（与官方 resolve 路径同构）。
 * 模拟器/国内网络直连 huggingface.co 常超时（实测 failed to connect ... after 5000ms）。
 */
const HF_HOSTS = ['https://hf-mirror.com', 'https://huggingface.co'];

function resolveUrls(entry: ModelEntry): string[] {
  const path = hfDownloadUrl(entry.repo, entry.file).replace(
    /^https:\/\/huggingface\.co/,
    '',
  );
  return HF_HOSTS.map(h => h + path);
}

/** 模型落盘目录（App 沙箱 Documents/models/） */
export const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;

export type DownloadProgress = (pct: number, written: number, total: number) => void;

export async function ensureModelsDir(): Promise<void> {
  const exists = await RNFS.exists(MODELS_DIR);
  if (!exists) {
    await RNFS.mkdir(MODELS_DIR);
  }
}

export function localPathFor(entry: ModelEntry): string {
  return `${MODELS_DIR}/${entry.file}`;
}

export async function isDownloaded(entry: ModelEntry): Promise<boolean> {
  return RNFS.exists(localPathFor(entry));
}

export async function deleteModel(entry: ModelEntry): Promise<void> {
  const p = localPathFor(entry);
  if (await RNFS.exists(p)) {
    await RNFS.unlink(p);
  }
}

/** 列出已下载模型（含用户手动放入的 .gguf） */
export async function listLocalModels(): Promise<string[]> {
  try {
    await ensureModelsDir();
    const files = await RNFS.readDir(MODELS_DIR);
    return files
      .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.gguf'))
      .map(f => f.path);
  } catch {
    return [];
  }
}

/**
 * 从 Hugging Face 下载 GGUF。
 * 断点续传：RNFS 的 downloadFile 支持 resume（同 content-length）。
 */
export async function downloadModel(
  entry: ModelEntry,
  onProgress?: DownloadProgress,
): Promise<string> {
  await ensureModelsDir();
  const dest = localPathFor(entry);

  let lastErr: Error = new Error('下载失败');
  for (const url of resolveUrls(entry)) {
    try {
      const result = await RNFS.downloadFile({
        fromUrl: url,
        toFile: dest,
        background: false,
        progressDivider: 2,
        progress: res => {
          if (onProgress && res.contentLength > 0) {
            onProgress(
              res.bytesWritten / res.contentLength,
              res.bytesWritten,
              res.contentLength,
            );
          }
        },
      }).promise;

      if (result.statusCode === 200 || result.statusCode === 0) {
        const stat = await RNFS.stat(dest);
        if (stat.size > 1024 * 1024) {
          return dest;
        }
        throw new Error('文件过小，疑似下载不完整');
      }
      lastErr = new Error(`HTTP ${result.statusCode} @ ${url}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await RNFS.unlink(dest).catch(() => undefined);
    }
  }
  throw lastErr;
}
