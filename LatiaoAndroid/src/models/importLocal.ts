import DocumentPicker, { isCancel, pickDirectory } from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import { ensureModelsDir, MODELS_DIR } from './download';

/**
 * 从手机导入本地 .gguf —— 对齐 PocketPal「右下角添加，加载手机里的模型」。
 * - 导入文件：系统文件选择器（可多选），拷贝进 App 沙箱 models/
 * - 选择文件夹：选目录后尽量枚举其中的 .gguf；SAF 列不出时提示改用「导入文件」
 */

async function importOne(fileUri: string, name: string): Promise<string> {
  await ensureModelsDir();
  const dest = `${MODELS_DIR}/${name}`;
  // document-picker copyTo 后是 file://；直接 pick 的可能是 content://
  const src = fileUri.startsWith('file://') ? fileUri.slice(7) : fileUri;
  if (await RNFS.exists(dest)) {
    return dest; // 已存在，跳过
  }
  await RNFS.copyFile(src, dest);
  return dest;
}

export async function importGgufFiles(): Promise<string[]> {
  const res = await DocumentPicker.pick({
    allowMultiSelection: true,
    copyTo: 'documentDirectory',
    type: [DocumentPicker.types.allFiles],
  });
  const picked: string[] = [];
  for (const r of res) {
    const name = (r.name ?? '').toLowerCase();
    if (!name.endsWith('.gguf')) {
      continue;
    }
    const uri = r.fileCopyUri ?? r.uri;
    if (!uri) {
      continue;
    }
    picked.push(await importOne(uri, r.name ?? `model-${Date.now()}.gguf`));
  }
  return picked;
}

export async function importGgufFromFolder(): Promise<string[]> {
  const dir = await pickDirectory();
  if (!dir?.uri) {
    return [];
  }
  await ensureModelsDir();
  const out: string[] = [];
  try {
    // file:// 或部分 SAF 映射可直接列；content:// 多数 ROM 列不出
    const path = dir.uri.startsWith('file://') ? dir.uri.slice(7) : dir.uri;
    const entries = await RNFS.readDir(path);
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) {
        out.push(await importOne(e.path, e.name));
      }
    }
    return out;
  } catch {
    throw new Error('无法列出该目录（系统权限限制）。请改用「导入 .gguf 文件」多选。');
  }
}

export { isCancel };
