import DocumentPicker, { isCancel } from 'react-native-document-picker';
import ScopedStorage from 'react-native-scoped-storage';
import RNFS from 'react-native-fs';
import { ensureModelsDir, MODELS_DIR } from './download';

/**
 * 本地模型导入（2026-09-30 加固）：
 * - 主路径用 scoped-storage.openDocument()：系统选择器返回**真实路径**，
 *   大文件零拷贝，绕开 document-picker copyTo 复制几 GB 会失败的问题
 * - 不强制 .gguf 后缀：文件名无后缀/大小写异常也收（Spark 这类命名）
 * - 路径导入只登记不复制；错误信息必须能看见
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
      return Array.isArray(arr) ? arr.filter(x => x && x.path) : [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

export async function registerModel(name: string, path: string): Promise<void> {
  const list = await loadExternalModels();
  if (!list.some(x => x.path === path)) {
    list.push({ name: name || path.split('/').pop() || 'model', path });
    await RNFS.writeFile(REGISTRY, JSON.stringify(list), 'utf8');
  }
}

export async function unregisterModel(path: string): Promise<void> {
  const list = (await loadExternalModels()).filter(x => x.path !== path);
  await RNFS.writeFile(REGISTRY, JSON.stringify(list), 'utf8');
}

/** 放宽：文件名含 gguf 即可；无后缀的大文件也收（用户自选文件时） */
function looksLikeModel(name: string): boolean {
  return /\.gguf$/i.test(name) || /gguf/i.test(name);
}

/** 主路径：scoped-storage 单文件选择（返回真实 path，零拷贝） */
export async function importGgufFiles(): Promise<ImportResult> {
  try {
    const f = await ScopedStorage.openDocument(false, 'utf8');
    if (!f) {
      return { imported: [], skipped: [] };
    }
    const name = f.name || (f.path || f.uri || '').split('/').pop() || 'model.gguf';
    const path = f.path && f.path !== 'undefined' && !f.path.startsWith('content:')
      ? f.path
      : f.uri;
    if (!looksLikeModel(name)) {
      // 仍接受：用户自己选的文件（可能是 Spark-xxx 无 .gguf 后缀）
      // 但要在结果里标注
    }
    await registerModel(name, path);
    return { imported: [path], skipped: [] };
  } catch (e) {
    if (isCancel(e)) {
      return { imported: [], skipped: [] };
    }
    // scoped-storage 失败则退回 document-picker（小文件）
    try {
      const res = await DocumentPicker.pickSingle({
        allowMultiSelection: false,
        type: ['*/*', 'application/octet-stream'],
      });
      const name = res.name ?? 'model.gguf';
      const uri = (res.fileCopyUri ?? res.uri ?? '').replace('file://', '');
      if (!uri) {
        return { imported: [], skipped: [], error: '未获得文件路径' };
      }
      await registerModel(name, uri);
      return { imported: [uri], skipped: [] };
    } catch (e2) {
      if (isCancel(e2)) {
        return { imported: [], skipped: [] };
      }
      return {
        imported: [],
        skipped: [],
        error: `选择文件失败：${String(e2 || e).slice(0, 120)}`,
      };
    }
  }
}

/** 选择文件夹：仅限子文件夹（Download 根目录系统拒绝） */
export async function importGgufFromFolder(): Promise<ImportResult> {
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
      if (e.type !== 'file') {
        continue;
      }
      const ok = /\.gguf$/i.test(e.name) || /gguf/i.test(e.name);
      if (!ok) {
        skipped.push(e.name);
        continue;
      }
      const p = e.path && e.path !== 'undefined' ? e.path : e.uri;
      await registerModel(e.name, p);
      imported.push(p);
    }
    return {
      imported,
      skipped,
      error:
        imported.length === 0
          ? `该目录没有 .gguf（共 ${entries.length} 项）。Download 根目录系统不允许，请选子文件夹。`
          : undefined,
    };
  } catch (e) {
    return { imported, skipped, error: `列出文件夹失败：${String(e).slice(0, 120)}` };
  }
}

/** 按绝对路径登记（不复制、不占双份空间） */
export async function importFromPath(path: string): Promise<ImportResult> {
  const p = (path.startsWith('file://') ? path.slice(7) : path.trim()).trim();
  if (!p) {
    return { imported: [], skipped: [], error: '路径为空' };
  }
  try {
    const exists = await RNFS.exists(p);
    if (!exists) {
      return {
        imported: [],
        skipped: [],
        error: '路径不存在。请到「授权文件访问」开启所有文件权限，或改用「导入模型文件」。',
      };
    }
    const name = p.split('/').pop() ?? 'model.gguf';
    await registerModel(name, p);
    return { imported: [p], skipped: [] };
  } catch (e) {
    return {
      imported: [],
      skipped: [],
      error: `读取失败（${String(e).slice(0, 100)}）。点「授权文件访问」后重试。`,
    };
  }
}

export { isCancel };
