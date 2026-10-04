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
  onJob?: (job: DownloadJob) => void,
): Promise<string> {
  await ensureModelsDir();
  const dest = localPathFor(entry);

  let lastErr: Error = new Error('下载失败');
  for (const url of resolveUrls(entry)) {
    try {
      const job = RNFS.downloadFile({
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
      });
      onJob?.({ jobId: job.jobId });
      const result = await job.promise;

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

// ── Hugging Face 全站搜索（镜像 API）────────────────────────
export type HfHit = {
  id: string;
  downloads: number;
  /** 仓库里探测到的 gguf 文件名（取前几个） */
  ggufFiles: string[];
};

const HF_API = 'https://hf-mirror.com/api';

export async function searchHfGguf(query: string, limit = 8): Promise<HfHit[]> {
  const q = encodeURIComponent(`${query} gguf`.trim());
  const resp = await fetch(`${HF_API}/models?search=${q}&limit=${limit}&sort=downloads&direction=-1`);
  if (!resp.ok) {
    throw new Error(`HF 搜索失败 HTTP ${resp.status}`);
  }
  const arr = (await resp.json()) as Array<{
    modelId?: string;
    id?: string;
    downloads?: number;
    siblings?: Array<{ rfilename?: string }>;
  }>;
  const hits: HfHit[] = [];
  for (const m of arr) {
    const id = m.id ?? m.modelId ?? '';
    if (!id) {
      continue;
    }
    // 有 siblings 就挑 gguf；没有则再拉详情
    let files = (m.siblings ?? [])
      .map(s => s.rfilename ?? '')
      .filter(f => f.toLowerCase().endsWith('.gguf'))
      .slice(0, 4);
    if (files.length === 0) {
      try {
        const d = await fetch(`${HF_API}/models/${id}`);
        if (d.ok) {
          const detail = (await d.json()) as { siblings?: Array<{ rfilename?: string }> };
          files = (detail.siblings ?? [])
            .map(s => s.rfilename ?? '')
            .filter(f => f.toLowerCase().endsWith('.gguf'))
            .slice(0, 4);
        }
      } catch {
        /* 忽略详情失败 */
      }
    }
    hits.push({ id, downloads: m.downloads ?? 0, ggufFiles: files });
  }
  return hits.filter(h => h.ggufFiles.length > 0);
}

export function hfFileUrl(repo: string, file: string): string {
  return `https://hf-mirror.com/${repo}/resolve/main/${file}`;
}

/** 带超时的 fetch（网络工具卡住时不能让整个流程悬着） */
async function fetchWithTimeout(url: string, ms = 20000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type RepoFile = { path: string; size: number; shard: boolean };

/** 列出仓库里的 gguf（含体积）：镜像优先、官方兜底 */
export async function listRepoGguf(repo: string): Promise<RepoFile[]> {
  let lastErr = '仓库不可达';
  for (const host of HF_HOSTS) {
    try {
      const r = await fetchWithTimeout(`${host}/api/models/${repo}/tree/main`);
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        continue;
      }
      const arr = (await r.json()) as Array<{ type?: string; path?: string; size?: number }>;
      if (!Array.isArray(arr)) {
        lastErr = '返回格式异常（可能是受限仓库）';
        continue;
      }
      return arr
        .filter(x => x.type === 'file' && /\.gguf$/i.test(x.path ?? ''))
        .map(x => ({
          path: x.path ?? '',
          size: x.size ?? 0,
          shard: /-\d{5}-of-\d{5}\.gguf$/i.test(x.path ?? ''),
        }))
        .sort((a, b) => a.size - b.size);
    } catch (e) {
      lastErr = String(e);
    }
  }
  throw new Error(`拿不到文件列表：${lastErr}`);
}

/** 下载前先看有没有空间（省得下到一半失败留下半截文件） */
export async function assertSpace(bytes: number): Promise<void> {
  if (!bytes || bytes <= 0) {
    return;
  }
  try {
    const info = await RNFS.getFSInfo();
    const need = bytes * 1.08;
    if (info.freeSpace < need) {
      throw new Error(
        `存储空间不足：需要 ${(need / 1e9).toFixed(2)}GB，剩余 ${(info.freeSpace / 1e9).toFixed(2)}GB`,
      );
    }
  } catch (e) {
    if (String(e).includes('存储空间不足')) {
      throw e;
    }
    // 拿不到磁盘信息就放行，别把下载挡死
  }
}

/** 跨仓库也不撞名的落盘文件名 */
export function filenameFor(repo: string, file: string): string {
  const base = file.split('/').pop() ?? 'model.gguf';
  const owner = repo.split('/')[0]?.replace(/[^\w.-]/g, '') ?? 'hf';
  return `${owner}-${base}`;
}

/** 搜索下载的落盘路径（下载与「取消清理」用同一份计算，避免两边算错） */
export function localPathForRepo(repo: string, file: string): string {
  return `${MODELS_DIR}/${filenameFor(repo, file)}`;
}

export type DownloadJob = { jobId: number };

/** 下载任意 repo 的指定 gguf 文件（镜像优先 + 官方兜底，可取消） */
export async function downloadGguf(
  repo: string,
  file: string,
  onProgress?: DownloadProgress,
  onJob?: (job: DownloadJob) => void,
): Promise<string> {
  await ensureModelsDir();
  const dest = localPathForRepo(repo, file);
  let lastErr: Error = new Error('下载失败');
  for (const host of HF_HOSTS) {
    try {
      const job = RNFS.downloadFile({
        fromUrl: `${host}/${repo}/resolve/main/${file}`,
        toFile: dest,
        progressDivider: 2,
        progress: res => {
          if (onProgress && res.contentLength > 0) {
            onProgress(res.bytesWritten / res.contentLength, res.bytesWritten, res.contentLength);
          }
        },
      });
      onJob?.({ jobId: job.jobId });
      const result = await job.promise;
      if (result.statusCode === 200 || result.statusCode === 0) {
        const stat = await RNFS.stat(dest);
        if (stat.size > 1024 * 1024) {
          return dest;
        }
        throw new Error('文件过小，疑似下载不完整');
      }
      lastErr = new Error(`HTTP ${result.statusCode} @ ${host}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await RNFS.unlink(dest).catch(() => undefined);
    }
  }
  throw lastErr;
}
