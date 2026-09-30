import DocumentPicker, { isCancel, pickDirectory } from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import { ensureModelsDir, MODELS_DIR } from './download';

/**
 * 从手机导入本地 .gguf（对齐 PocketPal「添加手机里的模型」）。
 * 优先用 document-picker 的 copyTo 落到 App 私有目录，再归位 models/。
 * 失败时给出可操作的提示（大文件/找不到/权限）。
 */

export type ImportResult = {
  imported: string[];
  skipped: string[];
  error?: string;
};

function safeName(name: string): string {
  return (name || `model-${Date.now()}.gguf`).replace(/[\\/]/g, '_');
}

async function importOne(fileUri: string, name: string): Promise<string> {
  await ensureModelsDir();
  const dest = `${MODELS_DIR}/${safeName(name)}`;
  if (await RNFS.exists(dest)) {
    return dest;
  }
  const src = fileUri.startsWith('file://') ? fileUri.slice(7) : fileUri;
  try {
    await RNFS.copyFile(src, dest);
  } catch (e) {
    // content:// 直接 copy 可能失败；再试去掉 scheme
    try {
      await RNFS.copyFile(decodeURIComponent(src), dest);
    } catch (e2) {
      throw new Error(`复制失败（${safeName(name)}）：${String(e2).slice(0, 120)}`);
    }
  }
  const st = await RNFS.stat(dest);
  if (st.size < 1024 * 1024) {
    await RNFS.unlink(dest).catch(() => undefined);
    throw new Error(`${safeName(name)} 过小，疑似复制不完整`);
  }
  return dest;
}

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
    const uri = r.fileCopyUri ?? r.uri;
    if (!uri) {
      skipped.push(name);
      continue;
    }
    try {
      imported.push(await importOne(uri, name));
    } catch (e) {
      error = String(e);
    }
  }
  return { imported, skipped, error };
}

export async function importGgufFromFolder(): Promise<ImportResult> {
  const dir = await pickDirectory();
  if (!dir?.uri) {
    return { imported: [], skipped: [] };
  }
  await ensureModelsDir();
  const imported: string[] = [];
  const skipped: string[] = [];
  try {
    const path = dir.uri.startsWith('file://') ? dir.uri.slice(7) : dir.uri;
    const entries = await RNFS.readDir(decodeURIComponent(path));
    for (const e of entries) {
      if (e.isFile() && /\.gguf$/i.test(e.name)) {
        try {
          imported.push(await importOne(e.path, e.name));
        } catch (err) {
          skipped.push(`${e.name}（${String(err).slice(0, 40)}）`);
        }
      }
    }
    return { imported, skipped };
  } catch {
    return {
      imported,
      skipped,
      error: '无法列出该目录。请改用「导入 .gguf 文件」多选，或点「按路径导入」填绝对路径。',
    };
  }
}

/** 按绝对路径导入（adb push / 本机完整路径） */
export async function importFromPath(path: string): Promise<ImportResult> {
  const p = path.startsWith('file://') ? path.slice(7) : path.trim();
  if (!/\.gguf$/i.test(p)) {
    return { imported: [], skipped: [p], error: '路径需要以 .gguf 结尾' };
  }
  try {
    await ensureModelsDir();
    const dest = await importOne(p, p.split('/').pop() ?? 'model.gguf');
    return { imported: [dest], skipped: [] };
  } catch (e) {
    const msg = String(e);
    if (/EACCES|Permission denied|ENOENT/i.test(msg)) {
      return {
        imported: [],
        skipped: [],
        error: '没有存储权限或路径不存在。优先用「导入 .gguf 文件」（系统选择器）；要按路径导入请点「授权文件访问」。',
      };
    }
    return { imported: [], skipped: [], error: msg };
  }
}

export { isCancel };
