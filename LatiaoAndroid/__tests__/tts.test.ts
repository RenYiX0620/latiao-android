/**
 * 朗读层单测：
 * - 切句与文本清洗（引擎对超长文本会哑火，必须切）
 * - 语言映射
 * - 降级契约：没有引擎 / 没有对应语言语音时给出 reason + nextSteps，而不是静默失败
 * - 停止
 * 引擎用 __mocks__/react-native-tts.js 的假实现（可注入错误与语音列表）。
 */
import { describe, expect, it, jest } from '@jest/globals';

type Tts = typeof import('../src/tts');

/**
 * 每个用例都重置模块：既清掉封装层里的「已就绪」缓存，也拿到**当前**的假引擎实例
 * （resetModules 会重新求值 mock，旧引用会失效）。
 */
function load(): { tts: Tts; m: any } {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tts = require('../src/tts') as Tts;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = (require('react-native-tts') as { __mock: any }).__mock;
  return { tts, m };
}

/** 让封装层里的异步链（探测 → 入队）跑完 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('文本准备与切句', () => {
  it('空文本不产生片段', () => {
    const { tts: { chunkForSpeech } } = load();
    expect(chunkForSpeech('')).toEqual([]);
    expect(chunkForSpeech('   \n  ')).toEqual([]);
  });

  it('短句合成一段', () => {
    const { tts: { chunkForSpeech } } = load();
    expect(chunkForSpeech('你好。')).toEqual(['你好。']);
  });

  it('按句边界打包，且每段不超过上限', () => {
    const { tts: { chunkForSpeech } } = load();
    const text = Array.from({ length: 20 }, (_, i) => `第${i}句，这是一段用于测试的文本。`).join('');
    const chunks = chunkForSpeech(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(60);
    }
    expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('超长单句被硬切', () => {
    const { tts: { chunkForSpeech } } = load();
    const one = 'a'.repeat(700);
    const chunks = chunkForSpeech(one, 280);
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(one);
  });

  it('图片/附件标记不被念出来', () => {
    const { tts: { chunkForSpeech, prepareText } } = load();
    expect(prepareText('【图片：a.png】\n看图说话')).toBe('看图说话');
    expect(chunkForSpeech('【附件 x.txt】\n正文')).toEqual(['正文']);
  });
});

describe('语言映射', () => {
  it('界面语言 → 语音语言', () => {
    const { tts: { speechLangFor } } = load();
    expect(speechLangFor('zh')).toBe('zh-CN');
    expect(speechLangFor('en')).toBe('en-US');
  });
});

describe('可用性探测（降级契约）', () => {
  it('有对应语音 → available，并带上引擎/语音名', async () => {
    const { tts: { ensureTts } } = load();
    const st = await ensureTts('zh-CN');
    expect(st.available).toBe(true);
    if (st.available) {
      expect(st.engine).toContain('中文测试音');
    }
  });

  it('没有引擎 → 不可用，且给出可执行步骤', async () => {
    const { tts: { ensureTts }, m } = load();
    m.failInit({ code: 'no_engine' });
    const st = await ensureTts('zh-CN');
    expect(st.available).toBe(false);
    if (!st.available) {
      expect(st.reason).toContain('语音引擎');
      expect(st.nextSteps.length).toBeGreaterThan(5);
    }
  });

  it('没有该语言的语音 → 明确说明缺什么', async () => {
    const { tts: { ensureTts }, m } = load();
    m.setVoices([{ id: 'en', name: 'English', language: 'en-US' }]);
    const st = await ensureTts('zh-CN');
    expect(st.available).toBe(false);
    if (!st.available) {
      expect(st.reason).toContain('zh-CN');
    }
  });
});

describe('朗读与停止', () => {
  it('短句合并成一次朗读（利于语气连贯）', async () => {
    const { tts: { speakText }, m } = load();
    const r = await speakText('第一句。第二句。', { lang: 'zh-CN' });
    await flush();
    expect(r).toEqual({ ok: true, chunks: 1 });
    expect(m.spoken()).toEqual(['第一句。第二句。']);
    m.fire('tts-finish');
  });

  it('长文切成多段依次入队；全部播完才回调一次，状态回落', async () => {
    const { tts: { speakText, isSpeaking }, m } = load();
    const done = jest.fn();
    const long = '第一句。' + '这是一句用于测试的较长文本，需要被切开入队。'.repeat(20);
    const r = await speakText(long, { lang: 'zh-CN', onDone: done });
    await flush();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chunks).toBeGreaterThan(1);
    }
    expect(isSpeaking()).toBe(true);
    expect(m.spoken().length).toBeGreaterThan(1);
    expect(m.spoken().join('').startsWith('第一句。')).toBe(true);
    // 只完成一片不算读完
    m.fire('tts-finish');
    expect(done).not.toHaveBeenCalled();
    // 把剩下的片段都报完成
    for (let i = 1; i < m.spoken().length; i++) {
      m.fire('tts-finish');
    }
    expect(done).toHaveBeenCalledTimes(1);
    expect(isSpeaking()).toBe(false);
  });

  it('引擎不可用时 speakText 返回 ok=false（不抛）', async () => {
    const { tts: { speakText }, m } = load();
    m.failInit({ code: 'no_engine' });
    const r = await speakText('你好。', { lang: 'zh-CN' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.nextSteps).toBeTruthy();
    }
  });

  it('空文本直接成功且不调引擎', async () => {
    const { tts: { speakText }, m } = load();
    const r = await speakText('   ', { lang: 'zh-CN' });
    expect(r).toEqual({ ok: true, chunks: 0 });
    expect(m.spoken()).toEqual([]);
  });

  it('stop 会调引擎停止并复位状态', async () => {
    const { tts: { speakText, stopSpeaking, isSpeaking }, m } = load();
    const done = jest.fn();
    await speakText('长一点的一句话。', { lang: 'zh-CN', onDone: done });
    await flush();
    expect(isSpeaking()).toBe(true);
    await stopSpeaking();
    expect(isSpeaking()).toBe(false);
    expect(m.api.stop).toHaveBeenCalled();
    m.fire('tts-finish');
    expect(done).toHaveBeenCalled();
  });

  it('引擎报错时走 onError 并复位', async () => {
    const { tts: { speakText, isSpeaking }, m } = load();
    const err = jest.fn();
    await speakText('一句话。', { lang: 'zh-CN', onError: err });
    await flush();
    m.fire('tts-error');
    expect(err).toHaveBeenCalledTimes(1);
    expect(isSpeaking()).toBe(false);
  });
});
