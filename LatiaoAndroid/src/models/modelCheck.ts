import RNFS from 'react-native-fs';
import { isUsableFilePath } from './importLocal';

/**
 * 加载前预检 —— 把 llama.rn 那句没头没尾的「Unknown error」翻译成能行动的结论。
 *
 * 背景：模型文件坏掉/没下完时，llama.rn 的原生层抛的是**非 std 异常**，JS 侧只拿到
 * `Unknown error`（JSI 的 catch(...)），logcat 里也没有对应的 error 行。与其让用户
 * 猜，不如在加载前自己把文件看一遍：在不在、读不读得到、是不是 GGUF、是不是小得离谱。
 *
 * 只读文件头 16 字节（base64），不会把整模型读进内存。
 */

export type ModelCheck =
  | { ok: true; sizeBytes: number }
  | {
      ok: false;
      kind: 'bad-path' | 'missing' | 'unreadable' | 'not-gguf' | 'too-small';
      reason: string;
      nextSteps: string;
    };

const MIN_BYTES = 1024 * 1024;
/** 'GGUF' 的前 4 个 base64 字符（'GGUF' → R0dVRg==） */
const GGUF_B64_PREFIX = 'R0dVR';

export async function checkModelFile(path: string): Promise<ModelCheck> {
  if (!path) {
    return {
      ok: false,
      kind: 'missing',
      reason: '没有选择模型文件',
      nextSteps: '到「模型」页选一个模型',
    };
  }

  // Android 的文件选择器常给 content:// 链接（Download 目录的 document id 形如
  // `msf%3A1000152862`）。那不是文件路径，先在这里拦下来，别让它变成"找不到文件"。
  if (!isUsableFilePath(path)) {
    return {
      ok: false,
      kind: 'bad-path',
      reason: '这个"路径"是系统「文件」给的链接（content://…），不是真实文件路径',
      nextSteps:
        '到「模型」页：点「选择模型文件」重新选一次（会自动复制一份到 App 沙箱）；或先点「授权文件访问」开启所有文件权限，再用「按路径导入」填 /sdcard/Download/models/xxx.gguf',
    };
  }

  let sizeBytes = 0;
  try {
    const stat = await RNFS.stat(path);
    sizeBytes = Number(stat.size) || 0;
  } catch {
    return {
      ok: false,
      kind: 'missing',
      reason: '找不到这个模型文件',
      nextSteps: '文件可能被删/被移走了，到「模型」页重新选一次',
    };
  }

  if (sizeBytes < MIN_BYTES) {
    return {
      ok: false,
      kind: 'too-small',
      reason: `文件只有 ${(sizeBytes / 1024).toFixed(0)} KB，肯定没下载完整`,
      nextSteps: '删掉这个文件重新下载；下载完成前不要杀掉 App 或锁屏',
    };
  }

  // 读文件头：读不到 = 权限或路径问题（比"加载失败"有用得多）
  let head = '';
  try {
    head = await RNFS.read(path, 16, 0, 'base64');
  } catch {
    return {
      ok: false,
      kind: 'unreadable',
      reason: '读不到这个文件（像是权限或路径的问题）',
      nextSteps: '点「授权文件访问」开启所有文件权限，或把模型放到 App 沙箱里再选',
    };
  }

  if (!head || !head.startsWith(GGUF_B64_PREFIX)) {
    return {
      ok: false,
      kind: 'not-gguf',
      reason: '这不是 GGUF 模型文件',
      nextSteps: '常见于：下载到的是网页错误页、或文件被改了扩展名。请重新下载 .gguf',
    };
  }

  return { ok: true, sizeBytes };
}

/** 引擎没给出原因时的排查提示（按发生概率排） */
export function loadFailureHint(): { reason: string; nextSteps: string } {
  return {
    reason: '引擎没给出具体原因（llama.rn 把原生异常吞成了 Unknown error）',
    nextSteps:
      '按概率排查：① 文件没下完 —— 重新下载并核对体积；② 量化格式来自某个分支（非标准 Q4_K_M/Q8_0 之类），官方引擎读不了；③ 内存不够 —— 换更小的模型或调小 n_ctx',
  };
}
