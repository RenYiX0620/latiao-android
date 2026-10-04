/**
 * i18n 的三道闸：
 * 1) zh / en 的 key 必须逐一对齐（漏翻会被立刻抓住）
 * 2) 插值与缺 key 的行为
 * 3) 界面文件里不许再出现硬编码中文（白名单只有两处有意保留的）
 *    —— 这条是"迁移是否真的完成"的机器判据，不靠人眼扫
 */
import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { makeT, zh, en } from '../src/i18n';

const ROOT = join(__dirname, '..');

describe('词典', () => {
  it('zh 与 en 的 key 完全一致', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    const missingInEn = zhKeys.filter(k => !enKeys.includes(k));
    const extraInEn = enKeys.filter(k => !(zhKeys as string[]).includes(k));
    expect({ missingInEn, extraInEn }).toEqual({ missingInEn: [], extraInEn: [] });
  });

  it('没有空文案', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(`${k}:${v}`.trim().length).toBeGreaterThan(k.length + 1);
    }
  });
});

describe('取值', () => {
  it('插值替换 {name}', () => {
    const t = makeT('zh');
    expect(t('chat.confirmTitle', { tool: 'write_note' })).toContain('write_note');
  });

  it('缺参数时保留占位，不输出 undefined', () => {
    const t = makeT('zh');
    expect(t('chat.stats.cached')).toContain('{n}');
    expect(t('chat.stats.cached')).not.toContain('undefined');
  });

  it('未知 key 原样返回并告警', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = makeT('en');
    // @ts-expect-error 故意传未定义的 key
    expect(t('no.such.key')).toBe('no.such.key');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('英文词典能取到同样的 key', () => {
    const t = makeT('en');
    expect(t('nav.chat')).toBe('Chat');
  });
});

describe('界面文件里没有硬编码中文（迁移完成度）', () => {
  const FILES = [
    'App.tsx',
    'src/screens/ChatScreen.tsx',
    'src/screens/ModelScreen.tsx',
    'src/screens/SettingsScreen.tsx',
    'src/screens/SideDrawer.tsx',
    'src/screens/Onboarding.tsx',
    'src/components/ThinkingBlock.tsx',
    'src/components/ErrorBoundary.tsx',
  ];
  /** 有意保留：会话占位标题（要和历史里存下的值比较）、语言名（各语言用本语言显示） */
  const ALLOW = new Set(['新对话', '中文']);

  it('字符串字面量与 JSX 文本里只剩白名单中文', () => {
    const leaks: string[] = [];
    for (const f of FILES) {
      let src = readFileSync(join(ROOT, f), 'utf8');
      src = src.replace(/\/\*[\s\S]*?\*\//g, ''); // 去块注释
      src = src.replace(/^[ \t]*\/\/.*$/gm, ''); // 去行注释
      const cjk = /[\u4e00-\u9fff]/;
      for (const m of src.matchAll(/'([^'\\\n]*)'|`([^`]*)`/g)) {
        const lit = m[1] ?? m[2] ?? '';
        if (cjk.test(lit) && !ALLOW.has(lit)) {
          leaks.push(`${f}: ${lit.slice(0, 40)}`);
        }
      }
      for (const m of src.matchAll(/>\s*([^<>{}]*[\u4e00-\u9fff][^<>{}]*?)\s*</g)) {
        const text = m[1].trim();
        if (!ALLOW.has(text)) {
          leaks.push(`${f} (JSX): ${text.slice(0, 40)}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
