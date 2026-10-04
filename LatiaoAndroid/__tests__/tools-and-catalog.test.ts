/**
 * 工具与模型目录的单测：
 * - calculate：自写算式求值（不能有 eval 注入面，也不该被奇怪的算式搞崩）
 * - 内置目录：不再出现已知 404 / gated 的条目；首选是会调工具的模型
 * - 文件名：跨仓库不撞名
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import RNFS from 'react-native-fs';
import { evaluateExpression } from '../src/agent/tools';
import { assertSpace, filenameFor } from '../src/models/download';
import { MODEL_CATALOG } from '../src/models/catalog';

describe('calculate', () => {
  it('四则运算与优先级', () => {
    expect(evaluateExpression('(12+5)*3/7')).toBeCloseTo(7.2857, 3);
    expect(evaluateExpression('2+3*4')).toBe(14);
    expect(evaluateExpression('-5+2')).toBe(-3);
    expect(evaluateExpression('10%3')).toBe(1);
    expect(evaluateExpression('2^10')).toBe(1024);
  });

  it('函数与多参数', () => {
    expect(evaluateExpression('sqrt(2)*10')).toBeCloseTo(14.142, 3);
    expect(evaluateExpression('max(3, 7, 5)')).toBe(7);
    expect(evaluateExpression('round(3.6)')).toBe(4);
  });

  it('中文逗号也能用（模型常写错）', () => {
    expect(evaluateExpression('min(3，8)')).toBe(3);
  });

  it('坏输入要报错而不是崩/执行代码', () => {
    expect(() => evaluateExpression('1+')).toThrow();
    expect(() => evaluateExpression('process.exit(1)')).toThrow();
    expect(() => evaluateExpression('1/0')).toThrow();
    expect(() => evaluateExpression('(1+2')).toThrow();
  });
});

describe('内置模型目录', () => {
  it('没有已知失效的条目（Gemma 全系 gated，仓库已撤下）', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.repo.toLowerCase()).not.toContain('gemma');
      expect(m.file.toLowerCase().endsWith('.gguf')).toBe(true);
    }
  });

  it('首选是会调工具的模型（Agent 卖点要成立）', () => {
    expect(MODEL_CATALOG[0].toolCapable).toBe(true);
  });

  it('id 唯一', () => {
    const ids = MODEL_CATALOG.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('filenameFor', () => {
  it('跨仓库同名文件不互相覆盖', () => {
    const a = filenameFor('unsloth/Qwen3-0.6B-GGUF', 'model-q4_k_m.gguf');
    const b = filenameFor('bartowski/Qwen3-0.6B-GGUF', 'model-q4_k_m.gguf');
    expect(a).not.toBe(b);
    expect(a).toContain('model-q4_k_m.gguf');
  });
});

describe('assertSpace（下载前存储预检）', () => {
  const FS = (RNFS as unknown as { __fs: { setFreeSpace: (n: number) => void } }).__fs;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('空间不够时给出带数字的明确错误', async () => {
    FS.setFreeSpace(300 * 1e6);
    await expect(assertSpace(400 * 1e6)).rejects.toThrow(/存储空间不足/);
  });

  it('空间充足时放行', async () => {
    FS.setFreeSpace(8 * 1e9);
    await expect(assertSpace(400 * 1e6)).resolves.toBeUndefined();
  });

  it('体积未知时不挡（拿不到大小就别拦下载）', async () => {
    FS.setFreeSpace(1);
    await expect(assertSpace(0)).resolves.toBeUndefined();
  });
});
