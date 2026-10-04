/**
 * 加载前预检 + 下载完整性：
 * 这两条是为了消灭「模型加载失败：Error: Unknown error」那种没头没尾的报错
 * （llama.rn 把原生异常吞成 Unknown error，logcat 里也没有 error 行）。
 */
import { describe, expect, it, jest } from '@jest/globals';
import RNFS from 'react-native-fs';
import { checkModelFile, loadFailureHint } from '../src/models/modelCheck';
import { downloadModel } from '../src/models/download';

const FS = (RNFS as unknown as {
  __fs: {
    seed: (p: string, c: string) => void;
    clear: () => void;
    has: (p: string) => boolean;
    setDownloadPlan: (p: unknown) => void;
  };
}).__fs;

const GGUF = (bytes: number) => `GGUF${'m'.repeat(Math.max(0, bytes - 4))}`;
const BIG = 2 * 1024 * 1024;

describe('checkModelFile（加载前预检）', () => {
  it('正常 GGUF → 通过，并带出体积', async () => {
    FS.clear();
    FS.seed('/m/good.gguf', GGUF(BIG));
    const r = await checkModelFile('/m/good.gguf');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sizeBytes).toBe(BIG);
    }
  });

  it('文件不存在 → 说得清是"找不到文件"', async () => {
    FS.clear();
    const r = await checkModelFile('/m/gone.gguf');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('missing');
      expect(r.nextSteps.length).toBeGreaterThan(5);
    }
  });

  it('太小（没下完的典型） → 报体积并让重下', async () => {
    FS.clear();
    FS.seed('/m/tiny.gguf', GGUF(200 * 1024));
    const r = await checkModelFile('/m/tiny.gguf');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('too-small');
      expect(r.reason).toContain('KB');
    }
  });

  it('不是 GGUF（网页错误页/改扩展名） → 明确说不是 GGUF', async () => {
    FS.clear();
    FS.seed('/m/html.gguf', `<html>404 not found</html>${'x'.repeat(BIG)}`);
    const r = await checkModelFile('/m/html.gguf');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('not-gguf');
    }
  });

  it('读不到（权限/路径） → 指向授权', async () => {
    FS.clear();
    FS.seed('/m/locked.gguf', GGUF(BIG));
    const spy = jest
      .spyOn(RNFS as unknown as { read: () => Promise<string> }, 'read')
      .mockRejectedValueOnce(new Error('EACCES'));
    const r = await checkModelFile('/m/locked.gguf');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('unreadable');
      expect(r.nextSteps).toContain('授权');
    }
    spy.mockRestore();
  });

  it('空路径 → 提示去选模型', async () => {
    const r = await checkModelFile('');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('missing');
    }
  });

  it('失败提示覆盖三种常见原因', () => {
    const h = loadFailureHint();
    expect(h.nextSteps).toContain('重新下载');
    expect(h.nextSteps).toContain('量化');
    expect(h.nextSteps).toContain('内存');
  });
});

describe('下载完整性（截断不再当成功）', () => {
  it('服务器给了长度、本地对不上 → 报"下载不完整"并删掉半截文件', async () => {
    FS.clear();
    FS.setDownloadPlan({ statusCode: 200, bodyBytes: 1_500_000, contentLength: 5_000_000 });
    const entry = {
      id: 'x',
      name: 'x',
      repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
      file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
      approxSize: '≈400 MB',
    };
    await expect(downloadModel(entry)).rejects.toThrow(/下载不完整/);
    // 半截文件必须被删掉，不能留着让用户以为下好了
    const dest = `${RNFS.DocumentDirectoryPath}/models/qwen2.5-0.5b-instruct-q4_k_m.gguf`;
    expect(FS.has(dest)).toBe(false);
  });

  it('length 对得上 → 正常返回路径', async () => {
    FS.clear();
    FS.setDownloadPlan({ statusCode: 200, bodyBytes: 2_000_000, contentLength: 2_000_000 });
    const entry = {
      id: 'y',
      name: 'y',
      repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
      file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
      approxSize: '≈400 MB',
    };
    const path = await downloadModel(entry);
    expect(path).toContain('qwen2.5-0.5b-instruct-q4_k_m.gguf');
  });
});
