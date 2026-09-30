import DocumentPicker, { isCancel } from 'react-native-document-picker';
import ScopedStorage from 'react-native-scoped-storage';
import RNFS from 'react-native-fs';
import { ensureModelsDir, MODELS_DIR } from './download';

/**
 * 本地模型导入 —— 大文件（GB 级）原则：登记原路径，零拷贝加载。
 * - 导入文件：系统选择器 → 记录 fileCopyUri/真实路径
 * - 选择文件夹：scoped-storage 列出目录内 .gguf，登记路径（3.38GB 也不用复制）
 * - 按路径导入：直接登记
 * 登记表存 external_models.json；加载时走 llama.rn 的 model= 路径。
 */

export type ImportResult = {
  imported: string[];
  skipped: string[];
  error?: string;
};

export type ExternalModel = { name: string; path: string };

const REGISTRY = `${RNFS.DocumentDirectoryPath}/external_models.json`;

export async function loadExternalModels(): Promise<ExternalModel[]> {
  try {
    if (await RNFS.exists(REGISTRY)) {
      const raw = await RNFS.readFile(REGISTRY, 'utf8');
      const arr = JSON.parse(raw) as ExternalModel[];
      return Array.isArray(arr) ? arr : [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

export async function registerModel(name: string, path: string): Promise<void> {
  const list = await loadExternalModels();
  if (!list.some(x => x.path === path)) {
    list.push({ name, path });
    await RNFS.writeFile(REGISTRY, JSON.stringify(list), 'utf8');
  }
}

export async function unregisterModel(path: string): Promise<void> {
  const list = (await loadExternalModels()).filter(x => x.path !== path);
  await RNFS.writeFile(REGISTRY, JSON.stringify(list), 'utf8');
}

function safeName(name: string): string {
  return (name || `model-${Date.now()}.gguf`).replace(/[\\/]/g, '_');
}

/** 导入文件（小文件拷进沙箱；大文件直接登记原路径） */
export async function importGgufFiles(): Promise<ImportResult> {
  const res = await DocumentPicker.pick({
    allowMultiSelection: true,
    copyTo: 'documentDirectory',
    type: ['*/*', 'application/octet-stream'],
  });
  const imported: string[] = [];
  const skipped: string[] = [];
  let error: string | undefined;
  for (const r of res) {
    const name = r.name ?? '';
    if (!/\.gguf$/i.test(name)) {
      skipped.push(name || '(未命名)');
      continue;
    }
    const copied = r.fileCopyUri ?? r.uri;
    if (!copied) {
      skipped.push(name);
      continue;
    }
    // 1GB 以下拷进沙箱；以上登记 copyTo 的副本路径（系统已拷到 App 私有目录）
    const src = copied.startsWith('file://') ? copied.slice(7) : copied;
    try {
      const st = await RNFS.stat(src);
      await registerModel(name, src);
      imported.push(src);
      if (st.size > 1024 * 1024 * 1024) {
        // 大文件：不二次拷到 models/，直接用 documentPicker 的副本
      }
    } catch (e) {
      error = String(e).slice(0, 140);
    }
  }
  return { imported, skipped, error };
}

/** 选择文件夹：列目录中的 .gguf，全部登记路径（零拷贝） */
export async function importGgufFromFolder(): Promise<ImportResult> {
  // 用 document-picker 选目录（系统 UI 稳定），再用 scoped-storage 列文件
  let treeUri: string;
  try {
    const dir = await DocumentPicker.pickDirectory();
    if (!dir?.uri) {
      return { imported: [], skipped: [] };
    }
    treeUri = dir.uri;
  } catch (e) {
    if (isCancel(e)) {
      return { imported: [], skipped: [] };
    }
    return { imported: [], skipped: [], error: String(e) };
  }
  const imported: string[] = [];
  const skipped: string[] = [];
  try {
    const entries = await ScopedStorage.listFiles(treeUri);
    for (const e of entries) {
      if (e.type !== 'file' || !/\.gguf$/i.test(e.name)) {
        continue;
      }
      // path 为解析出的存储路径；无则退回 uri
      const p = e.path && e.path !== 'undefined' ? e.path : e.uri;
      await registerModel(e.name, p);
      imported.push(p);
    }
    if (imported.length === 0) {
      return {
        imported,
        skipped,
        error: `该文件夹内没有 .gguf（共 ${entries.length} 项）。可展开子目录或改用「导入 .gguf 文件」。`,
      };
    }
    return { imported, skipped };
  } catch (e) {
    return { imported, skipped, error: `列出文件夹失败：${String(e).slice(0, 120)}` };
  }
}

/** 按绝对路径登记（不复制） */
export async function importFromPath(path: string): Promise<ImportResult> {
  const p = (path.startsWith('file://') ? path.slice(7) : path.trim()).trim();
  if (!/\.gguf$/i.test(p)) {
    return { imported: [], skipped: [p], error: '路径需要以 .gguf 结尾' };
  }
  try {
    if (!(await RNFS.exists(p))) {
      return {
        imported: [],
        skipped: [],
        error: '路径不存在或无权限。点「授权文件访问」后重试，或用「导入 .gguf 文件」。',
      };
    }
    const name = p.split('/').pop() ?? 'model.gguf';
    await registerModel(name, p);
    return { imported: [p], skipped: [] };
  } catch (e) {
    return { imported: [], skipped: [], error: String(e).slice(0, 140) };
  }
}

export { isCancel };
