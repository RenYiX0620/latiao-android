/**
 * 视觉（多模态）单测：
 * - 投影器配对：模型旁边找 mmproj；多个时按名字匹配挑；找不到就返回 null（绝不瞎猜）
 * - 图片判定 / 消息部件构造 / 历史标记
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import RNFS from 'react-native-fs';
import {
  attachmentMarker,
  buildUserContent,
  findProjector,
  isImageFile,
  isProjectorFile,
} from '../src/models/vision';

const FS = (RNFS as unknown as {
  __fs: { seed: (p: string, c: string) => void; clear: () => void };
}).__fs;

beforeEach(() => {
  FS.clear();
  jest.clearAllMocks();
});

describe('findProjector（mmproj 配对）', () => {
  const MODEL = '/models/Qwen2-VL-2B-Instruct-Q4_K_M.gguf';

  it('没有投影器 → null', async () => {
    FS.seed(MODEL, 'x');
    expect(await findProjector(MODEL)).toBeNull();
  });

  it('同目录唯一 mmproj → 直接采用', async () => {
    FS.seed(MODEL, 'x');
    FS.seed('/models/mmproj-Qwen2-VL-2B-Q8_0.gguf', 'x');
    expect(await findProjector(MODEL)).toBe('/models/mmproj-Qwen2-VL-2B-Q8_0.gguf');
  });

  it('多个投影器 → 挑与模型名共享词最多的那个', async () => {
    FS.seed(MODEL, 'x');
    FS.seed('/models/mmproj-Qwen2-VL-2B-Q8_0.gguf', 'x');
    FS.seed('/models/mmproj-SomeOtherModel-f16.gguf', 'x');
    expect(await findProjector(MODEL)).toBe('/models/mmproj-Qwen2-VL-2B-Q8_0.gguf');
  });

  it('非 gguf 的 mmproj 名字不算数', async () => {
    FS.seed(MODEL, 'x');
    FS.seed('/models/mmproj-notes.txt', 'x');
    expect(await findProjector(MODEL)).toBeNull();
  });

  it('目录读不到（模型在别处/权限不足）→ null，不抛', async () => {
    expect(await findProjector('/nope/model.gguf')).toBeNull();
    expect(await findProjector('')).toBeNull();
  });
});

describe('文件判定', () => {
  it('isImageFile', () => {
    expect(isImageFile('a.JPG')).toBe(true);
    expect(isImageFile('a.jpeg')).toBe(true);
    expect(isImageFile('a.png')).toBe(true);
    expect(isImageFile('a.webp')).toBe(true);
    expect(isImageFile('a.gguf')).toBe(false);
    expect(isImageFile('a.txt')).toBe(false);
  });

  it('isProjectorFile', () => {
    expect(isProjectorFile('mmproj-SmolVLM-256M-Q8_0.gguf')).toBe(true);
    expect(isProjectorFile('MMPROJ-x.GGUF')).toBe(true);
    expect(isProjectorFile('mmproj.txt')).toBe(false);
    expect(isProjectorFile('model.gguf')).toBe(false);
  });
});

describe('消息构造', () => {
  it('纯文本：没有附件就是原文；有文本附件则带上内容', () => {
    expect(buildUserContent('你好', null)).toBe('你好');
    expect(buildUserContent('看这个', { name: 'a.txt', content: 'BODY' })).toContain('BODY');
  });

  it('图片附件 → text + image_url 两个部件，路径补 file://', () => {
    const parts = buildUserContent('图里写了什么？', {
      name: 'shot.png',
      imagePath: '/data/user/0/app/files/shot.png',
    });
    expect(Array.isArray(parts)).toBe(true);
    const arr = parts as Array<Record<string, unknown>>;
    expect(arr[0]).toMatchObject({ type: 'text', text: '图里写了什么？' });
    expect(arr[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'file:///data/user/0/app/files/shot.png' },
    });
  });

  it('已经是 file:// 的路径不重复加前缀', () => {
    const arr = buildUserContent('x', {
      name: 's.png',
      imagePath: 'file:///a/s.png',
    }) as Array<{ image_url?: { url: string } }>;
    expect(arr[1].image_url?.url).toBe('file:///a/s.png');
  });

  it('历史标记：图片留文字痕迹，不带图片数据', () => {
    expect(attachmentMarker('看这个', { name: 'a.png', imagePath: '/a/a.png' })).toBe(
      '【图片：a.png】\n看这个',
    );
    expect(attachmentMarker('看这个', null)).toBe('看这个');
  });
});
