import RNFS from 'react-native-fs';

/**
 * 视觉（多模态）支持 —— 先解决「投影器（mmproj）配对」这步：
 * - 模型与投影器必须在同一个目录，按 llama.cpp 的惯例命名 `mmproj-*.gguf`
 * - 同目录有多个时，优先挑与模型名共享词（通常量子档位）的那个，再退化为名字最短的
 * 没配对成功就不开视觉，绝不瞎猜一个投影器去加载。
 */

export function isProjectorFile(name: string): boolean {
  return /mmproj/i.test(name) && /\.gguf$/i.test(name);
}

export function isImageFile(name: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(name);
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t && t !== 'mmproj' && t !== 'gguf');
}

/** 与模型名共享的词数（越大越匹配） */
function matchScore(modelName: string, projectorName: string): number {
  const modelTokens = new Set(tokens(modelName));
  return tokens(projectorName).filter(t => modelTokens.has(t)).length;
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '/';
}

/** 在模型旁边找投影器；找不到/有歧义且无法判定时返回 null */
export async function findProjector(modelPath: string): Promise<string | null> {
  if (!modelPath) {
    return null;
  }
  try {
    const entries = await RNFS.readDir(dirOf(modelPath));
    const candidates = entries
      .filter(e => e.isFile() && isProjectorFile(e.name))
      .map(e => e.path);
    if (candidates.length === 0) {
      return null;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    const modelName = modelPath.split('/').pop() ?? '';
    return [...candidates].sort((a, b) => {
      const sa = matchScore(modelName, a.split('/').pop() ?? '');
      const sb = matchScore(modelName, b.split('/').pop() ?? '');
      if (sa !== sb) {
        return sb - sa;
      }
      return (a.split('/').pop() ?? '').length - (b.split('/').pop() ?? '').length;
    })[0];
  } catch {
    return null;
  }
}

export type Attachment = {
  name: string;
  /** 文本附件的内容 */
  content?: string;
  /** 图片附件的本地路径（视觉模型才会用） */
  imagePath?: string;
};

export type MsgPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** 构造这一轮要发给模型的内容：图片附件 → 多模态部件 */
export function buildUserContent(text: string, attachment: Attachment | null): string | MsgPart[] {
  if (!attachment?.imagePath) {
    return attachment?.content
      ? `【附件 ${attachment.name}】\n${attachment.content}\n\n【用户问题】${text}`
      : text;
  }
  const parts: MsgPart[] = [{ type: 'text', text }];
  const url = attachment.imagePath.startsWith('file://')
    ? attachment.imagePath
    : `file://${attachment.imagePath}`;
  parts.push({ type: 'image_url', image_url: { url } });
  return parts;
}

/** 会话里给这条消息留的痕迹（图片本身不进历史，避免会话文件膨胀） */
export function attachmentMarker(text: string, attachment: Attachment | null): string {
  if (!attachment) {
    return text;
  }
  if (attachment.imagePath) {
    return `【图片：${attachment.name}】\n${text}`;
  }
  return `【附件 ${attachment.name}】\n${text}`;
}
