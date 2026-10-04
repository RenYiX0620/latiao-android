import DocumentPicker, { isCancel } from 'react-native-document-picker';
import {
  openDocument as scopedOpenDocument,
  openDocumentTree as scopedOpenDocumentTree,
} from 'react-native-scoped-storage';
import RNFS from 'react-native-fs';

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

/**
 * 能不能当文件路径用。
 * Android 的文件选择器经常只给 content:// 链接（Download 目录尤其如此，其 document id
 * 形如 `msf%3A1000152862`）——那不是文件系统路径，登记它等于登记一个打不开的路径：
 * 加载时只会得到一句 Unknown error（旧版）或"找不到这个模型文件"（新版预检）。
 */
export function isUsableFilePath(p: string): boolean {
  if (!p || !p.startsWith('/')) {
    return false;
  }
  if (/^\/content:/i.test(p)) {
    return false;
  }
  if (/%3A|%2F/i.test(p)) {
    return false;
  }
  return true;
}

/** 放宽：文件名含 gguf 即可；无后缀的大文件也收（用户自选文件时） */
function looksLikeModel(name: string): boolean {
  return /\.gguf$/i.test(name) || /gguf/i.test(name);
}

/** 主路径：scoped-storage 单文件选择（返回真实 path，零拷贝） */
export async function importGgufFiles(): Promise<ImportResult> {
  try {
    const f = await scopedOpenDocument(false, 'utf8');
    if (!f) {
      return { imported: [], skipped: [] };
    }
    const name = f.name || (f.path || f.uri || '').split('/').pop() || 'model.gguf';
    const raw = (f.path && f.path !== 'undefined' ? f.path : f.uri) || '';
    const path = toRealPath(raw);
    if (isUsableFilePath(path)) {
      await registerModel(name, path);
      return { imported: [path], skipped: [] };
    }
    // 系统只给了链接 → 退回"复制进沙箱"这条路，别登记打不开的路径
    return await importByCopy(
      '系统只给了文件链接（content://），已改为复制一份到 App 沙箱',
    );
  } catch (e) {
    if (isCancel(e)) {
      return { imported: [], skipped: [] };
    }
    return await importByCopy(
      '这个选择器拿不到真实路径，已改为复制一份到 App 沙箱',
    );
  }
}

/** 兜底导入：让 document-picker 复制进沙箱，换一个真路径 */
async function importByCopy(hint: string): Promise<ImportResult> {
  const pathHint =
    '也可以点「授权文件访问」开启所有文件权限后，用「按路径导入」填 /sdcard/Download/models/xxx.gguf（大模型推荐这条，不占双份空间）';
  try {
    const res = await DocumentPicker.pickSingle({
      allowMultiSelection: false,
      copyTo: 'documentDirectory',
      type: ['*/*', 'application/octet-stream'],
    });
    const name = res.name ?? 'model.gguf';
    const uri = res.fileCopyUri ?? res.uri ?? '';
    const path = uri.startsWith('file://') ? uri.slice(7) : uri;
    if (!isUsableFilePath(path)) {
      return { imported: [], skipped: [], error: `${hint}，但复制后仍拿不到真路径。${pathHint}` };
    }
    await registerModel(name, path);
    return { imported: [path], skipped: [], error: `${hint}：${name}` };
  } catch (e) {
    if (isCancel(e)) {
      return { imported: [], skipped: [] };
    }
    return {
      imported: [],
      skipped: [],
      error: `${hint}也没成功（${String(e).slice(0, 80)}）。${pathHint}`,
    };
  }
}

/** content:// tree URI → 真路径（primary:Download/models → /storage/emulated/0/Download/models） */
export function treeUriToPath(uri: string): string {
  try {
    const u = decodeURIComponent(uri);
    // 兼容 tree/primary:xxx 与 document/primary:xxx
    const m = u.match(/primary:(.+)$/);
    if (m) {
      return `/storage/emulated/0/${m[1].replace(/^\/+/, '')}`;
    }
  } catch {
    /* fallthrough */
  }
  return '';
}

/** openDocument 返回的 content:// 也转真路径 */
export function toRealPath(p: string): string {
  if (!p) return '';
  if (!p.startsWith('content:')) return p.replace('file://', '');
  return treeUriToPath(p) || p;
}

/** 选择文件夹：仅限子文件夹（Download 根目录系统拒绝）。
 *  目录树 URI 解析成 /storage/emulated/0/... 真路径后用 RNFS 读（配合所有文件权限），
 *  不再依赖 scoped-storage listFiles（它要求读写双重 SAF 权限，常拒绝）。
 */
export async function importGgufFromFolder(): Promise<ImportResult> {
  let treeUri = '';
  let hint = '';
  try {
    // openDocumentTree 自己申请持久化权限，返回 uri/path
    const dir = await scopedOpenDocumentTree(true);
    if (!dir?.uri && !dir?.path) {
      return { imported: [], skipped: [] };
    }
    treeUri = dir.uri || dir.path;
    if (dir.path && !dir.path.startsWith('content:')) {
      treeUri = dir.path;
    }
  } catch (e) {
    if (isCancel(e)) {
      return { imported: [], skipped: [] };
    }
    return { imported: [], skipped: [], error: `选择文件夹失败：${String(e).slice(0, 120)}` };
  }

  const realDir =
    treeUri && !treeUri.startsWith('content:') ? treeUri : treeUriToPath(treeUri);
  const imported: string[] = [];
  const skipped: string[] = [];
  if (!realDir) {
    return {
      imported,
      skipped,
      error: '无法解析该文件夹路径。请点「授权文件访问」后用路径导入。',
    };
  }
  try {
    const list = await RNFS.readDir(realDir);
    for (const e of list) {
      if (!e.isFile()) {
        continue;
      }
      const ok = /\.gguf$/i.test(e.name) || /gguf/i.test(e.name);
      if (!ok) {
        skipped.push(e.name);
        continue;
      }
      await registerModel(e.name, e.path);
      imported.push(e.path);
    }
    return {
      imported,
      skipped,
      error: imported.length === 0
        ? `${realDir} 内没有 .gguf（共 ${list.length} 项）。${hint}`
        : undefined,
    };
  } catch (e) {
    return {
      imported,
      skipped,
      error: `读取 ${realDir} 失败：${String(e).slice(0, 100)}。点「授权文件访问」开启所有文件权限后重试。`,
    };
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
